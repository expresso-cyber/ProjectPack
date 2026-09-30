# Codex CLI Development Workflow

## Repository Context

Codex CLI automatically reads repository `AGENTS.md` instruction files and applies the relevant instructions by directory scope. https://developers.openai.com/api/docs/guides/latest-model and https://openai.com/index/introducing-codex/

## Recommended first command sequence

Use Codex in the project root and ask it to:

1. read `AGENTS.md`
2. read `docs/00_MASTER_CONTEXT.md`
3. read `docs/02_SRS.md`
4. read `docs/04_SCOPE_AND_MVP.md`
5. inspect the repository
6. propose an implementation plan
7. wait for the task instruction if the user has not asked it to code

## Example implementation prompt

```text
Read AGENTS.md and the relevant docs before making changes.
Implement FR-01 through FR-04 only.
Do not add authentication or unrelated features.
Inspect the current repository before editing.
Use TypeScript/ESM for Node code.
Add tests for the new behavior.
Run type-check, tests, and build.
Update the changelog.
Report exactly what changed and what passed.
```

## Large feature workflow

### Step 1 — Requirements

Update the relevant `.md` file.

### Step 2 — Design

Document data/API/flow changes.

### Step 3 — Implementation

Make the smallest coherent change.

### Step 4 — Tests

Add unit/integration tests.

### Step 5 — QA

Run all relevant checks.

### Step 6 — Documentation

Update changelog and technical notes.

## Do not ask Codex to “build everything” in one giant prompt

Break the build into coherent milestones.

Recommended order:

```text
Foundation
→ scanner
→ metadata
→ extraction
→ database
→ API
→ UI
→ search
→ duplicate detection
→ ProjectPack
→ GitHub
→ AI
```

## Reference documentation

The earlier 90–150 page documentation should be stored under `reference/` and treated as broad context. Detailed implementation requirements in `docs/` are the operational source of truth.
