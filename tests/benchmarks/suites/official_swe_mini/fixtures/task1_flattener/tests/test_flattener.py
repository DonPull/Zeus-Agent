import pytest
from flattener import flatten_dict

def test_flat_dict():
    data = {"a": 1, "b": 2}
    assert flatten_dict(data) == {"a": 1, "b": 2}

def test_nested_dict():
    data = {"a": {"b": {"c": 3}}}
    assert flatten_dict(data) == {"a.b.c": 3}

def test_nested_list_indexing():
    data = {
        "users": [{"name": "alice"}, {"name": "bob"}],
        "tags": ["admin", "dev"]
    }
    expected = {
        "users.0.name": "alice",
        "users.1.name": "bob",
        "tags.0": "admin",
        "tags.1": "dev"
    }
    assert flatten_dict(data) == expected
