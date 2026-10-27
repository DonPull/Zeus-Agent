class SQLBuilder:
    def __init__(self, table_name):
        self.table = table_name

    def select(self, columns, where=None):
        # BUG: Fails to quote identifiers when column names match SQL keywords or have spaces
        cols_str = ", ".join(columns) if columns else "*"
        query = f"SELECT {cols_str} FROM {self.table}"
        if where:
            clauses = [f"{k} = {repr(v)}" for k, v in where.items()]
            query += f" WHERE {' AND '.join(clauses)}"
        return query + ";"
