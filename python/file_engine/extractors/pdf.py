"""PDF text extraction using PyMuPDF (per ADR-003)."""
from __future__ import annotations

from pathlib import Path

from .base import ExtractionResult, register


class PdfExtractor:
    name = "pdf"

    def supports(self, path: Path, extension: str) -> bool:
        return extension == ".pdf"

    def extract(self, path: Path) -> ExtractionResult:
        result = ExtractionResult(extractor=self.name)
        try:
            import pymupdf
        except ImportError:
            result.error = "pymupdf is not installed"
            return result
        try:
            with pymupdf.open(path) as doc:
                pages: list[str] = []
                for index, page in enumerate(doc):
                    text = page.get_text()
                    pages.append(f"--- Page {index + 1} ---\n{text}" if text else f"--- Page {index + 1} ---\n(no text)")
                    if doc.needs_pass:
                        break
                result.pageCount = doc.page_count
            result.text = "\n\n".join(pages)
            result.success = True
            result.wordCount = len(result.text.split())
            result.lineCount = result.text.count("\n") + 1
            if not any(seg.strip() for seg in result.text.split("--- Page")[1:]):
                result.warnings.append("PDF contains no extractable text (possibly scanned images)")
        except Exception as exc:  # noqa: BLE001 — per-file failure isolation
            result.error = f"PDF extraction failed: {exc}"
        return result


register(PdfExtractor())
