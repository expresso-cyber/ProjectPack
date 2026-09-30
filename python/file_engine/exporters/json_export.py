"""JSON export of scan + extraction results."""
from __future__ import annotations

import json
from typing import Any


def render_json(project_name: str, files: list[dict[str, Any]]) -> str:
    payload = {
        "project": project_name,
        "generatedAt": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
        "files": files,
    }
    return json.dumps(payload, indent=2, ensure_ascii=False)
