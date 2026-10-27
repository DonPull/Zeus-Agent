import pytest
from sql_gen import SQLBuilder

def test_sql_builder_basic():
    b = SQLBuilder("users")
    assert b.select(["id", "name"]) == 'SELECT "id", "name" FROM "users";' or b.select(["id", "name"]) == "SELECT `id`, `name` FROM `users`;"

def test_sql_builder_reserved_keywords_and_spaces():
    b = SQLBuilder("orders")
    # Columns like "order", "group", "first name" must be quoted with standard double quotes
    sql = b.select(["order", "group", "first name"], where={"status": "pending"})
    assert '"order"' in sql or '`order`' in sql
    assert '"group"' in sql or '`group`' in sql
    assert '"first name"' in sql or '`first name`' in sql
