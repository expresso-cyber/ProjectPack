# ProjectPack Master Context

## Product

**ProjectPack** is a File Intelligence & Project Management Platform created from a real workflow problem: complex nested folders are organized correctly for storage, but inconvenient for reading, searching, analyzing, copying, and packaging.

## Founder / Author

**Roshan Mithilesh Rai**

## Core problem

Users often have project structures like:

```text
python/
├── session01/
│   └── s01.py
├── session02/
│   └── s02.py
├── ...
└── session20/
    └── s20.py
```

The structure is useful, but a user may need the content in another representation: a single readable document, a searchable index, a project report, a clean package, or an exact duplicate.

## Core product abstraction

> Files and folders are storage structures. ProjectPack transforms them into understandable, searchable, analyzable, and actionable projects.

## Core pipeline

```text
SOURCE
  ↓
DISCOVER
  ↓
VALIDATE
  ↓
METADATA
  ↓
HASH
  ↓
EXTRACT
  ↓
NORMALIZE
  ↓
INDEX
  ↓
ANALYZE
  ↓
SEARCH / AI
  ↓
USER-APPROVED ACTION
  ↓
PACKAGE / EXPORT
```

## Current prototype foundation

### `extract_all_the_files.py`

Recursively scans a source folder, supports text/code extensions plus PDF, DOCX and XLSX, extracts content, and writes file boundaries, relative paths, types, and extracted content to an output file.

### `extract_nested_python_content_in_folder.py`

Recursively finds Python files, preserves relative paths, and combines their contents into one readable output.

### `universal_file_content_extractor(1).py`

The main prototype. It contains an extension registry, recursive scanning, file grouping, user selection, encoding fallbacks, PDF/DOCX/XLSX/PPTX/CSV extraction, text extraction, output formatting, skip/error reporting, and summary reporting.

### `copy__folder.py`

Uses recursive folder copying to reproduce an entire directory tree into a destination with a new name.

## Current MVP

The MVP is a single-workspace / local-development product with **no authentication**.

### MVP capabilities

- scan a selected project
- display folder hierarchy
- collect file metadata
- identify supported file types
- extract supported content
- use PyMuPDF for PDF text extraction
- export combined content
- search indexed text
- detect basic exact duplicates by hashing
- inspect folder structure
- create a ProjectPack preview
- copy/package selected files and folders
- create a manifest with hashes
- generate a project analysis report
- import/analyze public GitHub repository content

### Explicitly excluded from MVP

- login/signup
- authentication
- billing
- subscriptions
- team workspaces
- SSO
- enterprise administration
- cross-account permissions
- automatic destructive file operations
- full cloud-drive synchronization
- complete iLovePDF-style conversion suite
- mobile application

## Technical direction

### MERN core

- React
- TypeScript
- Vite
- Node.js
- Express
- MongoDB
- Mongoose

### Supporting systems

- Python processing worker
- PyMuPDF for PDF extraction
- `python-docx` for DOCX
- `openpyxl` for XLSX
- `python-pptx` for PPTX
- Redis + BullMQ for heavy/background jobs
- Zod for request validation
- Pino for structured logging
- Vitest + Supertest + Playwright + pytest for testing
- GitHub API / Octokit for repository integration

## Long-term direction

The long-term platform may add:

- semantic search
- MongoDB Vector Search
- AI file finder
- AI renaming
- AI folder suggestions
- version intelligence
- cloud connectors
- local desktop agent
- project cleanup agent
- project documentation agent
- file requests/submission portal
- team and enterprise functionality

## Golden rule

AI recommends. Deterministic systems execute. Destructive operations require explicit preview and approval.
