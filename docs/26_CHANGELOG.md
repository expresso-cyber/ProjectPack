# Changelog

## 0.7.0 — Browser Mode (client-side import & storage) + hosted-app fixes

- **New: Browser Mode** (`/browser`). Import a **local folder** (File System
  Access API), a **GitHub repository** (GitHub API + raw files) or a **live
  website** (through a CORS proxy) — everything is fetched and stored **in the
  visitor's browser** (IndexedDB). The server is never involved, so it works
  when the free instance has restarted, when its disk was wiped, or when the
  host blocks datacenter IPs, and it can read folders no server could see.
  Per project: stats, text search, duplicate detection, per-file download and
  "Download all (ZIP)" built in the browser. See docs/30_BROWSER_MODE.md.
- **Fixed: 404 storms on a project that a restart wiped.** The project page now
  shows "This project no longer exists" with a way back, instead of polling a
  missing project forever (and retrying scans against it).
- **Fixed: failed imports left empty "0 files / 0 B" projects behind.** After a
  failed or lost import the empty shell is removed again and the list refreshes.
- **Fixed: hosted local-folder confusion.** On a hosted deployment the local
  folder card explains that the server cannot see the visitor's disk and points
  at Browser Mode; the "cannot reach the API" message now mentions the free
  instance waking up instead of suggesting a dev command.
- **Crawler: fallback proxy for IP-blocked sites** (WEBSITE_FALLBACK_PROXY,
  default `https://api.allorigins.win/raw?url={url}`, set empty to disable).
  When a direct request fails at the network level, or the host answers
  403/451, the fetch is retried through the proxy — which usually succeeds
  because it comes from a different IP.
- **New web test suite** (vitest + jsdom + fake-indexeddb, 12 tests) wired into
  CI: `npm run test:web`.

## 0.6.1 — Clear failures, no stuck UI

- **Fixed: cryptic "Source root is not accessible" when an import fails.** The
  mirror folder is now created up-front, and an import that downloads nothing
  fails with the real reason instead — "Could not download anything from
  <site> (403 on <url>)…" — so a blocked or rate-limited site is obvious.
- **Fixed: the workspace could stay stuck on "Importing…" with disabled
  buttons and the bar frozen at 100%.** The import state is cleared before
  navigating to the project, and a `pageshow` guard resets stale in-flight
  state whenever the page is restored from the browser's back/forward cache.
- **Fixed: conditional re-import requests** are only sent when the local copy
  still exists, so a 304 can never leave a file missing after a disk reset.
- **Browser-compatible User-Agent** by default (override with
  WEBSITE_USER_AGENT): many hosts return 403 for unknown agents, which made
  imports of public sites fail. robots.txt is still respected.
- The workspace project list refreshes after a failed import (a failed import
  keeps its project row so the error stays visible; delete it with the card's
  ✕ button).

## 0.6.0 — Memory-safe crawler, faster imports, re-import refresh

- **Fixed: free-tier instance restarts (out of memory).** The crawler used to
  buffer every downloaded file in memory (6 workers × up to 50 MB each) and the
  scan/extract phases spawned up to 4 Python processes regardless of host size.
  Downloads are now streamed to disk with the hash computed on the fly, and the
  engine concurrency defaults to 2 (tune with EXTRACT_CONCURRENCY /
  HASH_CONCURRENCY). Extraction of large sites no longer OOM-kills the service.
- **Fixed: endless 404 console flood.** When the API restarted mid-import the
  UI polled a job that no longer existed, forever. Polling now stops on 404 and
  shows a clear "the server restarted, import again" message.
- **Fixed: "project not found" when deleting a project that a restart wiped.**
  The UI now explains it and refreshes the workspace list.
- **Hash while downloading** — the crawl hashes each file as it streams, and
  the scan phase reuses those hashes instead of re-reading every file.
- **Keep-alive connections** — one pooled agent reused across the crawl.
- **Skip heavy media** — new "skip video/audio" toggle on the website import
  form (much smaller, much faster import); skipped files are reported.
- **Re-import refreshes the existing project** — a second import of the same
  site updates that project (HTTP 304 skips unchanged files, extracted content
  is preserved, previously failed assets are retried) instead of creating a
  duplicate project.
- **Live counters** — progress shows "N pages · M assets · X MB" while
  crawling and "Indexing files — n/m" while scanning (new job `detail` field).

## 0.5.3 — CI: build shared before typecheck

- The GitHub Actions workflow now runs "npm run build -w @projectpack/shared"
  right after npm ci. The api and web workspaces typecheck against the shared
  package's compiled dist/, which previously did not exist on a fresh CI
  runner — causing the "Cannot find module '@projectpack/shared'" cascade
  (84 phantom errors). Render deployments were never affected (their build
  command already builds shared first).

## 0.5.2 — CI fix

- python/file_engine/requirements.txt now includes pytest — GitHub Actions
  (and any fresh machine) runs "npm run test:python" straight after
  "npm run install:python" without a missing-module failure.

## 0.5.1 — Single-service production mode (deployable)

- The API now serves the built web UI itself when apps/web/dist exists
  (override the folder with WEB_DIST_DIR): static assets plus an SPA history
  fallback, so ONE process (node apps/api/dist/server.js) can host the whole
  app on one port. Without a build the dev behaviour is unchanged (JSON
  landing route, vite dev server on :5173).
- Root "npm start" added for production: runs the compiled API with the
  Python engine and web dist alongside.

## 0.5.0 — Partial clone downloads, per-folder ZIPs, home-page delete

- Package page now supports partial clones: every file row has a checkbox,
  grouped by top-level folder (site section / domain) with select-all per
  folder and overall. Uncheck anything you don't want — "Approve & create
  package" then produces a package containing exactly the checked files
  (selection is passed to the API as includePaths and shown live in the
  stats: "N of M files selected").
- Files page: every folder row has a "↓ ZIP" button (streams a ZIP of that
  folder from the new /folder/download endpoint) and every file row has a
  "↓" button (direct download). Download any part of the mirror without
  creating a package at all.
- Home page: each project card has a delete button (with confirmation).
  Deleting removes the project's analysis, packages and extracted content
  and immediately updates the Total Projects / Total files indexed / Total
  size analyzed stats. Original websites/repos are never touched.
- Clean UI: download-failure warnings no longer render as a persistent
  banner on the project page — they are logged to the browser console
  (once per URL, with status codes); the transient toast at import time
  remains.

## 0.4.1 — Visible download failures + rate-limit resilience

- The website crawler now retries rate-limit responses (429/503) once with
  a backoff (honoring Retry-After), so bot protection no longer silently
  drops CSS/JS/font assets.
- Every failed download is now recorded with its URL and HTTP status and
  surfaced three ways: in the import job's result, as a toast right after
  import, and as an amber banner on the project overview (hover for the
  exact failed URLs). A crawl that silently loses files looks like
  "missing files" — now it says exactly what happened.
- Recommended recovery for an incomplete import: re-import the site (the
  retry usually picks up what the rate limiter dropped).

## 0.4.0 — Complete site mirrors, font extraction, rescan safety

- The crawler now captures the assets most sites hide: lazy-loaded images
  (data-src/data-original/data-bg/… on any element), images referenced only
  inside JS/JSON string literals (data-driven galleries/carousels), and
  video/audio files — the mirror is a complete copy of the site's content.
- Web fonts (.ttf/.otf/.woff/.woff2/.eot) are now supported files with real
  metadata extraction (family/style/weight via fontTools + brotli for woff2;
  legacy .eot parsed from its header) — font files no longer show up as
  "unsupported", and AI recreations know which fonts to use.
- Rescans preserve extraction state: files whose content hash is unchanged
  keep their "extracted" status, so the export panel and prompts survive a
  rescan instead of resetting to pending.
- Report wording for binary assets clarified: fonts/media are "indexed and
  included in packages" rather than a scary "unsupported / failed extraction".
- Image gallery: broken thumbnails now fall back to a clean extension badge
  instead of the browser's broken-image icon (some SVGs, like icon-font
  sheets, render as blank images by nature).
- Tests: font extraction (via a programmatically built TTF), lazy-load/
  JS-referenced/media crawling, and extraction-survives-rescan (37 API
  tests, 28 Python tests).

## 0.3.2 — Import completion, live overview, and polish fixes

- Website imports no longer sit at “100%” while the scan phase is still
  running: the import job now runs the scan inline and reports BOTH phases
  (crawl = first 70% of the bar, scan/hashing = last 30%). The bar keeps
  moving and navigation to the project happens exactly when everything is
  indexed.
- Project overview auto-refreshes while a project is in the “scanning”
  state, so opening a project mid-import shows live counts instead of
  zeros until a manual reload.
- The export panel now appears immediately after extraction completes
  (it re-renders when the extracted count changes) — no need to visit the
  file tree and come back.
- Duplicate analysis now reports distinct results: “Duplicates found”
  (with the group count) or “No duplicates found”.
- Removed the particle background animation per user preference.

## 0.3.1 — Website import speed and polish fixes

- Crawler is now a bounded worker pool (6 parallel requests by default,
  WEBSITE_CONCURRENCY) instead of a sequential loop — imports are several
  times faster; per-request politeness delay reduced to 100 ms.
- Fixed the import progress bar rendering inside the GitHub card — it now
  shows in its own section below the import cards, with a clearer label
  ("N items fetched") instead of the confusing raw budget denominator.
- Fixed the particle background being invisible (z-index painted it behind
  the page background) — grey/white linked particles now render on every
  page at 0.5 opacity.
- Missing Pillow now produces a friendly, actionable error ("run
  pip install -r python/file_engine/requirements.txt") on failed files, plus
  an amber hint banner on the project overview when image extraction fails
  for that reason. .ico images are also extracted (dimensions) now.
- Toasts fire in normal flows too: job completion (scan/extract/duplicates),
  import success/failure, and project creation — not only downloads.

## 0.3.0 — Website import, images gallery, AI-enhanced prompts, UI polish

- **Live website import**: paste any site URL and ProjectPack crawls it
  (same-host pages, assets + images from any host incl. CDN), mirrors the
  structure under its own data directory, and runs the identical scan /
  extract / analyze pipeline used for GitHub repos. robots.txt respected,
  bounded crawl (30 pages / 400 assets / 100 MB defaults, env-tunable),
  proxy-aware with localhost bypass. See docs/29_WEBSITE_IMPORT.md.
- **Image extraction like extract.pics, built in**: images are discovered
  from img tags, srcset, inline styles, and CSS url()/@import chains, then
  downloaded into the project — no third-party API needed.
- **Images gallery** on the Prompt page (above the generate section):
  thumbnails, per-image download, and "Download all (.zip)" via the new
  /images and /images/export endpoints; raw file streaming via
  /files/:fileId/raw.
- **Richer prompts**: the generated prompt now embeds an image manifest
  (paths, sizes, alt text, source URLs) and notes website-mirror sources.
- **Optional AI prompt enhancement** (ADR-007-compliant, opt-in):
  POST /projects/:id/prompt/enhance refines the deterministic prompt through
  any OpenAI-compatible endpoint (AI_API_KEY / AI_BASE_URL / AI_MODEL env
  vars); the button only appears when configured, and the deterministic
  prompt remains the default.
- **Toasts / snackbars**: success/error notifications for downloads, copy
  actions, and AI enhancement — downloads confirm when they actually finish
  (fetch → blob → save).
- **Breadcrumbs** (Workspace / project / page) on every project screen.
- **Particle background**: subtle grey/white linked-particle canvas at 0.5
  opacity, respecting prefers-reduced-motion.
- Tests: new website.test.ts spins a real loopback fixture site and covers
  crawl → scan → images → raw bytes → images ZIP → dimensions → prompt →
  AI status (36 API tests total, 27 Python tests).

## 0.2.1 — Bug fixes, data hygiene, and engine features

- Fixed the file-tree bug where root-level files (README, LICENSE, …)
  appeared twice per render (double-push in tree building).
- All generated data now lives in ~/.projectpack by default instead of the
  codebase folder (DATA_DIR override still honored).
- GitHub repository sources are stored under the project's own data
  directory, so deleting a project removes the downloaded copy.
- Configurable scan exclusions: POST /api/projects/:id/scan accepts an
  exclude list, editable in the overview UI.
- Archive inspection: ZIP files are supported types; their contents can be
  listed without extraction (new inspect-archive engine command and
  /files/:id/archive endpoint with UI on the content page).
- Image metadata extraction (dimensions, format, basic EXIF) via Pillow.
- New doc: docs/28_STORAGE_AND_MULTIUSER.md — local data layout and the
  researched multi-user/cloud-storage roadmap (R2/S3 presigned-URL pattern).

## 0.2.0 — UX and AI-workflow features

- Skeleton-screen loading states across the UI (project cards, stat grids,
  file tree, content view, report) for 2–10 s operations.
- Live progress bars synced with job progress: scan, extract, and GitHub
  import now run as background jobs polled through GET /api/jobs/:jobId.
- Back button on every screen.
- Selective export: filter combined exports by file type and folder, and
  cap the number of files (largest first) to stay within AI context limits.
  POST /api/projects/:id/export accepts extension/pathPrefix/limit.
- Project prompt generator: POST /api/projects/:id/prompt builds a
  professional "recreate this project" prompt (with or without file
  contents) that users can paste into ChatGPT, Claude, Codex, etc.
- New Prompt page with copy-to-clipboard and .md download.
- Custom logo (favicon.ico + navbar icon).

## 0.1.2 — Throughput and progress feedback

- Scan hashing and content extraction now run as a bounded worker pool
  (up to 4 concurrent Python engine processes), cutting wall-clock time
  roughly by the number of parallel batches on multi-core machines.
- GitHub import button shows an explicit "Importing & scanning" state so
  network + scan time is visibly working rather than appearing frozen.
- README: performance expectations documented.

## 0.1.1 — Dev-experience fixes

- API root (`GET /`) now returns a friendly JSON landing response instead of
  a 404 (opening the API port in a browser is no longer confusing).
- Python interpreter auto-detection: `python3`, `python`, then `py -3`
  (Windows launcher), with a clear error message when none is found.
  `PYTHON_BIN` still takes precedence when set.
- Web UI shows an actionable message when the API is unreachable instead of
  a generic "Request failed (500)".
- README: two-terminal quick start clarified, troubleshooting section added.

## 0.1.0 — MVP Implementation

- Monorepo scaffold: npm workspaces (api, web, shared), shared TypeScript contracts.
- Python file engine: scanner with safety limits, extension registry, binary
  sniffing, streaming SHA-256 hashing, text extractor with encoding
  fallbacks, PyMuPDF PDF extractor (per ADR-003), DOCX/XLSX/PPTX/CSV
  extractors, duplicate/structure/report analyzers, TXT/Markdown/JSON
  exporters, package builder with manifest, worker CLI with JSON
  temp-file contracts, safe tarball unpacking.
- Express API: health, project CRUD, scan, tree, file list with filters,
  content view, extraction, lexical search, duplicate analysis, ProjectPack
  preview/create/manifest/download, combined export, project report,
  GitHub analyze/tree. Zod validation, structured error format, helmet,
  pino logging, file-backed store with atomic writes, in-process job
  manager with progress.
- React web UI (Vite + Tailwind): workspace, project overview, file tree,
  content view, search, duplicate center, ProjectPack flow, report.
- GitHub import through codeload tarballs with proxy support.
- Tests: 22 pytest cases (file engine) and 23 vitest/supertest cases (API).
- CI workflow running typecheck + Python tests + API tests + builds.
- Worker (BullMQ) and desktop (Electron) packages intentionally stubbed —
  future stages per docs/27_IMPLEMENTATION_ORDER.md.

## 1.0.0 — Initial Documentation Baseline

- ProjectPack product identity defined.
- Authentication explicitly excluded from MVP.
- MERN + Python architecture defined.
- PyMuPDF selected for PDF extraction.
- File-engine requirements documented.
- ProjectPack packaging flow documented.
- GitHub integration requirements documented.
- AI/search architecture documented as layered/future functionality.
- Codex CLI repository workflow documented.
