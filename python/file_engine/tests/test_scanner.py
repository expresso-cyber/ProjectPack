from file_engine.core.pipeline import run_scan


def test_scan_finds_all_files(sample_project):
    result = run_scan(str(sample_project))
    paths = [f["relativePath"] for f in result["files"]]
    assert "session01/s01.py" in paths
    assert "session02/s02.py" in paths
    assert "session01/data.csv" in paths
    assert any(p.endswith("config.json") for p in paths)
    assert result["totalSize"] > 0


def test_scan_marks_binary_unsupported(sample_project):
    result = run_scan(str(sample_project))
    by_path = {f["relativePath"]: f for f in result["files"]}
    assert by_path["photo.bin"]["isBinary"] is True
    assert by_path["photo.bin"]["isSupported"] is False
    assert by_path["session01/s01.py"]["isBinary"] is False
    assert by_path["session01/s01.py"]["isSupported"] is True


def test_scan_folders_have_child_counts(sample_project):
    result = run_scan(str(sample_project))
    folders = {f["relativePath"]: f for f in result["folders"]}
    assert folders["session01"]["childFileCount"] == 2
    assert folders["session02"]["childFileCount"] == 2


def test_scan_limit_stops_early(sample_project):
    result = run_scan(str(sample_project), max_files=2)
    assert len(result["files"]) <= 2
    assert result["warnings"]
