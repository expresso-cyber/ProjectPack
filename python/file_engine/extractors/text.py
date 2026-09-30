"""Plain-text / code extraction with encoding fallbacks and size limits."""
from __future__ import annotations

from pathlib import Path

from ..core.metadata import TEXT_EXTENSIONS
from .base import ExtractionResult, register

MAX_TEXT_BYTES = 64 * 1024 * 1024
ENCODINGS = ("utf-8", "utf-8-sig", "utf-16", "cp1252", "latin-1")


class TextExtractor:
    name = "text"

    def supports(self, path: Path, extension: str) -> bool:
        return extension in TEXT_EXTENSIONS

    def extract(self, path: Path) -> ExtractionResult:
        result = ExtractionResult(extractor=self.name)
        if path.stat().st_size > MAX_TEXT_BYTES:
            result.error = "File exceeds text size limit"
            result.warnings.append("skipped: too large for text extraction")
            return result
        raw = path.read_bytes()
        text = None
        used = None
        for encoding in ENCODINGS:
            try:
                text = raw.decode(encoding)
                used = encoding
                break
            except (UnicodeDecodeError, LookupError):
                continue
        if text is None:
            result.error = "Unable to decode file with supported encodings"
            return result
        result.success = True
        result.text = text
        result.wordCount = len(text.split())
        result.lineCount = text.count("\n") + (0 if text.endswith("\n") or not text else 1)
        if text.count("\ufffd") > 0 and used in ("cp1252", "latin-1"):
            result.warnings.append(
                "Lossy decoding: replacement characters present; original bytes may not be valid text"
            )
        return result


register(TextExtractor())
