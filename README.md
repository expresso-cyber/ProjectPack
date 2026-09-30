# ProjectPack — File Intelligence & Project Management Platform

**Author:** Roshan Mithilesh Rai
**Stack:** React + TypeScript (Vite) · Node.js + Express + TypeScript · Python file engine
**Current stage:** **Working MVP** (Stages 1–9 of the implementation order)
**Authentication:** **Not included in the current MVP** (by design — see docs/04_SCOPE_AND_MVP.md)

ProjectPack turns nested folder structures into understandable, searchable,
analyzable, and packageable projects:

> scan → understand → index → search → analyze → organize → package

## What works today

- **Local project import** — point ProjectPack at any folder on disk; it is read, never modified.
- **Recursive scan** with metadata, binary detection, type classification, and SHA-256 hashing.
- **Content extraction** — text/code family, PDF (PyMuPDF), DOCX, XLSX, PPTX, CSV/TSV, with encoding fallbacks and per-file failure isolation.
- **Lexical search** across names, paths, and extracted content with snippets.
- **Duplicate detection** — exact duplicates grouped by content hash.
- **Project report** — totals, largest files, empty folders, extension breakdown, warnings.
- **ProjectPack packaging** — exclusion rules → include/exclude preview → explicit approval → copied package + SHA-256 manifest + ZIP download. Sources are never touched.
- **Combined export** — all extracted content in one TXT / Markdown / JSON document.
- **Selective export** — filter the export by file type and folder and cap the
  file count, so the document stays within an AI's context window.
- **Project prompt generator** — a professional "recreate this project" prompt
  (structure + optional file contents) to paste into any AI coding agent.
- **Live progress** — scans, extraction, and GitHub imports run as background
  jobs with progress bars; skeleton screens cover loading states.
- **Archive inspection** — ZIP files are indexed and their contents can be
  listed without extracting anything.
- **Image metadata** — PNG/JPEG/GIF/WebP dimensions, format, and basic EXIF.
- **Font metadata** — web fonts (.ttf/.otf/.woff/.woff2/.eot): family, style,
  and weight via fontTools, so recreations use the right fonts.
- **Scan safety net** — rescans keep extraction state for unchanged files
  (hash-compared), so exports/prompts survive a rescan.
- **Configurable scan exclusions** — extra folder names to skip during scans,
  editable from the project overview.
- **GitHub import** — any public repository (tarball download → safe unpack → full scan pipeline), plus a lightweight tree endpoint.
- **Live website import** — paste any site URL: the crawler mirrors pages,
  CSS, JS, fonts, images and videos (img tags, srcset, lazy-load data-*
  attributes, inline styles, CSS url()/@import, and URLs inside JS/JSON),
  respects robots.txt, then runs the same analysis pipeline. Bounded by env
  limits (see docs/29_WEBSITE_IMPORT.md).
- **Images gallery** — every project's images listed with thumbnails,
  dimensions, alt text, and source URLs; download one or all (ZIP).
- **Optional AI prompt enhancement** — with `AI_API_KEY` set, one click
  refines the generated prompt via any OpenAI-compatible endpoint; the
  deterministic generator stays the default (ADR-007).
- **Toasts & breadcrumbs** — snackbars confirm every completed download and
  finished job (with distinct “Duplicates found” / “No duplicates found”
  messages); breadcrumbs (Workspace / project / page) on every screen.
- **Web UI** — all eight screens from docs/11_UI_REQUIREMENTS.md (workspace,
  overview, file tree, content view, search, duplicate center, ProjectPack,
  report) plus a prompt-generator page with image gallery, skeleton loaders,
  live progress bars, toasts, breadcrumbs, and back buttons on every screen.

## Quick start

Prerequisites: Node.js 20+, Python 3.12+.

```bash
# 1. Install JS dependencies (workspaces: api, web, shared)
npm install

# 2. Install the Python engine dependencies
npm run install:python          # or: python3 -m pip install -r python/file_engine/requirements.txt

# 3. Terminal 1 — start the API (http://localhost:3001)
npm run dev:api

# 4. Terminal 2 — start the web UI (http://localhost:5173)
npm run dev:web
```

**Keep both running at the same time** — they are two separate processes.
Open **http://localhost:5173** in your browser (that is the app); port 3001 is
the JSON API only. The web dev server proxies `/api` requests to the API, so
no extra configuration is needed. Optional environment variables are
documented in `.env.example`.

## Where your data lives

All generated data (metadata, extracted text, packages, exports, and unpacked
GitHub repositories) is written to **`~/.projectpack`** by default — outside
any codebase — with one subfolder per project, so deleting a project removes
everything it created (including the downloaded GitHub copy). Override with
`DATA_DIR` in `.env`. For the multi-user/cloud-storage roadmap see
docs/28_STORAGE_AND_MULTIUSER.md.

## Performance expectations

- **GitHub import** is dominated by the network download of the repository
  tarball plus scanning; a 10 MB repository typically takes several seconds
  depending on connection speed.
- **Extraction** speed depends on document complexity (PDFs are parsed page by
  page). Extraction and hashing run in up to 4 parallel engine processes.
- Jobs run in-process by design for the MVP (ADR-006); the next stage is
  BullMQ-backed background jobs with live progress polling, which will make
  long scans feel fully responsive.

## Troubleshooting

- **`localhost:3001` shows a JSON response** — expected. The API serves JSON
  under `/api/*` only; use the web UI on port 5173.
- **Vite logs `http proxy error: ECONNREFUSED` / the UI shows "Cannot reach
  the ProjectPack API"** — the API is not running. Start it with
  `npm run dev:api` in a separate terminal, then refresh the page.
- **Windows** — the API auto-detects the Python launcher (`python3`, `python`,
  or `py -3`). If none is found, install Python 3.12+ or set `PYTHON_BIN`
  in `.env` to its full path.
- **Long waits after clicking Import / Extract** — expected for large or
  PDF-heavy repositories (see Performance expectations above); the button
  labels show the active stage.
- **"No Python interpreter found" or engine errors on scan** — confirm
  `python --version` works in a terminal and that the engine dependencies are
  installed (`npm run install:python`).

## Verify everything

```bash
npm run typecheck        # TypeScript, all workspaces
npm run test:python      # pytest — python/file_engine (22 tests)
npm run test:api         # vitest + supertest — apps/api (23 tests)
npm run build            # production builds for shared, api, and web
```

### One-command smoke test (no UI)

```bash
curl -s localhost:3001/api/health
curl -s -X POST localhost:3001/api/projects \
  -H 'content-type: application/json' \
  -d '{"name":"My Project","rootPath":"/absolute/path/to/folder"}'
# then POST /api/projects/:id/scan, /api/projects/:id/extract, ...
```

## Repository layout

```text
apps/
├── api/      Express + TypeScript REST API (projects, scan, extract, search,
│             duplicates, packaging, export, report, GitHub, jobs)
├── web/      React + TypeScript + Vite + Tailwind web UI
├── worker/   Future BullMQ queue runner (empty by design — see its README)
└── desktop/  Future Electron app (empty by design)
python/
└── file_engine/   Deterministic engine: scanner, hashing, metadata, extractors
                   (text/pdf/docx/xlsx/pptx/csv), analyzers (duplicates,
                   structure, report), exporters (txt/md/json/package), worker CLI
packages/
└── shared/   TypeScript contracts shared by api and web
docs/         Product truth — SRS, API spec, data models, decisions (start at
              docs/00_MASTER_CONTEXT.md)
reference/    Historical prototype code and research
```

## Architecture notes

- The API never scans files itself: it drives `python -m file_engine.worker`
  through temp-file JSON contracts (large payloads never touch argv/stdout).
- Jobs run in-process for the MVP (ADR-006: add Redis + BullMQ when work
  outgrows the request); progress and results persist in `DATA_DIR`.
- Persistence is file-backed under `DATA_DIR` (atomic writes, per-project
  directories). The store interface is narrow so a Mongoose implementation can
  replace it when multi-user persistence arrives (docs/12_DATA_MODELS.md).
- Safety: path traversal rejection, symlink skipping, scan limits, binary
  sniffing, tarball extraction with the Python `data` filter, and
  preview-before-approval on every modifying operation (ADR-008).
- HTTPS_PROXY/HTTP_PROXY is honored for GitHub access (Node's fetch otherwise
  ignores proxy environment variables).

## Read this first (product truth)

1. `AGENTS.md` — persistent instructions for Codex CLI.
2. `docs/00_MASTER_CONTEXT.md` — concise source of truth.
3. `docs/02_SRS.md` — software requirements specification.
4. `docs/04_SCOPE_AND_MVP.md` — exactly what is and is not in the current MVP.
5. `docs/13_API_SPECIFICATION.md` — REST API contract.

## Explicitly not in the MVP

Login/signup, authentication, billing, subscriptions, team workspaces, SSO,
enterprise administration, cloud-drive sync, OCR, and any automatic
destructive file operation.
