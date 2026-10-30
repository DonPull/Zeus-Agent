"""Real browser/service feasibility tests. No model, credentials or user profile."""
import concurrent.futures
import ctypes
from ctypes import wintypes
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import secrets
import socketserver
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import uuid

ROOT = Path(__file__).resolve().parents[2]
SERVICE = ROOT / "src-tauri/browser_service/service.py"
HIDDEN = {"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {}
SERVICE_ENV={key:value for key,value in os.environ.items() if key not in {'FORCE_COLOR','NO_COLOR','NODE_OPTIONS','PYTHONPATH','PYTHONHOME'}}


class WindowsJob:
    """Test supervisor's kill-on-close containment, before the startup frame."""
    def __init__(self, process):
        self.handle = None
        if os.name != "nt":
            return
        class IO(ctypes.Structure):
            _fields_ = [(name, ctypes.c_ulonglong) for name in ("ReadOperationCount", "WriteOperationCount", "OtherOperationCount", "ReadTransferCount", "WriteTransferCount", "OtherTransferCount")]
        class Basic(ctypes.Structure):
            _fields_ = [("PerProcessUserTimeLimit", ctypes.c_longlong), ("PerJobUserTimeLimit", ctypes.c_longlong),
                        ("LimitFlags", wintypes.DWORD), ("MinimumWorkingSetSize", ctypes.c_size_t), ("MaximumWorkingSetSize", ctypes.c_size_t),
                        ("ActiveProcessLimit", wintypes.DWORD), ("Affinity", ctypes.c_size_t), ("PriorityClass", wintypes.DWORD), ("SchedulingClass", wintypes.DWORD)]
        class Extended(ctypes.Structure):
            _fields_ = [("BasicLimitInformation", Basic), ("IoInfo", IO), ("ProcessMemoryLimit", ctypes.c_size_t),
                        ("JobMemoryLimit", ctypes.c_size_t), ("PeakProcessMemoryUsed", ctypes.c_size_t), ("PeakJobMemoryUsed", ctypes.c_size_t)]
        api = ctypes.WinDLL("kernel32", use_last_error=True)
        api.CreateJobObjectW.restype = wintypes.HANDLE
        api.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
        api.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
        api.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
        api.QueryInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD, ctypes.c_void_p]
        api.CloseHandle.argtypes = [wintypes.HANDLE]
        self.api = api
        self.handle = api.CreateJobObjectW(None, None)
        limits = Extended()
        limits.BasicLimitInformation.LimitFlags = 0x2000  # KILL_ON_JOB_CLOSE
        if not self.handle or not api.SetInformationJobObject(self.handle, 9, ctypes.byref(limits), ctypes.sizeof(limits)) or not api.AssignProcessToJobObject(self.handle, wintypes.HANDLE(process._handle)):
            raise ctypes.WinError(ctypes.get_last_error())

    def pids(self):
        if not self.handle:
            return []
        data = ctypes.create_string_buffer(65536)
        if not self.api.QueryInformationJobObject(self.handle, 3, data, len(data), None):
            raise ctypes.WinError(ctypes.get_last_error())
        count = ctypes.c_uint32.from_buffer(data, 4).value
        return [ctypes.c_size_t.from_buffer(data, 8 + index * ctypes.sizeof(ctypes.c_size_t)).value for index in range(count)]

    def close(self):
        if self.handle:
            self.api.CloseHandle(self.handle)
            self.handle = None


class Broker:
    def __init__(self, folder, capture=False):
        self.folder = Path(folder)
        self.closed = False
        self.token, self.session = secrets.token_hex(32), uuid.uuid4().hex
        self.process = subprocess.Popen([sys.executable, "-I", str(SERVICE)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=SERVICE_ENV, **HIDDEN)
        self.job = WindowsJob(self.process)
        self.lock = threading.Lock()
        self.pool = concurrent.futures.ThreadPoolExecutor(max_workers=1)
        self.write({"op": "start", "protocol": 1, "session_id": self.session, "generation": 1, "token": self.token,
                    "profile_dir": str(self.folder / "profile"), "artifact_dir": str(self.folder / "artifacts"), "capture_interval_ms": 250 if capture else 0})
        ready = self.read()
        if not ready.get("ok"):
            self.close()
            raise RuntimeError(str(ready))
        self.ready = ready

    def write(self, value):
        self.process.stdin.write(json.dumps(value).encode() + b"\n")
        self.process.stdin.flush()

    def read(self, timeout=20):
        raw = self.pool.submit(self.process.stdout.readline).result(timeout)
        if not raw:
            raise RuntimeError("Browser service exited")
        return json.loads(raw)

    def call(self, op, params=None, **overrides):
        with self.lock:
            self.write({"id": uuid.uuid4().hex, "protocol": 1, "session_id": self.session, "generation": 1,
                        "token": self.token, "op": op, "params": params or {}, **overrides})
            return self.read()

    def close(self, force=False):
        if self.closed:
            return
        self.closed = True
        if self.process.poll() is None and not force:
            try:
                self.write({"op": "shutdown", "id": "shutdown", "token": self.token})
                self.read(timeout=7)
                self.process.wait(timeout=5)
            except Exception:
                pass
        self.job.close()
        if self.process.poll() is None:
            self.process.kill()
        self.process.wait(timeout=5)
        self.process.stdin.close()
        self.process.stdout.close()
        self.stderr = self.process.stderr.read().decode(errors="replace")
        self.process.stderr.close()
        self.pool.shutdown(wait=True)


PAGE = b'''<!doctype html><html><body><label>Task note<input id="note"></label><button id="save" onclick="localStorage.note=note.value;document.cookie='continuity=present';statusText.textContent=note.value;fetch('/append',{method:'POST'})">Save note</button><p id="statusText"></p><p id="timer"></p><script>statusText.textContent=localStorage.note||'';setInterval(()=>{timer.textContent=Date.now();document.body.style.backgroundColor=Date.now()%1000<500?'#90c0f0':'#f0c090'},100)</script></body></html>'''


class PageHandler(BaseHTTPRequestHandler):
    updates = 0
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        if self.path == '/frames':
            self.wfile.write(b'<body><iframe title="Child controls" src="/frame"></iframe></body>')
        elif self.path == '/frame':
            self.wfile.write(b'<body><button onclick="fetch(\'/append\',{method:\'POST\'})">In frame</button></body>')
        elif self.path == '/dialog':
            self.wfile.write(b'<body><button onclick="if(confirm(\'Confirm update\'))fetch(\'/append\',{method:\'POST\'})">Confirm change</button></body>')
        else:
            self.wfile.write(PAGE)
    def do_POST(self):
        type(self).updates += 1
        self.send_response(204)
        self.end_headers()
    def log_message(self, *_):
        pass


class BrowserServiceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), PageHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f"http://127.0.0.1:{cls.server.server_port}/"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def setUp(self):
        self.folder = tempfile.TemporaryDirectory(prefix="zeus-browser-service-")
        self.broker = Broker(self.folder.name, capture=True)
        self.addCleanup(self.folder.cleanup)
        self.addCleanup(self.broker.close)
        self.assertTrue(self.broker.call("navigate", {"url": self.url})["ok"])

    def test_two_process_clients_retain_state_and_only_one_browser(self):
        broker = self.broker
        class Proxy(socketserver.StreamRequestHandler):
            def handle(self):
                request = json.loads(self.rfile.readline(1048576))
                if request.pop("client_token", None) != broker.token:
                    value = {"ok": False, "error": {"code": "CLIENT_AUTH"}}
                else:
                    value = broker.call(request["op"], request.get("params"))
                self.wfile.write(json.dumps(value).encode() + b"\n")
        with socketserver.ThreadingTCPServer(("127.0.0.1", 0), Proxy) as proxy:
            thread = threading.Thread(target=proxy.serve_forever, daemon=True)
            thread.start()
            client = "import sys,socket,json; cfg=json.load(sys.stdin); s=socket.create_connection(('127.0.0.1',cfg.pop('port'))); s.sendall(json.dumps(cfg).encode()+b'\\n'); print(s.makefile().readline()); s.close()"
            def call(op, params=None):
                result = subprocess.run([sys.executable, "-I", "-c", client], input=json.dumps({"port": proxy.server_address[1], "client_token": broker.token, "op": op, "params": params or {}}), text=True, capture_output=True, timeout=15, **HIDDEN)
                self.assertEqual(result.returncode, 0, result.stderr)
                return json.loads(result.stdout)
            self.assertTrue(call("fill", {"target": {"css": "#note"}, "value": "retained between clients"})["ok"])
            self.assertTrue(call("click", {"target": {"role": "button", "name": "Save note"}})["ok"])
            observed = call("observe")["result"]
            self.assertIn("retained between clients", observed["text"])
            self.assertEqual(len(call("tabs")["result"]["tabs"]), 1)
            proxy.shutdown()
            thread.join()
        self.assertEqual(broker.session, broker.ready["result"]["session_id"])

    def test_protocol_negative_controls_and_idempotency(self):
        self.assertEqual(self.broker.call("observe", token="wrong")["error"]["code"], "BROWSER_AUTH")
        self.assertEqual(self.broker.call("observe", session_id="foreign")["error"]["code"], "BROWSER_IDENTITY")
        self.assertEqual(self.broker.call("evaluate", {"code": "1+1"})["error"]["code"], "BROWSER_UNSUPPORTED")
        self.assertFalse(self.broker.call("navigate", {"url": "file:///C:/Windows/win.ini"})["ok"])
        self.assertTrue(self.broker.call("fill", {"target": {"css": "#note"}, "value": "only once"})["ok"])
        before = PageHandler.updates
        request_id = uuid.uuid4().hex
        first = self.broker.call("click", {"target": {"css": "#save"}}, id=request_id)
        second = self.broker.call("click", {"target": {"css": "#save"}}, id=request_id)
        self.assertEqual(first, second)
        time.sleep(0.2)
        self.assertEqual(PageHandler.updates, before + 1)
        failure = self.broker.call("click", {"target": {"css": "#missing"}, "timeout_ms": 200})
        self.assertFalse(failure["ok"])

    def test_capture_changes_while_actor_is_idle_and_shutdown_is_clean(self):
        artifact = Path(self.folder.name) / "artifacts/latest.jpg"
        deadline = time.monotonic() + 4
        while not artifact.exists() and time.monotonic() < deadline:
            time.sleep(0.05)
        first = hashlib.sha256(artifact.read_bytes()).hexdigest()
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            time.sleep(0.15)
            if hashlib.sha256(artifact.read_bytes()).hexdigest() != first:
                break
        else:
            self.fail("Independent browser pixels did not change")
        self.broker.close()
        self.assertEqual(self.broker.process.returncode, 0)
        self.assertEqual(self.broker.stderr, "")

    def test_frames_tabs_semantics_and_stale_targets(self):
        old=self.broker.call('observe')['result']
        self.assertIn('button "Save note"',old['semantic'])
        self.assertTrue(self.broker.call('navigate',{'url':self.url+'frames'})['ok'])
        self.assertEqual(self.broker.call('click',{'target':{'css':'#save'},'revision':old['revision']})['error']['code'],'BROWSER_STALE_TARGET')
        deadline=time.monotonic()+3
        while True:
            observed=self.broker.call('observe')['result']
            if observed['frames']:
                break
            if time.monotonic()>deadline:self.fail('Child frame was not observable')
        self.assertTrue(self.broker.call('click',{'target':{'role':'button','name':'In frame'},'frame_id':observed['frames'][0]['frame_id']})['ok'])
        self.assertEqual(self.broker.call('click',{'target':{'css':'button'},'frame_id':'foreign'})['error']['code'],'BROWSER_FRAME')
        tab=self.broker.call('new_tab')['result']['tab_id']
        self.assertEqual(len(self.broker.call('tabs')['result']['tabs']),2)
        self.assertTrue(self.broker.call('close_tab',{'tab_id':tab})['ok'])
        self.assertEqual(len(self.broker.call('tabs')['result']['tabs']),1)

    def test_dialog_policy_reports_actual_acceptance_not_just_preparation(self):
        self.assertTrue(self.broker.call('navigate',{'url':self.url+'dialog'})['ok'])
        before=PageHandler.updates
        first=self.broker.call('click',{'target':{'role':'button','name':'Confirm change'}})
        self.assertTrue(first['ok'])
        self.assertEqual(first['result']['dialogs'][-1]['handling'],'dismissed')
        self.assertFalse(first['result']['dialogs'][-1]['expected'])
        self.assertEqual(PageHandler.updates,before)
        prepared=self.broker.call('dialog',{'behavior':'accept'})
        self.assertEqual(prepared['result']['dialog_policy'],'prepared_for_next_dialog')
        accepted=self.broker.call('click',{'target':{'role':'button','name':'Confirm change'}})
        self.assertEqual(accepted['result']['dialogs'][-1]['handling'],'accepted')
        time.sleep(0.1)
        self.assertEqual(PageHandler.updates,before+1)

    def test_oversized_frames_end_the_protocol_instead_of_executing(self):
        self.broker.process.stdin.write(b'x'*(1024*1024+1)+b'\n')
        self.broker.process.stdin.flush()
        self.assertEqual(self.broker.read()['error']['code'],'BROWSER_FRAME_LIMIT')

    @unittest.skipUnless(os.name == "nt", "Windows process containment")
    def test_kill_on_close_reaps_browser_descendants(self):
        pids = self.broker.job.pids()
        self.assertGreater(len(pids), 2)
        api = ctypes.WinDLL("kernel32", use_last_error=True)
        api.OpenProcess.restype = wintypes.HANDLE
        api.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        api.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
        api.CloseHandle.argtypes = [wintypes.HANDLE]
        handles = [api.OpenProcess(0x100000, False, pid) for pid in pids]
        try:
            self.broker.close(force=True)
            for handle in filter(None, handles):
                self.assertEqual(api.WaitForSingleObject(handle, 5000), 0)
        finally:
            for handle in filter(None, handles):
                api.CloseHandle(handle)


if __name__ == "__main__":
    unittest.main(verbosity=2)
