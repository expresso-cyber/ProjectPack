"""Combined plain-text export with file boundaries."""
from __future__ import annotations


def render_txt(entries: list[dict[str, str | None]]) -> str:
    parts = []
    for entry in entries:
        parts.append("=" * 78)
        parts.append(f"FILE: {entry['relativePath']}")
        parts.append("=" * 78)
        parts.append(entry.get("text") or "(no extractable content)")
        parts.append("")
    return "\n".join(parts)
