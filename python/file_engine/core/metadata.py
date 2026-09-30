"""Extension registry, binary sniffing, and mime/type classification."""
from __future__ import annotations

from pathlib import Path

# Text/code family supported by the plain-text extractor.
TEXT_EXTENSIONS = {
    ".py", ".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".html", ".htm",
    ".css", ".scss", ".sass", ".less", ".json", ".xml", ".yaml", ".yml",
    ".toml", ".ini", ".cfg", ".conf", ".env", ".sql", ".java", ".c", ".h",
    ".cpp", ".hpp", ".cc", ".cs", ".php", ".rb", ".go", ".rs", ".swift",
    ".kt", ".sh", ".bash", ".zsh", ".bat", ".cmd", ".ps1", ".md", ".markdown",
    ".rst", ".txt", ".log", ".svg", ".vue", ".svelte",
    ".properties", ".gitignore", ".editorconfig", ".dockerfile", ".tf",
}

# Structured-document extractors.
STRUCTURED_EXTENSIONS = {".pdf", ".docx", ".xlsx", ".pptx"}


MIME_BY_EXTENSION = {
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".eot": "application/vnd.ms-fontobject",
    ".zip": "application/zip",
}

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tiff", ".ico"}
# Web fonts handled by the font metadata extractor.
FONT_EXTENSIONS = {".ttf", ".otf", ".woff", ".woff2", ".eot"}
ARCHIVE_EXTENSIONS = {".zip"}

SUPPORTED_EXTENSIONS = (
    TEXT_EXTENSIONS
    | STRUCTURED_EXTENSIONS
    | {".csv", ".tsv"}
    | IMAGE_EXTENSIONS
    | FONT_EXTENSIONS
    | ARCHIVE_EXTENSIONS
)

BINARY_SNIFF_BYTES = 8192


def extension_of(path: Path) -> str:
    name = path.name.lower()
    if name in {".gitignore", ".dockerignore", ".env", ".editorconfig"}:
        return name
    if name == "dockerfile":
        return ".dockerfile"
    return path.suffix.lower()


def mime_for(extension: str) -> str:
    return MIME_BY_EXTENSION.get(extension, "application/octet-stream")


def looks_binary(path: Path, extension: str) -> bool:
    """A file is treated as binary when it contains NUL bytes near the start.
    Known structured formats are binary by definition."""
    if extension in STRUCTURED_EXTENSIONS or extension in MIME_BY_EXTENSION and extension not in {".svg"}:
        return True
    try:
        with path.open("rb") as fh:
            head = fh.read(BINARY_SNIFF_BYTES)
    except OSError:
        return True
    return b"\x00" in head


def is_supported(extension: str) -> bool:
    return extension in SUPPORTED_EXTENSIONS


def extractor_name_for(extension: str) -> str | None:
    if extension in {".pdf"}:
        return "pdf"
    if extension in IMAGE_EXTENSIONS:
        return "image"
    if extension in FONT_EXTENSIONS:
        return "font"
    if extension in ARCHIVE_EXTENSIONS:
        return "archive"
    if extension == ".docx":
        return "docx"
    if extension == ".xlsx":
        return "xlsx"
    if extension == ".pptx":
        return "pptx"
    if extension in {".csv", ".tsv"}:
        return "csv"
    if extension in TEXT_EXTENSIONS:
        return "text"
    return None
