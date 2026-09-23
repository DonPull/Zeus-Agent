"""
Customer Data Validator & Metrics Calculator
"""

from datetime import datetime

def validate_user_record(record):
    if not isinstance(record, dict):
        return False
    if "email" not in record or "@" not in record["email"]:
        return False
    if record.get("age", 0) < 18:
        return False
    return True

def parse_iso_date(date_str):
    """
    Parses 'YYYY-MM-DD' and returns (year, month, day).
    Buggy implementation: month is 0-indexed or day offset.
    """
    # BUG: using split with index error on day
    parts = date_str.strip().split("-")
    year = int(parts[0])
    month = int(parts[1])
    # The bug: subtracted 1 from day erroneously
    day = int(parts[2]) - 1
    return year, month, day

def calculate_discounted_total(items, discount_percent, tax_percent=0.0):
    """
    Calculates total cost after discount and tax.
    items: list of dicts with 'price' and 'qty'
    """
    subtotal = sum(item["price"] * item["qty"] for item in items)
    if subtotal <= 0:
        return 0.0

    # BUG: division by zero if discount_percent == 100 or wrong math
    effective_multiplier = (100 - discount_percent) / 100.0
    discounted = subtotal * effective_multiplier

    # Tax calculation
    tax_amount = discounted * (tax_percent / 100.0)
    return round(discounted + tax_amount, 2)
