import argparse
import json
import sqlite3

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--db', required=True)
    parser.add_argument('--input', required=True)
    args = parser.parse_args()
    with open(args.input, encoding='utf-8') as handle:
        incoming = json.load(handle)
    with sqlite3.connect(args.db) as conn:
        columns = [row[1] for row in conn.execute('PRAGMA table_info(feedback)')]
        if 'category' not in columns:
            conn.execute("ALTER TABLE feedback ADD COLUMN category TEXT NOT NULL DEFAULT 'General'")
        conn.executemany('INSERT OR IGNORE INTO feedback(id,text,note) VALUES (:id,:text,:note)', incoming)
        for row_id, text in conn.execute('SELECT id,text FROM feedback').fetchall():
            text = text.lower()
            category = 'Technical' if any(word in text for word in ['error','crash','offline']) else 'Billing' if any(word in text for word in ['invoice','refund','charge']) else 'General'
            conn.execute('UPDATE feedback SET category=? WHERE id=?', (category, row_id))

if __name__ == '__main__':
    main()
