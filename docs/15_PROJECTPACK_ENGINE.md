# ProjectPack Engine

## Purpose

ProjectPack is the safe packaging layer that converts a project into a clean, verifiable deliverable.

## Pipeline

```text
SELECT SOURCE
    ↓
SCAN
    ↓
ANALYZE
    ↓
BUILD PROPOSAL
    ↓
USER REVIEW
    ↓
APPROVE
    ↓
COPY / PACKAGE
    ↓
MANIFEST
    ↓
VERIFY
```

## Candidate Exclusions

The engine may flag, but must not automatically delete:

- `node_modules/`
- build output
- cache directories
- temporary files
- editor metadata
- `.DS_Store`
- Python caches
- test artifacts
- local environment files such as `.env`

These are recommendations and must be configurable.

## Secret Safety

Potential secrets such as API keys or private credentials should be flagged for review. Detection must never claim certainty when the pattern is ambiguous.

## Copy Strategy

Preserve relative paths.

Do not allow a destination path to escape the user-selected destination root.

## Manifest

Example:

```json
{
  "project": "Example",
  "algorithm": "sha256",
  "files": [
    {
      "path": "src/app.py",
      "size": 1823,
      "hash": "..."
    }
  ]
}
```

## Verification

After package creation:

1. verify expected file count
2. verify each expected path exists
3. verify size
4. verify hash where enabled
5. report failures

## Undo

The first MVP may produce a new package rather than editing the original. This reduces risk.
