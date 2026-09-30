"""CSV/TSV extraction via the standard library."""
from __future__ import annotations

import csv as csv_module
from pathlib import Path

from .base import ExtractionResult, register

MAX_CSV_ROWS = 50000


class CsvExtractor:
    name = "csv"

    def supports(self, path: Path, extension: str) -> bool:
        return extension in {".csv", ".tsv"}

    def extract(self, path: Path) -> ExtractionResult:
        result = ExtractionResult(extractor=self.name)
        delimiter = "\t" if path.suffix.lower() == ".tsv" else ","
        try:
            with path.open("r", encoding="utf-8", newline="") as fh:
                sample = fh.read(4096)
                fh.seek(0)
                if "\x00" in sample:
                    result.error = "Binary data in CSV"
                    return result
                dialect = csv_module.Sniffer().sniff(sample, delimiters=",;\t|") if sample else None
                reader = csv_module.reader(fh, dialect=dialect or csv_module.excel)
                rows: list[str] = []
                for row in reader:
                    rows.append(" | ".join(row))
                    if len(rows) >= MAX_CSV_ROWS:
                        result.warnings.append(f"Truncated at {MAX_CSV_ROWS} rows")
                        break
            result.text = "\n".join(rows)
            result.success = True
            result.wordCount = len(result.text.split())
            result.lineCount = len(rows)
        except UnicodeDecodeError:
            result.error = "CSV is not valid UTF-8"
        except Exception as exc:  # noqa: BLE001
            result.error = f"CSV extraction failed: {exc}"
        return result


register(CsvExtractor())
