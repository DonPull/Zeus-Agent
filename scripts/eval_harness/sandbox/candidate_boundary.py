"""Trusted account/access probe; runs before any submitted program."""
import ctypes
import json
import os
import sys
from pathlib import Path

def denied_read(name):
    try:
        with open(name, 'rb') as source:
            source.read(1)
        return False
    except PermissionError:
        return True

def denied_write(name):
    try:
        with open(name, 'xb') as target:
            target.write(b'Unexpected candidate access')
        return False
    except PermissionError:
        return True

def denied_modify(name):
    try:
        with open(name, 'r+b'):
            pass
        return False
    except PermissionError:
        return True

kernel = ctypes.WinDLL('kernel32', use_last_error=True)
kernel.OpenProcess.restype = ctypes.c_void_p
kernel.CloseHandle.argtypes = [ctypes.c_void_p]
handle = kernel.OpenProcess(0x7a, False, int(sys.argv[1]))
process_denied = not bool(handle)
if handle:
    kernel.CloseHandle(handle)

result = {
    'username': os.getlogin(),
    'is_admin': bool(ctypes.windll.shell32.IsUserAnAdmin()),
    'controller_process_denied': process_denied,
    'runtime_write_denied': denied_modify(r'C:\Zeus\Runtime\browser\venv\Scripts\Lib\os.py'),
    'private_read_denied': denied_read(r'C:\Zeus\GraderPrivate\candidate.json'),
    'private_write_denied': denied_write(r'C:\Zeus\GraderPrivate\candidate-write.txt'),
    'input_read_denied': denied_read(r'C:\Zeus\Input\job.json'),
    'output_write_denied': denied_write(r'C:\Zeus\Output\candidate-write.txt'),
    'runtime_readable': Path(r'C:\Zeus\Runtime\browser\venv\Scripts\Lib\os.py').is_file(),
}
scratch = Path(r'C:\Zeus\CandidateScratch\owned-write.txt')
scratch.write_text('candidate scratch', encoding='utf8')
result['scratch_writable'] = scratch.read_text(encoding='utf8') == 'candidate scratch'
print(json.dumps(result))
