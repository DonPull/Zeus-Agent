import pytest
import sys
import os

# Add src to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'src')))

from validator import validate_user_record, parse_iso_date, calculate_discounted_total

def test_validate_user_record_valid():
    record = {"email": "alex@example.com", "age": 25}
    assert validate_user_record(record) is True

def test_validate_user_record_invalid():
    record = {"email": "invalid_email", "age": 15}
    assert validate_user_record(record) is False

def test_parse_iso_date_correct():
    # Failing test before fix due to day subtraction bug
    year, month, day = parse_iso_date("2026-05-15")
    assert year == 2026
    assert month == 5
    assert day == 15

def test_calculate_discounted_total_normal():
    items = [{"price": 100.0, "qty": 2}]
    # 200 with 10% discount + 5% tax = 180 + 9 = 189
    total = calculate_discounted_total(items, 10.0, 5.0)
    assert total == 189.0

def test_calculate_discounted_total_full_discount():
    items = [{"price": 50.0, "qty": 1}]
    total = calculate_discounted_total(items, 100.0, 0.0)
    assert total == 0.0
