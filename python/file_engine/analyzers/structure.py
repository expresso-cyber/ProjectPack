"""Folder-structure analysis: empty folders, deep nesting, breadth stats."""
from __future__ import annotations

from typing import Any

DEEP_DEPTH = 8


def analyze_structure(files: list[dict[str, Any]], folders: list[dict[str, Any]]) -> dict[str, Any]:
    file_paths = {f["relativePath"] for f in files}
    folder_by_path = {f["relativePath"]: f for f in folders}

    empty_folders = []
    for folder in folders:
        rel = folder["relativePath"]
        has_child_folder = any(
            p != rel and p.startswith(rel + "/") for p in folder_by_path
        )
        has_file = any(
            p != rel and p.startswith(rel + "/") for p in file_paths
        )
        if not has_child_folder and not has_file:
            empty_folders.append(rel)

    deepest = max((f["depth"] for f in folders), default=0)
    deep_folders = [f["relativePath"] for f in folders if f["depth"] >= DEEP_DEPTH]

    return {
        "emptyFolders": sorted(empty_folders),
        "deepestDepth": deepest,
        "deepFolders": deep_folders,
        "folderCount": len(folders),
    }
