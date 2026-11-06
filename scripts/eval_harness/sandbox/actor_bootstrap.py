"""Readonly guest bootstrap: start the real app under the candidate token."""
import ctypes
from ctypes import wintypes
import json
import os
import subprocess
import sys

if os.name != 'nt' or len(sys.argv) != 1 or os.path.normcase(os.path.abspath(__file__)) != r'c:\zeus\publictools\actor_bootstrap.py':
    raise RuntimeError('Disposable Windows actor bootstrap required')
with open(r'C:\Zeus\Input\job.json', 'rb') as stream:
    raw = stream.read(16385)
if len(raw) > 16384:
    raise RuntimeError('Oversized actor job')
job = json.loads(raw)
machine = ctypes.create_unicode_buffer(256)
machine_size = wintypes.DWORD(len(machine))
if not ctypes.windll.kernel32.GetComputerNameW(machine, ctypes.byref(machine_size)) or machine.value.lower() == job['host_name'].lower():
    raise RuntimeError('Host execution is forbidden')
buffer = ctypes.create_unicode_buffer(256)
size = wintypes.DWORD(len(buffer))
if not ctypes.windll.advapi32.GetUserNameW(buffer, ctypes.byref(size)):
    raise RuntimeError('Cannot inspect actor token identity')
username = buffer.value
if username.lower() != 'zeuscandidate' or ctypes.windll.shell32.IsUserAnAdmin():
    raise RuntimeError('The actor must use the non-admin candidate account')

# CreateProcessWithLogonW loads the profile but can inherit the controller's
# environment strings. Resolve these paths from the actual current user token.
for name, csidl in [('USERPROFILE', 0x28), ('APPDATA', 0x1A), ('LOCALAPPDATA', 0x1C)]:
    folder = ctypes.create_unicode_buffer(32768)
    if ctypes.windll.shell32.SHGetFolderPathW(None, csidl, None, 0, folder) != 0:
        raise RuntimeError('Cannot resolve actor profile folder')
    os.environ[name] = folder.value
os.environ['USERNAME'] = username
os.environ.pop('ZEUS_GUEST_ACTOR_LAUNCHER', None)
os.environ.pop('ZEUS_GRADER_CANDIDATE_LAUNCHER', None)
workspace = r'C:\Zeus\CandidateScratch\App'
if os.environ.get('ZEUS_TEST_WORKSPACE_ROOT') != workspace:
    raise RuntimeError('Owned actor workspace required')
os.makedirs(workspace, exist_ok=True)
app = subprocess.Popen([r'C:\Zeus\Runtime\app\zeus-evaluation.exe'], cwd=workspace,
                       stdin=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW)
print('ZEUS_ACTOR_STARTED:' + json.dumps({'pid': app.pid, 'bootstrap_pid': os.getpid(),
      'username': username, 'is_admin': False}), flush=True)
raise SystemExit(app.wait())
