"""DOCX extraction via python-docx, preserving paragraph and table order."""
from __future__ import annotations

from pathlib import Path

from .base import ExtractionResult, register


class DocxExtractor:
    name = "docx"

    def supports(self, path: Path, extension: str) -> bool:
        return extension == ".docx"

    def extract(self, path: Path) -> ExtractionResult:
        result = ExtractionResult(extractor=self.name)
        try:
            import docx  # python-docx
        except ImportError:
            result.error = "python-docx is not installed"
            return result
        try:
            document = docx.Document(str(path))
            parts: list[str] = []
            for para in document.paragraphs:
                parts.append(para.text)
            for table in document.tables:
                for row in table.rows:
                    cells = [cell.text.strip() for cell in row.cells]
                    parts.append(" | ".join(cells))
            result.text = "\n".join(parts)
            result.success = True
            result.wordCount = len(result.text.split())
            result.lineCount = len(parts)
        except Exception as exc:  # noqa: BLE001
            result.error = f"DOCX extraction failed: {exc}"
        return result


register(DocxExtractor())
