"""Read-only, task-scoped timing analysis. Never opens settings or credentials.

Raw task text stays in the explicitly chosen local output directory. Provider
credits are not inferred from token counts. Model durations are estimates until
the ledger has completion timestamps; they are not summed into wall-clock time.
"""
import argparse
from collections import Counter, defaultdict
from datetime import datetime
import json
import os
from pathlib import Path
import re
import sqlite3


def seconds(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()


def analyze(database, task_id, output):
    connection = sqlite3.connect(database.resolve().as_uri() + '?mode=ro', uri=True)
    connection.row_factory = sqlite3.Row
    connection.execute('PRAGMA query_only=ON')
    row=connection.execute('SELECT * FROM runs WHERE task_id=? ORDER BY started_at DESC LIMIT 1', (task_id,)).fetchone()
    if row is None:
        raise SystemExit('No persisted run exists for that task')
    run = dict(row)
    messages = [dict(row) for row in connection.execute('SELECT rowid AS seq,* FROM messages WHERE task_id=? ORDER BY rowid', (task_id,))]
    requests = [dict(row) for row in connection.execute('SELECT * FROM credit_events WHERE run_id=? ORDER BY created_at', (run['id'],))]
    actions = [dict(row) for row in connection.execute('SELECT a.* FROM managed_browser_actions a JOIN managed_browser_sessions s ON s.id=a.session_id WHERE s.run_id=? ORDER BY a.created_at', (run['id'],))]
    connection.close()
    start = seconds(run['started_at'])
    end = seconds(run.get('completed_at') or run['updated_at'])
    messages = [message for message in messages if start <= seconds(message['created_at']) <= end]
    groups = defaultdict(lambda: Counter())
    for request in requests:
        group = groups[(request['role'], request['model'])]
        group['requests'] += 1
        for field in ('input_tokens', 'output_tokens', 'cached_tokens', 'reasoning_tokens'):
            group[field] += request.get(field) or 0
    operation_groups = defaultdict(lambda: Counter())
    failures = []
    for action in actions:
        action['arguments'] = json.loads(action['arguments'] or '{}')
        action['response'] = json.loads(action['response'] or '{}')
        duration = seconds(action['updated_at']) - seconds(action['created_at'])
        group = operation_groups[(action['op'], action['status'])]
        group['count'] += 1
        group['journal_seconds'] += duration
        group['service_seconds'] += action['response'].get('timing_ms', {}).get('total', 0) / 1000
        if action['status'] == 'failed':
            failures.append({'seq': action['seq'], 'op': action['op'], 'seconds': round(duration, 3), 'arguments': action['arguments'], 'response': action['response']})
    estimates = []
    for index, request in enumerate(requests):
        timestamp = seconds(request['created_at'])
        next_start = min([seconds(other['created_at']) for other in requests[index+1:] if other['role'] == request['role']] or [end + 1])
        candidates = [message for message in messages if message['role'] == 'assistant' and message['model'] == request['model'] and timestamp <= seconds(message['created_at']) < next_start]
        if candidates:
            message = min(candidates, key=lambda item: seconds(item['created_at']))
            estimates.append({'role': request['role'], 'model': request['model'], 'seconds': round(seconds(message['created_at']) - timestamp, 3), 'message_seq': message['seq']})
    scripts = []
    for message in messages:
        if message['role'] != 'assistant' or message['kind'] != 'directive':
            continue
        match = re.search(r'```zeus-directive\s*(.*?)```', message['content'], re.S)
        if not match:
            continue
        try:
            directive = json.loads(match[1])
        except ValueError:
            continue
        code = directive.get('action', {}).get('code', '')
        scripts.append({'seq': message['seq'], 'time': message['created_at'], 'type': directive.get('type'), 'chars': len(code), 'code': code,
                        'explicit_waits': re.findall(r'(?:sleep|wait_for_timeout)\([^)]*\)', code)})
    summary = {'task_id': task_id, 'run_id': run['id'], 'duration_seconds': round(end-start, 3),
               'usage': [{'role': role, 'model': model, **counts} for (role, model), counts in groups.items()],
               'operations': [{'op': op, 'status': status, **counts} for (op, status), counts in operation_groups.items()],
               'failures': failures, 'model_duration_estimates': estimates,
               'explicit_waits': [{'seq': script['seq'], 'waits': script['explicit_waits']} for script in scripts if script['explicit_waits']],
               'cache_exceeds_reported_input_requests': sum((request.get('cached_tokens') or 0) > (request.get('input_tokens') or 0) for request in requests),
               'notes': ['Request times estimate time to the first persisted model output, not exact provider duration.',
                         'Nested model calls and parallel activities can overlap; do not sum estimates into wall-clock time.',
                         'Tokens and cached tokens are not provider credits.']}
    output.mkdir(parents=True, exist_ok=True)
    for name, data in [('summary', summary), ('messages', messages), ('requests', requests), ('actions', actions), ('scripts', scripts)]:
        (output / (name + '.json')).write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding='utf8')
    print(json.dumps({key: value for key, value in summary.items() if key not in ('failures', 'model_duration_estimates', 'explicit_waits')}, indent=2))
    print('Full selected-task report:', output)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', type=Path, default=Path(os.environ.get('APPDATA', '.')) / 'zeus-agent/zeus.db')
    parser.add_argument('--task', required=True)
    parser.add_argument('--output', type=Path, required=True)
    arguments = parser.parse_args()
    analyze(arguments.database, arguments.task, arguments.output)
