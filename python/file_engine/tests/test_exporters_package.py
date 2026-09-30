import json

from file_engine.core.hashing import sha256_file
from file_engine.exporters.package import create_package


def test_package_copies_only_included(sample_project):
    entries = [
        {"path": "session01/s01.py", "included": True, "type": ".py", "projectId": "p1"},
        {"path": "photo.bin", "included": False, "reason": "binary unsupported"},
    ]
    dest = sample_project.parent / "package-out"
    manifest = create_package(sample_project, entries, dest)
    assert (dest / "content" / "session01" / "s01.py").exists()
    assert not (dest / "content" / "photo.bin").exists()
    assert manifest["algorithm"] == "sha256"
    assert manifest["fileCount"] == 1
    stored = manifest["files"][0]
    assert stored["hash"] == sha256_file(sample_project / "session01" / "s01.py")


def test_manifest_round_trip(sample_project):
    entries = [{"path": "README.md", "included": True, "type": ".md"}]
    dest = sample_project.parent / "pkg2"
    manifest = create_package(sample_project, entries, dest)
    on_disk = json.loads((dest / "manifest.json").read_text())
    assert on_disk == manifest
