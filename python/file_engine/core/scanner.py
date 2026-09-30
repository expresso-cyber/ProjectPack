"""Recursive, safety-bounded directory scanner."""
from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path

from ..security.paths import is_symlink, within_root
from .metadata import extension_of
from .models import FileEntry, ScanResult

# Directories that are never useful as project content.
DEFAULT_EXCLUDED_DIRS = {
    ".git", ".hg", ".svn", "node_modules", "__pycache__", ".venv", "venv",
    ".mypy_cache", ".pytest_cache", ".idea", ".vs", ".next", "dist", "build",
    ".DS_Store",
}


class ScanLimits:
    def __init__(self, max_files: int = 20000, max_depth: int = 64):
        self.max_files = max_files
        self.max_depth = max_depth


def scan(
    root: Path,
    limits: ScanLimits | None = None,
    excluded_dirs: set[str] | None = None,
) -> ScanResult:
    limits = limits or ScanLimits()
    excluded = DEFAULT_EXCLUDED_DIRS if excluded_dirs is None else excluded_dirs
    result = ScanResult(root=str(root))
    result.scannedAt = datetime.now(timezone.utc).isoformat()

    def walk(dir_path: Path, rel: str, depth: int) -> None:
        if depth > limits.max_depth:
            result.warnings.append(f"Max depth exceeded at {rel or '.'}")
            return
        try:
            entries = sorted(os.scandir(dir_path), key=lambda e: e.name)
        except OSError as exc:
            result.skipped.append({"path": rel or ".", "reason": str(exc)})
            return
        for entry in entries:
            entry_rel = f"{rel}/{entry.name}" if rel else entry.name
            if entry.is_symlink():
                result.skipped.append({"path": entry_rel, "reason": "symlink skipped"})
                continue
            if entry.is_dir(follow_symlinks=False):
                if entry.name in excluded:
                    continue
                result.folders.append({
                    "name": entry.name,
                    "relativePath": entry_rel,
                    "depth": depth,
                })
                walk(Path(entry.path), entry_rel, depth + 1)
                if len(result.files) >= limits.max_files:
                    result.warnings.append(
                        f"File limit ({limits.max_files}) reached; scan stopped early"
                    )
                    return
            elif entry.is_file(follow_symlinks=False):
                if len(result.files) >= limits.max_files:
                    result.warnings.append(
                        f"File limit ({limits.max_files}) reached; scan stopped early"
                    )
                    return
                try:
                    stat = entry.stat(follow_symlinks=False)
                except OSError as exc:
                    result.skipped.append({"path": entry_rel, "reason": str(exc)})
                    continue
                ext = extension_of(Path(entry.name))
                result.files.append(FileEntry(
                    relativePath=entry_rel,
                    name=entry.name,
                    extension=ext,
                    size=stat.st_size,
                    modifiedAt=datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
                    isSymlink=False,
                ))
                result.totalSize += stat.st_size

    walk(root, "", 0)
    return result


def folder_nodes(result: ScanResult) -> list[dict]:
    """Post-process folders with child counts."""
    counts: dict[str, dict[str, int]] = {}
    for folder in result.folders:
        counts[folder["relativePath"]] = {"folders": 0, "files": 0}
    for f in result.files:
        parent = f.relativePath.rsplit("/", 1)[0] if "/" in f.relativePath else ""
        while parent:
            if parent in counts:
                counts[parent]["files"] += 1
            parent = parent.rsplit("/", 1)[0] if "/" in parent else ""
    for folder in result.folders:
        parent = folder["relativePath"].rsplit("/", 1)[0] if "/" in folder["relativePath"] else ""
        if parent in counts:
            counts[parent]["folders"] += 1
    out = []
    for folder in result.folders:
        c = counts[folder["relativePath"]]
        out.append({**folder, "childFolderCount": c["folders"], "childFileCount": c["files"]})
    return out
