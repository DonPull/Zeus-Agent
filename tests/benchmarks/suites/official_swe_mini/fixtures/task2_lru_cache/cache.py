import time
from collections import OrderedDict

class TTLCache:
    def __init__(self, maxsize=100, ttl_seconds=60):
        self.maxsize = maxsize
        self.ttl = ttl_seconds
        self.store = OrderedDict()

    def set(self, key, value):
        if len(self.store) >= self.maxsize:
            self.store.popitem(last=False)
        self.store[key] = (value, time.time())

    def get(self, key, default=None):
        if key not in self.store:
            return default
        value, created_at = self.store[key]
        # BUG: Does not check TTL expiration on retrieval!
        self.store.move_to_end(key)
        return value

    def size(self):
        return len(self.store)
