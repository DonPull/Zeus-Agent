import time
import pytest
from cache import TTLCache

def test_cache_basic_get_set():
    c = TTLCache(maxsize=3, ttl_seconds=10)
    c.set("x", 100)
    assert c.get("x") == 100

def test_cache_lru_eviction():
    c = TTLCache(maxsize=2, ttl_seconds=10)
    c.set("a", 1)
    c.set("b", 2)
    c.set("c", 3)
    assert c.get("a") is None
    assert c.get("b") == 2
    assert c.get("c") == 3

def test_cache_ttl_expiration():
    c = TTLCache(maxsize=5, ttl_seconds=0.1)
    c.set("temp", "hello")
    assert c.get("temp") == "hello"
    time.sleep(0.15)
    assert c.get("temp") is None
