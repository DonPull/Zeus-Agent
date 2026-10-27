import pytest
from semver import Version

def test_semver_basic_comparison():
    assert Version("1.0.0") < Version("2.0.0")
    assert Version("1.1.0") < Version("1.2.0")
    assert Version("1.1.1") < Version("1.1.2")

def test_semver_prerelease_precedence():
    # Per SemVer 2.0.0 Spec Section 9:
    # A normal release (e.g. 1.0.0) has higher precedence than a pre-release version (e.g. 1.0.0-alpha).
    assert Version("1.0.0-alpha") < Version("1.0.0")
    assert Version("1.0.0-alpha") < Version("1.0.0-beta")
    assert not (Version("1.0.0") < Version("1.0.0-alpha"))
