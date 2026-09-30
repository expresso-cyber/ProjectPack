# @projectpack/worker — background job runner (future stage)

Intentionally empty for the MVP. The API currently runs scan/extract/package
jobs in-process through `apps/api/src/jobs/jobManager.ts`, which is sufficient
for single-workspace use (see ADR-006 in docs/25_DECISIONS.md).

When scans outgrow the request process, this package will host the BullMQ
queue processors (Redis backing store) and the API will enqueue instead of
running inline. The JobManager interface (`create`, `run`, progress reporting)
is designed so the swap is a drop-in change.
