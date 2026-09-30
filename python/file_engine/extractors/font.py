"""Font metadata extraction (family, subfamily, weight) for web fonts.

Handles .ttf, .otf, .woff and .woff2 via fontTools (brotli enables woff2),
and .eot with a small header parser (fontTools has no EOT support, but the
EOT header carries the family name as UTF-16LE).
"""
from __future__ import annotations

import struct
from pathlib import Path

from .base import ExtractionResult, register

FONT_EXTENSIONS = {".ttf", ".otf", ".woff", ".woff2", ".eot"}


def _parse_eot(path: Path) -> str:
    """Best-effort family name from a legacy EOT header."""
    data = path.read_bytes()
    # EOT header: ... Padding1(4) FamilyNameSize(4) FamilyNameOffset(4) at 82/86
    if len(data) < 94:
        raise ValueError("not a valid EOT file")
    family_size, family_offset = struct.unpack_from("<II", data, 82)
    lines = [f"Font: Embedded OpenType (legacy)", f"File size: {len(data)} bytes"]
    if 0 < family_size <= 512 and family_offset + family_size <= len(data):
        try:
            family = data[family_offset : family_offset + family_size].decode("utf-16-le")
            family = family.strip("\x00 ").strip()
            if family:
                lines.insert(1, f"Family: {family}")
        except UnicodeDecodeError:
            pass
    return "\n".join(lines)


class FontExtractor:
    name = "font"

    def supports(self, path: Path, extension: str) -> bool:
        return extension in FONT_EXTENSIONS

    def extract(self, path: Path) -> ExtractionResult:
        result = ExtractionResult(extractor=self.name)
        if path.suffix.lower() == ".eot":
            try:
                result.text = _parse_eot(path)
                result.success = True
                result.wordCount = len(result.text.split())
                result.lineCount = len(result.text.splitlines())
            except Exception as exc:  # noqa: BLE001
                result.error = f"Font metadata extraction failed: {exc}"
            return result

        try:
            from fontTools.ttLib import TTFont
        except ImportError:
            result.error = "fonttools is not installed"
            return result
        try:
            font = TTFont(str(path), fontNumber=0, lazy=True)
            name_table = font["name"]
            family = name_table.getDebugName(1)
            subfamily = name_table.getDebugName(2)
            full_name = name_table.getDebugName(4)
            preferred = name_table.getDebugName(16) or family

            flavor = {"woff": "WOFF", "woff2": "WOFF2"}.get(getattr(font, "flavor", None), "OpenType")
            lines = [f"Font: {flavor}"]
            if preferred:
                lines.append(f"Family: {preferred}")
            if subfamily:
                lines.append(f"Style: {subfamily}")
            if full_name and full_name != f"{family} {subfamily}":
                lines.append(f"Full name: {full_name}")
            if "OS/2" in font:
                weight = font["OS/2"].usWeightClass
                lines.append(f"Weight: {weight}")
            lines.append(f"File size: {path.stat().st_size} bytes")

            result.text = "\n".join(lines)
            result.success = True
            result.wordCount = len(result.text.split())
            result.lineCount = len(lines)
        except Exception as exc:  # noqa: BLE001
            result.error = f"Font metadata extraction failed: {exc}"
        return result


register(FontExtractor())
