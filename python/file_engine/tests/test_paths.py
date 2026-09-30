import pytest

from file_engine.security.paths import UnsafePathError, safe_resolve


def test_safe_resolve_accepts_nested(root_dir):
    assert safe_resolve(root_dir, "a/b/c.txt").name == "c.txt"


def test_safe_resolve_rejects_traversal(root_dir):
    with pytest.raises(UnsafePathError):
        safe_resolve(root_dir, "../outside.txt")


def test_safe_resolve_rejects_encoded_traversal(root_dir):
    with pytest.raises(UnsafePathError):
        safe_resolve(root_dir, "sub/../../escape.txt")


def test_safe_resolve_rejects_null_byte(root_dir):
    with pytest.raises(UnsafePathError):
        safe_resolve(root_dir, "a\x00b")
