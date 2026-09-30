# Testing and QA

## Test Layers

### Unit

Test:

- path normalization
- extension classification
- hashing
- metadata normalization
- extractor selection
- output formatting
- duplicate grouping

### Integration

Test:

- API → service → database
- API → queue
- worker → Python engine
- GitHub adapter

### End-to-End

Test:

- select project
- scan
- extract
- search
- analyze
- package
- download/export

## File Fixture Set

Create fixtures for:

- TXT
- Markdown
- Python
- JavaScript
- JSON
- CSV
- PDF
- DOCX
- XLSX
- PPTX
- empty file
- malformed file
- unreadable encoding
- Unicode filename
- deep nested path
- duplicate contents
- very large file
- archive traversal test

## PDF Tests

Verify:

- page count
- page text
- empty pages
- malformed PDF handling
- Unicode text

Use PyMuPDF in the actual PDF extractor tests.

## Duplicate Tests

Two different filenames with identical bytes must resolve to the same exact-hash group.

Two same filenames with different bytes must not be treated as exact duplicates.

## Package Tests

Verify that:

- excluded files do not appear
- included files preserve relative paths
- manifest paths match package paths
- hashes verify
- source files remain unchanged

## Performance Tests

Measure:

- files scanned per minute
- extraction throughput
- memory usage
- queue wait time
- package creation time

## Regression Rule

Every bug discovered in file processing must result in a regression test.

## Minimum CI

- lint
- type-check
- unit tests
- integration tests
- Python tests
- production build
