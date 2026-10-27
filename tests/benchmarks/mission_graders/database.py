"""Trusted fixture creation/inspection; never imported from a submission."""
import json
import sqlite3
import sys

mode, database = sys.argv[1:3]
if mode == 'create':
    with open(sys.argv[3], encoding='utf-8') as source:
        seed = json.load(source)
    with sqlite3.connect(database) as conn:
        conn.execute('CREATE TABLE feedback(id INTEGER PRIMARY KEY,text TEXT NOT NULL,note TEXT NOT NULL)')
        conn.executemany('INSERT INTO feedback VALUES (:id,:text,:note)', seed)
elif mode == 'read':
    with sqlite3.connect('file:' + database.replace('\\', '/') + '?mode=ro', uri=True) as conn:
        columns = [dict(zip(['cid','name','type','notnull','default','pk'], row)) for row in conn.execute('PRAGMA table_info(feedback)')]
        conn.row_factory = sqlite3.Row
        rows = [dict(row) for row in conn.execute('SELECT * FROM feedback ORDER BY id')]
    print(json.dumps({'columns': columns, 'rows': rows}))
elif mode == 'default':
    with sqlite3.connect(database) as conn:
        try:
            conn.execute("INSERT INTO feedback(id,text,note) VALUES(-2147483648,'probe','probe')")
            value = conn.execute('SELECT category FROM feedback WHERE id=-2147483648').fetchone()[0]
            result = {'category': value}
        except sqlite3.DatabaseError as error:
            result = {'error': str(error)}
        finally:
            conn.rollback()
    print(json.dumps(result))
else:
    raise ValueError('unknown database operation')
