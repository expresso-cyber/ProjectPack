"""ProjectPack package creation: copy approved files into a clean package
directory and write a SHA-256 manifest. Never deletes or modifies sources."""
from __future__ import annotations

import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ..core.hashing import sha256_file
from ..security.paths import safe_resolve


def create_package(
    root: Path,
    entries: list[dict[str, Any]],
    destination: Path,
    project_name: str = "projectpack",
) -> dict[str, Any]:
    destination.mkdir(parents=True, exist_ok=True)
    manifest_files: list[dict[str, Any]] = []
    content_dir = destination / "content"
    content_dir.mkdir(exist_ok=True)
    for entry in entries:
        if not entry.get("included", True):
            continue
        rel = entry["path"]
        try:
            src = safe_resolve(root, rel)
        except Exception:
            continue
        target = content_dir / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, target)
        manifest_files.append({
            "path": rel,
            "size": target.stat().st_size,
            "hash": sha256_file(target),
            "type": entry.get("type", "file"),
        })
    manifest = {
        "projectId": entry_project_id(entries),
        "packageId": destination.name,
        "project": project_name,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "algorithm": "sha256",
        "fileCount": len(manifest_files),
        "totalSize": sum(f["size"] for f in manifest_files),
        "files": manifest_files,
    }
    (destination / "manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    return manifest


def entry_project_id(entries: list[dict[str, Any]]) -> str | None:
    for entry in entries:
        if entry.get("projectId"):
            return entry["projectId"]
    return None
