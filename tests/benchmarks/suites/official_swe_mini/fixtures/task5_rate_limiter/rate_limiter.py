import time

class TokenBucket:
    def __init__(self, capacity, refill_rate):
        self.capacity = capacity
        self.refill_rate = refill_rate  # tokens per second
        self.tokens = capacity
        self.last_refill = time.time()

    def consume(self, amount=1):
        now = time.time()
        elapsed = now - self.last_refill
        # BUG: Int division causes loss of fraction on rapid calls:
        refilled = int(elapsed * self.refill_rate)
        if refilled > 0:
            self.tokens = min(self.capacity, self.tokens + refilled)
            self.last_refill = now

        if self.tokens >= amount:
            self.tokens -= amount
            return True
        return False
