# AI and Search Specification

## AI Position

AI is a layer on top of the deterministic file engine.

## MVP Search

Start with deterministic search:

- filename
- path
- extension
- extracted text

## Future Semantic Search

MongoDB Search and MongoDB Vector Search can later support full-text, semantic, and hybrid retrieval. https://www.mongodb.com/docs/manual/text-search/ and https://www.mongodb.com/docs/vector-search/

## Hybrid Search

Conceptually:

```text
query
 ↓
keyword retrieval
+
vector retrieval
 ↓
metadata filtering
 ↓
ranking
 ↓
results
```

## AI File Finder

User example:

> “Find the PDF where I wrote about database normalization.”

System:

1. parse intent
2. generate lexical terms
3. retrieve candidates
4. semantic retrieval if enabled
5. rank
6. return source paths and snippets

## AI Renamer

AI should generate suggestions only.

Flow:

```text
file
 ↓
content/metadata
 ↓
name proposal
 ↓
preview
 ↓
user approval
 ↓
rename
```

## AI Folder Organizer

AI proposes category assignments; user previews before changes.

## Project Q&A

Future RAG-style flow:

```text
Question
 ↓
retrieve relevant file chunks
 ↓
include source paths
 ↓
LLM response
 ↓
show citations to project files
```

## Agentic Workflows

Future agents can plan multi-step operations such as:

> “Prepare this project for sharing.”

Required safety model:

```text
PLAN
→ PREVIEW
→ APPROVE
→ EXECUTE
→ VERIFY
```

## Provider Independence

Do not hard-wire business logic to one model provider.

Create an internal interface for:

- embeddings
- chat/completion
- summarization
- classification

## No AI Requirement

The core application must remain useful if AI is disabled.
