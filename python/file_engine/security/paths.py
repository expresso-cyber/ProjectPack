"""Path safety: canonicalize and enforce that every operated path stays inside
the approved source root. Blocks traversal, symlink escapes, and null bytes."""
from __future__ import annotations

import os
from pathlib import Path


class UnsafePathError(ValueError):
    """Raised when a path attempts to escape the source root."""


def canonical_root(root: str | os.PathLike[str]) -> Path:
    try:
        p = Path(root).expanduser().resolve(strict=True)
    except OSError as exc:
        raise UnsafePathError(f"Source root is not accessible: {root}") from exc
    if not p.is_dir():
        raise UnsafePathError(f"Source root is not a directory: {root}")
    return p


def safe_resolve(root: Path, relative: str) -> Path:
    """Resolve `relative` inside `root`, rejecting traversal and escapes."""
    if not relative or "\x00" in relative:
        raise UnsafePathError("Invalid relative path")
    candidate = (root / relative).resolve()
    root_resolved = root.resolve()
    if candidate != root_resolved and root_resolved not in candidate.parents:
        raise UnsafePathError(f"Path escapes source root: {relative!r}")
    return candidate


def is_symlink(path: Path) -> bool:
    return path.is_symlink()


def within_root(root: Path, path: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False
