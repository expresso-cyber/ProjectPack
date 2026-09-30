# Non-Functional Requirements

## NFR-01 Reliability

A single malformed or inaccessible file should not terminate an otherwise valid project scan.

## NFR-02 Performance

Scanning must be streaming-friendly and should avoid loading entire large files into memory unless the extractor requires it.

## NFR-03 Scalability

The architecture must allow extraction and analysis jobs to move from request/response execution into queued workers.

## NFR-04 Security

Treat all files as untrusted input.

Required protections include:

- canonical path validation
- allowed-root enforcement
- path traversal checks
- archive safety
- file size limits
- MIME/content validation
- secure temporary directories
- cleanup after processing

## NFR-05 Observability

Log job IDs, operation type, duration, counts, failures, and error classes without logging file contents or secrets by default.

## NFR-06 Extensibility

New extractors should be addable without rewriting the scanner or API.

## NFR-07 Testability

Scanner, hashing, normalization, extractors, packager, and API endpoints should be independently testable.

## NFR-08 Portability

Core algorithms should avoid hard-coded Windows-only assumptions even though Windows is an important development target.

## NFR-09 UX Safety

Potentially destructive operations require:

```text
PLAN → PREVIEW → APPROVE → EXECUTE → VERIFY
```

## NFR-10 Maintainability

Business logic must not be embedded directly in route handlers.

## NFR-11 Data privacy

Do not persist original user files by default in the MVP unless a documented feature requires it.

## NFR-12 Determinism

For the same input and same extraction configuration, the system should produce reproducible metadata/output where practical.
