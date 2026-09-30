"""Image metadata extraction (dimensions, format, EXIF where available)."""
from __future__ import annotations

from pathlib import Path

from .base import ExtractionResult, register

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tiff", ".ico"}


class ImageExtractor:
    name = "image"

    def supports(self, path: Path, extension: str) -> bool:
        return extension in IMAGE_EXTENSIONS

    def extract(self, path: Path) -> ExtractionResult:
        result = ExtractionResult(extractor=self.name)
        try:
            from PIL import Image
        except ImportError:
            result.error = "pillow is not installed"
            return result
        try:
            with Image.open(path) as img:
                lines = [
                    f"Image: {img.format}",
                    f"Dimensions: {img.width} x {img.height} pixels",
                    f"Mode: {img.mode}",
                    f"File size: {path.stat().st_size} bytes",
                ]
                exif = img.getexif()
                if exif:
                    # Only a few well-known, non-identifying tags.
                    wanted = {271: "Camera make", 272: "Camera model", 306: "Date"}
                    for tag_id, label in wanted.items():
                        value = exif.get(tag_id)
                        if value:
                            lines.append(f"{label}: {value}")
                result.text = "\\n".join(lines)
                result.success = True
                result.wordCount = len(result.text.split())
                result.lineCount = len(lines)
        except Exception as exc:  # noqa: BLE001
            result.error = f"Image metadata extraction failed: {exc}"
        return result


register(ImageExtractor())
