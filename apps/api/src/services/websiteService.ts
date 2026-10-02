import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Agent, ProxyAgent } from 'undici';
import * as cheerio from 'cheerio';
import type { JobRecord, WebsiteAssetInfo } from '@projectpack/shared';
import { env } from '../config/env.js';
import { store } from './store.js';
import { jobManager } from '../jobs/jobManager.js';
import { scanWork } from './scanService.js';
import { reorganizeMirror, type MirrorFile } from './mirrorStructure.js';
import { AppError } from '../utils/errors.js';

/**
 * Website import: crawl a live site (pages + assets, images included), store
 * the mirror under the project's own data directory, and reuse the exact same
 * scan/extract/analyze/prompt pipeline as GitHub imports.
 *
 * Design notes:
 * - Pages are crawled same-host only (www stripped); assets (images, fonts,
 *   CSS, JS) are downloaded from any host — that is how CDN-hosted images are
 *   captured, the same behaviour extract.pics offers but without a paid API.
 * - robots.txt is respected (best effort) and requests are rate-delayed.
 * - Everything is bounded: max pages, max assets, total bytes, per-request
 *   timeout. After the crawl the mirror is reorganised into a real project
 *   structure (index.html, pages/, assets/css|js|images|fonts) and the
 *   references inside HTML/CSS are rewritten so the clone stays connected.
 */

const proxyUrl =
  process.env.HTTPS_PROXY ?? process.env.https_proxy ?? process.env.HTTP_PROXY ?? process.env.http_proxy;
// A direct agent lets loopback (tests, local dev) bypass any configured proxy.
const directAgent = new Agent();
const proxyAgent = proxyUrl ? new ProxyAgent(proxyUrl) : null;

function isLocalHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname.endsWith('.localhost')
  );
}

function dispatcherFor(url: URL): unknown {
  if (!proxyAgent) return undefined;
  return isLocalHost(url.hostname) ? directAgent : proxyAgent;
}

async function politeFetch(url: URL): Promise<Response> {
  const init: RequestInit = {
    redirect: 'follow',
    signal: AbortSignal.timeout(env.websiteTimeoutMs),
    headers: {
      'User-Agent': 'ProjectPack/0.3 (+website-import)',
      Accept: 'text/html,application/xhtml+xml,text/css,*/*;q=0.8',
    },
  };
  const dispatcher = dispatcherFor(url);
  return fetch(url, (dispatcher ? { ...init, dispatcher } : init) as RequestInit);
}

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.avif', '.bmp', '.tiff']);
const FONT_EXTENSIONS = new Set(['.woff', '.woff2', '.ttf', '.otf', '.eot']);
const CSS_EXTENSIONS = new Set(['.css']);
const JS_EXTENSIONS = new Set(['.js', '.mjs']);
const PAGE_EXTENSIONS = new Set(['', '.html', '.htm', '.xhtml', '.php', '.asp', '.aspx', '.jsp', '.cfm']);
// Heavy binaries the mirror deliberately skips (archives, installers, office
// docs…). Media (video/audio) IS downloaded — a faithful site copy needs it;
// total-size and per-file caps keep a runaway video from blowing the budget.
const SKIP_URL = /\.(zip|rar|7z|tar|gz|tgz|bz2|xz|exe|msi|dmg|pkg|deb|rpm|apk|iso|wasm)(\?|$)/i;

const MEDIA_EXTENSIONS = new Set([
  '.mp4', '.m4v', '.webm', '.mov', '.avi', '.mkv',
  '.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac',
]);

// Lazy-loading attributes hold the REAL image URL while src is a tiny
// placeholder — sites using them would otherwise lose most of their images.
const LAZY_ATTRS = [
  'data-src', 'data-original', 'data-lazy-src', 'data-lazy',
  'data-bg', 'data-background', 'data-bgset', 'data-poster',
];

const CONTENT_TYPE_EXT: Record<string, string> = {
  'text/html': '.html',
  'application/xhtml+xml': '.html',
  'text/css': '.css',
  'text/javascript': '.js',
  'application/javascript': '.js',
  'application/x-javascript': '.js',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/x-icon': '.ico',
  'image/vnd.microsoft.icon': '.ico',
  'image/avif': '.avif',
  'image/bmp': '.bmp',
  'image/tiff': '.tiff',
  'font/woff': '.woff',
  'font/woff2': '.woff2',
  'application/font-woff': '.woff',
  'font/ttf': '.ttf',
  'application/x-font-ttf': '.ttf',
  'application/json': '.json',
  'text/plain': '.txt',
  'text/xml': '.xml',
  'application/xml': '.xml',
};

interface FetchFailure {
  url: string;
  status?: number;
}

interface CrawlStats {
  pages: number;
  assets: number;
  images: number;
  bytes: number;
  failed: number;
  truncated: boolean;
  failures: FetchFailure[];
}

function normalizeKey(url: URL): string {
  return `${url.origin}${url.pathname}${url.search}`.toLowerCase();
}

function bareHost(hostname: string): string {
  return hostname.replace(/^www\./i, '').toLowerCase();
}

/** Strip anything dangerous out of a URL path segment. */
function sanitizeSegment(segment: string): string {
  const clean = segment
    .replace(/[^A-Za-z0-9._@ -]/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 120);
  return clean;
}

function extensionForUrl(url: URL): string {
  const last = decodeURIComponent(url.pathname.split('/').pop() ?? '');
  const dot = last.lastIndexOf('.');
  if (dot > 0 && dot < last.length - 1) return last.slice(dot).toLowerCase();
  return '';
}

/** Extension to save under — from the URL, or from the content type. */
function extensionFor(url: URL, contentType: string): string {
  const fromUrl = extensionForUrl(url);
  if (fromUrl) return fromUrl;
  const base = contentType.split(';')[0].trim().toLowerCase();
  return CONTENT_TYPE_EXT[base] ?? '';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch with one retry on rate-limit responses (429/503), honoring
 * Retry-After when present. Parallel crawls can trip bot protection —
 * backing off once usually recovers the asset instead of losing it.
 */
async function fetchWithRetry(url: URL): Promise<{ ok: true; res: Response } | { ok: false; status?: number }> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let res: Response;
    try {
      res = await politeFetch(url);
    } catch {
      return { ok: false }; // network error / timeout
    }
    if ((res.status === 429 || res.status === 503) && attempt === 0) {
      const retryAfter = Number(res.headers.get('retry-after'));
      const waitMs =
        Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(retryAfter * 1000, 5000)
          : 1500;
      await sleep(waitMs);
      continue;
    }
    return { ok: true, res };
  }
  return { ok: false, status: 429 }; // still rate-limited after the backoff
}

/** Best-effort robots.txt: returns disallowed path prefixes for our UA / "*". */
async function fetchRobots(origin: URL): Promise<string[]> {
  try {
    const res = await politeFetch(new URL('/robots.txt', origin));
    if (!res.ok) return [];
    const text = await res.text();
    const disallow: string[] = [];
    let applies = false;
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.split('#')[0].trim();
      if (!line) continue;
      const [rawKey, ...rest] = line.split(':');
      const key = rawKey.trim().toLowerCase();
      const value = rest.join(':').trim();
      if (key === 'user-agent') applies = value === '*' || /projectpack/i.test(value);
      else if (key === 'disallow' && applies && value) disallow.push(value);
    }
    return disallow;
  } catch {
    return [];
  }
}

/** Compute a safe on-disk path that mirrors the URL structure. */
function relativePathFor(url: URL, extension: string, usedPaths: Set<string>): string {
  const host = sanitizeSegment(bareHost(url.hostname)) || 'site';
  const rawSegments = decodeURIComponent(url.pathname).split('/').filter(Boolean);
  const dirSegments = rawSegments.slice(0, -1).map(sanitizeSegment).filter(Boolean);
  let fileName = sanitizeSegment(rawSegments[rawSegments.length - 1] ?? '');
  if (!fileName) fileName = 'index';
  // Trailing-slash URLs (and extension-less pages) get the resolved extension.
  if (!extensionForUrl(url) && extension) fileName = `${fileName}${extension}`;
  let rel = path.join(host, ...dirSegments, fileName);
  if (usedPaths.has(rel)) {
    // Different URL, same path (query variants) — disambiguate with a short hash.
    const hash = crypto.createHash('sha1').update(normalizeKey(url)).digest('hex').slice(0, 6);
    const dot = fileName.lastIndexOf('.');
    rel = path.join(host, ...dirSegments, dot > 0 ? `${fileName.slice(0, dot)}_${hash}${fileName.slice(dot)}` : `${fileName}_${hash}`);
  }
  usedPaths.add(rel);
  return rel;
}

interface PageRefs {
  pages: URL[];
  assets: { url: URL; alt?: string }[];
}

function parseHtmlRefs(html: string, pageUrl: URL): PageRefs {
  const pages: URL[] = [];
  const assets: { url: URL; alt?: string }[] = [];

  const resolve = (raw: string): URL | null => {
    try {
      const url = new URL(raw, pageUrl);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
      url.hash = '';
      return url;
    } catch {
      return null;
    }
  };

  const $ = cheerio.load(html);
  const pushAsset = (raw: string | undefined, alt?: string) => {
    if (!raw) return;
    const url = resolve(raw);
    if (url) assets.push({ url, alt });
  };
  const pushPage = (raw: string | undefined) => {
    if (!raw) return;
    const url = resolve(raw);
    if (url) pages.push(url);
  };

  $('a[href]').each((_, el) => pushPage($(el).attr('href')));
  $('link[href]').each((_, el) => pushAsset($(el).attr('href')));
  $('script[src]').each((_, el) => pushAsset($(el).attr('src')));
  $('img').each((_, el) => {
    const alt = $(el).attr('alt') || undefined;
    pushAsset($(el).attr('src'), alt);
    const srcset = $(el).attr('srcset') ?? $(el).attr('data-srcset');
    if (srcset) {
      // keep the highest-resolution candidate per srcset entry
      const best = srcset
        .split(',')
        .map((part) => part.trim().split(/\s+/)[0])
        .filter(Boolean)
        .pop();
      if (best) pushAsset(best, alt);
    }
    // lazy-loaded images: the real URL sits in a data-* attribute
    for (const attr of LAZY_ATTRS) pushAsset($(el).attr(attr), alt);
  });
  // lazy-load / background attributes on ANY element (sliders, heroes, divs…)
  $(LAZY_ATTRS.map((a) => `[${a}]`).join(',')).each((_, el) => {
    const node = $(el);
    for (const attr of LAZY_ATTRS) pushAsset(node.attr(attr));
  });
  $('source[src], video[src], video[poster], audio[src], use[href], embed[src]').each((_, el) => {
    const el2 = $(el);
    pushAsset(el2.attr('src') ?? el2.attr('poster') ?? el2.attr('href'));
    const srcset = el2.attr('srcset');
    if (srcset) {
      const best = srcset.split(',').map((p) => p.trim().split(/\s+/)[0]).filter(Boolean).pop();
      if (best) pushAsset(best);
    }
  });
  // CSS url() references inside inline styles.
  const urlRe = /url\((['"]?)([^'")]+)\1\)/gi;
  $('[style]').each((_, el) => {
    const style = $(el).attr('style') ?? '';
    for (const match of style.matchAll(urlRe)) pushAsset(match[2]);
  });

  return { pages: pages.filter((u) => !SKIP_URL.test(u.pathname)), assets };
}

function parseCssRefs(css: string, cssUrl: URL): URL[] {
  const urls: URL[] = [];
  const add = (raw: string) => {
    try {
      if (/^(data:|about:|#)/i.test(raw)) return;
      const url = new URL(raw, cssUrl);
      if (url.protocol === 'http:' || url.protocol === 'https:') urls.push(url);
    } catch {
      /* ignore malformed */
    }
  };
  for (const match of css.matchAll(/url\((['"]?)([^'")]+)\1\)/gi)) add(match[2]);
  for (const match of css.matchAll(/@import\s+(['"])([^'"]+)\1/gi)) add(match[2]);
  return urls;
}

/**
 * Asset URLs referenced inside JS/JSON string literals — galleries and
 * carousels often build their image lists in code instead of HTML.
 */
function parseJsRefs(source: string, baseUrl: URL): URL[] {
  const urls: URL[] = [];
  const re = /['"`]([^'"`\s]*?\.(?:png|jpe?g|gif|webp|svg|ico|avif|bmp|mp4|m4v|webm|mov|mp3|wav|ogg|m4a|woff2?|ttf|otf|eot)(?:\?[^'"`\s]*)?)['"`]/gi;
  for (const match of source.matchAll(re)) {
    try {
      const url = new URL(match[1], baseUrl);
      if (url.protocol === 'http:' || url.protocol === 'https:') urls.push(url);
    } catch {
      /* ignore malformed */
    }
  }
  return urls;
}

/** Classify a discovered URL: should it be fetched as a page or an asset? */
function isPageCandidate(url: URL, startHost: string, fromAnchor: boolean): boolean {
  if (bareHost(url.hostname) !== startHost) return false;
  if (SKIP_URL.test(url.pathname)) return false;
  const ext = extensionForUrl(url);
  if (PAGE_EXTENSIONS.has(ext)) return true;
  // Unknown extension reached via a link — assume it renders as a page.
  return fromAnchor && !IMAGE_EXTENSIONS.has(ext) && !CSS_EXTENSIONS.has(ext) && !JS_EXTENSIONS.has(ext) && !FONT_EXTENSIONS.has(ext);
}

function isAssetCandidate(url: URL): boolean {
  if (SKIP_URL.test(url.pathname)) return false;
  const ext = extensionForUrl(url);
  return (
    IMAGE_EXTENSIONS.has(ext) ||
    CSS_EXTENSIONS.has(ext) ||
    JS_EXTENSIONS.has(ext) ||
    FONT_EXTENSIONS.has(ext) ||
    MEDIA_EXTENSIONS.has(ext) ||
    ext === '.json' ||
    ext === '.xml' ||
    ext === '.txt' ||
    ext === '' // unknown — fetch and let the content type decide
  );
}

async function crawl(
  seed: URL,
  dest: string,
  report: (completed: number, total: number) => void,
  opts: { pages?: URL[] } = {},
): Promise<{ stats: CrawlStats; assets: WebsiteAssetInfo[]; mirrorFiles: MirrorFile[] }> {
  const startHost = bareHost(seed.hostname);
  const seen = new Set<string>();
  const usedPaths = new Set<string>();
  const saved = new Map<string, string>(); // url key -> relative path
  const assetInfos: WebsiteAssetInfo[] = [];
  // every file we save, so the mirror can be reorganised into a real project
  // structure (index.html, pages/, assets/css|js|images|fonts) afterwards
  const mirrorFiles: MirrorFile[] = [];
  const stats: CrawlStats = { pages: 0, assets: 0, images: 0, bytes: 0, failed: 0, truncated: false, failures: [] };
  const budget = env.websiteMaxPages + env.websiteMaxAssets;

  // Every failed download is recorded (capped) so the UI can tell the user
  // exactly what could not be fetched and why — a crawl that silently loses
  // assets looks like "missing files" otherwise.
  const recordFailure = (url: URL, status?: number) => {
    stats.failed += 1;
    if (stats.failures.length < 50) {
      stats.failures.push({ url: url.toString(), status });
    }
  };

  const disallowPrefixes = await fetchRobots(seed);
  const robotsBlocks = (url: URL): boolean =>
    disallowPrefixes.some((prefix) => prefix !== '' && url.pathname.startsWith(prefix));

  interface QueueItem {
    url: URL;
    kind: 'page' | 'asset';
    alt?: string;
    depth: number;
  }
  // Selective mode: when the user picked specific pages, ONLY those are
  // fetched (their assets included) and no further pages are discovered —
  // e.g. a student told to build just 4 pages of a site.
  const allowedPages =
    opts.pages && opts.pages.length > 0 ? new Set(opts.pages.map((u) => normalizeKey(u))) : null;
  const queue: QueueItem[] = allowedPages
    ? (opts.pages as URL[]).map((url) => ({ url, kind: 'page' as const, depth: 0 }))
    : [{ url: seed, kind: 'page', depth: 0 }];

  const recordProgress = () => report(Math.min(stats.pages + stats.assets, budget), budget);

  /**
   * Fetch one asset; stylesheets and scripts are parsed (bounded depth) so
   * @import chains, CSS url() references, and image/media URLs inside JS/JSON
   * string literals are followed too. Newly discovered assets are pushed onto
   * the shared queue so the worker pool fetches them in parallel.
   */
  const processAsset = async (item: QueueItem): Promise<void> => {
    const savedAsset = await fetchAndSave(item.url, item.alt);
    const savedPath = saved.get(normalizeKey(item.url));
    if (!savedAsset || !savedPath || item.depth >= 3) return;
    const kind = savedAsset.contentType;
    if (!kind.includes('text/css') && !kind.includes('javascript') && !kind.includes('application/json') && !kind.includes('text/plain')) {
      return;
    }
    const text = fs.readFileSync(path.join(dest, savedPath), 'utf8');
    const refs = kind.includes('text/css')
      ? parseCssRefs(text, item.url)
      : parseJsRefs(text, item.url);
    for (const refUrl of refs) {
      if (saved.has(normalizeKey(refUrl)) || seen.has(normalizeKey(refUrl))) continue;
      if (!isAssetCandidate(refUrl) || stats.assets >= env.websiteMaxAssets) continue;
      queue.push({ url: refUrl, kind: 'asset', depth: item.depth + 1 });
    }
  };

  const fetchAndSave = async (url: URL, alt?: string): Promise<{ html: string | null; contentType: string } | null> => {
    const outcome = await fetchWithRetry(url);
    if (!outcome.ok) {
      recordFailure(url, outcome.status);
      recordProgress();
      return null;
    }
    const res = outcome.res;
    if (!res.ok) {
      recordFailure(url, res.status);
      recordProgress();
      return null;
    }
    const contentType = res.headers.get('content-type') ?? '';
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > env.maxFileBytes || stats.bytes + buffer.length > env.websiteMaxTotalBytes) {
      stats.truncated = true;
      recordProgress();
      return null;
    }
    const extension = extensionFor(url, contentType);
    const isHtml = contentType.includes('text/html') || contentType.includes('application/xhtml');
    const effectiveExt = extension || (isHtml ? '.html' : '.bin');
    const rel = relativePathFor(url, effectiveExt, usedPaths);
    const abs = path.join(dest, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, buffer);
    stats.bytes += buffer.length;
    saved.set(normalizeKey(url), rel);
    mirrorFiles.push({ urlKey: normalizeKey(url), url: url.toString(), oldPath: rel, isPage: isHtml });
    if (IMAGE_EXTENSIONS.has(effectiveExt)) {
      stats.images += 1;
      // Same image can be referenced by an <img> tag (with alt text) and by
      // CSS (without) — merge so the alt text survives.
      const existing = assetInfos.find((a) => a.relativePath === rel);
      if (existing) {
        if (alt && !existing.alt) existing.alt = alt;
      } else {
        assetInfos.push({ relativePath: rel, url: url.toString(), contentType, alt });
      }
    }
    recordProgress();
    // Politeness delay per request (per worker) — with the worker pool this
    // keeps the request rate reasonable while fetching in parallel.
    if (env.websiteRequestDelayMs > 0) await sleep(env.websiteRequestDelayMs);
    return { html: isHtml ? buffer.toString('utf8') : null, contentType };
  };

  /** Process one queue item: a page (parse + discover) or an asset (save). */
  const processItem = async (item: QueueItem): Promise<void> => {
    const key = normalizeKey(item.url);
    if (seen.has(key)) return;
    if (robotsBlocks(item.url)) return;

    if (
      item.kind === 'page' &&
      (!allowedPages || allowedPages.has(key)) &&
      isPageCandidate(item.url, startHost, true) &&
      stats.pages < env.websiteMaxPages
    ) {
      seen.add(key);
      stats.pages += 1;
      const result = await fetchAndSave(item.url);
      if (result?.html) {
        const refs = parseHtmlRefs(result.html, item.url);
        // In selective mode links are not followed — only assets are collected.
        if (!allowedPages) {
          for (const page of refs.pages) queue.push({ url: page, kind: 'page', depth: 0 });
        }
        for (const asset of refs.assets) {
          if (saved.has(normalizeKey(asset.url)) || seen.has(normalizeKey(asset.url))) continue;
          if (isAssetCandidate(asset.url) && stats.assets < env.websiteMaxAssets) {
            queue.push({ url: asset.url, kind: 'asset', alt: asset.alt, depth: 0 });
          }
        }
      }
    } else if (isAssetCandidate(item.url) && stats.assets < env.websiteMaxAssets) {
      seen.add(key);
      stats.assets += 1;
      await processAsset(item);
    } else {
      // Over budget or not fetchable — mark seen so we do not revisit.
      seen.add(key);
    }
  };

  // Bounded worker pool: many requests run in parallel, cutting import time
  // roughly by the worker count while staying polite (delay after each
  // request, applied per worker).
  let active = 0;
  const workerCount = Math.max(1, Math.min(env.websiteConcurrency, 12));
  const worker = async (): Promise<void> => {
    for (;;) {
      const item = queue.shift();
      if (!item) {
        if (active === 0) return; // nothing in flight, nothing queued → done
        await sleep(15); // other workers may still enqueue more work
        continue;
      }
      active += 1;
      try {
        await processItem(item);
      } finally {
        active -= 1;
      }
    }
  };
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return { stats, assets: assetInfos, mirrorFiles };
}

function parseSeedUrl(rawUrl: string): URL {
  let seed: URL;
  try {
    seed = new URL(rawUrl.trim());
  } catch {
    throw new AppError('WEBSITE_ERROR', 'That does not look like a valid URL — expected e.g. https://example.com', 400);
  }
  if (seed.protocol !== 'http:' && seed.protocol !== 'https:') {
    throw new AppError('WEBSITE_ERROR', 'Only http:// and https:// URLs are supported', 400);
  }
  if (!seed.hostname) {
    throw new AppError('WEBSITE_ERROR', 'The URL has no hostname', 400);
  }
  return seed;
}

/**
 * The page links found on a site's landing page — powers the "crawl only these
 * pages" picker so a user can import 4 specific pages instead of a whole site.
 * The landing page itself is returned first.
 */
export async function listSitePages(rawUrl: string): Promise<string[]> {
  const seed = parseSeedUrl(rawUrl);
  let res: Response;
  try {
    res = await politeFetch(seed);
  } catch {
    throw new AppError('WEBSITE_ERROR', `Could not open ${seed.origin} — the site may be down or blocking automated access`, 502);
  }
  if (!res.ok) {
    throw new AppError('WEBSITE_ERROR', `Could not open ${seed.origin} (HTTP ${res.status})`, 502);
  }
  const html = await res.text();
  const { pages } = parseHtmlRefs(html, seed);
  const startHost = bareHost(seed.hostname);
  // never offer a page the site's robots.txt disallows
  const disallowPrefixes = await fetchRobots(seed);
  const blocked = (url: URL) =>
    disallowPrefixes.some((prefix) => prefix !== '' && url.pathname.startsWith(prefix));
  const seen = new Set<string>();
  const out: string[] = [seed.toString()];
  seen.add(normalizeKey(seed));
  for (const page of pages) {
    if (!isPageCandidate(page, startHost, true) || blocked(page)) continue;
    const key = normalizeKey(page);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(page.toString());
    if (out.length >= 200) break;
  }
  return out;
}

/** Import + scan a live website into a new project (same pipeline as GitHub). */
export async function analyzeWebsite(
  rawUrl: string,
  name?: string,
  options: { pages?: string[] } = {},
): Promise<{ projectId: string; job: JobRecord }> {
  const seed = parseSeedUrl(rawUrl);

  // Optional explicit page list (selective import).
  const selectedPages: URL[] = [];
  for (const raw of options.pages ?? []) {
    try {
      const candidate = new URL(raw.trim());
      if ((candidate.protocol === 'http:' || candidate.protocol === 'https:') && candidate.hostname) {
        selectedPages.push(candidate);
      }
    } catch {
      /* ignore malformed entries rather than failing the whole import */
    }
  }

  const project = store.createProject({
    name: name || bareHost(seed.hostname),
    sourceType: 'website',
    sourceLabel: seed.origin + (seed.pathname !== '/' ? seed.pathname : ''),
    rootPath: '', // filled by the job below
  });

  const job = jobManager.start(project.id, 'website-import', async ({ report }) => {
    const dest = path.join(env.dataDir, 'projects', project.id, 'source');
    // Progress is split in two phases so the bar never sits at 100% while
    // work is still running: crawling maps to the first 70% of the bar,
    // the scan/hashing phase fills the remaining 30%.
    const budget = env.websiteMaxPages + env.websiteMaxAssets;
    const crawlReport = (completed: number, total: number) => {
      void total;
      report(Math.min(Math.round(completed * 0.7), Math.round(budget * 0.7)), budget);
    };
    const { stats, assets, mirrorFiles } = await crawl(
      seed,
      dest,
      crawlReport,
      selectedPages.length > 0 ? { pages: selectedPages } : {},
    );
    if (stats.pages === 0 && stats.assets === 0) {
      throw new AppError(
        'WEBSITE_ERROR',
        selectedPages.length > 0
          ? `Could not fetch any of the ${selectedPages.length} selected page(s) — check the links, or try the whole-site crawl`
          : `Could not fetch anything from ${seed.origin} — the site may be down, blocking bots, or behind authentication`,
        502,
      );
    }
    store.updateProject(project.id, {
      rootPath: dest,
      // Persist download failures so the overview can tell the user exactly
      // which URLs could not be fetched (rate limiting, bot blocks, dead
      // links) instead of the mirror quietly missing files.
      importFailures: stats.failures,
    });
    // Turn the URL mirror into a real project structure and rewrite the links
    // inside HTML/CSS so the clone stays connected, then record the new paths.
    const { moved } = reorganizeMirror(dest, mirrorFiles, normalizeKey);
    store.saveWebsiteAssets(
      project.id,
      assets.map((asset) => ({ ...asset, relativePath: moved.get(asset.relativePath) ?? asset.relativePath })),
    );

    // Scan phase (70% → 100%): runs inline (not as a nested job) so its
    // progress feeds THIS job — the bar keeps moving while files are hashed
    // and the job only completes when the scan is fully done.
    store.updateProject(project.id, { status: 'scanning' });
    try {
      await scanWork(project.id, (completed, total, failed) => {
        if (total > 0) {
          report(Math.round(budget * (0.7 + 0.3 * (completed / total))), budget, failed);
        } else {
          report(Math.round(budget * 0.95), budget, failed);
        }
      });
    } catch (err) {
      store.updateProject(project.id, { status: 'error' });
      throw err;
    }
    return { ...stats, imported: true };
  });

  return { projectId: project.id, job };
}
