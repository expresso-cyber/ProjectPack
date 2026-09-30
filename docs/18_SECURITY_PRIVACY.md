# Security and Privacy Requirements

## Security Model

Every file is untrusted input.

## Path Traversal

Never concatenate untrusted path fragments and write them without canonicalization.

Require output paths to remain within approved roots.

## Symlinks

Define a policy before enabling recursive copy. The safe default is to avoid following symlinks outside the approved source tree.

## Archive Safety

Protect against:

- path traversal in archives
- zip bombs
- decompression bombs
- excessive nesting
- huge extracted totals

## File Validation

Do not trust file extension alone. Validate content type where appropriate.

## Temporary Storage

Use a dedicated temp root with:

- unique job directory
- restricted permissions
- cleanup on success/failure
- maximum size enforcement

## Secrets

Do not write source file contents or suspected secrets to logs.

## Authentication Status

Authentication is not implemented in the MVP.

Because of that, the MVP should be treated as:

- local development,
- single-user use,
- or an explicitly controlled internal deployment.

Do not present the unauthenticated MVP as a secure multi-user SaaS.

## Future Authentication Boundary

When authentication is added, the future system should add:

- users
- sessions/tokens
- organizations/workspaces
- RBAC
- tenant-scoped queries
- signed object access

## Privacy

Default principle:

> Do not upload or retain user files unless the feature explicitly requires it.

## AI Privacy

If cloud AI is later enabled, clearly communicate what content is sent to external model providers and allow local-only processing where technically feasible.
