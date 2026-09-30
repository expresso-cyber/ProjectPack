# File Engine Specification

## Purpose

The File Engine is the central deterministic subsystem.

## Design Goals

- recursive discovery
- safe paths
- modular extractors
- predictable metadata
- per-file failure isolation
- streaming for large files
- reusable from API, worker, and desktop modes

## Proposed Modules

```text
python/file_engine/
├── core/
│   ├── models.py
│   ├── scanner.py
│   ├── hashing.py
│   ├── metadata.py
│   └── pipeline.py
├── extractors/
│   ├── base.py
│   ├── text.py
│   ├── pdf.py
│   ├── docx.py
│   ├── xlsx.py
│   ├── pptx.py
│   ├── csv.py
│   └── future/
├── analyzers/
│   ├── duplicates.py
│   ├── structure.py
│   ├── naming.py
│   └── project.py
├── exporters/
│   ├── txt.py
│   ├── markdown.py
│   ├── json.py
│   └── package.py
└── tests/
```

## Extractor Interface

Each extractor should conceptually expose:

```text
supports(file)
extract(file)
metadata(file)
```

The extractor should return a normalized result.

## PDF

Use PyMuPDF:

```python
import pymupdf

with pymupdf.open(path) as doc:
    for page in doc:
        text = page.get_text()
```

PyMuPDF documents page-level text extraction directly through `get_text()`. https://pymupdf.readthedocs.io/en/latest/the-basics.html and https://pymupdf.readthedocs.io/en/latest/recipes-text.html

## Existing Prototype Migration

The current prototype uses `pypdf` for PDFs; the production engine should migrate the PDF path to PyMuPDF as requested.

The existing prototype's strengths to retain include:

- extension registry
- recursive scan
- encoding fallbacks
- structured output
- table extraction
- slide extraction
- per-file skip reporting

## Text Extraction

Support the current text/code family from the prototype, including Python, JavaScript, TypeScript, HTML, CSS, JSON, XML, YAML, SQL, Java, C/C++, C#, PHP, Ruby, Go, Rust, Shell, batch, PowerShell, Markdown, logs and configuration formats.

## Binary Files

Binary/unsupported files must not be decoded as arbitrary text.

## Encoding

Try UTF-8 first, then reasonable fallback encodings, while exposing that replacement characters may indicate lossy decoding.

## Large Files

Avoid reading entire large files into memory. Use streaming/chunking where possible.

## Extraction Result

```text
ExtractionResult
- fileId
- success
- extractor
- text
- metadata
- warnings[]
- error
- durationMs
```

## Security

- canonicalize paths
- enforce source root
- reject traversal
- consider symlink policy
- use isolated temporary directories
- clean temp data on completion/failure
