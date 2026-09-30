"""Project-level analysis report."""
from __future__ import annotations

from collections import Counter
from typing import Any

from .duplicates import group_duplicates
from .structure import analyze_structure


def build_report(files: list[dict[str, Any]], folders: list[dict[str, Any]]) -> dict[str, Any]:
    supported = [f for f in files if f.get("isSupported")]
    unsupported = [f for f in files if not f.get("isSupported")]
    extracted = [f for f in files if f.get("extractionStatus") == "extracted"]
    failed = [f for f in files if f.get("extractionStatus") == "failed"]
    largest = sorted(files, key=lambda f: -f.get("size", 0))[:10]
    dup_groups = group_duplicates(files)
    structure = analyze_structure(files, folders)

    ext_counter: Counter[str] = Counter()
    ext_size: Counter[str] = Counter()
    for f in files:
        ext_counter[f.get("extension") or "(none)"] += 1
        ext_size[f.get("extension") or "(none)"] += f.get("size", 0)

    warnings: list[str] = []
    if unsupported:
        warnings.append(
            f"{len(unsupported)} binary asset file(s) (fonts/media/etc.) were indexed and are "
            "included in packages, but have no extractable text"
        )
    if failed:
        warnings.append(f"{len(failed)} file(s) failed extraction")
    if structure["emptyFolders"]:
        warnings.append(f"{len(structure['emptyFolders'])} empty folder(s) found")
    if structure["deepFolders"]:
        warnings.append(f"{len(structure['deepFolders'])} folder(s) nested unusually deep (>= {8} levels)")

    return {
        "totals": {
            "files": len(files),
            "folders": structure["folderCount"],
            "totalSize": sum(f.get("size", 0) for f in files),
            "supported": len(supported),
            "unsupported": len(unsupported),
            "extracted": len(extracted),
            "failed": len(failed),
        },
        "largestFiles": [
            {"relativePath": f["relativePath"], "size": f.get("size", 0)} for f in largest
        ],
        "duplicates": {
            "groups": len(dup_groups),
            "wastedBytes": sum(g["wastedBytes"] for g in dup_groups),
        },
        "emptyFolders": structure["emptyFolders"],
        "deepestDepth": structure["deepestDepth"],
        "extensionBreakdown": [
            {"extension": ext, "count": count, "size": ext_size[ext]}
            for ext, count in ext_counter.most_common(20)
        ],
        "warnings": warnings,
    }
