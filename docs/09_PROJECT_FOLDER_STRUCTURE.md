# Project Folder Structure

```text
ProjectPack/
├── AGENTS.md
├── README.md
├── package.json
├── package-lock.json
├── .gitignore
├── .env.example
├── docker-compose.yml
│
├── apps/
│   ├── web/
│   │   ├── src/
│   │   │   ├── components/
│   │   │   ├── features/
│   │   │   ├── pages/
│   │   │   ├── hooks/
│   │   │   ├── lib/
│   │   │   ├── services/
│   │   │   ├── stores/
│   │   │   ├── types/
│   │   │   └── main.tsx
│   │   └── public/
│   │
│   ├── api/
│   │   ├── src/
│   │   │   ├── config/
│   │   │   ├── controllers/
│   │   │   ├── middleware/
│   │   │   ├── models/
│   │   │   ├── routes/
│   │   │   ├── services/
│   │   │   ├── jobs/
│   │   │   ├── integrations/
│   │   │   ├── utils/
│   │   │   ├── app.ts
│   │   │   └── server.ts
│   │   └── tests/
│   │
│   ├── worker/
│   │   ├── src/
│   │   │   ├── queues/
│   │   │   ├── processors/
│   │   │   └── services/
│   │   └── tests/
│   │
│   └── desktop/
│       ├── electron/
│       └── src/
│
├── python/
│   └── file_engine/
│       ├── core/
│       ├── extractors/
│       ├── analyzers/
│       ├── exporters/
│       ├── security/
│       ├── tests/
│       ├── requirements.txt
│       └── worker.py
│
├── packages/
│   └── shared/
│       ├── src/
│       └── package.json
│
├── docs/
├── reference/
├── scripts/
├── tests/
└── .github/
    └── workflows/
```

## Why this structure

- `web` owns presentation.
- `api` owns business APIs.
- `worker` owns Node background orchestration.
- `desktop` owns local filesystem capabilities.
- `python/file_engine` owns extraction and analysis.
- `packages/shared` contains shared TypeScript contracts/types.
- `docs` is the product truth.
- `reference` stores large historical documentation/source research.

## Do not create a giant monolithic server

Keep scanners, extractors, packagers, and integration clients independent.
