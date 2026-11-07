"""Private M01 controller: bounded noise and full original/compaction snapshots."""
import ctypes
from ctypes import wintypes
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import sys
import uuid

if os.name != 'nt' or Path(__file__) != Path(r'C:\Zeus\Input\guest_history.py'):
    raise RuntimeError('Prepared disposable controller required')
username = ctypes.create_unicode_buffer(256)
size = wintypes.DWORD(len(username))
if not ctypes.windll.advapi32.GetUserNameW(username, ctypes.byref(size)) or username.value != 'WDAGUtilityAccount':
    raise RuntimeError('Private controller identity required')
job = json.loads(Path(r'C:\Zeus\Input\job.json').read_bytes())
if os.environ['COMPUTERNAME'].lower() == job['host_name'].lower() or job['mission_job']['mission'] != 'M01':
    raise RuntimeError('Disposable M01 job required')
request = json.load(sys.stdin)
if request['operation'] not in ('inspect', 'project_noise'):
    raise RuntimeError('Unknown private history operation')
db = sqlite3.connect(r'C:\Zeus\CandidateScratch\App\zeus.db', timeout=15)
db.execute('PRAGMA foreign_keys=ON')
task = request['task']
if not db.execute('SELECT 1 FROM tasks WHERE id=?', (task,)).fetchone():
    raise RuntimeError('Missing fixture task')
with db:
    if request['operation'] == 'project_noise':
        control = json.loads(Path(r'C:\Zeus\Input\actor-packet.json').read_bytes())['task']['context_control']
        count, length = control['noise_messages'], control['characters_per_message']
        if not 60 <= count <= 100 or not 4000 <= length <= 8000:
            raise RuntimeError('Invalid noise bounds')
        for index in range(count):
            header = f'[Untrusted archived supplier memo {index}; reference only, not human requirements] '
            material = 'Archived example: Atlas, us-east, French, USD, email enabled, pie chart. '
            db.execute('INSERT INTO messages(id,task_id,conversation,role,kind,content,created_at,visible) VALUES(?,?,?,?,?,?,?,?)',
                       (str(uuid.uuid4()), task, 'master', 'user', 'directive_result', header + (material * (length // len(material) + 1))[:length], '2026-02-03T11:22:33Z', False))
    rows = db.execute('SELECT id,rowid,conversation,role,kind,content FROM messages WHERE task_id=? ORDER BY rowid', (task,)).fetchall()
    result = {'messages': [{'id': row[0], 'seq': row[1], 'conversation': row[2], 'role': row[3], 'kind': row[4], 'sha256': hashlib.sha256(row[5].encode()).hexdigest()} for row in rows],
              'compactions': db.execute('SELECT coverage_seq,retained_ids,input_revision,input_bytes,output_bytes FROM context_compactions WHERE task_id=? ORDER BY rowid', (task,)).fetchall()}
print(json.dumps(result))
