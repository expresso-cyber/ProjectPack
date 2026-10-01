import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { once } from 'node:events';
import { Agent, ProxyAgent } from 'undici';
import * as cheerio from 'cheerio';
import type { JobRecord, WebsiteAssetInfo } from '@projectpack/shared';
import { env } from '../config/env.js';
import { store } from './store.js';
import { jobManager } from '../jobs/jobManager.js';
import { scanWork } from './scanService.js';
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
 *   timeout. The HTML is stored byte-for-byte (URLs are NOT rewritten) so AI
 *   agents see the real source.
 */

const proxyUrl =
  process.env.HTTPS_PROXY ?? process.env.https_proxy ?? process.env.HTTP_PROXY ?? process.env.http_proxy;
// A direct agent lets loopback (tests, local dev) bypass any configured proxy.
// Keep-alive is on explicitly: a crawl makes hundreds of requests to the same
// host, and reusing the TLS connection instead of reconnecting each time is a
// large speed win.
const directAgent = new Agent({
  keepAliveTimeout: 60_000,
  keepAliveMaxTimeout: 300_000,
  connections: 32,
});
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
  if (!proxyAgent) return directAgent;
  return isLocalHost(url.hostname) ? directAgent : proxyAgent;
}

/**
 * Some hosts block datacenter IPs (or answer 403/451 to non-browser clients).
 * When a fallback proxy template is configured, retry through it — it comes
 * from a different IP, which usually succeeds. Disable by setting
 * WEBSITE_FALLBACK_PROXY to an empty string.
 */
function canUseFallback(url: URL): boolean {
  return Boolean(env.websiteFallbackProxy) && !isLocalHost(url.hostname);
}

async function fetchViaFallbackProxy(url: URL): Promise<Response> {
  const template = env.websiteFallbackProxy as string;
  const proxied = template.replace('{url}', encodeURIComponent(url.toString()));
  return fetch(proxied, {
    redirect: 'follow',
    signal: AbortSignal.timeout(env.websiteTimeoutMs),
    headers: { 'User-Agent': env.websiteUserAgent },
  });
}

async function politeFetch(url: URL, extraHeaders: Record<string, string> = {}): Promise<Response> {
  const init: RequestInit = {
    redirect: 'follow',
    signal: AbortSignal.timeout(env.websiteTimeoutMs),
    headers: {
      'User-Agent': env.websiteUserAgent,
      Accept: 'text/html,application/xhtml+xml,text/css,*/*;q=0.8',
      ...extraHeaders,
    },
  };
  const dispatcher = dispatcherFor(url);
  let res: Response;
  try {
    res = await fetch(url, (dispatcher ? { ...init, dispatcher } : init) as RequestInit);
  } catch (err) {
    if (!canUseFallback(url)) throw err;
    return await fetchViaFallbackProxy(url);
  }
  if ((res.status === 403 || res.status === 451) && canUseFallback(url)) {
    const proxied = await fetchViaFallbackProxy(url).catch(() => null);
    if (proxied && proxied.ok) return proxied;
  }
  return res;
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
  /** files actually present in the mirror (written or reused via 304) */
  saved: number;
  /** files kept from a previous import because the server said 304 */
  unchanged: number;
  /** heavy media files skipped because the user asked to skip them */
  skippedMedia: number;
}

/** What we know about a file from a previous import of the same site. */
export interface PreviousAsset {
  relativePath: string;
  url?: string;
  contentType?: string;
  alt?: string;
  hash?: string;
  size?: number;
  etag?: string;
  lastModified?: string;
}

/** True for video/audio URLs (skipped when the user opts out of heavy media). */
function isMediaUrl(url: URL): boolean {
  return MEDIA_EXTENSIONS.has(extensionForUrl(url));
}

/**
 * Stream a response body straight to disk, hashing as the bytes arrive.
 * Nothing is ever buffered whole in memory — this is what keeps a large
 * crawl from exhausting a small host's RAM.
 */
async function streamToFile(
  body: ReadableStream<Uint8Array>,
  absPath: string,
  hash: crypto.Hash,
  limits: { maxFileBytes: number; remainingTotal: number },
): Promise<{ size: number } | { tooBig: true } | { failed: true }> {
  const out = fs.createWriteStream(absPath);
  const reader = body.getReader();
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limits.maxFileBytes || size > limits.remainingTotal) {
        await reader.cancel().catch(() => undefined);
        out.destroy();
        return { tooBig: true };
      }
      hash.update(value);
      if (!out.write(Buffer.from(value))) {
        await once(out, 'drain');
      }
    }
    await new Promise<void>((resolve, reject) => {
      out.end(() => resolve());
      out.on('error', reject);
    });
    return { size };
  } catch {
    out.destroy();
    return { failed: true };
  }
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
async function fetchWithRetry(
  url: URL,
  headers: Record<string, string> = {},
): Promise<{ ok: true; res: Response } | { ok: false; status?: number }> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let res: Response;
    try {
      res = await politeFetch(url, headers);
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
  report: (completed: number, total: number, failed?: number, detail?: string) => void,
  opts: { skipMedia?: boolean; previous?: Map<string, PreviousAsset> } = {},
): Promise<{ stats: CrawlStats; assets: WebsiteAssetInfo[]; knownHashes: Map<string, string> }> {
  const startHost = bareHost(seed.hostname);
  const seen = new Set<string>();
  const usedPaths = new Set<string>();
  const saved = new Map<string, string>(); // url key -> relative path
  const assetInfos: WebsiteAssetInfo[] = [];
  const stats: CrawlStats = {
    pages: 0,
    assets: 0,
    images: 0,
    bytes: 0,
    failed: 0,
    truncated: false,
    failures: [],
    saved: 0,
    unchanged: 0,
    skippedMedia: 0,
  };
  const budget = env.websiteMaxPages + env.websiteMaxAssets;
  // The mirror directory must exist even when every fetch fails: the scan
  // engine validates the source root before reading it, and a missing folder
  // used to surface as the confusing "Source root is not accessible".
  fs.mkdirSync(dest, { recursive: true });
  // Hashes computed while downloading — the scan phase reuses them instead of
  // re-reading every file off disk.
  const knownHashes = new Map<string, string>();
  const previous = opts.previous ?? new Map<string, PreviousAsset>();

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
  const queue: QueueItem[] = [{ url: seed, kind: 'page', depth: 0 }];

  const recordProgress = () => {
    const mb = (stats.bytes / (1024 * 1024)).toFixed(1);
    const parts = [`${stats.pages} pages`, `${stats.assets} assets`, `${mb} MB`];
    if (stats.unchanged > 0) parts.push(`${stats.unchanged} unchanged`);
    if (stats.failed > 0) parts.push(`${stats.failed} failed`);
    report(Math.min(stats.pages + stats.assets, budget), budget, undefined, parts.join(' · '));
  };

  /** Register an asset (merging alt text when the same file is seen twice). */
  const rememberAsset = (
    rel: string,
    url: URL,
    contentType: string,
    alt: string | undefined,
    meta: Pick<WebsiteAssetInfo, 'hash' | 'size' | 'etag' | 'lastModified'>,
  ) => {
    const existing = assetInfos.find((a) => a.relativePath === rel);
    if (existing) {
      if (alt && !existing.alt) existing.alt = alt;
      return;
    }
    assetInfos.push({ relativePath: rel, url: url.toString(), contentType, alt, ...meta });
  };

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
    const key = normalizeKey(url);
    const prev = previous.get(key);
    // Conditional request: if we already have this file from an earlier
    // import, ask the server whether it changed. A 304 means we skip the
    // download AND the hash entirely — re-imports become seconds.
    // Validators are only sent when the local copy still exists (the disk is
    // ephemeral on small hosts — a 304 with no local file would lose it).
    const prevPath = prev ? path.join(dest, prev.relativePath) : '';
    const havePrev = Boolean(prev && fs.existsSync(prevPath));
    const validators: Record<string, string> = {};
    if (havePrev && prev?.etag) validators['if-none-match'] = prev.etag;
    if (havePrev && prev?.lastModified) validators['if-modified-since'] = prev.lastModified;

    const outcome = await fetchWithRetry(url, validators);
    if (!outcome.ok) {
      recordFailure(url, outcome.status);
      recordProgress();
      return null;
    }
    const res = outcome.res;
    const contentType = res.headers.get('content-type') ?? '';

    if (res.status === 304 && prev && havePrev) {
      const abs = path.join(dest, prev.relativePath);
      if (fs.existsSync(abs)) {
        const effectiveType = prev.contentType ?? contentType;
        const isHtmlPage =
          effectiveType.includes('text/html') || effectiveType.includes('application/xhtml');
        saved.set(key, prev.relativePath);
        stats.bytes += prev.size ?? 0;
        stats.saved += 1;
        stats.unchanged += 1;
        if (prev.hash) knownHashes.set(prev.relativePath, prev.hash);
        if (IMAGE_EXTENSIONS.has(path.extname(prev.relativePath))) {
          stats.images += 1;
          rememberAsset(prev.relativePath, url, effectiveType, alt, {
            hash: prev.hash,
            size: prev.size,
            etag: prev.etag,
            lastModified: prev.lastModified,
          });
        }
        recordProgress();
        if (env.websiteRequestDelayMs > 0) await sleep(env.websiteRequestDelayMs);
        // Pages still need their HTML parsed to discover links/assets.
        return {
          html: isHtmlPage ? fs.readFileSync(abs, 'utf8') : null,
          contentType: effectiveType,
        };
      }
    }

    if (!res.ok || !res.body) {
      recordFailure(url, res.status);
      recordProgress();
      return null;
    }

    const extension = extensionFor(url, contentType);
    const isHtml = contentType.includes('text/html') || contentType.includes('application/xhtml');
    const effectiveExt = extension || (isHtml ? '.html' : '.bin');
    const rel = relativePathFor(url, effectiveExt, usedPaths);
    const abs = path.join(dest, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });

    const hash = crypto.createHash('sha256');
    const written = await streamToFile(res.body, abs, hash, {
      maxFileBytes: env.maxFileBytes,
      remainingTotal: Math.max(0, env.websiteMaxTotalBytes - stats.bytes),
    });
    if ('tooBig' in written) {
      stats.truncated = true;
      fs.rmSync(abs, { force: true });
      recordProgress();
      return null;
    }
    if ('failed' in written) {
      fs.rmSync(abs, { force: true });
      recordFailure(url);
      recordProgress();
      return null;
    }

    const digest = hash.digest('hex');
    stats.bytes += written.size;
    stats.saved += 1;
    saved.set(key, rel);
    knownHashes.set(rel, digest);
    if (IMAGE_EXTENSIONS.has(effectiveExt)) {
      stats.images += 1;
      // Same image can be referenced by an <img> tag (with alt text) and by
      // CSS (without) — merge so the alt text survives.
      rememberAsset(rel, url, contentType, alt, {
        hash: digest,
        size: written.size,
        etag: res.headers.get('etag') ?? undefined,
        lastModified: res.headers.get('last-modified') ?? undefined,
      });
    }
    recordProgress();
    // Politeness delay per request (per worker) — with the worker pool this
    // keeps the request rate reasonable while fetching in parallel.
    if (env.websiteRequestDelayMs > 0) await sleep(env.websiteRequestDelayMs);
    return { html: isHtml ? fs.readFileSync(abs, 'utf8') : null, contentType };
  };

  /** Process one queue item: a page (parse + discover) or an asset (save). */
  const processItem = async (item: QueueItem): Promise<void> => {
    const key = normalizeKey(item.url);
    if (seen.has(key)) return;
    if (robotsBlocks(item.url)) return;
    // Opt-out of heavy media (video/audio): skipped before it ever enters the
    // queue or counts against the byte budget.
    if (opts.skipMedia && item.kind === 'asset' && isMediaUrl(item.url)) {
      seen.add(key);
      stats.skippedMedia += 1;
      return;
    }

    if (item.kind === 'page' && isPageCandidate(item.url, startHost, true) && stats.pages < env.websiteMaxPages) {
      seen.add(key);
      stats.pages += 1;
      const result = await fetchAndSave(item.url);
      if (result?.html) {
        const refs = parseHtmlRefs(result.html, item.url);
        for (const page of refs.pages) queue.push({ url: page, kind: 'page', depth: 0 });
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

  return { stats, assets: assetInfos, knownHashes };
}

/** Import + scan a live website into a project (same pipeline as GitHub). */
export interface WebsiteImportOptions {
  /** skip video/audio files entirely (much smaller, much faster import) */
  skipMedia?: boolean;
}

export async function analyzeWebsite(
  rawUrl: string,
  name?: string,
  options: WebsiteImportOptions = {},
): Promise<{ projectId: string; job: JobRecord; reused: boolean }> {
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

  const sourceLabel = seed.origin + (seed.pathname !== '/' ? seed.pathname : '');

  // Re-importing a site we already have REFRESHES that project instead of
  // creating a duplicate: files the server reports unchanged come back as 304
  // (not re-downloaded, not re-hashed) and the rescan keeps already-extracted
  // content. This also recovers assets that failed on the first attempt.
  const existing = store
    .listProjects()
    .find((p) => p.sourceType === 'website' && p.sourceLabel === sourceLabel && p.rootPath);

  const project =
    existing ??
    store.createProject({
      name: name || bareHost(seed.hostname),
      sourceType: 'website',
      sourceLabel,
      rootPath: '', // filled by the job below
    });

  // Validators from the previous import of this project (URL → asset info).
  const previous = new Map<string, PreviousAsset>();
  if (existing) {
    for (const asset of store.getWebsiteAssets(existing.id)) {
      if (!asset.url) continue;
      try {
        previous.set(normalizeKey(new URL(asset.url)), asset);
      } catch {
        /* stored URL no longer parses — treat as new */
      }
    }
  }

  const job = jobManager.start(project.id, 'website-import', async ({ report }) => {
    const dest = path.join(env.dataDir, 'projects', project.id, 'source');
    // Progress is split in two phases so the bar never sits at 100% while
    // work is still running: crawling maps to the first 70% of the bar,
    // the scan/hashing phase fills the remaining 30%.
    const budget = env.websiteMaxPages + env.websiteMaxAssets;
    const crawlReport = (completed: number, _total: number, _failed?: number, detail?: string) => {
      report(Math.min(Math.round(completed * 0.7), Math.round(budget * 0.7)), budget, 0, detail);
    };
    const { stats, assets, knownHashes } = await crawl(seed, dest, crawlReport, {
      skipMedia: options.skipMedia,
      previous,
    });
    if (stats.saved === 0) {
      // Nothing reached the mirror — say exactly why (status + first URL)
      // instead of letting the scan fail with a cryptic path error.
      const first = stats.failures[0];
      const reason = first
        ? `${first.status ?? 'network error'} on ${first.url}`
        : 'no pages or assets were found';
      throw new AppError(
        'WEBSITE_ERROR',
        `Could not download anything from ${seed.origin} (${reason}). The site may be ` +
          'blocking automated access, rate-limiting, or behind authentication — try again in a ' +
          'minute, or paste the URL from a different network.',
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
    store.saveWebsiteAssets(project.id, assets);

    // Scan phase (70% → 100%): runs inline (not as a nested job) so its
    // progress feeds THIS job — the bar keeps moving while files are hashed
    // and the job only completes when the scan is fully done. Hashes computed
    // during the download are reused, so this phase only hashes what changed.
    store.updateProject(project.id, { status: 'scanning' });
    try {
      await scanWork(
        project.id,
        (completed, total, failed) => {
          const detail = total > 0 ? `Indexing files — ${completed}/${total}` : 'Indexing files';
          if (total > 0) {
            report(Math.round(budget * (0.7 + 0.3 * (completed / total))), budget, failed, detail);
          } else {
            report(Math.round(budget * 0.95), budget, failed, detail);
          }
        },
        { knownHashes },
      );
    } catch (err) {
      store.updateProject(project.id, { status: 'error' });
      throw err;
    }
    return { ...stats, imported: true, reused: Boolean(existing) };
  });

  return { projectId: project.id, job, reused: Boolean(existing) };
}
