"""Known solution using CSV + Decimal; the grader uses independent JS integer logic."""
import csv
import json
from decimal import Decimal
from pathlib import Path
import re
import sys

root = Path(sys.argv[1])
invoices = {}
with (root / 'invoices.csv').open(encoding='utf-8', newline='') as source:
    for row in csv.DictReader(source):
        invoices[row['invoice_id']] = {**row, 'paid': Decimal('0'), 'late': False, 'accepted': []}
payments = json.loads((root / 'payments.json').read_text(encoding='utf-8'))
exceptions, seen = [], set()
for payment in payments:
    invoice = invoices.get(payment['invoice_id'])
    reason = None
    if payment['payment_id'] in seen:
        reason = 'duplicate'
    elif invoice is None:
        reason = 'unknown_invoice'
    elif invoice['currency'] != payment['currency']:
        reason = 'currency_mismatch'
    elif not isinstance(payment['amount'], str) or not re.fullmatch(r'\d+\.\d{2}', payment['amount'], flags=re.ASCII):
        reason = 'invalid_amount'
    elif payment['date'] > '2026-02-15':
        reason = 'after_cutoff'
    seen.add(payment['payment_id'])
    if reason:
        exceptions.append({'payment_id': payment['payment_id'], 'reason': reason})
    else:
        invoice['paid'] += Decimal(payment['amount'])
        invoice['late'] |= payment['date'] > invoice['due_date']
        invoice['accepted'].append(payment['payment_id'])

rows, totals = [], {}
for invoice in invoices.values():
    amount, paid = Decimal(invoice['amount']), invoice['paid']
    status = 'unpaid' if paid == 0 else 'partial' if paid < amount else 'paid' if paid == amount else 'overpaid'
    row = {'invoice_id': invoice['invoice_id'], 'currency': invoice['currency'],
           'invoiced_minor': int(amount * 100), 'paid_minor': int(paid * 100), 'balance_minor': int((amount - paid) * 100),
           'status': status, 'late': invoice['late'], 'accepted_payment_ids': invoice['accepted']}
    rows.append(row)
    aggregate = totals.setdefault(row['currency'], {'invoiced_minor': 0, 'paid_minor': 0, 'balance_minor': 0})
    for key in aggregate:
        aggregate[key] += row[key]
(root / 'reconciliation.json').write_text(json.dumps({'as_of': '2026-02-15', 'invoices': rows, 'exceptions': exceptions, 'totals': totals}, indent=2), encoding='utf-8')
