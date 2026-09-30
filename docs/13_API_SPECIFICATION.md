# API Specification

## API Style

REST JSON API.

Current API is single-workspace and unauthenticated.

## Health

### GET `/api/health`

Response:

```json
{
  "status": "ok"
}
```

## Projects

### POST `/api/projects`

Creates project metadata.

### GET `/api/projects`

Lists current workspace projects.

### GET `/api/projects/:projectId`

Returns project metadata and summary.

### DELETE `/api/projects/:projectId`

Deletes project metadata/results. It must not delete original local source files.

## Scan

### POST `/api/projects/:projectId/scan`

Starts a scan job.

### GET `/api/jobs/:jobId`

Returns progress.

## Files

### GET `/api/projects/:projectId/files`

Supports filters:

- extension
- path
- supported
- extractionStatus

## Extract

### POST `/api/projects/:projectId/extract`

Starts extraction.

### GET `/api/projects/:projectId/files/:fileId/content`

Returns extracted content if available.

## Search

### GET `/api/projects/:projectId/search?q=...`

MVP lexical search.

Future:

- semantic search
- hybrid search

## Duplicates

### POST `/api/projects/:projectId/duplicates`

Starts duplicate analysis.

### GET `/api/projects/:projectId/duplicates`

Returns duplicate groups.

## ProjectPack

### POST `/api/projects/:projectId/package/preview`

Returns proposed include/exclude plan.

### POST `/api/projects/:projectId/package/create`

Creates package after explicit user confirmation.

### GET `/api/projects/:projectId/package/:packageId/manifest`

Returns package manifest.

## GitHub

### POST `/api/github/analyze`

Accepts a public repository URL for analysis.

### POST `/api/github/tree`

Returns selected repository structure.

## Website

### POST `/api/website/analyze`

Accepts `{ url, name? }`. Crawls the live site (same-host pages; assets
including images from any host; robots.txt respected; bounded by
`WEBSITE_MAX_*` env vars), mirrors it under the project's data directory, and
runs the full scan pipeline. Returns `{ projectId, jobId }` for job polling.

### GET `/api/projects/:projectId/images`

Lists every image file in the project: path, size, dimensions (once
extracted), plus source URL and alt text for website imports.

### GET `/api/projects/:projectId/images/export`

Streams a ZIP of every image in the project.

### GET `/api/projects/:projectId/files/:fileId/raw`

Streams the raw bytes of a stored file (inline for images — used for
thumbnails; attachment otherwise).

## AI (optional)

### GET `/api/ai/status`

Reports whether AI prompt enhancement is configured
(`{ configured, model }`).

### POST `/api/projects/:projectId/prompt/enhance`

Accepts `{ prompt }` and returns the AI-refined prompt. Requires `AI_API_KEY`
(and optional `AI_BASE_URL` / `AI_MODEL`) — returns 503 when unconfigured.
Per ADR-007 this is the only AI-assisted code path and is strictly opt-in.

## Error format

```json
{
  "error": {
    "code": "INVALID_PROJECT_SOURCE",
    "message": "The selected source could not be processed."
  }
}
```

Never return internal stack traces in production responses.

## MVP additions (implemented beyond the original contract)

### GET `/api/projects/:projectId/tree`

Returns the full folder/file hierarchy as a nested tree for the file-tree UI.

### GET `/api/projects/:projectId/report`

Returns the project analysis report (totals, largest files, duplicate summary,
empty folders, extension breakdown, warnings). Computed on demand from stored
scan data when no stored report exists.

### POST `/api/projects/:projectId/export`

Body: `{ "format": "txt" | "md" | "json" }`. Builds the combined-content
document; returns `{ downloadUrl, bytes }`.

### GET `/api/projects/:projectId/exports/:fileName`

Downloads a generated export artifact (basename-safe).

### GET `/api/projects/:projectId/packages`

Lists created packages for the project.

### GET `/api/projects/:projectId/package/:packageId/download`

Downloads the created package as a ZIP archive.

### Job completion semantics

Scan, extract, and duplicate jobs run in the background (in-process job
manager per ADR-006): the POST responds immediately with the job in
`running` state, and clients poll `GET /api/jobs/:jobId` for live progress
(`progress`, `completed`, `total`, `failed` fields update during the run).
Package creation remains synchronous (it returns the finished manifest).

### POST `/api/projects/:projectId/prompt`

Body: `{ "includeContent": boolean, "maxBytesPerFile": number }`.
Deterministically generates a professional "recreate this project" prompt
(overview, directory structure, build instructions, and optionally file
contents) for use with external AI coding agents. Returns
`{ prompt, fileCount }`.

### Export filters

`POST /api/projects/:projectId/export` accepts `{ format, extension?,
pathPrefix?, limit? }` to export selectively by file type, folder, and
file count (largest first) — keeping exports within AI context budgets.

### Scan exclusions

`POST /api/projects/:projectId/scan` accepts `{ "exclude": string[] }` — extra
directory names to skip during the scan (beyond the built-in defaults like
node_modules, .git, __pycache__, venv, dist, build). The list is persisted with
the project so rescans and the UI stay in sync.

### GET `/api/projects/:projectId/files/:fileId/archive`

Lists the contents of a `.zip` file **without extracting anything**
(entry names, sizes, compressed sizes, entry count, truncation flag).
Returns 400 for non-zip files and 422 for corrupt archives.
