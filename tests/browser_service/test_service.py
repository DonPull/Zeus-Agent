"""Real browser/service feasibility tests. No model, credentials or user profile."""
import concurrent.futures
import importlib.util
import ctypes
from ctypes import wintypes
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import secrets
import statistics
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
        self.mailbox = self.folder / "mailbox"
        self.process = subprocess.Popen([sys.executable, "-I", str(SERVICE)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=SERVICE_ENV, **HIDDEN)
        self.job = WindowsJob(self.process)
        self.lock = threading.Lock()
        self.pool = concurrent.futures.ThreadPoolExecutor(max_workers=1)
        self.write({"op": "start", "protocol": 1, "session_id": self.session, "generation": 1, "token": self.token,
                    "task_id": uuid.uuid4().hex, "run_id": uuid.uuid4().hex,
                    "profile_dir": str(self.folder / "profile"), "artifact_dir": str(self.folder / "artifacts"),
                    "mailbox_dir": str(self.mailbox), "capture_interval_ms": 1000 if capture else 0})
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
    uploaded=b''
    def do_GET(self):
        if self.path=='/slow-download':
            self.send_response(200);self.send_header('Content-Type','application/octet-stream');self.send_header('Content-Disposition','attachment; filename="unfinished.bin"');self.send_header('Content-Length',str(1024*1024));self.end_headers()
            for _ in range(16):
                try:self.wfile.write(b'x'*65536);self.wfile.flush()
                except ConnectionError:break
                time.sleep(.1)
            return
        if self.path=='/download':
            data=b'item,amount\nverified,42\n'
            self.send_response(200);self.send_header('Content-Type','text/csv');self.send_header('Content-Disposition','attachment; filename="report.csv"');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data);return
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        if self.path == '/frames':
            self.wfile.write(b'<body><iframe title="Child controls" src="/frame"></iframe></body>')
        elif self.path == '/frame':
            self.wfile.write(b'<body><button onclick="fetch(\'/append\',{method:\'POST\'})">In frame</button></body>')
        elif self.path == '/dialog':
            self.wfile.write(b'<body><button onclick="if(confirm(\'Confirm update\'))fetch(\'/append\',{method:\'POST\'})">Confirm change</button></body>')
        elif self.path == '/widget':
            self.wfile.write(b'<body tabindex="0" onkeydown="document.querySelector(\'#feedback\').textContent=event.key"><input id="hidden" style="visibility:hidden"><div id="feedback" role="status" data-state="unknown" style="background:rgb(40,90,130)">Awaiting input</div><script>for(let i=0;i<30;i++){let e=document.createElement("span");e.className="item";e.textContent="Visible item "+i;document.body.append(e)}</script></body>')
        elif self.path == '/static':
            self.wfile.write(b'<body><h1>Static capture fixture</h1><button>Observe</button></body>')
        elif self.path == '/readiness':
            self.wfile.write(b'''<body><input id="name" data-ready="false"><button id="save" data-ready="false">Save</button><button id="uncertain" onclick="fetch('/append',{method:'POST'})">Submit</button><p id="status">Loading</p><script>
            setInterval(()=>fetch('/ping'),100);
            setTimeout(()=>{document.querySelector('#name').value='';document.querySelector('#name').dataset.ready='true';document.querySelector('#save').dataset.ready='true';document.querySelector('#status').textContent='Ready';document.querySelector('#save').onclick=()=>{fetch('/append',{method:'POST'});setTimeout(()=>document.querySelector('#status').textContent='Saved',450)}},600);
            </script></body>''')
        elif self.path == '/typing':
            self.wfile.write(b'''<body tabindex="0"><p id="feedback"></p><input id="password" name="secret" type="password"><script>document.body.onkeydown=e=>{if(e.key.length===1)document.querySelector('#feedback').textContent+=e.key}</script></body>''')
        elif self.path=='/files':
            self.wfile.write(b'''<body><input id="file" type="file" onchange="this.files[0].arrayBuffer().then(bytes=>fetch('/upload',{method:'POST',body:bytes})).then(()=>document.querySelector('#status').textContent='Uploaded')"><p id="status">Waiting</p><a href="/download">Download report</a></body>''')
        elif self.path == '/ping':
            self.wfile.write(b'ok')
        elif self.path == '/slow':
            time.sleep(1.5)
            self.wfile.write(PAGE)
        else:
            self.wfile.write(PAGE)
    def do_POST(self):
        if self.path=='/upload':type(self).uploaded=self.rfile.read(int(self.headers.get('Content-Length','0')))
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
        first = self.capture_frame()
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            time.sleep(0.15)
            if self.capture_frame()["frame"]["sha256"] != first["frame"]["sha256"]:
                break
        else:
            self.fail("Independent browser pixels did not change")
        self.broker.close()
        self.assertEqual(self.broker.process.returncode, 0)
        self.assertEqual(self.broker.stderr, "")

    def capture_frame(self, after=0, state="live"):
        deadline=time.monotonic()+6
        while time.monotonic()<deadline:
            try:
                descriptor=(self.broker.mailbox / 'capture.json').read_bytes()
                value=json.loads(descriptor)
                if value['state']!=state or value['revision']<=after:
                    time.sleep(.05)
                    continue
                if state=='live':
                    frame=value['frame']
                    data=(self.broker.mailbox / frame['key']).read_bytes()
                    if (self.broker.mailbox / 'capture.json').read_bytes()!=descriptor:
                        continue
                    self.assertEqual(hashlib.sha256(data).hexdigest(),frame['sha256'])
                    self.assertEqual(len(data),frame['bytes'])
                    self.assertLessEqual(len(data),2*1024*1024)
                    self.assertEqual((frame['width'],frame['height']),(1280,720))
                    self.assertEqual(value['session_id'],self.broker.session)
                self.assertLessEqual(len(descriptor),8192)
                return value
            except (OSError,ValueError):
                time.sleep(.05)
        self.fail(f'No matching {state} capture publication after {after}')

    def test_capture_advances_during_a_long_action_and_reports_no_tab(self):
        first=self.capture_frame()
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            waiting=pool.submit(self.broker.call,'wait',{'target':{'css':'#never'},'timeout_ms':4500})
            second=self.capture_frame(after=first['revision'])
            self.assertFalse(waiting.done(), 'Preview waited for the action queue')
            self.assertNotEqual(first['frame']['sha256'],second['frame']['sha256'])
            self.assertFalse(waiting.result()['ok'])
        tabs=self.broker.call('tabs')['result']['tabs']
        for tab in tabs:
            self.assertTrue(self.broker.call('close_tab',{'tab_id':tab['tab_id']})['ok'])
        no_tab=self.capture_frame(after=second['revision'],state='no_tab')
        self.assertEqual(no_tab['error'],'BROWSER_CAPTURE_FAILED')
        self.assertEqual(len(list(self.broker.mailbox.glob('slot-*.jpg'))),2)

    def test_generic_inspection_and_visible_keyboard_widget_preserve_unknown_state(self):
        self.assertTrue(self.broker.call('navigate',{'url':self.url+'widget'})['ok'])
        hidden=self.broker.call('inspect',{'target':{'css':'#hidden'}})['result']['elements'][0]
        self.assertFalse(hidden['visible'])
        self.assertFalse(self.broker.call('fill',{'target':{'css':'#hidden'},'value':'wrong target','timeout_ms':200})['ok'])
        self.assertTrue(self.broker.call('press',{'target':{'css':'body'},'key':'A'})['ok'])
        inspected=self.broker.call('inspect',{'target':{'css':'#feedback'}})['result']
        self.assertEqual(inspected['elements'][0]['text'],'A')
        self.assertEqual(inspected['elements'][0]['attributes']['data-state'],'unknown')
        self.assertEqual(inspected['elements'][0]['colors']['background'],'rgb(40, 90, 130)')
        many=self.broker.call('inspect',{'target':{'css':'.item'}})['result']
        self.assertEqual(len(many['elements']),20)
        self.assertTrue(many['truncated'])
        self.assertLessEqual(len(json.dumps(many).encode()),32768)
        self.assertEqual(self.broker.call('evaluate',{'code':'1+1'})['error']['code'],'BROWSER_UNSUPPORTED')

    def test_readiness_hydration_late_confirmation_and_uncertain_effect_are_not_blindly_retried(self):
        before=PageHandler.updates
        self.assertTrue(self.broker.call('navigate',{'url':self.url+'readiness'})['ok'])
        filled=self.broker.call('fill',{'target':{'css':'#name'},'value':'Retained input','timeout_ms':3000,
            'ready':{'target':{'css':'#name'},'condition':{'kind':'attribute','name':'data-ready','value':'true'}},
            'expect':{'target':{'css':'#name'},'condition':{'kind':'value','value':'Retained input'},'settle_ms':100}})
        self.assertTrue(filled['ok'],filled)
        saved=self.broker.call('click',{'target':{'css':'#save'},'timeout_ms':2500,
            'expect':{'target':{'css':'#status'},'condition':{'kind':'text','value':'Saved','match':'equals'}}})
        self.assertTrue(saved['ok'],saved)
        self.assertEqual(PageHandler.updates,before+1)
        action_id=uuid.uuid4().hex
        params={'target':{'css':'#uncertain'},'timeout_ms':300,'expect':{'target':{'css':'#status'},'condition':{'kind':'text','value':'Never happens'}}}
        first=self.broker.call('click',params,id=action_id)
        self.assertEqual(first['error']['code'],'BROWSER_OUTCOME_UNCONFIRMED')
        self.assertEqual(self.broker.call('click',params,id=action_id),first)
        self.assertEqual(PageHandler.updates,before+2)
        invalid=self.broker.call('click',{'target':{'css':'#uncertain'},'expect':{'target':{'css':'#status'},'condition':{'kind':'execute','value':'1+1'}}})
        self.assertEqual(invalid['error']['code'],'BROWSER_ARGUMENT')
        self.assertEqual(PageHandler.updates,before+2)

    def test_coherent_keyboard_text_and_sensitive_focus(self):
        self.assertTrue(self.broker.call('navigate',{'url':self.url+'typing'})['ok'])
        result=self.broker.call('type_text',{'target':{'css':'body'},'value':'calm input',
            'expect':{'target':{'css':'#feedback'},'condition':{'kind':'text','value':'calm input','match':'equals'}}})
        self.assertTrue(result['ok'],result)
        self.assertTrue(self.broker.call('click',{'target':{'css':'#password'}})['ok'])
        blocked=self.broker.call('type_text',{'target':{'css':'body'},'value':'do not enter'})
        self.assertEqual(blocked['error']['code'],'BROWSER_SENSITIVE_INPUT')

    def test_viewed_capture_uses_fixed_eight_fps_quality_eighty_and_bounded_slots(self):
        self.broker.mailbox.mkdir(parents=True,exist_ok=True)
        (self.broker.mailbox/'viewer.json').write_text(json.dumps({'until_ms':int(time.time()*1000)+10000}))
        first=self.capture_frame()
        self.assertEqual(first['frame']['quality'],80)
        # Let the new heartbeat take effect at the next independently scheduled cycle.
        second=self.capture_frame(after=first['revision'])
        start=time.monotonic();time.sleep(2)
        final=self.capture_frame(after=second['revision'])
        elapsed=time.monotonic()-start;frames=final['frame']['seq']-second['frame']['seq']
        print('\nVIEWED_CAPTURE_MEASUREMENT '+json.dumps({'frames':frames,'seconds':round(elapsed,2),'fps':round(frames/elapsed,2),'quality':80}),flush=True)
        self.assertGreaterEqual(frames,12)
        self.assertLessEqual(frames,20)
        self.assertEqual(len(list(self.broker.mailbox.glob('slot-*.jpg'))),2)

    def test_capture_and_action_latency_are_measured_with_capture_on_and_off(self):
        report={'note':'Short local measurements, not a throughput or capability benchmark. Navigation and observation exclude model time.','cases':{}}
        for enabled in (False,True):
            broker=self.broker if enabled else Broker(Path(self.folder.name)/'without-capture',capture=False)
            try:
                for name,suffix in [('static','static'),('animated',''),('slow_navigation','slow'),('dynamic_widget','widget')]:
                    start=time.perf_counter()
                    self.assertTrue(broker.call('navigate',{'url':self.url+suffix})['ok'])
                    navigation_ms=round((time.perf_counter()-start)*1000,2)
                    samples=[];frames={};deadline=time.monotonic()+2.4
                    while time.monotonic()<deadline:
                        start=time.perf_counter()
                        self.assertTrue(broker.call('observe')['ok'])
                        samples.append((time.perf_counter()-start)*1000)
                        if enabled:
                            try:
                                publication=json.loads((broker.mailbox/'capture.json').read_bytes())
                                frame=publication.get('frame')
                                if publication['state']=='live' and frame:
                                    frames[frame['seq']]=frame['ended_ms']-frame['started_ms']
                            except (OSError,ValueError):pass
                        time.sleep(.125)
                    row={'navigation_ms':navigation_ms,'observe_count':len(samples),'observe_median_ms':round(statistics.median(samples),2),'observe_max_ms':round(max(samples),2)}
                    if enabled:
                        self.assertGreaterEqual(len(frames),2,'Measurement did not overlap independent captures')
                        row.update(capture_samples=len(frames),capture_median_ms=statistics.median(frames.values()),capture_max_ms=max(frames.values()))
                    report['cases'].setdefault(name,{})['capture_on' if enabled else 'capture_off']=row
            finally:
                if not enabled:broker.close()
        frame=self.capture_frame()
        report['capture_latency_ms']=frame['frame']['ended_ms']-frame['frame']['started_ms']
        report['metrics']=frame['metrics']
        report['retained_mailbox_bytes']=sum(file.stat().st_size for file in self.broker.mailbox.iterdir() if file.is_file())
        print('\nCAPTURE_MEASUREMENT '+json.dumps(report),flush=True)
        if os.environ.get('ZEUS_CAPTURE_METRICS_PATH'):
            destination=Path(os.environ['ZEUS_CAPTURE_METRICS_PATH'])
            destination.parent.mkdir(parents=True,exist_ok=True)
            destination.write_text(json.dumps(report,indent=2),encoding='utf8')

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

    def test_read_only_tab_inspection_does_not_steal_the_automation_target(self):
        first=self.broker.call('tabs')['result']['tabs'][0]['tab_id']
        second=self.broker.call('new_tab')['result']['tab_id']
        self.assertTrue(self.broker.call('navigate',{'url':self.url+'widget','tab_id':second})['ok'])
        self.assertTrue(self.broker.call('observe',{'tab_id':first})['ok'])
        tabs=self.broker.call('tabs')['result']['tabs']
        self.assertEqual(next(tab['tab_id'] for tab in tabs if tab['selected']),second)
        changed=self.broker.call('fill',{'tab_id':first,'target':{'css':'#note'},'value':'Explicit action target'})
        self.assertTrue(changed['ok'])
        self.assertEqual(next(tab['tab_id'] for tab in changed['tabs'] if tab['selected']),first)

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


class HandoffServiceTests(unittest.IsolatedAsyncioTestCase):
    """Real browser/page instrumentation; only native window placement is mocked.
    The separate Windows visibility probe validates actual native rendering.
    """
    @classmethod
    def setUpClass(cls):
        cls.server=ThreadingHTTPServer(('127.0.0.1',0),PageHandler);cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True);cls.thread.start();cls.url=f'http://127.0.0.1:{cls.server.server_port}'

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown();cls.server.server_close();cls.thread.join()
    async def asyncSetUp(self):
        spec=importlib.util.spec_from_file_location('zeus_service',SERVICE)
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        self.folder=tempfile.TemporaryDirectory(prefix='zeus-human-observer-')
        root=Path(self.folder.name);(root/'frames').mkdir()
        self.config={'session_id':str(uuid.uuid4()),'generation':1,'token':secrets.token_hex(32),'profile_dir':str(root/'profile'),'artifact_dir':str(root/'artifacts'),'frame_dir':str(root/'frames')}
        self.service=module.Service(self.config)
        await self.service.start()
        self.page=self.service.pages[self.service.selected]
        await self.page.set_content('<body><input id="note"><input id="password" type="password"><button id="save" onclick="window.saved=note.value">Save</button><p id="status">Ready</p></body>')
        await self.page.evaluate(module.HUMAN_OBSERVER)  # set_content retains this initial document
        class Window:
            positions=[]
            def position(self,visible):self.positions.append(visible)
        self.service.window=Window()
        self.error=module.BrowserError

    async def asyncTearDown(self):
        if not self.service.closing:await self.service.close()
        self.folder.cleanup()

    async def call(self,op,params=None,**extra):
        return await self.service.action({'protocol':1,'session_id':self.config['session_id'],'generation':1,'token':self.config['token'],'id':str(uuid.uuid4()),'op':op,'params':params or {},**extra})

    async def test_human_pause_preserves_page_records_grouped_inputs_and_resumes_fresh(self):
        await self.call('fill',{'target':{'css':'#note'},'value':'Unsaved draft'})
        before=await self.page.evaluate('marker=>({note:note.value,marker:window.marker=marker})',str(uuid.uuid4()))
        epoch=str(uuid.uuid4())
        await self.call('_human_begin',{'epoch':epoch});await self.call('_human_open',{'epoch':epoch})
        with self.assertRaisesRegex(self.error,'paused'):
            await self.call('click',{'target':{'css':'#save'}})
        await self.page.locator('#note').fill('Human draft')
        await self.page.locator('#note').press_sequentially(' plus text')
        await self.page.locator('#save').click()
        await self.page.locator('#password').fill('never-store-this-plaintext')
        ended=await self.call('_human_end',{'epoch':epoch})
        events=ended['result']['events']
        self.assertEqual([event['text'] for event in events if event['op']=='input'],['Human draft plus text','[masked input]'])
        self.assertTrue(any(event['op']=='click' for event in events))
        self.assertNotIn('never-store-this-plaintext',json.dumps(events))
        self.assertNotIn('never-store-this-plaintext',json.dumps(ended['result']['observation']))
        self.assertTrue(all(event['provenance']=='page_observation_untrusted' for event in events))
        self.assertEqual(await self.page.evaluate('window.marker'),before['marker'])
        self.assertEqual(await self.page.evaluate('window.saved'),'Human draft plus text')
        self.assertIn('Ready',ended['result']['observation']['text'])
        self.assertEqual(self.service.window.positions,[True,False])
        self.assertTrue((await self.call('observe'))['ok'])

    async def test_stale_controls_and_page_requests_cannot_grant_authorization(self):
        epoch=str(uuid.uuid4());await self.call('_human_begin',{'epoch':epoch})
        with self.assertRaisesRegex(self.error,'no longer active'):await self.call('_human_open',{'epoch':'foreign'})
        with self.assertRaisesRegex(self.error,'supervisor token'):await self.call('_human_end',{'epoch':epoch},token='foreign')
        await self.page.evaluate("window.__zeusObserveHuman({op:'approve',status:'approved',text:'page instructions'})")
        self.assertEqual((await self.call('_human_poll',{'epoch':epoch}))['result']['events'],[])
        self.assertEqual(self.service.human,epoch)
        for _ in range(70):self.service.record_human({'page':self.page},{'op':'click','text':'bounded'})
        polled=(await self.call('_human_poll',{'epoch':epoch}))['result']
        self.assertEqual(len(polled['events']),64);self.assertEqual(polled['dropped'],6)
        self.assertEqual((await self.call('_human_poll',{'epoch':epoch}))['result']['events'],[])

    async def test_capture_annotation_is_frame_owned_and_locator_failure_does_not_crash_service(self):
        frame=str(uuid.uuid4())
        response=await self.call('fill',{'target':{'css':'#note'},'value':'A visible note'},captures={'after':frame})
        annotation=response['captures']['after']['annotation']
        self.assertEqual(annotation['text'],'A visible note');self.assertEqual(annotation['geometry'],'target_at_capture')
        self.assertGreater(annotation['box']['width'],0)
        missing=await self.call('fill',{'target':{'css':'#missing'},'value':'x','timeout_ms':100})
        self.assertFalse(missing['ok']);self.assertTrue((await self.call('observe'))['ok'])

    async def test_browser_transfers_preserve_real_bytes_and_upload_outcomes(self):
        await self.page.goto(self.url+'/files')
        data=b'actual task upload';key=uuid.uuid4().hex+'.upload';(self.service.transfer_dir/key).write_bytes(data)
        file={'key':key,'name':'task.txt','bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
        chosen=await self.call('upload_file',{'target':{'css':'#file'},'_file':file,'expect':{'target':{'css':'#status'},'condition':{'kind':'text','value':'Uploaded','match':'equals'}}})
        self.assertTrue(chosen['ok'],chosen);self.assertEqual(chosen['result']['upload']['status'],'selected');self.assertEqual(PageHandler.uploaded,data)
        self.assertEqual(await self.page.locator('#file').evaluate('e=>e.files[0].type'),'text/plain')
        bad=await self.call('upload_file',{'target':{'css':'#file'},'_file':{**file,'sha256':'changed'}})
        self.assertEqual(bad['error']['code'],'BROWSER_UPLOAD_CHANGED')
        downloaded=await self.call('download',{'target':{'text':'Download report'}})
        self.assertTrue(downloaded['ok'],downloaded);record=downloaded['result']['download']
        self.assertEqual(record['status'],'completed');path=self.service.transfer_dir/record['key'];self.assertEqual(path.read_bytes(),b'item,amount\nverified,42\n')
        # A normal click can also begin a download. Closing the run must cancel
        # unfinished work while preserving the earlier verified file.
        await self.page.evaluate("()=>{const link=document.createElement('a');link.href='/slow-download';link.textContent='Slow report';document.body.append(link)}")
        await self.call('click',{'target':{'text':'Slow report'}})
        self.assertTrue(any(row['status']=='pending' for row in self.service.transfers.values()))
        await self.service.close()
        self.assertTrue(path.exists(),'Saved download must outlive its temporary browser context')
        self.assertTrue(any(row['status']=='cancelled' for row in self.service.transfers.values()))

    async def test_human_can_answer_native_dialog_and_resume_cannot_hide_it_early(self):
        import asyncio
        epoch=str(uuid.uuid4());await self.call('_human_begin',{'epoch':epoch});await self.call('_human_open',{'epoch':epoch})
        pending=asyncio.create_task(self.page.evaluate("confirm('Synthetic human confirmation')"))
        for _ in range(100):
            if self.service.human_dialogs:break
            await asyncio.sleep(.01)
        self.assertTrue(self.service.human_dialogs);self.assertFalse(pending.done())
        with self.assertRaisesRegex(self.error,'Finish the open browser dialog'):await self.call('_human_end',{'epoch':epoch})
        dialog,_=next(iter(self.service.human_dialogs.values()));await dialog.accept()
        self.assertTrue(await pending)
        for _ in range(100):
            if not self.service.human_dialogs:break
            await asyncio.sleep(.01)
        self.assertFalse(self.service.human_dialogs)
        await self.call('_human_end',{'epoch':epoch})

    async def test_closing_browser_ends_pending_intervention_without_a_restart(self):
        epoch=str(uuid.uuid4());await self.call('_human_begin',{'epoch':epoch});await self.service.context.close()
        with self.assertRaisesRegex(self.error,'owned browser was closed'):await self.call('_human_poll',{'epoch':epoch})


if __name__ == "__main__":
    unittest.main(verbosity=2)
