# Data Models

## MVP principle

There is no `User` model in the current MVP because authentication is intentionally excluded.

## Project

```text
Project
- _id
- name
- sourceType: local | github
- sourceLabel
- rootPath (local-only, never exposed unnecessarily)
- status
- createdAt
- updatedAt
```

## Folder

```text
Folder
- _id
- projectId
- parentId
- name
- relativePath
- depth
- childFolderCount
- childFileCount
```

## File

```text
File
- _id
- projectId
- folderId
- name
- relativePath
- extension
- mimeType
- size
- modifiedAt
- hash
- isSupported
- isBinary
- isExtractable
- extractionStatus
- extractionError
- contentPreview
- metadata
- createdAt
- updatedAt
```

## FileContent

Store only the content representation required for search/features.

```text
FileContent
- fileId
- text
- normalizedText
- wordCount
- lineCount
- extractionMethod
- pageCount
- sheetCount
- slideCount
- createdAt
```

For very large content, consider chunking.

## DuplicateGroup

```text
DuplicateGroup
- projectId
- hash
- fileIds[]
- totalBytes
```

## Job

```text
Job
- projectId
- type
- status
- progress
- total
- completed
- failed
- startedAt
- completedAt
- error
```

## PackageManifest

```text
PackageManifest
- projectId
- packageId
- createdAt
- algorithm
- files[]
```

Each manifest file entry contains path, size, hash, and type.

## Future AI Chunk

```text
ContentChunk
- fileId
- chunkIndex
- text
- tokenEstimate
- embedding (future)
```

MongoDB Vector Search can support semantic retrieval later without introducing a separate vector database if the selected MongoDB deployment supports the required vector-search capability. https://www.mongodb.com/docs/vector-search/
