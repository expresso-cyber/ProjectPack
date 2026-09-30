# Software Requirements Specification (SRS)

## 1. Purpose

This SRS defines the functional and non-functional requirements for the ProjectPack MVP and establishes boundaries for later versions.

## 2. Product Goal

Enable a user to select a project or repository, understand its file structure and content, search across that content, identify common structural problems, and generate a safe project package without manually opening every nested folder and file.

## 3. Current Scope

The MVP is designed for a single workspace without authentication.

## 4. Actors

- **User** — selects a local project or repository and initiates analysis.
- **System** — scans, validates, extracts, indexes, analyzes, and packages.
- **GitHub Provider** — optional external source for repository content.
- **Python Worker** — performs document/file extraction jobs.

## 5. Functional Requirements

### FR-01 Project Source Selection

The system shall allow a user to select a local project source.

### FR-02 Recursive Discovery

The system shall recursively discover files within nested directories.

### FR-03 Metadata Collection

The system shall collect, when available:

- filename
- extension
- relative path
- size
- modified timestamp
- MIME type
- hash

### FR-04 File Type Classification

The system shall classify files by extension and/or detected MIME type.

### FR-05 Content Extraction

The system shall extract text from supported text/code files and supported document formats.

### FR-06 PDF Extraction

PDF extraction shall use **PyMuPDF** (`pymupdf`) in the production Python engine.

### FR-07 Structured Document Extraction

The system shall support, subject to format limitations:

- DOCX paragraphs and tables
- XLSX sheet values
- PPTX slide text
- CSV rows

### FR-08 Extraction Result Structure

Each extracted file shall retain source path metadata so users can identify where content originated.

### FR-09 Combined Export

The system shall allow supported file content to be exported as TXT, Markdown, and JSON.

### FR-10 Folder Visualization

The system shall display a navigable folder tree.

### FR-11 Search

The system shall support file-name, path, and extracted-content search.

### FR-12 Duplicate Detection

The system shall detect exact duplicate content using strong hashes.

### FR-13 Folder Analysis

The system shall identify issues such as:

- empty folders
- unusually deep nesting
- duplicate names
- very large files
- unsupported file types
- likely generated folders

### FR-14 ProjectPack Preview

The system shall generate a proposed list of files/folders to include or exclude from a package.

### FR-15 User Approval

The system shall require explicit approval before applying potentially destructive or modifying operations.

### FR-16 Package Creation

The system shall create a clean package that preserves selected folder structure.

### FR-17 Manifest

The package shall support a manifest containing file paths, sizes, and hashes.

### FR-18 Project Report

The system shall generate a project analysis report with counts, warnings, extraction status, and packaging readiness.

### FR-19 GitHub Import

The system shall support public GitHub repository analysis in a later MVP increment.

### FR-20 Job Progress

Long-running operations shall expose progress/status information.

## 6. Authentication Constraint

Authentication, login, signup, password storage, OAuth, JWT user sessions, and user accounts are explicitly **out of scope** for this MVP.

The architecture shall not make future authentication difficult, but no current feature may depend on it.

## 7. Non-Functional Requirements Summary

- Security-first file handling
- Deterministic and repeatable extraction
- Fault isolation per file
- Reasonable performance for typical student/developer projects
- Extensible extractor architecture
- Testability
- Clear observability
- Cross-platform future readiness

## 8. Assumptions

- The initial target user is a single user working with local project files.
- Some file formats will not be fully extractable.
- OCR may be a later feature.
- Large files require streaming/worker processing.
- Cloud connectors are later-stage features.

## 9. Out of Scope

- full document-management suite
- enterprise compliance suite
- complete storage synchronization
- automatic deletion
- arbitrary file conversion
- guaranteed perfect semantic understanding

## 10. Requirement Traceability

Every implementation task should reference one or more requirement IDs such as `FR-05` or `NFR-07`.
