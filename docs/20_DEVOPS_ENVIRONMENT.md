# Development and DevOps Environment

## Local Services

Recommended:

```text
Node.js LTS
MongoDB
Redis
Python
```

Docker Compose may provide MongoDB and Redis for local consistency.

## Environment Files

```text
.env.example      committed
.env              local only
```

## Suggested Scripts

```text
npm run dev
npm run build
npm run test
npm run lint
npm run typecheck
npm run worker
npm run python:test
```

## Logging

Development logs may be verbose.

Production logs must avoid:

- file contents
- credentials
- private tokens
- full user paths unless needed for debugging

## Deployment Shape

MVP:

```text
Web frontend
Node API
MongoDB
Redis
Python worker
```

Future:

```text
CDN
API replicas
worker pool
object storage
observability
desktop clients
```

## Backups

Back up database metadata. Treat original user files separately from application metadata.
