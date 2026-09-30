# Storage Architecture & Multi-User Roadmap

## The problem this document answers

During the MVP, all ProjectPack output (project metadata, extracted text,
packages, exports, and unpacked GitHub repositories) lived under a single
`DATA_DIR` that defaulted to a folder inside the codebase. Two issues follow:

1. **Repository pollution** — analysis data lands inside the developer's
   project folder and gets mixed with source control.
2. **No multi-user story** — a single local `DATA_DIR` cannot serve multiple
   users, multiple machines, or horizontally scaled API replicas.

## What changed in this release (local MVP)

- The default `DATA_DIR` is now the **OS user home directory**
  (`~/.projectpack`, e.g. `C:\Users\<name>\.projectpack` on Windows) —
  completely outside any codebase. Override with `DATA_DIR` in `.env`.
- Unpacked GitHub repository sources now live under the **project's own data
  directory** (`<DATA_DIR>/projects/<projectId>/source`), so deleting a
  project removes its downloaded copy too — no orphans.
- `data/` remains in `.gitignore` for anyone who pins `DATA_DIR` back inside
  the repository.

## Where data lives now

```text
~/.projectpack/
├── projects/<projectId>/
│   ├── project.json        # metadata + scan settings
│   ├── files.json          # indexed file records
│   ├── folders.json        # folder records
│   ├── contents/           # extracted text per file
│   ├── packages/           # created ProjectPacks + ZIPs + manifests
│   ├── exports/            # combined .md/.txt/.json exports
│   ├── source/             # (GitHub projects) unpacked repository tree
│   └── jobs.json, duplicates.json, report.json
└── tmp/                    # engine scratch payloads
```

## Multi-user architecture (recommended, when the product needs it)

Research summary (sources at the end): the standard pattern for self-hosted and
SaaS apps is **local disk only for single-node development/evaluation, and
S3-compatible object storage for any production or multi-replica deployment**,
because container-local files are lost on redeploy and are not shared between
replicas. Concretely for ProjectPack:

1. **Do not store original files at all where avoidable.** ProjectPack's core
   value is extracted *representations*, not storage:
   - GitHub sources are re-downloadable from upstream at any time.
   - Local-folder projects are re-scannable from the user's own disk.
   - Keep original files only for user-uploaded archives, and give them a
     retention policy (TTL) or explicit "keep source" opt-in.
2. **Metadata + extracted text → managed MongoDB (MongoDB Atlas or
   self-hosted Mongo).** This matches the documented data model
   (docs/12_DATA_MODELS.md). The current file-backed `Store` interface is
   intentionally narrow so a Mongoose implementation can replace it.
3. **User-uploaded artifacts (packages, exports, retained sources) →
   S3-compatible object storage**, served to browsers via **presigned URLs**,
   never proxied through the API. Candidates:
   - **Cloudflare R2** — S3-compatible API, zero egress fees; for a product
     whose main output is *downloads* (packages, exports), egress is the
     dominant cost, which makes R2 the price leader.
   - **AWS S3** — the feature/durability benchmark; egress billed at roughly
     $0.09/GB, which adds up quickly for download-heavy usage.
   - **Supabase Storage / Backblaze B2** — fine alternatives; Supabase fits
     if the rest of the stack already lives there.
   - Self-hosted option: **MinIO** on a dedicated volume.
4. **Workers** keep only ephemeral scratch space (temp dir per job, cleaned
   on completion) — which the Python engine already does.
5. **Retention**: per-project TTLs (e.g. auto-delete analysis older than N
   days) plus the existing delete-project flow.

## Why not "just add cloud storage now"

The MVP is single-workspace and local-first by design (docs/04_SCOPE_AND_MVP.md).
Adding object storage before authentication and multi-user workspaces would
add cost and complexity with no user benefit — anyone can already point
`DATA_DIR` at any disk they like. The queue/worker stage (BullMQ + Redis,
ADR-006) and this storage stage are the two infrastructure steps to take
together when the product goes multi-user.

## Sources

- Sim self-hosting docs — object storage backends; local disk lost on
  container recreation, use S3/Azure Blob/GCS for production multi-replica:
  https://docs.sim.ai/platform/self-hosting/object-storage
- Cloudflare R2 vs AWS S3 comparison (2025) — zero egress with R2 vs S3
  egress pricing: https://www.digitalapplied.com/blog/cloudflare-r2-vs-aws-s3-comparison
- Cloudflare R2 vs S3 (vendor): https://www.cloudflare.com/pg-cloudflare-r2-vs-aws-s3/
- Django file storage at scale — presigned URLs / direct uploads pattern:
  https://www.djangozen.com/tutorials/file-storage-at-scale-in-django-s3-signed-urls-direct-uploads-and-cdns/
