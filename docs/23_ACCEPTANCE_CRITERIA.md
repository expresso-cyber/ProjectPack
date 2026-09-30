# Acceptance Criteria

## Project Scan

- user can select a valid project source
- scan recursively discovers nested files
- scan does not terminate because of one inaccessible file
- relative paths are preserved
- summary counts are accurate

## Extraction

- supported text files extract correctly
- PDF extraction uses PyMuPDF
- DOCX paragraphs/tables are represented
- XLSX sheets are represented
- PPTX slides are represented
- unsupported files are marked, not silently treated as text
- extraction failures are reported per file

## Search

- search returns matching paths
- search can identify content matches
- results are stable and paginated where appropriate

## Duplicate Detection

- identical bytes group together
- different bytes do not group as exact duplicates
- the original files are not modified

## ProjectPack

- user can preview proposed exclusions
- no file is changed before approval
- output preserves approved relative paths
- manifest is generated when enabled
- package verification can detect missing/corrupt output

## Security

- traversal outside source/destination root is rejected
- archive extraction is protected
- secrets are not written to logs
- large files respect configured limits

## MVP Scope

- no login/signup/authentication exists
- no billing exists
- no team features are required
