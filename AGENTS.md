# ProjectPack Codex Instructions

## Source of truth

Before changing architecture, requirements, or major behavior, read:

1. `docs/00_MASTER_CONTEXT.md`
2. `docs/02_SRS.md`
3. `docs/04_SCOPE_AND_MVP.md`
4. `docs/10_TECH_STACK_AND_TOOLS.md`
5. the subsystem specification directly related to the task

Do **not** invent requirements that conflict with these documents.

## Project identity

Product: **ProjectPack**  
Author: **Roshan Mithilesh Rai**  
Category: File Intelligence & Project Management Platform

## Current MVP constraints

- Do not implement authentication, login, signup, OAuth, JWT user sessions, password reset, account recovery, or user management yet.
- Keep the code architecture easy to extend for authentication later.
- Do not build billing in the MVP.
- Do not build social/team collaboration in the MVP.
- Do not build an all-purpose PDF conversion website.
- Do not add large dependencies when a Node.js or Python standard-library capability is sufficient.
- Do not automatically delete, overwrite, rename, move, or modify user files without an explicit preview/approval flow.
- Never assume a file extension is trustworthy; validate file type where security-sensitive.
- Never place secrets, API keys, local absolute paths, or personal credentials into source control.

## Technology defaults

Frontend: React + TypeScript + Vite  
Backend: Node.js + Express + TypeScript  
Database: MongoDB + Mongoose  
Heavy processing: Python worker  
PDF: PyMuPDF (`pymupdf`)  
Queue: Redis + BullMQ when work is asynchronous/heavy  
Desktop/local filesystem: Electron is a future/parallel capability where direct local writes are required.

## Coding rules

- Prefer TypeScript for new JavaScript/Node code.
- Prefer ESM modules.
- Keep controllers thin; put business logic in services.
- Keep filesystem operations isolated from HTTP handlers.
- Keep extractors isolated and testable.
- Prefer pure functions for normalization and classification.
- Use structured error types.
- Validate API input with a schema library such as Zod.
- Use environment variables for configuration.
- Avoid hard-coded machine-specific paths.
- Keep long-running processing off the request thread.
- Make background jobs idempotent.
- Add tests for every non-trivial file-processing feature.

## Documentation rules

When adding a feature:

1. Update the relevant `.md` specification first if the behavior is new.
2. Implement the feature.
3. Add tests.
4. Update the changelog.
5. Report what changed and what was verified.

## File-processing safety

Treat every uploaded or selected file as untrusted input.

Protect against:

- path traversal,
- ZIP bombs,
- decompression bombs,
- oversized files,
- malformed files,
- unsupported encodings,
- malicious macros/content where relevant,
- symlink surprises,
- accidental recursive self-copy.

## Verification commands

At minimum, use the project's package scripts once they exist:

- frontend type-check/build
- backend type-check/test
- Python tests
- lint

Never claim a test passed unless it was actually run.

## Codex workflow

For a medium or large task:

1. read the relevant requirements,
2. inspect the existing code,
3. make the smallest coherent change,
4. run relevant tests,
5. update documentation if behavior changed,
6. summarize changed files and verification.

Do not rewrite unrelated parts of the repository.
