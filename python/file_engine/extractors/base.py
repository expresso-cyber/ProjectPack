"""Extractor interface and registry."""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional, Protocol, runtime_checkable

REPLACEMENT_CHAR = "\ufffd"


@dataclass
class ExtractionResult:
    fileId: str = ""
    success: bool = False
    extractor: str = ""
    text: str = ""
    wordCount: int = 0
    lineCount: int = 0
    pageCount: Optional[int] = None
    sheetCount: Optional[int] = None
    slideCount: Optional[int] = None
    warnings: list[str] = field(default_factory=list)
    error: Optional[str] = None
    durationMs: int = 0

    def normalized(self) -> str:
        return re.sub(r"\s+", " ", self.text).strip()


@runtime_checkable
class Extractor(Protocol):
    name: str

    def supports(self, path: Path, extension: str) -> bool: ...

    def extract(self, path: Path) -> ExtractionResult: ...


REGISTRY: list[Extractor] = []


def register(extractor: Extractor) -> Extractor:
    REGISTRY.append(extractor)
    return extractor


_PRIORITY_MODULES = ("pdf", "docx", "xlsx", "pptx", "csv", "image", "font", "archive", "text")


def find_extractor(extension: str) -> Optional[Extractor]:
    """Return the extractor handling this extension, or None.

    Import order defines priority: structured-document extractors are matched
    before the plain-text extractor so e.g. .csv never falls through to raw
    text decoding.
    """
    from . import pdf, docx, xlsx, pptx, csv, image, font, archive, text  # noqa: F401 — triggers registration

    for extractor in REGISTRY:
        if extractor.supports(Path(f"name{extension}"), extension):
            return extractor
    return None
