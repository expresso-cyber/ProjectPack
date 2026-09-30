# Recommended Implementation Order

Codex should implement the project in this order unless a requirement explicitly changes it.

## Stage 1 — Repository foundation

- monorepo scripts
- shared types
- environment loading
- linting/formatting
- testing

## Stage 2 — Python file engine

- scanner
- metadata
- hashing
- extension registry
- text extractor
- PyMuPDF PDF extractor
- DOCX/XLSX/PPTX/CSV extractors
- normalized output
- tests

## Stage 3 — Node API

- Express app
- MongoDB connection
- project CRUD
- scan/extraction job APIs
- job status

## Stage 4 — Queue/worker

- Redis
- BullMQ
- extraction job processor
- progress reporting

## Stage 5 — React UI

- project creation
- project overview
- tree view
- file list
- content viewer
- job progress

## Stage 6 — Search

- lexical search
- filters
- snippets

## Stage 7 — Duplicate intelligence

- hashing
- grouping
- duplicate UI

## Stage 8 — ProjectPack

- exclusion rules
- preview
- package
- manifest
- verify

## Stage 9 — GitHub

- public repository URL
- tree
- selective content
- package

## Stage 10 — AI

- semantic search
- summaries
- AI suggestions

## Stage 11 — Electron/Desktop

- direct local filesystem access
- local copy/move/rename
- background indexing
