import sys
from pathlib import Path

import pytest

ENGINE_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ENGINE_ROOT))

@pytest.fixture()
def sample_project(tmp_path: Path) -> Path:
    """Copy the fixture tree into tmp so tests can mutate safely."""
    import shutil
    src = Path(__file__).parent / "fixtures" / "sample_project"
    dest = tmp_path / "sample_project"
    shutil.copytree(src, dest)
    return dest

@pytest.fixture()
def root_dir(tmp_path):
    (tmp_path / "a" / "b").mkdir(parents=True)
    (tmp_path / "a" / "b" / "c.txt").write_text("x")
    (tmp_path / "sub").mkdir()
    return tmp_path
