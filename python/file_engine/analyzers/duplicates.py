"""Exact duplicate detection by SHA-256 content hash."""
from __future__ import annotations

from collections import defaultdict
from typing import Any


def group_duplicates(files: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Group files sharing the same non-null hash. Only groups of 2+ returned."""
    by_hash: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for f in files:
        h = f.get("hash")
        if h:
            by_hash[h].append(f)
    groups = []
    for h, members in by_hash.items():
        if len(members) < 2:
            continue
        groups.append({
            "hash": h,
            "fileIds": [m["fileId"] for m in members],
            "paths": [m["relativePath"] for m in members],
            "totalBytes": sum(m.get("size", 0) for m in members),
            "wastedBytes": sum(m.get("size", 0) for m in members[:-1]),
        })
    groups.sort(key=lambda g: -g["totalBytes"])
    return groups
