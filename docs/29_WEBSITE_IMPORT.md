# 29 — Website Import

> Status: **Implemented** (v0.3.0). Companion doc to `16_GITHUB_INTEGRATION.md`.

## Goal

Let a user paste **any live website URL** and get the same treatment a GitHub
repository gets: the site is mirrored to disk (pages, CSS, JS, fonts, and
**all images**), scanned, analyzed, and made exportable/packagable — including
a "recreate this project" prompt with every file's content in one document.
The intended workflow: import a site → download the folder (or prompt) → hand
it to an AI → get the same site back with small improvements.

## How it works

`POST /api/website/analyze { url, name? }` starts a background
`website-import` job (same polling model as GitHub imports:
`GET /api/jobs/:jobId`).

The crawler (`apps/api/src/services/websiteService.ts`):

1. **Fetches and respects robots.txt** (best effort — disallow rules for
   `User-agent: *` and `ProjectPack`).
2. **Crawls pages same-host only** (with/without `www` treated as the same
   host), discovering links from `a[href]`.
3. **Downloads assets from any host** — `img[src]`, `img[srcset]` (highest
   resolution candidate), lazy-loading attributes (`data-src`,
   `data-srcset`, `data-original`, `data-lazy-src`, `data-bg`,
   `data-background`, `data-bgset`, `data-poster` on any element),
   `link[href]` (stylesheets), `script[src]`, `source`/`video`/`audio`/`use`
   references, inline `style` attributes, CSS `url()` and `@import` chains,
   asset URLs inside JS/JSON string literals (data-driven galleries), and
   video/audio media files. Cross-host assets are how CDN-hosted images and
   fonts get captured.
4. **Mirrors the URL structure on disk**: `<DATA_DIR>/projects/<id>/source/
   <host>/<path>` — so deleting the project removes the whole mirror. HTML is
   saved byte-for-byte; URLs are NOT rewritten (the AI sees the real source).
5. **Retries rate limits**: 429/503 responses get one backoff retry
   (Retry-After honored); permanent failures are recorded (URL + status)
   and shown as a toast, in the job result, and on the project overview.
6. **Runs the standard pipeline** over the mirror: scan → hash → files/tree →
   extract (HTML/CSS/JS are text; PNG/JPG/WebP/etc. get dimensions/EXIF via
   the Python image extractor) → duplicates/report/package/prompt.

### Bounded by design

| Limit | Env var | Default |
| --- | --- | --- |
| Pages crawled | `WEBSITE_MAX_PAGES` | 30 |
| Assets downloaded | `WEBSITE_MAX_ASSETS` | 400 |
| Total download size | `WEBSITE_MAX_TOTAL_BYTES` | 100 MB |
| Per-request timeout | `WEBSITE_TIMEOUT_MS` | 20 000 |
| Delay between requests (per worker) | `WEBSITE_REQUEST_DELAY_MS` | 100 |
| Parallel fetch workers | `WEBSITE_CONCURRENCY` | 6 |

Archives, installers and office documents are skipped by extension; media
(video/audio) IS downloaded so the mirror is complete (bounded by the size
caps). Requests are fetched by a bounded worker pool (6 by default), so
imports are several times faster than a sequential crawl while the per-worker
delay keeps the request rate polite. Proxy: the crawler honors `HTTPS_PROXY`/`HTTP_PROXY` and always
bypasses it for localhost.

### Why not extract.pics?

extract.pics is a hosted (paid, API-key) service that scrapes a page for
image URLs. Our crawler already does that and more, for free, offline-capable,
and integrated: it captures images from **HTML tags, srcset, inline styles,
and CSS `url()`/`@import` chains**, downloads them into the project so they
flow into scans, packages, exports, and the prompt. No third-party dependency
or key needed.

## New API surface

| Endpoint | Description |
| --- | --- |
| `POST /api/website/analyze` | Start the crawl + scan job |
| `GET /api/projects/:id/images` | All images: path, size, dimensions (after extraction), source URL + alt text (website projects) |
| `GET /api/projects/:id/images/export` | ZIP of every image |
| `GET /api/projects/:id/files/:fileId/raw` | Raw bytes of any stored file (inline for images → used for thumbnails) |

Crawl metadata (source URL + alt text per saved file) is persisted in
`website-assets.json` inside the project's data directory.

## Prompt integration

`buildProjectPrompt` now includes an **Images & visual assets** manifest
(path, size, alt text, source URL) and tells the AI to reference the image
files rather than recreate them as code. For website projects the overview
section notes that the source is a live-website mirror.

## Optional AI prompt enhancement (ADR-007)

The prompt generator stays deterministic. As an explicit opt-in extra, the
user can click **"Enhance with AI"** on the Prompt page when the API has an
OpenAI-compatible key configured:

```
AI_API_KEY=sk-...          # any OpenAI-compatible provider
AI_BASE_URL=https://api.openai.com/v1   # or your own endpoint
AI_MODEL=gpt-4o-mini
```

`POST /api/projects/:id/prompt/enhance { prompt }` then asks the model to
reorganize/harden the deterministic prompt (goal section, tech-stack summary,
verification checklist) **without removing file contents**. `GET /api/ai/status`
reports whether it is configured; without a key the endpoint returns 503 and
the UI hides the button. All file contents remain generated locally — only
the finished prompt is sent to the provider.

## UI

- **Home**: a third import card ("Live website") next to local folder and
  GitHub. The import job's progress bar covers BOTH phases (crawl = first
  70%, scan/hashing = last 30%) so it never sits at 100% while work is still
  running; navigation to the project happens when the job truly completes.
- **Prompt page**: an images gallery **above** the generate-prompt section —
  thumbnails, per-image download, and "Download all (.zip)".
- Toasts/snackbars fire when any download completes or fails, and when
  jobs finish (distinct “Duplicates found” / “No duplicates found” messages).
- Breadcrumbs (Workspace / project / page) on every project page.
- The project overview auto-refreshes while a scan is in progress, and the
  export panel re-renders as soon as extraction finishes — no manual
  navigation needed.

## Testing

`apps/api/tests/website.test.ts` spins up a real fixture site on loopback
(pages, stylesheets with `@import`, images from `img`/`srcset`/inline-style/
CSS, a robots.txt-disallowed page) and asserts the full journey: crawl →
scan → images listing (alt text, source URLs) → raw bytes → images ZIP →
extraction-enriched dimensions → prompt with image manifest → AI status.

## Speed, memory and re-imports (v0.6.0)

- **Streamed downloads**: every file is streamed straight to disk and hashed
  as the bytes arrive. Nothing is buffered whole in memory, so a large site no
  longer risks exhausting a small host (this was the cause of free-tier
  instance restarts on 512 MB).
- **Hash-on-download**: the SHA-256 computed during the crawl is reused by the
  scan phase, so the "hashing" pass only touches new/changed files.
- **Keep-alive connections**: one pooled HTTP agent is reused across the
  hundreds of requests a crawl makes.
- **Skip heavy media**: the import form has a "skip video/audio" toggle for a
  much smaller, much faster import; skipped files are counted in the result.
- **Re-imports refresh the existing project** instead of creating a duplicate:
  files the server reports unchanged come back as HTTP 304 and are neither
  re-downloaded nor re-hashed, while already-extracted content is preserved.
  This also recovers assets that failed the first time.
- **Live counters**: the progress bar shows "N pages · M assets · X MB"
  during the crawl and "Indexing files — n/m" during the scan.
- **Lost-job handling**: if the API restarts mid-import the UI stops polling
  (no more endless 404s) and tells you to re-import.

