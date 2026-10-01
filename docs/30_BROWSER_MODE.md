# Browser Mode (client-side import & storage)

Browser Mode is the answer to the limits of a free hosted deployment: the
crawling and the storage happen **in the visitor's browser**, so the server's
memory, ephemeral disk, sleeping instance and network blocks never apply.

Open it from the workspace header: **Browser Mode** (`/browser`).

## What it does

| Source | How it is fetched | Notes |
| --- | --- | --- |
| Local folder | File System Access API (`showDirectoryPicker`) | Chrome/Edge. Reads the folder directly — nothing is uploaded, the folder is never modified. |
| GitHub repository | `api.github.com` (tree) + `raw.githubusercontent.com` (files) | Public repos. Unauthenticated GitHub API allows 60 requests/hour. |
| Live website | A CORS proxy (default `https://api.allorigins.win/raw?url={url}`) | A browser cannot read a cross-origin page directly, so pages/assets go through the proxy. The template is editable in the UI. |

Everything is then stored in **IndexedDB** (project index + file blobs), so the
data survives server restarts, redeploys and cold starts — it never left the
machine.

## What you get per project

- file count, folder count, total size
- search across paths, names **and text** (text-like files are stored decoded)
- duplicate detection (SHA-256 computed with WebCrypto while importing)
- per-file download and "Download all (ZIP)" (ZIP built in the browser)
- delete (removes only the local copy)

## Limits and guard rails

- `LIMITS` in `apps/web/src/lib/browser/types.ts`: max 3000 files, 25 MB per
  file, 200 MB total per import; media can be skipped entirely.
- Extraction (PDF/Office/image analysis) is a server-side Python feature and is
  **not** available in Browser Mode — text search works on text-like files.
- The website importer depends on a public proxy; if one is rate-limited, paste
  a different template (e.g. `https://corsproxy.io/?{url}`).
- Browser storage is per-browser and per-profile: clearing site data removes
  the projects (that is the trade-off for never uploading them).

## Why not just fix the server?

Both exist on purpose:

- **Server mode** (the workspace) is the full pipeline: Python extraction,
  packages, reports, prompts — best run locally.
- **Browser Mode** keeps working when the server cannot: free-tier restarts,
  datacenter-IP blocks, and the visitor's own folders, which no server can read.

## Tests

`apps/web/tests/browser.test.ts` (vitest + jsdom + fake-indexeddb) covers
hashing, storage, folder walking (skip rules + media toggle), HTML reference
discovery, the proxy crawl (including CSS-discovered assets), duplicate
grouping, search and ZIP building.
