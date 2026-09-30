# GitHub Integration

## Goal

Allow users to inspect and selectively package GitHub repository content without requiring a local `git clone` for the basic workflow.

## Public Repository MVP Flow

```text
GitHub URL
   ↓
Validate URL
   ↓
Repository metadata
   ↓
Tree listing
   ↓
User selects folder/files
   ↓
Fetch selected content
   ↓
ProjectPack analysis
   ↓
Export/package
```

GitHub's REST APIs expose repository contents and Git tree information. The Contents API has documented directory-size limits, while the Git Trees API can recursively return repository tree information subject to documented limits. Use API pagination/limits carefully rather than assuming a single request can represent every repository. 

## Download ZIP vs ProjectPack

### GitHub ZIP

Useful when the user wants the whole repository archive.

### ProjectPack

Useful when the user wants:

- a specific folder
- selected files
- analysis before downloading
- excluded generated files
- combined extracted content
- a manifest
- a clean project package

ProjectPack is a convenience/intelligence layer, not a replacement for Git.

## Private repositories

Private repository support should be implemented later through authenticated GitHub integration with the minimum required permissions.

## Integration Service

Use an adapter such as:

```text
GitHubProvider
- getRepository()
- getTree()
- getFile()
- getDirectory()
- createArchive()
```

Keep GitHub-specific logic out of generic project services.

## Rate limits

The GitHub API has different limits depending on authentication and endpoint context. Read the current GitHub documentation at implementation time rather than hard-coding old limits.

## Safety

Do not:

- expose GitHub tokens to the browser unnecessarily
- log access tokens
- silently access private repositories
- assume repository URLs are safe without validation
