"""Pipeline orchestration: scan -> metadata -> hash -> extract -> normalize.

Each stage is independently callable so the API can run scan-only first and
extraction later (per-job progress reporting).
"""
from __future__ import annotations

import time
from pathlib import Path
from typing import Any, Callable

from ..security.paths import UnsafePathError, canonical_root
from .hashing import sha256_file
from .metadata import TEXT_EXTENSIONS, extractor_name_for, is_supported, looks_binary
from .models import FileEntry
from .scanner import ScanLimits, folder_nodes, scan


def run_scan(
    source_root: str,
    max_files: int = 20000,
    excluded_dirs: set[str] | None = None,
) -> dict[str, Any]:
    """Stage 1-3: discover, metadata, hash. Returns serializable scan result."""
    root = canonical_root(source_root)
    result = scan(root, ScanLimits(max_files=max_files), excluded_dirs=excluded_dirs)
    files: list[dict[str, Any]] = []
    for f in result.files:
        try:
            src = root / f.relativePath
            f.isBinary = looks_binary(src, f.extension)
        except OSError:
            f.isBinary = True
        # Text-family files must actually decode as text; structured formats
        # (pdf/docx/xlsx/pptx/csv/zip/images) are supported by definition.
        f.isSupported = (
            is_supported(f.extension) if f.extension in TEXT_EXTENSIONS and not f.isBinary
            else (is_supported(f.extension) if f.extension not in TEXT_EXTENSIONS else False)
        )
        files.append(f.to_dict())
    return {
        "root": str(root),
        "scannedAt": result.scannedAt,
        "totalSize": result.totalSize,
        "warnings": result.warnings,
        "skipped": result.skipped,
        "files": files,
        "folders": folder_nodes(result),
    }


def run_hash(source_root: str, relative_paths: list[str]) -> list[dict[str, Any]]:
    """Hash a set of files (stage 4). Returns [{relativePath, hash, error?}]."""
    root = canonical_root(source_root)
    out = []
    for rel in relative_paths:
        try:
            src = root / rel
            out.append({"relativePath": rel, "hash": sha256_file(src)})
        except (OSError, UnsafePathError) as exc:
            out.append({"relativePath": rel, "error": str(exc)})
    return out


def extract_one(source_root: str, relative_path: str, extension: str) -> dict[str, Any]:
    """Extract a single file. Always returns a dict; never raises for content errors."""
    from ..extractors.base import ExtractionResult, find_extractor

    started = time.monotonic()
    root = canonical_root(source_root)
    try:
        src = (root / relative_path).resolve()
    except OSError as exc:
        return {"success": False, "error": str(exc), "durationMs": 0}
    extractor = find_extractor(extension)
    if extractor is None:
        return {
            "success": False,
            "extractor": None,
            "error": "unsupported file type",
            "durationMs": 0,
        }
    result: ExtractionResult = extractor.extract(src)
    result.fileId = relative_path
    result.durationMs = int((time.monotonic() - started) * 1000)
    out = result.__dict__.copy()
    out["normalizedText"] = result.normalized()
    return out


def extract_batch(
    source_root: str,
    files: list[dict[str, Any]],
    on_progress: Callable[[int, int], None] | None = None,
) -> list[dict[str, Any]]:
    """Extract many files with per-file failure isolation and progress callback."""
    results = []
    total = len(files)
    for i, f in enumerate(files):
        results.append(extract_one(source_root, f["relativePath"], f.get("extension", "")))
        if on_progress is not None:
            on_progress(i + 1, total)
    return results
