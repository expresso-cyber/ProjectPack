# Functional Requirements

## Project Scanning

### FR-01 Recursive scanner

Input: source directory.

Output: normalized list of discovered files.

Requirements:

- recurse nested folders
- avoid infinite loops
- handle inaccessible entries without killing the whole scan
- return relative paths
- support configurable exclusion patterns

## Metadata

Each file record should include:

```text
id
name
relativePath
extension
mimeType
size
createdAt
modifiedAt
hash
isSupported
isBinary
isExtractable
extractionStatus
```

## Content Extraction

### Text

Use robust decoding with UTF-8 first and sensible fallbacks.

### PDF

Use PyMuPDF.

### DOCX

Extract paragraphs and tables at minimum.

### XLSX

Extract workbook/sheet values. Future implementation may preserve formulas separately.

### PPTX

Extract slide text.

### CSV

Parse rows safely and support large-file streaming.

## Search

MVP search should support:

- filename
- path
- extension
- extracted text

Future search may include semantic/vector search.

## Duplicate Detection

Exact duplicate detection shall use content hashes.

Suggested staged approach:

```text
same size?
  ↓
partial hash (optional optimization)
  ↓
full SHA-256/BLAKE3
  ↓
same content group
```

Never delete a duplicate automatically.

## Folder Analysis

Produce findings such as:

- empty directories
- excessive depth
- oversized files
- generated/build directories
- unsupported files
- suspicious names
- duplicate content

## Packaging

Packaging must:

- preserve allowed hierarchy
- support exclusions
- never include files outside the chosen source tree
- prevent path traversal
- generate a manifest
- optionally calculate final checksums

## Copy / Move / Rename

These operations are preview-first.

## Error Handling

Every file-processing job should be able to return per-file errors without failing the entire job.
