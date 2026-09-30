# User Stories and Use Cases

## Student

### US-01

As a student, I want to select my entire course folder so I can read the content of nested session files without manually opening every directory.

### US-02

As a student, I want all supported source files combined into Markdown so I can share or review them more easily.

## Developer

### US-03

As a developer, I want ProjectPack to inspect a repository and tell me what is inside it.

### US-04

As a developer, I want to create a clean package without build artifacts, caches, or obvious temporary files.

## Freelancer

### US-05

As a freelancer, I want to prepare a client project without accidentally including unrelated files.

## Teacher

### US-06

As a teacher, I want to collect and inspect student project folders with consistent structure.

## Researcher

### US-07

As a researcher, I want to search across many documents by content rather than filename alone.

## Use Case: Analyze Project

1. User selects project.
2. Scanner discovers files.
3. System collects metadata.
4. System classifies files.
5. Supported content is extracted.
6. Results are indexed.
7. Project analysis is generated.
8. Dashboard displays findings.

## Use Case: Create ProjectPack

1. User starts packaging.
2. System proposes exclusions.
3. User reviews proposed changes.
4. User approves.
5. System creates package.
6. System verifies package.
7. System writes manifest.
8. User downloads/saves package.

## Use Case: Find Duplicate

1. System hashes files.
2. Files are grouped by hash.
3. User sees duplicate groups.
4. System explains group membership.
5. User decides whether to retain/remove/move.

## Use Case: Read All Content

1. Scan project.
2. Select file types.
3. Extract content.
4. Preserve source paths.
5. Export as TXT/Markdown/JSON.
