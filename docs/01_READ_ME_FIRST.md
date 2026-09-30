# Read Me First — How to Use These Specifications With Codex CLI

## Recommended workflow

Keep these files in the repository before asking Codex to build the application.

Codex CLI can automatically load repository `AGENTS.md` instructions. Use that file for persistent rules and use the `docs/` directory for detailed specifications. https://developers.openai.com/api/docs/guides/latest-model and https://openai.com/index/introducing-codex/

## Should the earlier 90–150 page project documentation also be saved?

**Yes.** Save it as a reference document, but do not depend on it as the only instruction file.

Recommended location:

```text
reference/
└── PROJECTPACK_MASTER_DOCUMENTATION.md
```

Then keep the concise, operational requirements in:

```text
docs/
```

The large documentation is useful for context. The smaller files are better for implementation because a coding task can load only the relevant specification.

## Recommended prompt to Codex

```text
Read AGENTS.md first.
Then read docs/00_MASTER_CONTEXT.md, docs/02_SRS.md, docs/04_SCOPE_AND_MVP.md,
and the subsystem specification relevant to this task.
Do not invent requirements. Implement only the requested scope.
Inspect the existing code before editing.
Run the relevant tests and report exactly what passed.
```

## Task-specific reading

### Frontend task

Read:

- `00_MASTER_CONTEXT.md`
- `02_SRS.md`
- `03_PRD.md`
- `04_SCOPE_AND_MVP.md`
- `09_PROJECT_FOLDER_STRUCTURE.md`
- `10_TECH_STACK_AND_TOOLS.md`
- `11_UI_REQUIREMENTS.md`

### Backend task

Read:

- `00_MASTER_CONTEXT.md`
- `02_SRS.md`
- `05_FUNCTIONAL_REQUIREMENTS.md`
- `10_TECH_STACK_AND_TOOLS.md`
- `12_DATA_MODELS.md`
- `13_API_SPECIFICATION.md`

### File-engine task

Read:

- `00_MASTER_CONTEXT.md`
- `05_FUNCTIONAL_REQUIREMENTS.md`
- `14_FILE_ENGINE_SPECIFICATION.md`
- `15_PROJECTPACK_ENGINE.md`
- `18_TESTING_QA.md`

### GitHub task

Read:

- `00_MASTER_CONTEXT.md`
- `16_GITHUB_INTEGRATION.md`
- `13_API_SPECIFICATION.md`
- `18_TESTING_QA.md`

### AI/search task

Read:

- `17_AI_AND_SEARCH_SPEC.md`
- `12_DATA_MODELS.md`
- `13_API_SPECIFICATION.md`

## Important

Do not paste the entire 120-page documentation into every Codex prompt. Store it in the repository and let `AGENTS.md` point Codex toward the specific specifications it needs.
