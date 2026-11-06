"""Trusted standard-user gate. Parent assigns the job before authorizing code."""
import json
import os
import subprocess
import sys

header = bytearray()
while True:
    char = os.read(sys.stdin.fileno(), 1)
    if char == b'\n':
        break
    if not char or len(header) >= 65536:
        raise RuntimeError('Missing or oversized candidate activation')
    header.extend(char)
arguments = json.loads(header)
if not isinstance(arguments, list) or len(arguments) > 128 or not all(isinstance(arg, str) for arg in arguments):
    raise RuntimeError('Invalid candidate arguments')
child = subprocess.Popen([sys.executable, *arguments], stdin=sys.stdin, stdout=sys.stdout, stderr=sys.stderr)
raise SystemExit(child.wait())
