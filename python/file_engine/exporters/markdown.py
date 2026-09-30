"""Combined Markdown export with a table of contents."""
from __future__ import annotations


def render_markdown(project_name: str, entries: list[dict[str, str | None]]) -> str:
    lines = [f"# ProjectPack export — {project_name}", ""]
    for entry in entries:
        anchor = entry["relativePath"].lower().replace("/", "-").replace(".", "")
        lines.append(f"- [{entry['relativePath']}](#{anchor})")
    lines.append("")
    for entry in entries:
        anchor = entry["relativePath"].lower().replace("/", "-").replace(".", "")
        lines.append(f"## {entry['relativePath']} {{#{anchor}}}")
        lines.append("")
        text = entry.get("text") or "(no extractable content)"
        lines.append("```")
        lines.append(text)
        lines.append("```")
        lines.append("")
    return "\n".join(lines)
