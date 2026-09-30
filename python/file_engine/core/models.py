"""Dataclass models shared across the engine."""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Any, Optional


@dataclass
class FileEntry:
    """One discovered file inside a source root."""
    relativePath: str
    name: str
    extension: str
    size: int
    modifiedAt: str
    isSymlink: bool = False
    # Filled by hashing stage
    hash: Optional[str] = None
    isBinary: Optional[bool] = None
    isSupported: Optional[bool] = None
    # Filled by extraction stage
    extractionStatus: str = "pending"
    extractionError: Optional[str] = None
    pageCount: Optional[int] = None
    sheetCount: Optional[int] = None
    slideCount: Optional[int] = None
    warnings: list[str] = field(default_factory=list)
    contentPreview: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        return {k: v for k, v in asdict(self).items() if v is not None or k in
                ("hash", "isBinary", "isSupported", "extractionStatus")}


@dataclass
class ScanResult:
    root: str
    files: list[FileEntry] = field(default_factory=list)
    folders: list[dict[str, Any]] = field(default_factory=list)
    skipped: list[dict[str, str]] = field(default_factory=list)
    scannedAt: str = ""
    totalSize: int = 0
    warnings: list[str] = field(default_factory=list)
