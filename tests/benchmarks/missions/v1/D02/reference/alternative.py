import argparse
import json
import sqlite3

parser = argparse.ArgumentParser()
parser.add_argument('--db', required=True)
parser.add_argument('--input', required=True)
args = parser.parse_args()
with open(args.input, encoding='utf-8') as source:
    rows = json.load(source)
with sqlite3.connect(args.db) as connection:
    if 'category' not in [column[1] for column in connection.execute('PRAGMA table_info(feedback)')]:
        connection.execute("ALTER TABLE feedback ADD COLUMN category TEXT NOT NULL DEFAULT 'General'")
    for row in rows:
        if connection.execute('SELECT 1 FROM feedback WHERE id=?', (row['id'],)).fetchone() is None:
            connection.execute('INSERT INTO feedback(id,text,note) VALUES (?,?,?)', (row['id'],row['text'],row['note']))
    connection.execute("""UPDATE feedback SET category = CASE
        WHEN instr(lower(text),'error')>0 OR instr(lower(text),'crash')>0 OR instr(lower(text),'offline')>0 THEN 'Technical'
        WHEN instr(lower(text),'invoice')>0 OR instr(lower(text),'refund')>0 OR instr(lower(text),'charge')>0 THEN 'Billing'
        ELSE 'General' END""")
