import json
import subprocess
import sys
from pathlib import Path

from file_engine.core.pipeline import extract_one, run_scan

ENGINE_ROOT = Path(__file__).resolve().parents[2]


def test_image_metadata_extraction(sample_project):
    from PIL import Image
    img_path = sample_project / "photo.png"
    Image.new("RGB", (320, 200), (10, 20, 30)).save(img_path)
    res = extract_one(str(sample_project), "photo.png", ".png")
    assert res["success"] is True
    assert res["extractor"] == "image"
    assert "320 x 200" in res["text"]
    assert "PNG" in res["text"]


def test_zip_files_are_supported_and_summarized(sample_project, tmp_path):
    import zipfile
    zip_path = sample_project / "bundle.zip"
    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.writestr("a.txt", "hello")
        zf.writestr("sub/b.txt", "world")
    res = extract_one(str(sample_project), "bundle.zip", ".zip")
    assert res["success"] is True
    assert res["extractor"] == "archive"
    assert "a.txt" in res["text"] and "sub/b.txt" in res["text"]

    # scan marks the zip supported
    scan = run_scan(str(sample_project))
    by_path = {f["relativePath"]: f for f in scan["files"]}
    assert by_path["bundle.zip"]["isSupported"] is True


def test_inspect_archive_cli(sample_project, tmp_path):
    import zipfile
    zip_path = sample_project / "data.zip"
    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.writestr("one.txt", "x" * 100)
        zf.writestr("two.txt", "y" * 50)
    out = tmp_path / "inspect.json"
    proc = subprocess.run(
        [sys.executable, "-m", "file_engine.worker", "inspect-archive",
         "--archive", str(zip_path), "--out", str(out)],
        cwd=ENGINE_ROOT, capture_output=True, text=True,
    )
    assert proc.returncode == 0, proc.stderr
    payload = json.loads(out.read_text())
    assert payload["ok"] is True
    names = [e["name"] for e in payload["entries"]]
    assert "one.txt" in names and "two.txt" in names
    assert payload["totalUncompressedSize"] == 150


def test_inspect_archive_rejects_non_zip(sample_project, tmp_path):
    out = tmp_path / "inspect2.json"
    proc = subprocess.run(
        [sys.executable, "-m", "file_engine.worker", "inspect-archive",
         "--archive", str(sample_project / "photo.bin"), "--out", str(out)],
        cwd=ENGINE_ROOT, capture_output=True, text=True,
    )
    assert proc.returncode == 0  # command succeeds, but reports not-a-zip
    payload = json.loads(out.read_text())
    assert payload["ok"] is False


def test_scan_exclude_dirs(sample_project):
    (sample_project / "node_modules").mkdir()
    (sample_project / "node_modules" / "junk.js").write_text("x")
    (sample_project / "custom").mkdir()
    (sample_project / "custom" / "secret.py").write_text("y")

    default_scan = run_scan(str(sample_project))
    paths = {f["relativePath"] for f in default_scan["files"]}
    assert "node_modules/junk.js" not in paths  # excluded by default

    custom_scan = run_scan(str(sample_project), excluded_dirs={"custom"})
    custom_paths = {f["relativePath"] for f in custom_scan["files"]}
    assert "custom/secret.py" not in custom_paths
    assert "session01/s01.py" in custom_paths


def test_font_metadata_extraction(tmp_path):
    """Fonts are supported files: family/style metadata is extracted."""
    from fontTools.fontBuilder import FontBuilder
    from fontTools.pens.ttGlyphPen import TTGlyphPen

    fb = FontBuilder(1000, isTTF=True)
    glyph_names = ["space", "A", "a"]
    fb.setupGlyphOrder(glyph_names)
    fb.setupCharacterMap({32: "space", 65: "A", 97: "a"})
    pen = TTGlyphPen(None)
    pen.moveTo((0, 0))
    pen.lineTo((0, 700))
    pen.lineTo((500, 700))
    pen.closePath()
    fb.setupGlyf({name: pen.glyph() for name in glyph_names})
    fb.setupHorizontalMetrics({name: (600, 0) for name in glyph_names})
    fb.setupHorizontalHeader(ascent=800, descent=-200)
    fb.setupNameTable({"familyName": "TestSans", "styleName": "Bold"})
    fb.setupOS2()
    fb.setupPost()
    fb.setupMaxp()
    font_path = tmp_path / "TestSans-Bold.ttf"
    fb.save(str(font_path))

    from file_engine.extractors.font import FontExtractor

    result = FontExtractor().extract(font_path)
    assert result.success is True
    assert "TestSans" in result.text
    assert "Bold" in result.text
