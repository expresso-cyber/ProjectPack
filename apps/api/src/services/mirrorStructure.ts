/**
 * Turn a raw URL mirror into a real project structure.
 *
 * The crawler saves every file under its hostname (`c0.wp.com/c/7.1.2/…`,
 * `fonts.googleapis.com/css.css`), which is faithful to the URLs but is not a
 * project anyone would want to open. This module reorganises the mirror into
 * the layout a static site actually has —
 *
 *   index.html
 *   about.html
 *   pages/service.html
 *   assets/css/*.css
 *   assets/js/*.js
 *   assets/images/*
 *   assets/fonts/*
 *   assets/media/*
 *   assets/files/*
 *
 * — and rewrites the references inside HTML and CSS so the clone stays fully
 * connected (pages link to each other, stylesheets find their images, etc.).
 */
import fs from 'node:fs';
import path from 'node:path';
import * as cheerio from 'cheerio';

export interface MirrorFile {
  /** normalised URL key (origin + path + search, lower-cased) */
  urlKey: string;
  /** the absolute URL this file was downloaded from */
  url: string;
  /** where the crawler put it (host-first path) */
  oldPath: string;
  isPage: boolean;
}

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.avif', '.bmp', '.tiff']);
const FONT_EXT = new Set(['.woff', '.woff2', '.ttf', '.otf', '.eot']);
const MEDIA_EXT = new Set(['.mp4', '.m4v', '.webm', '.mov', '.avi', '.mkv', '.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac']);

function bucketFor(extension: string): string {
  if (IMAGE_EXT.has(extension)) return 'assets/images';
  if (extension === '.css') return 'assets/css';
  if (extension === '.js' || extension === '.mjs') return 'assets/js';
  if (FONT_EXT.has(extension)) return 'assets/fonts';
  if (MEDIA_EXT.has(extension)) return 'assets/media';
  return 'assets/files';
}

function extensionOf(p: string): string {
  const base = p.slice(p.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot).toLowerCase() : '';
}

function baseNameOf(p: string): string {
  return p.slice(p.lastIndexOf('/') + 1);
}

/** Where a page should live in the project: root page → index.html. */
export function pageTargetPath(url: URL): string {
  let pathname = url.pathname.replace(/^\/+/, '');
  if (pathname === '' || pathname === 'index.html') return 'index.html';
  if (/\.[a-z0-9]{1,6}$/i.test(pathname)) return pathname;
  return `${pathname}.html`;
}

function assetTargetPath(oldPath: string, used: Set<string>): string {
  const extension = extensionOf(oldPath);
  const bucket = bucketFor(extension);
  const base = baseNameOf(oldPath) || `file${extension}`;
  let candidate = `${bucket}/${base}`;
  if (used.has(candidate)) {
    const dot = candidate.lastIndexOf('.');
    const stem = dot > 0 ? candidate.slice(0, dot) : candidate;
    const ext = dot > 0 ? candidate.slice(dot) : '';
    for (let i = 2; ; i += 1) {
      const next = `${stem}-${i}${ext}`;
      if (!used.has(next)) {
        candidate = next;
        break;
      }
    }
  }
  used.add(candidate);
  return candidate;
}

export interface MirrorPlan {
  /** oldPath → newPath */
  byOldPath: Map<string, string>;
  /** urlKey → newPath (used for reference rewriting) */
  byUrlKey: Map<string, string>;
}

export function planMirror(files: MirrorFile[]): MirrorPlan {
  const byOldPath = new Map<string, string>();
  const byUrlKey = new Map<string, string>();
  const used = new Set<string>();

  // pages first so index.html keeps the root slot
  const ordered = [...files].sort((a, b) => Number(b.isPage) - Number(a.isPage));
  for (const file of ordered) {
    let target: string;
    if (file.isPage) {
      try {
        target = pageTargetPath(new URL(file.url));
      } catch {
        target = `pages/${baseNameOf(file.oldPath) || 'page.html'}`;
      }
      if (used.has(target)) {
        const dot = target.lastIndexOf('.');
        const stem = dot > 0 ? target.slice(0, dot) : target;
        const ext = dot > 0 ? target.slice(dot) : '';
        for (let i = 2; ; i += 1) {
          if (!used.has(`${stem}-${i}${ext}`)) {
            target = `${stem}-${i}${ext}`;
            break;
          }
        }
      }
      used.add(target);
    } else {
      target = assetTargetPath(file.oldPath, used);
    }
    byOldPath.set(file.oldPath, target);
    byUrlKey.set(file.urlKey, target);
  }
  return { byOldPath, byUrlKey };
}

/** Relative path from one mirror path to another (posix, HTML-friendly). */
export function relativeLink(fromPath: string, toPath: string): string {
  const fromDir = path.posix.dirname(fromPath);
  const rel = path.posix.relative(fromDir === '.' ? '' : fromDir, toPath);
  return rel === '' ? path.posix.basename(toPath) : rel;
}

const URL_ATTRS = ['href', 'src', 'data-src', 'data-original', 'data-lazy-src', 'data-bg', 'data-background', 'data-poster', 'poster', 'action'];
const SRCSET_ATTRS = ['srcset', 'data-bgset'];

const CSS_URL_RE = /url\(\s*(['"]?)([^'")]+)\1\s*\)|@import\s+(['"])([^'"]+)\3/gi;

function rewriteCssText(
  css: string,
  baseUrl: URL,
  fromPath: string,
  plan: MirrorPlan,
  normalizeKey: (url: URL) => string,
): string {
  return css.replace(CSS_URL_RE, (match, _q1: string, raw1: string | undefined, _q2: string, raw2: string | undefined) => {
    const raw = raw1 ?? raw2;
    if (!raw || raw.startsWith('data:') || raw.startsWith('#')) return match;
    try {
      const target = plan.byUrlKey.get(normalizeKey(new URL(raw, baseUrl)));
      if (!target) return match;
      return match.replace(raw, relativeLink(fromPath, target));
    } catch {
      return match;
    }
  });
}

function rewriteHtml(
  html: string,
  pageUrl: URL,
  pageNewPath: string,
  plan: MirrorPlan,
  normalizeKey: (url: URL) => string,
): string {
  const $ = cheerio.load(html);
  const mapRef = (raw: string | undefined): string | undefined => {
    if (!raw) return raw;
    const value = raw.trim();
    if (!value || value.startsWith('#') || /^(data:|mailto:|tel:|javascript:)/i.test(value)) return raw;
    try {
      const target = plan.byUrlKey.get(normalizeKey(new URL(value, pageUrl)));
      if (!target) return raw;
      return relativeLink(pageNewPath, target);
    } catch {
      return raw;
    }
  };

  for (const attr of URL_ATTRS) {
    $(`[${attr}]`).each((_, element) => {
      const current = $(element).attr(attr);
      const next = mapRef(current);
      if (next !== undefined && next !== current) $(element).attr(attr, next);
    });
  }

  for (const attr of SRCSET_ATTRS) {
    $(`[${attr}]`).each((_, element) => {
      const current = $(element).attr(attr);
      if (!current) return;
      const rewritten = current
        .split(',')
        .map((part) => {
          const trimmed = part.trim();
          if (!trimmed) return part;
          const [url, ...descriptor] = trimmed.split(/\s+/);
          const next = mapRef(url) ?? url;
          return [next, ...descriptor].join(' ');
        })
        .join(', ');
      if (rewritten !== current) $(element).attr(attr, rewritten);
    });
  }

  $('[style]').each((_, element) => {
    const style = $(element).attr('style');
    if (!style || !style.includes('url(')) return;
    $(element).attr('style', rewriteCssText(style, pageUrl, pageNewPath, plan, normalizeKey));
  });

  $('style').each((_, element) => {
    const css = $(element).html();
    if (!css || !css.includes('url(')) return;
    $(element).text(rewriteCssText(css, pageUrl, pageNewPath, plan, normalizeKey));
  });

  return $.html();
}

export interface ReorganizeResult {
  /** oldPath → newPath for every file that moved */
  moved: Map<string, string>;
  pagesRewritten: number;
  stylesheetsRewritten: number;
}

/**
 * Apply the plan on disk: write HTML/CSS to their new locations with rewritten
 * references, move the remaining files, then drop the old host directories.
 */
export function reorganizeMirror(
  dest: string,
  files: MirrorFile[],
  normalizeKey: (url: URL) => string,
): ReorganizeResult {
  const plan = planMirror(files);
  const result: ReorganizeResult = { moved: plan.byOldPath, pagesRewritten: 0, stylesheetsRewritten: 0 };

  for (const file of files) {
    const target = plan.byOldPath.get(file.oldPath);
    if (!target) continue;
    const source = path.join(dest, file.oldPath);
    if (!fs.existsSync(source)) continue;
    const destination = path.join(dest, target);
    fs.mkdirSync(path.dirname(destination), { recursive: true });

    const extension = extensionOf(file.oldPath);
    const needsRewrite = file.isPage || extension === '.css';
    if (needsRewrite) {
      try {
        const text = fs.readFileSync(source, 'utf8');
        const rewritten = file.isPage
          ? rewriteHtml(text, new URL(file.url), target, plan, normalizeKey)
          : rewriteCssText(text, new URL(file.url), target, plan, normalizeKey);
        fs.writeFileSync(destination, rewritten);
        if (file.isPage) result.pagesRewritten += 1;
        else result.stylesheetsRewritten += 1;
        fs.rmSync(source, { force: true });
        continue;
      } catch {
        /* fall through to a plain move if rewriting failed */
      }
    }
    fs.renameSync(source, destination);
  }

  // remove the now-empty host directories (and any leftover empty folders)
  const pruneEmpty = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const child = path.join(dir, entry.name);
      pruneEmpty(child);
      if (fs.readdirSync(child).length === 0) fs.rmdirSync(child);
    }
  };
  try {
    pruneEmpty(dest);
  } catch {
    /* best effort — leftovers are harmless */
  }

  return result;
}
