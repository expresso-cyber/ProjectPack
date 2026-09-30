# UI Requirements

## Design direction

- modern SaaS
- developer-friendly
- calm and minimal
- strong file-tree visualization
- information-dense without clutter
- responsive
- accessible

## Main Screens

### 1. Home / Workspace

Shows:

- project list for the current local session
- “Analyze Project” action
- “GitHub Repository” action
- recent analyses

### 2. Project Overview

Show:

- project name
- total files
- total folders
- total size
- supported/unsupported counts
- duplicates
- warnings
- extraction status

### 3. File Tree

Requirements:

- expand/collapse folders
- file icons
- filters
- search
- file metadata
- selection mode

### 4. Content View

Show:

- source path
- file type
- extracted text
- page/sheet/slide boundaries where available
- extraction warnings

### 5. Search

Support filters:

- name
- path
- type
- content
- status

### 6. Duplicate Center

Show groups with:

- files
- size
- hash
- path
- modification time

### 7. ProjectPack

Show:

- included files
- excluded files
- reason for exclusion
- estimated output size
- manifest option
- approval button

### 8. Report

Show project health summary and detailed findings.

## Interaction safety

Destructive or modifying operations must use confirmation dialogs and previews.

## Empty states

Every main screen must have a useful empty-state explanation and a next action.

## Loading states

Long scans must show progress, counts, and current stage.
