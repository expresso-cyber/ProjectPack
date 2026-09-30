"""ZIP archive summary extraction (names only — never unpacks)."""
from __future__ import annotations

import zipfile
from pathlib import Path

from .base import ExtractionResult, register

ARCHIVE_EXTENSIONS = {".zip"}
MAX_ENTRIES = 5000


class ArchiveExtractor:
    name = "archive"

    def supports(self, path: Path, extension: str) -> bool:
        return extension in ARCHIVE_EXTENSIONS

    def extract(self, path: Path) -> ExtractionResult:
        result = ExtractionResult(extractor=self.name)
        try:
            with zipfile.ZipFile(path) as zf:
                names = zf.namelist()[:MAX_ENTRIES]
                result.text = "Archive contents ({} shown of {} entries):\\n".format(
                    len(names), len(zf.namelist())
                ) + "\\n".join(names)
                result.success = True
                result.wordCount = len(names)
                result.lineCount = len(names)
        except Exception as exc:  # noqa: BLE001
            result.error = f"Archive extraction failed: {exc}"
        return result


register(ArchiveExtractor())
