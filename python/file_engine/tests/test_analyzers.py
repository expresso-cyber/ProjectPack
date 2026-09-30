from file_engine.analyzers.duplicates import group_duplicates
from file_engine.analyzers.project import build_report


def _files():
    return [
        {"fileId": "1", "relativePath": "a.py", "hash": "h1", "size": 10,
         "isSupported": True, "extractionStatus": "extracted", "extension": ".py"},
        {"fileId": "2", "relativePath": "b.py", "hash": "h1", "size": 10,
         "isSupported": True, "extractionStatus": "extracted", "extension": ".py"},
        {"fileId": "3", "relativePath": "c.bin", "hash": None, "size": 100,
         "isSupported": False, "extractionStatus": "skipped", "extension": ".bin"},
        {"fileId": "4", "relativePath": "d.js", "hash": "h2", "size": 5,
         "isSupported": True, "extractionStatus": "failed", "extension": ".js"},
    ]


def test_duplicate_groups():
    groups = group_duplicates(_files())
    assert len(groups) == 1
    assert groups[0]["hash"] == "h1"
    assert groups[0]["fileIds"] == ["1", "2"]
    assert groups[0]["wastedBytes"] == 10


def test_report_totals_and_warnings():
    report = build_report(_files(), [{"relativePath": "empty", "depth": 1}])
    assert report["totals"]["files"] == 4
    assert report["totals"]["supported"] == 3
    assert report["totals"]["failed"] == 1
    assert report["duplicates"]["groups"] == 1
    assert any("binary asset" in w for w in report["warnings"])
