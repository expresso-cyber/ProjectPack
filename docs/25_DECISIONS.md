# Architecture Decision Record (ADR) Log

## ADR-001 — Use MERN as the application core

**Decision:** Use React + TypeScript, Node.js + Express + MongoDB/Mongoose.

**Reason:** The founder already has JavaScript/full-stack experience and the product has a document-oriented metadata model.

## ADR-002 — Keep file extraction in Python

**Decision:** Use a Python processing engine for extraction-heavy operations.

**Reason:** The existing prototypes already use Python libraries and the extraction layer benefits from Python's document ecosystem.

## ADR-003 — Use PyMuPDF for production PDF extraction

**Decision:** Production PDF extraction uses PyMuPDF.

**Reason:** It provides direct page/document text extraction APIs and fits the existing Python pipeline.

## ADR-004 — No authentication in MVP

**Decision:** Do not implement login/signup/authentication now.

**Reason:** The current goal is validating the core file workflow first.

**Constraint:** Do not present the unauthenticated build as a secure multi-user SaaS.

## ADR-005 — Do not store all original files in MongoDB by default

**Decision:** Store metadata and extracted representations; keep original file storage local or move to object storage when the feature requires it.

**Reason:** File intelligence is not the same as file storage.

## ADR-006 — Queue heavy work

**Decision:** Use Redis + BullMQ when scans/extraction become long-running.

**Reason:** Background queues keep HTTP requests responsive and provide retry/progress behavior. BullMQ is a Redis-backed job system. 

## ADR-007 — Keep AI optional

**Decision:** Core scan, extraction, hashing, packaging, and safety remain deterministic.

**Reason:** The product must survive model-provider changes and avoid AI costs for basic operations.

## ADR-008 — Preview before modification

**Decision:** Renames/moves/copies/deletions use preview and explicit approval.

**Reason:** User trust and data safety.
