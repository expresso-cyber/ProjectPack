# System Architecture

## Architecture Style

A modular monorepo with a MERN web application and a Python processing worker.

```text
                 React + TypeScript
                        │
                     REST API
                        │
             Node.js + Express + TS
                  │          │
                  │          └──────── MongoDB
                  │
             Redis / BullMQ
                  │
          ┌───────┴────────┐
          │                │
      Node workers     Python worker
                           │
                  ┌────────┼────────┐
                  │        │        │
               PyMuPDF  DOCX     XLSX/PPTX
```

## Runtime Modes

### Web mode

The browser selects files or folders using browser capabilities and sends the required data to the API when server-side processing is needed.

### Desktop mode (recommended for full local filesystem control)

Electron can provide a desktop shell using JavaScript/HTML/CSS and Node.js, with a shared React UI. Electron supports Windows, macOS, and Linux from one codebase. https://www.electronjs.org/docs/latest/

## Backend Responsibilities

- API routing
- validation
- project lifecycle
- job orchestration
- metadata persistence
- search
- packaging orchestration
- GitHub integration

## Python Responsibilities

- heavy extraction
- PDF processing
- document extraction
- optional OCR
- content normalization
- extraction-specific parsing

## Database Responsibilities

MongoDB stores metadata and normalized project state.

Do not use MongoDB as the default place for every original file. GridFS exists for files larger than MongoDB's 16 MiB BSON document limit, but object storage or local processing may be preferable for a file-intelligence product. https://www.mongodb.com/docs/manual/core/gridfs/ and https://www.mongodb.com/docs/drivers/node/current/crud/gridfs/

## Queue

BullMQ is a Redis-backed Node.js job system suitable for moving heavy work out of HTTP request handlers. https://docs.bullmq.io/ and https://docs.bullmq.io/quick-start

## Search

MVP: metadata + lexical search.

Later: MongoDB Search / Vector Search for semantic and hybrid retrieval. MongoDB documents current Search and Vector Search capabilities for full-text, semantic, and hybrid search. https://www.mongodb.com/docs/manual/text-search/ and https://www.mongodb.com/docs/vector-search/
