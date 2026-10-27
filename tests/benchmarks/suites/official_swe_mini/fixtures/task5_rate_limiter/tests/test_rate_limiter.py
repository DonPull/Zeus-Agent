import time
import pytest
from rate_limiter import TokenBucket

def test_initial_burst():
    bucket = TokenBucket(capacity=5, refill_rate=1.0)
    for _ in range(5):
        assert bucket.consume(1) is True
    assert bucket.consume(1) is False

def test_fractional_refill():
    # Capacity 2, refill rate 10 tokens per second (1 token every 0.1s)
    bucket = TokenBucket(capacity=2, refill_rate=10.0)
    assert bucket.consume(2) is True
    assert bucket.consume(1) is False

    # Sleep 0.12s (should have refilled at least 1 token)
    time.sleep(0.12)
    assert bucket.consume(1) is True
