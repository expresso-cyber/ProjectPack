import json
import subprocess
import sys
from pathlib import Path

ENGINE_ROOT = Path(__file__).resolve().parents[2]


def run_worker(*cli_args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, "-m", "file_engine.worker", *cli_args],
        cwd=ENGINE_ROOT,
        capture_output=True,
        text=True,
    )


def test_cli_scan(sample_project, tmp_path):
    out = tmp_path / "scan.json"
    proc = run_worker("scan", "--source", str(sample_project), "--out", str(out))
    assert proc.returncode == 0, proc.stderr
    payload = json.loads(out.read_text())
    assert payload["files"]
    assert payload["folders"]


def test_cli_extract_round_trip(sample_project, tmp_path):
    files_json = tmp_path / "files.json"
    out = tmp_path / "extract.json"
    files_json.write_text(json.dumps([
        {"relativePath": "session01/s01.py", "extension": ".py"},
        {"relativePath": "photo.bin", "extension": ".bin"},
    ]))
    proc = run_worker("extract", "--source", str(sample_project),
                      "--files", str(files_json), "--out", str(out))
    assert proc.returncode == 0, proc.stderr
    results = json.loads(out.read_text())
    assert results[0]["success"] is True
    assert results[1]["success"] is False


def test_cli_rejects_missing_source(tmp_path):
    proc = run_worker("scan", "--source", str(tmp_path / "nope"), "--out", str(tmp_path / "o.json"))
    assert proc.returncode == 3
    assert "UNSAFE_PATH" in proc.stdout
