# Technology Stack and Tools

## Required Core Stack

| Layer | Technology | Role |
|---|---|---|
| UI | React + TypeScript | Web interface |
| Build | Vite | Frontend build/dev server |
| Styling | Tailwind CSS | UI styling |
| Server | Node.js + TypeScript | Application runtime |
| API | Express | HTTP API |
| DB | MongoDB | Metadata/project state |
| ODM | Mongoose | Schema/model layer |
| Worker | Python | Heavy extraction |
| PDF | PyMuPDF (`pymupdf`) | PDF extraction/rendering |
| Queue | BullMQ | Background jobs |
| Queue store | Redis | BullMQ backing store |
| Validation | Zod | API/input validation |
| Logging | Pino | Structured logs |
| GitHub | Octokit | GitHub API integration |
| Tests | Vitest / Supertest / Playwright / pytest | Automated testing |
| Desktop | Electron (later/full local mode) | Local filesystem operations |

React's current guidance supports building React applications and TypeScript integration, and Create React App is deprecated; use Vite or another supported setup instead. https://react.dev/learn/installation and https://react.dev/learn/typescript

MongoDB's documentation explicitly describes MERN as MongoDB + Express/Node.js + React. https://www.mongodb.com/docs/drivers/node-frameworks/react/

## Node Runtime

Use the current **LTS** Node.js line available when the project is initialized. As of 2026-09-27, Node.js 24 is an LTS line and Node.js 26 is current. Prefer LTS for the project rather than Current unless there is a documented need. https://nodejs.org/en/blog/release

## Python Dependencies

Start with:

```text
pymupdf
python-docx
openpyxl
python-pptx
```

Add only when required:

```text
pillow
charset-normalizer
python-magic / platform equivalent
pytest
```

## PDF Requirement

Use PyMuPDF rather than the prototype's `pypdf` for the production PDF extraction path. PyMuPDF supports opening documents and page-level text extraction through `page.get_text()`. https://pymupdf.readthedocs.io/en/latest/the-basics.html and https://pymupdf.readthedocs.io/en/latest/recipes-text.html

## Optional OCR

Future OCR may use Tesseract or another dedicated OCR system. Do not add OCR dependencies until OCR is an explicitly scheduled feature.

## Frontend Recommended Packages

```text
react-router-dom
@tanstack/react-query
zustand
zod
lucide-react
```

Optional UI library: use a small component layer such as shadcn/ui only if it reduces custom UI work and does not create unnecessary coupling.

## Backend Recommended Packages

```text
express
mongoose
zod
pino
pino-http
cors
helmet
multer
archiver
@octokit/rest
bullmq
redis
```

Use native Node.js `fs/promises`, `path`, `crypto`, and streaming APIs wherever sufficient.

## Testing

Frontend:

```text
vitest
@testing-library/react
playwright
```

Backend:

```text
vitest
supertest
```

Python:

```text
pytest
```

## Development Tools

Recommended:

- VS Code
- Git
- GitHub
- Node.js LTS
- Python 3.12+ compatible with project dependencies
- MongoDB Community or MongoDB Atlas
- Redis local/container
- Docker Desktop
- Codex CLI

## Environment

Maintain `.env.example`; do not commit `.env`.

Recommended variables:

```text
PORT
MONGODB_URI
REDIS_URL
PYTHON_ENGINE_PATH
TEMP_ROOT
GITHUB_TOKEN (only when GitHub private integration is implemented)
AI_PROVIDER_API_KEY (only if AI is enabled)
```

## Storage strategy

MVP: process selected files and store metadata/results. Do not build permanent file storage unless required.

Future SaaS: use S3-compatible object storage. MongoDB GridFS is available for larger-than-16 MiB files but should not automatically become the default file-storage strategy. See https://www.mongodb.com/docs/manual/core/gridfs/.
