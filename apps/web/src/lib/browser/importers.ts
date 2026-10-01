/**
 * Browser Mode importers. All fetching happens in the visitor's browser:
 *  - local folder  → File System Access API (Chrome/Edge), reads their disk
 *  - GitHub repo   → api.github.com + raw.githubusercontent.com (CORS-enabled)
 *  - website       → fetched through a public CORS proxy (a browser cannot
 *                    read a cross-origin page directly)
 */
import { blobToText } from './blob';
import { sha256Hex } from './hash';
import {
  LIMITS,
  extensionOf,
  formatMb,
  isMediaPath,
  isTextPath,
  shouldSkipDir,
} from './types';
import type { ImportedFile, ImportResult, ProgressFn } from './types';

/* ------------------------------------------------------------------ budget */

class Budget {
  files: ImportedFile[] = [];
  bytes = 0;
  skippedMedia = 0;
  truncated = false;

  constructor(private readonly skipMedia: boolean) {}

  full(): boolean {
    if (this.files.length >= LIMITS.maxFiles || this.bytes >= LIMITS.maxTotalBytes) {
      this.truncated = true;
      return true;
    }
    return false;
  }

  skip(path: string): boolean {
    if (this.skipMedia && isMediaPath(path)) {
      this.skippedMedia += 1;
      return true;
    }
    return false;
  }

  tooBig(size: number): boolean {
    if (size > LIMITS.maxFileBytes) {
      this.truncated = true;
      return true;
    }
    return false;
  }

  async add(path: string, blob: Blob): Promise<void> {
    const hash = await sha256Hex(blob);
    let text: string | undefined;
    if (isTextPath(path) && blob.size <= 512 * 1024) {
      try {
        text = await blobToText(blob);
      } catch {
        text = undefined;
      }
    }
    this.files.push({ relativePath: path, blob, size: blob.size, hash, text });
    this.bytes += blob.size;
  }

  result(): ImportResult {
    return { files: this.files, skippedMedia: this.skippedMedia, truncated: this.truncated };
  }
}

/* ------------------------------------------------------------ local folder */

export interface FileHandleLike {
  kind: 'file';
  name: string;
  getFile(): Promise<File>;
}
export interface DirHandleLike {
  kind: 'directory';
  name: string;
  values(): AsyncIterableIterator<DirHandleLike | FileHandleLike>;
}

type PickerWindow = Window & {
  showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<DirHandleLike>;
};

export function folderPickerAvailable(): boolean {
  return typeof window !== 'undefined' && typeof (window as PickerWindow).showDirectoryPicker === 'function';
}

export async function pickFolder(): Promise<DirHandleLike | null> {
  const picker = (window as PickerWindow).showDirectoryPicker;
  if (!picker) {
    throw new Error('This browser cannot open folders directly — use Chrome or Edge for local folders.');
  }
  return picker({ mode: 'read' });
}

export async function importLocalFolder(
  handle: DirHandleLike,
  onProgress: ProgressFn,
  skipMedia = false,
): Promise<ImportResult> {
  const budget = new Budget(skipMedia);
  const walk = async (dir: DirHandleLike, prefix: string): Promise<void> => {
    for await (const entry of dir.values()) {
      if (budget.full()) return;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.kind === 'directory') {
        if (shouldSkipDir(entry.name)) continue;
        await walk(entry, path);
        continue;
      }
      if (budget.skip(path)) continue;
      let file: File;
      try {
        file = await entry.getFile();
      } catch {
        continue; // unreadable entry — skip it rather than abort the import
      }
      if (budget.tooBig(file.size)) continue;
      await budget.add(path, file);
      onProgress({
        phase: 'Reading folder',
        completed: budget.files.length,
        total: budget.files.length,
        detail: `${budget.files.length} files · ${formatMb(budget.bytes)}`,
      });
    }
  };
  await walk(handle, '');
  return budget.result();
}

/* ----------------------------------------------------------------- github */

export function parseGithubUrl(raw: string): { owner: string; repo: string; branch?: string } {
  const cleaned = raw.trim().replace(/\.git$/i, '').replace(/\/+$/, '');
  const match = cleaned.match(/github\.com[/:]([^/]+)\/([^/#?]+)(?:\/(?:tree|blob)\/([^/#?]+))?/i);
  if (!match) throw new Error('Expected a GitHub URL like https://github.com/owner/repo');
  return { owner: match[1], repo: match[2], branch: match[3] };
}

interface GithubTreeResponse {
  tree?: { path: string; type: string; size?: number }[];
}

export async function importGithubRepo(
  rawUrl: string,
  onProgress: ProgressFn,
  skipMedia = false,
): Promise<ImportResult> {
  const { owner, repo, branch } = parseGithubUrl(rawUrl);
  const headers = { Accept: 'application/vnd.github+json' };

  const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });
  if (repoRes.status === 403) {
    throw new Error(
      'GitHub rate limit reached (60 requests/hour without a token). Wait a bit, or import the repo from a local clone.',
    );
  }
  if (repoRes.status === 404) throw new Error(`Repository ${owner}/${repo} was not found (is it public?)`);
  if (!repoRes.ok) throw new Error(`GitHub API error ${repoRes.status}`);
  const meta = (await repoRes.json()) as { default_branch?: string };
  const ref = branch ?? meta.default_branch ?? 'main';

  const treeRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
    { headers },
  );
  if (!treeRes.ok) throw new Error(`Could not read the repository tree (${treeRes.status})`);
  const tree = (await treeRes.json()) as GithubTreeResponse;
  const blobs = (tree.tree ?? [])
    .filter((node) => node.type === 'blob')
    .filter((node) => !node.path.split('/').some((segment) => shouldSkipDir(segment)));

  const budget = new Budget(skipMedia);
  const total = Math.min(blobs.length, LIMITS.maxFiles);
  for (const blob of blobs) {
    if (budget.full()) break;
    if (budget.skip(blob.path)) continue;
    if (budget.tooBig(blob.size ?? 0)) continue;
    const url = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(ref)}/${blob.path
      .split('/')
      .map(encodeURIComponent)
      .join('/')}`;
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      await budget.add(blob.path, await res.blob());
    } catch {
      continue;
    }
    onProgress({
      phase: 'Downloading repository',
      completed: budget.files.length,
      total,
      detail: `${budget.files.length}/${total} files · ${formatMb(budget.bytes)}`,
    });
  }
  if (budget.files.length === 0) throw new Error('No files could be downloaded from that repository.');
  return budget.result();
}

/* ---------------------------------------------------------------- website */

export const DEFAULT_PROXY = 'https://api.allorigins.win/raw?url={url}';

function proxied(template: string, url: string): string {
  return template.replace('{url}', encodeURIComponent(url));
}

export function normalizeUrl(raw: string): URL {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error('Paste a website URL first.');
  const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(withProto);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http:// and https:// URLs are supported');
  }
  return url;
}

function bareHost(hostname: string): string {
  return hostname.replace(/^www\./i, '');
}

function sameSite(url: URL, start: URL): boolean {
  return bareHost(url.hostname) === bareHost(start.hostname);
}

/** CSS url(...) and @import references, resolved against the stylesheet URL. */
export function urlsInCss(css: string, base: URL): URL[] {
  const out: URL[] = [];
  const re = /url\(\s*(['"]?)([^'")]+)\1\s*\)|@import\s+(['"])([^'"]+)\3/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(css)) !== null) {
    const raw = match[2] ?? match[4];
    if (!raw || raw.startsWith('data:')) continue;
    try {
      out.push(new URL(raw, base));
    } catch {
      /* ignore unparseable reference */
    }
  }
  return out;
}

/** Page links and asset URLs found in an HTML document. */
export function refsFromHtml(html: string, base: URL): { pages: URL[]; assets: URL[] } {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const pages: URL[] = [];
  const assets: URL[] = [];
  const resolve = (raw: string | null | undefined): URL | null => {
    if (!raw) return null;
    const value = raw.trim();
    if (!value || /^(data:|mailto:|javascript:|tel:|#)/i.test(value)) return null;
    try {
      return new URL(value, base);
    } catch {
      return null;
    }
  };

  doc.querySelectorAll('a[href]').forEach((el) => {
    const url = resolve(el.getAttribute('href'));
    if (url) pages.push(url);
  });
  doc.querySelectorAll('link[href]').forEach((el) => {
    const url = resolve(el.getAttribute('href'));
    if (url) assets.push(url);
  });
  doc.querySelectorAll('script[src]').forEach((el) => {
    const url = resolve(el.getAttribute('src'));
    if (url) assets.push(url);
  });
  doc.querySelectorAll('img[src], source[src], video[src], audio[src], track[src], embed[src], object[data]').forEach((el) => {
    const url = resolve(el.getAttribute('src') ?? el.getAttribute('data'));
    if (url) assets.push(url);
  });
  doc.querySelectorAll('[srcset]').forEach((el) => {
    for (const part of (el.getAttribute('srcset') ?? '').split(',')) {
      const url = resolve(part.trim().split(/\s+/)[0]);
      if (url) assets.push(url);
    }
  });
  for (const attr of ['data-src', 'data-original', 'data-lazy-src', 'data-bg', 'data-background', 'data-poster', 'data-bgset']) {
    doc.querySelectorAll(`[${attr}]`).forEach((el) => {
      const url = resolve(el.getAttribute(attr));
      if (url) assets.push(url);
    });
  }
  doc.querySelectorAll('[style]').forEach((el) => {
    assets.push(...urlsInCss(el.getAttribute('style') ?? '', base));
  });
  doc.querySelectorAll('style').forEach((el) => {
    assets.push(...urlsInCss(el.textContent ?? '', base));
  });

  return { pages, assets };
}

const CONTENT_TYPE_EXT: Record<string, string> = {
  'text/html': '.html',
  'application/xhtml+xml': '.html',
  'text/css': '.css',
  'text/javascript': '.js',
  'application/javascript': '.js',
  'application/json': '.json',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/x-icon': '.ico',
  'image/avif': '.avif',
  'font/woff': '.woff',
  'font/woff2': '.woff2',
  'font/ttf': '.ttf',
  'font/otf': '.otf',
};

export function extensionForContentType(type: string): string {
  return CONTENT_TYPE_EXT[type.split(';')[0].trim().toLowerCase()] ?? '';
}

/** Mirror a URL onto a safe relative path (host + path, with an extension). */
export function pathForUrl(url: URL, contentType = ''): string {
  const host = bareHost(url.hostname) || 'site';
  const segments = decodeURIComponent(url.pathname)
    .split('/')
    .filter(Boolean)
    .map((segment) => segment.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 60));
  if (segments.length === 0) return `${host}/index.html`;
  const last = segments[segments.length - 1];
  if (!/\.[a-z0-9]{1,6}$/i.test(last)) {
    const ext = extensionForContentType(contentType);
    if (url.pathname.endsWith('/')) segments.push('index.html');
    else segments[segments.length - 1] = `${last}${ext || '.html'}`;
  }
  return [host, ...segments].join('/');
}

export interface WebsiteImportOptions {
  proxyTemplate?: string;
  skipMedia?: boolean;
  maxPages?: number;
  maxAssets?: number;
}

export async function importWebsite(
  rawUrl: string,
  onProgress: ProgressFn,
  options: WebsiteImportOptions = {},
): Promise<ImportResult> {
  const start = normalizeUrl(rawUrl);
  const template = options.proxyTemplate?.trim() || DEFAULT_PROXY;
  const maxPages = options.maxPages ?? 25;
  const maxAssets = options.maxAssets ?? 250;
  const budget = new Budget(Boolean(options.skipMedia));
  const seen = new Set<string>();
  const usedPaths = new Set<string>();
  const key = (url: URL) => `${url.origin}${url.pathname}${url.search}`.toLowerCase();

  const uniquePath = (path: string): string => {
    if (!usedPaths.has(path)) {
      usedPaths.add(path);
      return path;
    }
    const dot = path.lastIndexOf('.');
    const base = dot > 0 ? path.slice(0, dot) : path;
    const ext = dot > 0 ? path.slice(dot) : '';
    for (let i = 2; ; i += 1) {
      const candidate = `${base}-${i}${ext}`;
      if (!usedPaths.has(candidate)) {
        usedPaths.add(candidate);
        return candidate;
      }
    }
  };

  const fetchVia = async (url: URL): Promise<Response> => {
    const res = await fetch(proxied(template, url.toString()));
    if (!res.ok) throw new Error(`Fetch failed (${res.status}) for ${url.toString()}`);
    return res;
  };

  // 1 — pages (same site), which also reveal more assets
  const pages: URL[] = [start];
  const assets: URL[] = [];
  let crawled = 0;
  while (pages.length > 0 && crawled < maxPages) {
    const page = pages.shift() as URL;
    if (seen.has(key(page))) continue;
    seen.add(key(page));
    crawled += 1;
    onProgress({
      phase: 'Crawling pages',
      completed: crawled,
      total: maxPages,
      detail: `${crawled} pages · ${budget.files.length} files`,
    });
    let res: Response;
    try {
      res = await fetchVia(page);
    } catch {
      continue;
    }
    const html = await res.text();
    const contentType = res.headers.get('content-type') ?? 'text/html';
    await budget.add(uniquePath(pathForUrl(page, contentType)), new Blob([html], { type: 'text/html' }));
    const refs = refsFromHtml(html, page);
    for (const candidate of refs.pages) {
      if (sameSite(candidate, start) && !seen.has(key(candidate)) && crawled + pages.length < maxPages) {
        pages.push(candidate);
      }
    }
    assets.push(...refs.assets);
  }

  // 2 — assets (any host, so CDN images/fonts come along)
  const queue = [...assets];
  let fetched = 0;
  while (queue.length > 0 && fetched < maxAssets && !budget.full()) {
    const asset = queue.shift() as URL;
    if (seen.has(key(asset))) continue;
    seen.add(key(asset));
    fetched += 1;
    if (budget.skip(pathForUrl(asset))) continue;
    let res: Response;
    try {
      res = await fetchVia(asset);
    } catch {
      continue;
    }
    const blob = await res.blob();
    if (budget.tooBig(blob.size)) continue;
    const path = uniquePath(pathForUrl(asset, res.headers.get('content-type') ?? blob.type));
    await budget.add(path, blob);
    if (path.endsWith('.css') && fetched + queue.length < maxAssets) {
      try {
        queue.push(...urlsInCss(await blobToText(blob), asset));
      } catch {
        /* not text — skip its references */
      }
    }
    onProgress({
      phase: 'Downloading assets',
      completed: fetched,
      total: Math.min(maxAssets, fetched + queue.length),
      detail: `${budget.files.length} files · ${formatMb(budget.bytes)}`,
    });
  }

  if (budget.files.length === 0) {
    throw new Error(
      'Nothing could be fetched through the proxy — check the URL, or try a different proxy template.',
    );
  }
  return budget.result();
}

export { extensionOf };
