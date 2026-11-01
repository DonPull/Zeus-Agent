"""Trusted managed-browser process. Only the supervisor writes this stdio pipe.

No actor source, CDP endpoint, filesystem path or launch arguments are accepted
by the action protocol. The first frame is supervisor-owned configuration.
"""
import asyncio
import hashlib
import importlib.metadata
import json
import mimetypes
import os
import re
from pathlib import Path
import sys
import time
import uuid
from urllib.parse import urlsplit

PROTOCOL = 1
SDK_VERSION = "1.62.0"
MAX_FRAME = 1024 * 1024
MAX_TEXT = 256 * 1024
MAX_IMAGE = 2 * 1024 * 1024
OPERATIONS = {"observe", "inspect", "navigate", "click", "fill", "press", "type_text", "select_option", "wait", "tabs", "new_tab", "select_tab", "close_tab", "dialog", "upload_file", "download"}
TRANSFER_LIMIT = 50 * 1024 * 1024

# Page-originated telemetry is observation, never an authorization channel.
HUMAN_OBSERVER = r"""(() => {
    let pendingInput=null,inputTimer,scrollTimer;
    const send=data=>Promise.resolve(window.__zeusObserveHuman(data)).catch(()=>{});
    const describe=e=>({tag:e?.tagName||'',name:(e?.getAttribute?.('aria-label')||e?.getAttribute?.('name')||e?.id||'').slice(0,100)});
    const flush=()=>{clearTimeout(inputTimer);if(pendingInput){const data=pendingInput;pendingInput=null;return send(data);}};
    window.__zeusFlushHuman=flush;
    addEventListener('click',e=>{if(!e.isTrusted)return;flush();send({op:'click',text:(e.target?.innerText||'').slice(0,100),target:describe(e.target),point:{x:e.clientX,y:e.clientY}});},true);
    addEventListener('input',e=>{if(!e.isTrusted)return;const t=e.target,masked=t?.type==='password';
        pendingInput={op:'input',text:masked?'[masked input]':String(t?.value??t?.innerText??'').slice(0,512),target:describe(t)};
        clearTimeout(inputTimer);inputTimer=setTimeout(flush,350);},true);
    addEventListener('keydown',e=>{if(!e.isTrusted||e.key.length===1&&!e.ctrlKey&&!e.altKey&&!e.metaKey)return;flush();send({op:'press',text:[e.ctrlKey?'Ctrl':null,e.altKey?'Alt':null,e.metaKey?'Meta':null,e.shiftKey?'Shift':null,e.key].filter(Boolean).join('+'),target:describe(e.target)});},true);
    addEventListener('scroll',()=>{clearTimeout(scrollTimer);scrollTimer=setTimeout(()=>send({op:'scroll',text:`${Math.round(scrollX)}, ${Math.round(scrollY)}`}),250);},true);
    addEventListener('pagehide',flush,true);addEventListener('blur',flush,true);
    addEventListener('focus',()=>send({op:'select_tab',text:''}));
})()"""


class OwnedWindow:
    """Only windows belonging to the browser PID obtained from its CDP pipe."""
    def __init__(self, pid):
        import ctypes
        from ctypes import wintypes
        self.ctypes, self.types, self.pid = ctypes, wintypes, pid
        self.api = ctypes.WinDLL('user32', use_last_error=True)
        self.api.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
        self.api.GetClassNameW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
        self.api.SetWindowPos.argtypes = [wintypes.HWND, wintypes.HWND, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, wintypes.UINT]
        self.api.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
        self.api.SetForegroundWindow.argtypes = [wintypes.HWND]

    def position(self, visible):
        windows=[]
        callback_type=self.ctypes.WINFUNCTYPE(self.types.BOOL,self.types.HWND,self.types.LPARAM)
        def visit(hwnd,_):
            pid=self.types.DWORD();self.api.GetWindowThreadProcessId(hwnd,self.ctypes.byref(pid))
            name=self.ctypes.create_unicode_buffer(128);self.api.GetClassNameW(hwnd,name,len(name))
            if pid.value==self.pid and name.value=='Chrome_WidgetWin_1':windows.append(hwnd)
            return True
        callback=callback_type(visit);self.api.EnumWindows(callback,0)
        if not windows:fail('BROWSER_WINDOW_MISSING','The owned browser window is no longer available')
        for hwnd in windows:
            self.api.ShowWindow(hwnd,4)  # non-minimized; hidden/minimized capture is slow
            flags=0x0010 | (0x0040 if visible else 0x0004)
            if not self.api.SetWindowPos(hwnd,None,80 if visible else -30000,80 if visible else -30000,1320,820,flags):
                fail('BROWSER_WINDOW_FAILED','Could not position the owned browser window')
        if visible:self.api.SetForegroundWindow(windows[0])


class BrowserError(Exception):
    def __init__(self, code, message):
        self.code, self.message = code, message
        super().__init__(message)


def fail(code, message):
    raise BrowserError(code, message)


def bounded_string(value, name, limit=8192):
    if not isinstance(value, str) or not value or len(value.encode("utf-8")) > limit:
        fail("BROWSER_ARGUMENT", f"Invalid {name}")
    return value


def emit(value):
    data = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(data) > MAX_FRAME:
        value = {"id": value.get("id"), "ok": False, "error": {"code": "BROWSER_RESPONSE_LIMIT", "message": "Response exceeded protocol limit"}}
        data = json.dumps(value).encode("utf-8")
    sys.stdout.buffer.write(data + b"\n")
    sys.stdout.buffer.flush()


async def read_frame():
    raw = await asyncio.to_thread(sys.stdin.buffer.readline, MAX_FRAME + 1)
    if not raw:
        return None
    if len(raw) > MAX_FRAME or not raw.endswith(b"\n"):
        fail("BROWSER_FRAME_LIMIT", "Invalid or oversized protocol frame")
    try:
        value = json.loads(raw)
    except (ValueError, UnicodeError):
        fail("BROWSER_PROTOCOL", "Invalid JSON frame")
    if not isinstance(value, dict):
        fail("BROWSER_PROTOCOL", "Expected an object")
    return value


def web_url(value):
    value = bounded_string(value, "URL")
    parsed = urlsplit(value)
    if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password:
        fail("BROWSER_URL", "Only HTTP(S) URLs without embedded credentials are supported")
    return value


def native_path(path):
    """Python file I/O needs a Windows long-path prefix for deep task roots.
    This is supervisor-owned storage, never a path chosen by an actor.
    """
    path=Path(path)
    if os.name=='nt':
        name=path.absolute().as_posix()
        if not name.startswith('//?/'):
            name='//?/UNC/'+name[2:] if name.startswith('//') else '//?/'+name
        return Path(name)
    return path


class Service:
    def __init__(self, config):
        self.config = config
        self.context = self.playwright = None
        self.pages, self.revisions, self.frames = {}, {}, {}
        self.selected = None
        self.seen, self.results = set(), {}
        self.capture_task = None
        self.closing = False
        self.preview_seq = 0
        self.capture_revision = 0
        self.capture_lock = asyncio.Lock()
        self.latest_capture = None
        self.capture_metrics = {"attempts": 0, "skipped": 0, "failures": 0}
        self.mailbox = Path(config["mailbox_dir"]) if config.get("mailbox_dir") else None
        self.dialog_policy, self.dialog_events = {}, {}
        self.network_events, self.network_seq = [], 0
        self.artifact_dir = Path(config["artifact_dir"])
        self.frame_dir = Path(config["frame_dir"]) if config.get("frame_dir") else None
        self.annotation = None
        self.annotation_target = None
        self.annotation_until = 0
        self.window = None
        self.human = None
        self.human_events = []
        self.human_seq = 0
        self.human_dropped = 0
        transfer_path=Path(config.get('transfer_dir',self.artifact_dir.parent/'transfers'))
        self.transfer_dir=native_path(transfer_path)
        # Chromium's downloadPath rejects the Win32 namespace prefix; Python's
        # deep-path file I/O requires it. Keep their representations separate.
        self.download_dir=transfer_path/'incoming'
        self.transfers={}
        self.download_tasks={}
        self.active_action=None
        self.human_dialogs={}
        self.dialog_sessions={}
        self.browser_disconnected=False

    def register(self, page):
        for key, existing in self.pages.items():
            if page is existing:
                return key
        if len(self.tab_list()) >= 16:
            asyncio.create_task(page.close())
            return None
        key = uuid.uuid4().hex
        self.pages[key], self.revisions[key] = page, 0
        def navigated(frame):
            self.revisions[key] = self.revisions.get(key, 0) + 1
            if self.human and frame is page.main_frame:
                self.record_human({'page':page,'frame':frame},{'op':'navigate','text':page.url[:512]})
        page.on("framenavigated", navigated)
        page.on('close', lambda: self.record_human({'page':page},{'op':'close_tab','text':''}))
        page.on("dialog", lambda dialog: self.handle_dialog(key, dialog))
        page.on('download',self.download_started)
        if self.context:
            asyncio.create_task(self.watch_dialogs(key,page))
        if self.selected is None:
            self.selected = key
        return key

    async def handle_dialog(self, tab_id, dialog):
        policy = self.dialog_policy.pop(tab_id, None)
        event = {"type": dialog.type, "expected": policy is not None, "handling": "pending"}
        events = self.dialog_events.setdefault(tab_id, [])
        events.append(event)
        del events[:-16]
        if self.human:
            event['handling']='human_pending'
            self.human_dialogs[tab_id]=(dialog,event)
            return  # a human must be allowed to answer the real native dialog
        try:
            if policy and policy["behavior"] == "accept":
                await dialog.accept(policy.get("prompt_text", ""))
                event["handling"] = "accepted"
            else:
                await dialog.dismiss()
                event["handling"] = "dismissed"
        except Exception:
            event["handling"] = "failed"

    async def watch_dialogs(self,tab,page):
        if tab in self.dialog_sessions:return
        self.dialog_sessions[tab]=None
        try:
            session=await self.context.new_cdp_session(page)
            def closed(data):
                waiting=self.human_dialogs.pop(tab,None)
                if waiting:waiting[1]['handling']='human_accepted' if data.get('result') else 'human_dismissed'
            session.on('Page.javascriptDialogClosed',closed)
            await session.send('Page.enable')
            self.dialog_sessions[tab]=session
        except Exception:
            self.dialog_sessions.pop(tab,None)

    async def start(self):
        try:
            sdk = importlib.metadata.version("playwright")
        except importlib.metadata.PackageNotFoundError:
            fail("BROWSER_RUNTIME_MISSING", "Playwright is missing from the isolated browser runtime; run the explicit setup command")
        if sdk != SDK_VERSION:
            fail("BROWSER_RUNTIME_VERSION", f"Managed browser requires Playwright {SDK_VERSION}")
        from playwright.async_api import async_playwright
        self.playwright = await async_playwright().start()
        executable = Path(self.playwright.chromium.executable_path)
        if not executable.is_file():
            fail("BROWSER_RUNTIME_MISSING", "Matching Playwright Chromium is not installed; run the browser-runtime setup command")
        profile = Path(self.config["profile_dir"])
        profile.mkdir(parents=True, exist_ok=True)
        self.artifact_dir.mkdir(parents=True, exist_ok=True)
        self.transfer_dir.mkdir(parents=True,exist_ok=True)
        (self.transfer_dir/'incoming').mkdir(exist_ok=True)
        windowed = os.name == 'nt' and self.config.get('window_mode') == 'offscreen'
        self.context = await self.playwright.chromium.launch_persistent_context(
            str(profile), headless=not windowed, viewport={"width": 1280, "height": 720},
            args=['--window-position=-30000,-30000'] if windowed else [],
            accept_downloads=True, downloads_path=str(self.download_dir), timeout=12000,
        )
        await self.context.expose_binding('__zeusObserveHuman',self.record_human)
        await self.context.add_init_script(HUMAN_OBSERVER)
        if windowed:
            cdp=await self.context.browser.new_browser_cdp_session()
            processes=(await cdp.send('SystemInfo.getProcessInfo'))['processInfo']
            self.window=OwnedWindow(int(next(p['id'] for p in processes if p['type']=='browser')))
            self.window.position(False)
            await cdp.detach()
        self.context.set_default_timeout(30000)
        self.context.on('close',lambda:setattr(self,'browser_disconnected',True))
        self.context.on("page", self.register)
        self.context.on("response", self.record_response)
        for page in self.context.pages:
            self.register(page)
        if not self.pages:
            self.register(await self.context.new_page())
        interval = self.config.get("capture_interval_ms", 1000 if self.mailbox else 0)
        if interval:
            if not isinstance(interval, int) or not 250 <= interval <= 5000:
                fail("BROWSER_ARGUMENT", "Invalid capture interval")
            self.capture_task = asyncio.create_task(self.capture(interval / 1000))
        import playwright
        manifest = json.loads((Path(playwright.__file__).parent / "driver/package/browsers.json").read_text())
        chromium = next(item for item in manifest["browsers"] if item["name"] == "chromium")
        if self.context.browser.version != chromium["browserVersion"]:
            fail("BROWSER_RUNTIME_VERSION", "Browser executable does not match the pinned SDK manifest")
        return {"protocol": PROTOCOL, "sdk": SDK_VERSION, "browser": self.context.browser.version, "browser_revision": chromium["revision"],
                "session_id": self.config["session_id"], "generation": self.config["generation"], "tabs": self.tab_list(),
                "handoff_supported": self.window is not None, "window_mode": 'offscreen' if windowed else 'headless'}

    def download_started(self, download):
        if len(self.transfers)>=64:
            asyncio.create_task(download.cancel());return
        identity=uuid.uuid4().hex
        name=re.sub(r'[^a-zA-Z0-9._-]','_',download.suggested_filename)[:120].strip('.') or 'download'
        self.transfers[identity]={'id':identity,'direction':'download','name':name,'status':'pending','action_id':None if self.human else self.active_action,'actor':'Human' if self.human else 'Agent','source':download.url[:2048]}
        self.download_tasks[download]=asyncio.create_task(self.save_download(download,identity,name),name=identity)

    async def save_download(self, download, identity, name):
        entry=self.transfers[identity]
        key=identity+'-'+name
        destination=self.transfer_dir/key
        task=asyncio.create_task(download.save_as(destination))
        try:
            while not task.done():
                await asyncio.wait({task},timeout=.1)
                incoming=0
                for path in (self.transfer_dir/'incoming').iterdir():
                    try:
                        if path.is_file():incoming+=path.stat().st_size
                    except FileNotFoundError:
                        pass  # completed downloads can remove their temporary file
                retained=sum(row.get('bytes',0) for row in self.transfers.values())
                if incoming>TRANSFER_LIMIT or retained+incoming>250*1024*1024:
                    await download.cancel();fail('BROWSER_TRANSFER_LIMIT','Download exceeded the file/session allowance')
            await task
            size=destination.stat().st_size
            if size>TRANSFER_LIMIT:fail('BROWSER_TRANSFER_LIMIT','Download exceeded 50 MiB')
            if sum(row.get('bytes',0) for row in self.transfers.values())+size>250*1024*1024:fail('BROWSER_TRANSFER_LIMIT','Session downloads exceeded 250 MiB')
            digest=await asyncio.to_thread(lambda:hashlib.sha256(destination.read_bytes()).hexdigest())
            entry.update(status='completed',key=key,bytes=size,sha256=digest,mime='application/octet-stream')
        except Exception as error:
            entry.update(status='cancelled' if entry.get('status')=='cancelled' else 'failed',error=str(error)[:500])
            try:destination.unlink(missing_ok=True)
            except OSError:pass
        finally:
            if not task.done():
                await download.cancel()
                try:await task
                except Exception:pass
        return dict(entry)

    def record_human(self, source, data):
        if not self.human or not isinstance(data,dict) or data.get('op') not in {'click','input','press','scroll','navigate','close_tab','select_tab'}:
            return
        page=source.get('page')
        tab=next((key for key,p in self.pages.items() if p is page),None)
        if tab is None:return
        self.human_seq+=1
        event={'seq':self.human_seq,'epoch':self.human,'actor':'Human','op':data['op'],'text':str(data.get('text',''))[:512],
               'tab_id':tab,'recorded_ms':int(time.time()*1000),'provenance':'page_observation_untrusted',
               'url':page.url[:2048],'target':str(data.get('target',{}))[:200]}
        event['frame_url']=source['frame'].url[:2048] if source.get('frame') else None
        event['coordinate_space']='frame_viewport'
        # Event coordinates do not establish the position in a later screenshot.
        # Retain them as evidence; do not draw them on unrelated post-event pixels.
        point=data.get('point')
        if isinstance(point,dict) and all(isinstance(point.get(k),(float,int)) and abs(point[k])<100000 for k in ('x','y')):
            event['event_point']=point
        self.human_events.append(event)
        if len(self.human_events)>64:
            self.human_events.pop(0);self.human_dropped+=1
        self.annotation={'actor':'Human','op':event['op'],'text':event['text'][:200],'tab_id':tab}
        self.annotation_target=None;self.annotation_until=time.monotonic()+1.5
        if not page.is_closed():self.selected=tab

    async def human_control(self, op, params, captures):
        if self.browser_disconnected:fail('BROWSER_SESSION_ENDED','The owned browser was closed; this live session cannot resume')
        if op=='_human_begin':
            if self.human:fail('BROWSER_HANDOFF_PENDING','An intervention is already pending')
            if not self.window:fail('BROWSER_HANDOFF_UNAVAILABLE','This browser was started without native handoff support')
            for tab,page in self.pages.items():
                if not page.is_closed():await self.watch_dialogs(tab,page)
            self.human=bounded_string(params.get('epoch'),'handoff identity',128)
            self.active_action=None
            self.human_events=[];self.human_dropped=0
            return {'phase':'requested'}
        if not self.human or params.get('epoch')!=self.human:
            fail('BROWSER_HANDOFF_STALE','This intervention is no longer active')
        if op=='_human_open':
            self.window.position(True)
            return {'phase':'open'}
        if op=='_human_capture':
            return {'capture':await self.boundary_capture(captures.get('after'),params)}
        if op=='_human_end':
            if self.human_dialogs:fail('BROWSER_HUMAN_DIALOG','Finish the open browser dialog before resuming Zeus')
            for page in self.pages.values():
                if not page.is_closed():
                    try:await page.evaluate('window.__zeusFlushHuman?.()')
                    except Exception:pass
            self.window.position(False)
        events,self.human_events=self.human_events,[]
        result={'events':events,'dropped':self.human_dropped,'transfers':list(self.transfers.values()),'coverage':'page actions only; browser chrome/native dialogs are outside recording; batched images are approximate'}
        self.human_dropped=0
        if events and captures.get('after'):
            result['capture']=await self.boundary_capture(captures['after'],{'tab_id':events[-1]['tab_id']})
        if op=='_human_end':
            self.human=None
            try:result['observation']=await self.execute('observe',{},5000)
            except Exception as error:result['observation_error']=str(error)[:500]
        return result

    def record_response(self, response):
        """Bounded generic request evidence, never raw bodies, headers or cookies."""
        try:
            request = response.request
            if request.method not in {"POST", "PUT", "PATCH", "DELETE"}:
                return
            data = request.post_data or ""
            parsed = urlsplit(response.url)
            safe_url = parsed._replace(netloc=parsed.netloc.rsplit("@", 1)[-1], query="", fragment="").geturl()[:2048]
            body = data.encode("utf-8") if len(data) <= 65536 else None
            tab_id = self.register(request.frame.page)
            self.network_seq += 1
            self.network_events.append({"seq": self.network_seq, "method": request.method, "url": safe_url,
                                        "status": response.status, "tab_id": tab_id,
                                        "body_sha256": hashlib.sha256(body).hexdigest() if body is not None and len(body) <= 65536 else None})
            del self.network_events[:-32]
        except Exception:
            pass

    def tab_list(self):
        return [{"tab_id": key, "url": page.url[:2048], "revision": self.revisions[key], "selected": key == self.selected}
                for key, page in self.pages.items() if not page.is_closed()]

    def page(self, params):
        tab_id = params.get("tab_id") or self.selected
        page = self.pages.get(tab_id)
        if page is None or page.is_closed():
            fail("BROWSER_TAB", "Unknown or closed tab")
        revision = params.get("revision")
        if revision is not None and revision != self.revisions[tab_id]:
            fail("BROWSER_STALE_TARGET", "Page navigated; observe again before acting")
        return tab_id, page

    def locator(self, page, params):
        target = params.get("target")
        if not isinstance(target, dict):
            fail("BROWSER_ARGUMENT", "A structured locator target is required")
        root = page
        if params.get("frame_id"):
            root = self.frames.get(params["frame_id"])
            if root is None or root not in page.frames or root.is_detached():
                fail("BROWSER_FRAME", "Unknown or detached frame")
        if set(target) <= {"role", "name", "exact"} and "role" in target:
            return root.get_by_role(bounded_string(target["role"], "role", 80), name=target.get("name"), exact=target.get("exact", True))
        if set(target) == {"text"}:
            return root.get_by_text(bounded_string(target["text"], "text", 2000), exact=True)
        if set(target) == {"test_id"}:
            return root.get_by_test_id(bounded_string(target["test_id"], "test ID", 2000))
        if set(target) == {"css"}:
            return root.locator(bounded_string(target["css"], "CSS selector", 2000))
        fail("BROWSER_ARGUMENT", "Use one supported role/text/test_id/css locator")

    async def screenshot(self, page, key, destination_dir=None, timeout=3000, quality=60):
        # All browser captures share one flight, including explicit observations.
        async with self.capture_lock:
            return await self.capture_image(page, key, destination_dir or self.artifact_dir, timeout, quality)

    async def capture_image(self, page, key, destination_dir, timeout, quality=60):
        started = int(time.time() * 1000)
        annotation = None
        box = None
        annotation_identity=self.annotation
        target=self.annotation_target
        if self.annotation and time.monotonic() < self.annotation_until and self.annotation.get('tab_id') == self.register(page):
            annotation = dict(self.annotation)
            if target is not None:
                try:
                    box = await target.bounding_box(timeout=100)
                except Exception:
                    if self.annotation_target is target:self.annotation_target=None
        # Preserve the browser's visible presentation, including native password
        # masking. Do not extract hidden password values for replay annotations.
        data = await page.screenshot(type="jpeg", quality=quality, timeout=timeout, scale="css")
        if self.annotation is not annotation_identity:
            annotation=None  # capture overlapped a different interaction
        if annotation and box and target is not None:
            try:
                after_box = await target.bounding_box(timeout=100)
                if box == after_box:
                    annotation['box'] = box
                    annotation['geometry'] = 'target_at_capture'
            except Exception:
                pass
        if len(data) > MAX_IMAGE:
            fail("BROWSER_IMAGE_LIMIT", "Screenshot exceeds artifact limit")
        destination = destination_dir / key
        temporary = destination.with_suffix(".tmp")
        temporary.write_bytes(data)
        os.replace(temporary, destination)
        tab = next((key for key, existing in self.pages.items() if existing is page), None)
        parsed = urlsplit(page.url)
        safe_url = parsed._replace(netloc=parsed.netloc.rsplit("@", 1)[-1], query="", fragment="").geturl()[:2048]
        return {"key": key, "mime": "image/jpeg", "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(),
                "tab_id": tab, "tab_revision": self.revisions.get(tab), "url": safe_url,
                "started_ms": started, "ended_ms": int(time.time() * 1000), "width": 1280, "height": 720,
                "quality": quality, "masking": "browser-visible", "annotation": annotation}

    def publish_capture(self, state, error=None):
        self.capture_revision += 1
        value = {"protocol": PROTOCOL, "task_id": self.config.get("task_id"), "run_id": self.config.get("run_id"),
                 "session_id": self.config["session_id"], "generation": self.config["generation"],
                 "revision": self.capture_revision, "state": state, "error": error,
                 "published_ms": int(time.time() * 1000), "frame": self.latest_capture,
                 "metrics": self.capture_metrics}
        data = json.dumps(value, separators=(",", ":")).encode("utf-8")
        if len(data) > 8192:
            fail("BROWSER_CAPTURE_LIMIT", "Capture descriptor exceeded its bound")
        temporary = self.mailbox / "capture.tmp"
        temporary.write_bytes(data)
        os.replace(temporary, self.mailbox / "capture.json")

    async def capture(self, interval):
        if self.mailbox:
            self.mailbox.mkdir(parents=True, exist_ok=True)
        while not self.closing:
            cycle_start = time.monotonic()
            delay = interval
            if self.mailbox:
                try:
                    with (self.mailbox / "viewer.json").open("rb") as stream:
                        heartbeat = json.loads(stream.read(129))
                    if heartbeat.get("until_ms", 0) > time.time() * 1000:
                        delay = 0.125  # Fixed viewed target: 8 FPS, no load adaptation.
                except (OSError, ValueError, TypeError):
                    pass
            try:
                if self.capture_lock.locked():
                    self.capture_metrics["skipped"] += 1
                elif self.mailbox:
                    self.capture_metrics["attempts"] += 1
                    tab, page = self.page({})
                    revision = self.revisions[tab]
                    artifact = await self.screenshot(page, f"slot-{(self.preview_seq + 1) % 2}.jpg", self.mailbox, quality=80)
                    if tab != self.selected or page.is_closed() or revision != self.revisions[tab]:
                        fail("BROWSER_CAPTURE_CHANGED", "Target changed during capture")
                    self.preview_seq += 1
                    parsed = urlsplit(page.url)
                    safe_url = parsed._replace(netloc=parsed.netloc.rsplit("@", 1)[-1], query="", fragment="").geturl()[:2048]
                    self.latest_capture = {**artifact, "seq": self.preview_seq, "tab_id": tab, "tab_revision": revision,
                                           "url": safe_url}
                    self.publish_capture("live")
            except Exception:
                self.capture_metrics["failures"] += 1
                if self.mailbox and not self.closing:
                    try:
                        self.publish_capture("no_tab" if not self.tab_list() else "capture_error", "BROWSER_CAPTURE_FAILED")
                    except OSError:
                        # Preserve the last atomic descriptor; collector freshness
                        # detects publication failure instead of inventing a frame.
                        pass
            await asyncio.sleep(max(0, delay - (time.monotonic() - cycle_start)))

    async def action(self, request):
        if request.get("protocol") != PROTOCOL or request.get("session_id") != self.config["session_id"] or request.get("generation") != self.config["generation"]:
            fail("BROWSER_IDENTITY", "Invalid protocol/session/generation")
        if request.get("token") != self.config["token"]:
            fail("BROWSER_AUTH", "Invalid supervisor token")
        if request.get('op') in {'_human_begin','_human_open','_human_poll','_human_end','_human_capture'}:
            result=await self.human_control(request['op'],request.get('params',{}),request.get('captures',{}))
            return {'id':request.get('id'),'ok':True,'result':result,'tabs':self.tab_list()}
        if self.human:
            fail('BROWSER_HUMAN_CONTROL','Agent browser operations are paused until the user resumes')
        action_id = bounded_string(request.get("id"), "action ID", 128)
        if action_id in self.seen:
            if action_id in self.results:
                return self.results[action_id]
            fail("BROWSER_DUPLICATE_ID", "Action ID has expired; it will not execute again")
        if len(self.seen) >= 5000:
            fail("BROWSER_ACTION_LIMIT", "Session action limit reached")
        params = request.get("params", {})
        if not isinstance(params, dict):
            fail("BROWSER_ARGUMENT", "Invalid action parameters")
        op = request.get("op")
        if op not in OPERATIONS:
            fail("BROWSER_UNSUPPORTED", "Operation is not supported by the managed browser")
        timeout = params.get("timeout_ms", 30000)
        if not isinstance(timeout, int) or isinstance(timeout, bool) or not 100 <= timeout <= 60000:
            fail("BROWSER_ARGUMENT", "Timeout must be 100–60000 milliseconds")
        self.seen.add(action_id)
        self.active_action=action_id
        self.annotation_target = None
        self.annotation = None
        if op in {'click', 'fill', 'press', 'type_text', 'select_option'}:
            tab, page = self.page(params)
            locator = self.locator(page, params)
            description = params.get('key', '') if op == 'press' else ''
            if op in {'fill', 'type_text', 'select_option'}:
                # Annotation collection is best effort and must not turn a
                # missing/stale locator into a service-process failure.
                description = '[input]'
                try:
                    identity = ((await locator.get_attribute('type', timeout=100) or '') + ' ' + (await locator.get_attribute('name', timeout=100) or '')).lower()
                    focused=page.locator('input:focus,textarea:focus')
                    if op=='type_text' and await focused.count():
                        identity+=' '+(await focused.first.get_attribute('type') or '')+' '+(await focused.first.get_attribute('name') or '')
                    description = '[masked input]' if any(word in identity.lower() for word in ('password', 'token', 'secret')) else str(params.get('value', ''))[:200]
                except Exception:
                    pass
            self.annotation = {'actor': 'Agent', 'op': op, 'text': description, 'tab_id': tab, 'action_id': action_id}
            self.annotation_until = time.monotonic() + timeout / 1000 + 3
            self.annotation_target = locator
        action_started=time.monotonic()
        captures = {}
        reservations = request.get("captures", {})
        if reservations.get("before"):
            captures["before"] = await self.boundary_capture(reservations["before"], params)
        execution_started=time.monotonic()
        try:
            result = await self.execute(op, params, timeout, reservations.get("explicit"))
            response = {"id": action_id, "ok": True, "result": result}
        except BrowserError as error:
            response = {"id": action_id, "ok": False, "error": {"code": error.code, "message": error.message}}
        except Exception as error:
            message = str(error)[:1500]
            if isinstance(params.get("value"), str) and params["value"]:
                message = message.replace(params["value"], "[redacted]")
            response = {"id": action_id, "ok": False, "error": {"code": "BROWSER_ACTION_FAILED", "message": message}}
        after_started=time.monotonic()
        # A post-action label describes the interaction, while the target outline
        # is remeasured against each capture; it never reuses a pre-navigation box.
        if reservations.get("after"):
            captures["after"] = await self.boundary_capture(reservations["after"], params)
        if captures:
            response["captures"] = captures
        response["tabs"] = self.tab_list()
        response['transfers']=list(self.transfers.values())
        self.active_action=None
        ended=time.monotonic()
        self.annotation_until = time.monotonic() + 1.5
        response['timing_ms']={'before_capture':round((execution_started-action_started)*1000,2),'execution':round((after_started-execution_started)*1000,2),'after_capture':round((ended-after_started)*1000,2),'total':round((ended-action_started)*1000,2)}
        self.results[action_id] = response
        if len(self.results) > 64:
            self.results.pop(next(iter(self.results)))
        return response

    async def boundary_capture(self, frame_id, params):
        acquired = False
        try:
            if str(uuid.UUID(frame_id)) != frame_id or self.frame_dir is None:
                fail("BROWSER_CAPTURE_IDENTITY", "Invalid capture reservation")
            # Do not queue a boundary behind a three-second periodic screenshot.
            await asyncio.wait_for(self.capture_lock.acquire(), timeout=0.1)
            acquired = True
            tab, page = self.page({"tab_id": params.get("tab_id")})
            revision = self.revisions[tab]
            image = await self.capture_image(page, frame_id + ".jpg", self.frame_dir, 900)
            if page.is_closed() or revision != self.revisions[tab]:
                fail("BROWSER_CAPTURE_CHANGED", "Page changed during capture")
            return {**image, "tab_id": tab, "tab_revision": revision}
        except Exception:
            return {"error": "BROWSER_CAPTURE_UNAVAILABLE"}
        finally:
            if acquired:
                self.capture_lock.release()

    def validate_check(self, spec):
        if not isinstance(spec, dict) or set(spec)-{'target','state','condition','settle_ms'} or not isinstance(spec.get('target'),dict):
            fail('BROWSER_ARGUMENT','A readiness/result check needs a supported target')
        target=spec['target']
        if set(target) not in ({'css'},{'text'},{'role','name'},{'test_id'}) or any(not isinstance(value,str) or not value or len(value.encode())>2000 for value in target.values()):
            fail('BROWSER_ARGUMENT','Invalid readiness/result locator')
        if spec.get('state','visible') not in {'visible','hidden','attached','detached'}:
            fail('BROWSER_ARGUMENT','Invalid check state')
        settle=spec.get('settle_ms',0)
        if not isinstance(settle,int) or isinstance(settle,bool) or not 0<=settle<=2000:
            fail('BROWSER_ARGUMENT','settle_ms must be 0–2000')
        condition=spec.get('condition')
        if condition is not None:
            if not isinstance(condition,dict) or set(condition)-{'kind','value','name','match'} or condition.get('kind') not in {'text','value','attribute','enabled','disabled'}:
                fail('BROWSER_ARGUMENT','Invalid check condition')
            if condition.get('match','contains') not in {'contains','equals'}:
                fail('BROWSER_ARGUMENT','Invalid text matching mode')
            if condition['kind'] in {'text','value','attribute'} and (not isinstance(condition.get('value'),str) or len(condition['value'].encode())>2000):
                fail('BROWSER_ARGUMENT','Check value must be at most 2000 bytes')
            name=condition.get('name','')
            if condition['kind']=='attribute' and (not isinstance(name,str) or not __import__('re').fullmatch(r'(?:data-|aria-)[a-zA-Z0-9_-]{1,80}',name)):
                fail('BROWSER_ARGUMENT','Attribute checks support data-* and aria-* attributes')

    async def check_state(self, page, params, spec, deadline):
        from playwright.async_api import expect
        locator=self.locator(page,{**params,'target':spec['target']})
        async def check():
            remaining=max(1,int((deadline-time.monotonic())*1000))
            condition=spec.get('condition')
            if not condition:
                await locator.wait_for(state=spec.get('state','visible'),timeout=remaining)
            elif condition['kind']=='text':
                if condition.get('match','contains')=='equals':await expect(locator).to_have_text(condition['value'],timeout=remaining)
                else:await expect(locator).to_contain_text(condition['value'],timeout=remaining)
            elif condition['kind']=='value':await expect(locator).to_have_value(condition['value'],timeout=remaining)
            elif condition['kind']=='attribute':await expect(locator).to_have_attribute(condition['name'],condition['value'],timeout=remaining)
            elif condition['kind']=='enabled':await expect(locator).to_be_enabled(timeout=remaining)
            else:await expect(locator).to_be_disabled(timeout=remaining)
        await check()
        settle=spec.get('settle_ms',0)/1000
        if settle:
            if time.monotonic()+settle>deadline:fail('BROWSER_WAIT_TIMEOUT','Settling exceeded this action deadline')
            await asyncio.sleep(settle)
            await check()

    async def execute(self, op, params, timeout, screenshot_id=None):
        deadline=time.monotonic()+timeout/1000
        mutable=op in {'navigate','click','fill','press','type_text','select_option','upload_file','download'}
        for name in ('ready','expect'):
            if name in params:
                if not mutable:fail('BROWSER_ARGUMENT','Readiness/result checks belong to an interaction')
                self.validate_check(params[name])
        if 'condition' in params or 'settle_ms' in params:
            if op!='wait':fail('BROWSER_ARGUMENT','condition/settle_ms belongs to wait or a check')
            self.validate_check({key:params[key] for key in ('target','state','condition','settle_ms') if key in params})
        if op == "tabs":
            return {"tabs": self.tab_list()}
        if op == "new_tab":
            if len(self.tab_list()) >= 16:
                fail("BROWSER_TAB_LIMIT", "Managed sessions allow at most 16 tabs")
            page = await self.context.new_page()
            tab_id = self.register(page)
            self.selected = tab_id
            return {"tab_id": tab_id, "tabs": self.tab_list()}
        tab_id, page = self.page(params)
        if params.get('ready'):
            try:await self.check_state(page,params,params['ready'],deadline)
            except Exception as error:fail('BROWSER_NOT_READY',f'Readiness check did not pass; interaction was not sent. {str(error)[:700]}')
        timeout=max(1,int((deadline-time.monotonic())*1000))
        if params.get("tab_id") and op not in {"observe", "inspect", "wait", "dialog"}:
            self.selected = tab_id
        if op == "select_tab":
            self.selected = tab_id
        elif op == "close_tab":
            await page.close()
            if self.selected == tab_id:
                self.selected = next((key for key, p in self.pages.items() if not p.is_closed()), None)
        elif op == "navigate":
            response = await page.goto(web_url(params.get("url")), wait_until="domcontentloaded", timeout=timeout)
            await self.verify_result(page,params,deadline)
            return {"tab_id": tab_id, "revision": self.revisions[tab_id], "url": page.url[:8192], "http_status": response.status if response else None}
        elif op == "observe":
            text = await page.locator("body").inner_text(timeout=timeout)
            encoded = text.encode("utf-8")
            text = encoded[:MAX_TEXT // 2].decode("utf-8", errors="ignore")
            semantic = await self.semantic_snapshot(tab_id,page,timeout)
            semantic_bytes = semantic.encode("utf-8")
            semantic = semantic_bytes[:MAX_TEXT // 2].decode("utf-8", errors="ignore")
            self.frames = {key: frame for key, frame in self.frames.items() if not frame.is_detached()}
            frames = []
            for frame in page.frames[:100]:
                if frame is page.main_frame:
                    continue
                key = next((key for key, existing in self.frames.items() if existing is frame), None) or uuid.uuid4().hex
                self.frames[key] = frame
                frames.append({"frame_id": key, "url": frame.url[:2048], "name": frame.name[:200]})
            result = {"tab_id": tab_id, "revision": self.revisions[tab_id], "url": page.url[:8192], "title": (await page.title())[:2048],
                      "text": text, "semantic": semantic, "truncated": len(encoded) > MAX_TEXT // 2 or len(semantic_bytes) > MAX_TEXT // 2,
                      "frames": frames, "frames_truncated": len(page.frames)>100, "dialogs": self.dialog_events.get(tab_id, []),
                      "network_events": list(self.network_events), "untrusted_page_content": True}
            result['transfers']=list(self.transfers.values())
            if params.get("screenshot", False):
                try:
                    if not screenshot_id or str(uuid.UUID(screenshot_id)) != screenshot_id:
                        fail("BROWSER_ARCHIVE_QUOTA", "No screenshot reservation is available")
                    result["artifact"] = await self.screenshot(page, f"{uuid.UUID(screenshot_id).hex}.jpg")
                except Exception:
                    result["artifact_error"] = "BROWSER_CAPTURE_FAILED" if screenshot_id else "BROWSER_ARCHIVE_QUOTA"
            return result
        elif op == "inspect":
            locator = self.locator(page, params)
            total = await locator.count()
            # This is fixed trusted inspection code, never caller JavaScript.
            values = await locator.all() if total <= 20 else [locator.nth(i) for i in range(20)]
            elements = []
            for element in values:
                data = await element.evaluate("""element => {
                    const style=getComputedStyle(element), rect=element.getBoundingClientRect();
                    const attributes={};
                    for(const name of ['role','aria-label','aria-selected','aria-checked','aria-expanded','aria-disabled','data-state','data-status','class','type']){
                        const value=element.getAttribute(name);if(value!==null)attributes[name]=value.slice(0,500);
                    }
                    return {text:(element.innerText||'').slice(0,500),attributes,
                        visible:rect.width>0&&rect.height>0&&style.display!=='none'&&style.visibility!=='hidden',
                        enabled:!element.disabled&&element.getAttribute('aria-disabled')!=='true',
                        box:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},
                        colors:{foreground:style.color,background:style.backgroundColor,border:style.borderColor},
                        coordinate_space:'frame_viewport'};
                }""", timeout=timeout)
                if len(json.dumps(elements + [data]).encode('utf-8')) > 32768:
                    break
                elements.append(data)
            return {"tab_id": tab_id, "revision": self.revisions[tab_id], "elements": elements,
                    "matched": total, "truncated": len(elements) < total, "untrusted_page_content": True}
        elif op in {"click", "fill", "press", "type_text", "select_option", "wait", "upload_file", "download"}:
            locator = self.locator(page, params)
            if op == "click":
                await locator.click(timeout=timeout)
            elif op=='upload_file':
                file=params.get('_file',{})
                key=file.get('key','')
                if not re.fullmatch(r'[a-f0-9]{32}\.upload',key):fail('BROWSER_UPLOAD_IDENTITY','Missing supervisor-owned upload snapshot')
                path=self.transfer_dir/key
                if path.is_symlink() or path.resolve().parent!=self.transfer_dir.resolve():fail('BROWSER_UPLOAD_IDENTITY','Invalid snapshot ownership')
                with path.open('rb') as source:data=source.read(TRANSFER_LIMIT+1)
                if len(data)>TRANSFER_LIMIT or len(data)!=file.get('bytes') or hashlib.sha256(data).hexdigest()!=file.get('sha256'):
                    fail('BROWSER_UPLOAD_CHANGED','Upload snapshot changed after authorization')
                name=bounded_string(file.get('name'),'file name',240)
                await locator.set_input_files({'name':name,'mimeType':mimetypes.guess_type(name)[0] or 'application/octet-stream','buffer':data},timeout=timeout)
                await self.verify_result(page,params,deadline)
                return {'tab_id':tab_id,'upload':{'name':file['name'],'bytes':len(data),'sha256':file['sha256'],'status':'selected','server_acceptance':'expected_state_confirmed' if params.get('expect') else 'not_verified'}}
            elif op=='download':
                async with page.expect_download(timeout=timeout) as pending:
                    await locator.click(timeout=timeout)
                download=await pending.value
                task=self.download_tasks.get(download)
                if task is None:fail('BROWSER_TRANSFER_LIMIT','Download tracking allowance exhausted')
                try:result=await asyncio.wait_for(asyncio.shield(task),max(.001,deadline-time.monotonic()))
                except asyncio.TimeoutError:fail('BROWSER_TRANSFER_PENDING','Download is still in progress; observe its state instead of clicking again')
                if result['status']!='completed':fail('BROWSER_DOWNLOAD_FAILED',result.get('error','Download was not completed'))
                return {'tab_id':tab_id,'download':result}
            elif op in {"fill","type_text"}:
                field_type = (await locator.get_attribute("type", timeout=timeout) or "").lower()
                name = (await locator.get_attribute("name", timeout=timeout) or "").lower()
                if field_type == "password" or any(word in name for word in ("password", "token", "secret")):
                    fail("BROWSER_SENSITIVE_INPUT", "Use ask_user_for_login for human entry in the owned browser")
                value = params.get("value")
                if not isinstance(value, str) or len(value.encode("utf-8")) > 65536:
                    fail("BROWSER_ARGUMENT", "Invalid fill value")
                if op=='fill':await locator.fill(value,timeout=timeout)
                else:
                    if len(value)>8192:fail('BROWSER_ARGUMENT','type_text supports at most 8192 characters')
                    await locator.wait_for(state='visible',timeout=timeout)
                    # Keyboard widgets may target body while an input has focus.
                    active=await page.locator('input:focus,textarea:focus').count()
                    if active:
                        focused=page.locator('input:focus,textarea:focus').first
                        identity=((await focused.get_attribute('type') or '')+' '+(await focused.get_attribute('name') or '')).lower()
                        if any(word in identity for word in ('password','token','secret')):fail('BROWSER_SENSITIVE_INPUT','Sensitive focused input requires supervised handoff')
                    try:await locator.press_sequentially(value,timeout=max(1,int((deadline-time.monotonic())*1000)))
                    except Exception:fail('BROWSER_INPUT_UNCERTAIN','Input may be partial. Inspect its current value before entering it again.')
            elif op == "press":
                await locator.press(bounded_string(params.get("key"), "key", 100), timeout=timeout)
            elif op == "select_option":
                await locator.select_option(bounded_string(params.get("value"), "option", 2000), timeout=timeout)
            else:
                spec={key:params[key] for key in ('target','state','condition','settle_ms') if key in params}
                self.validate_check(spec)
                await self.check_state(page,params,spec,deadline)
            await self.verify_result(page,params,deadline)
        elif op == "dialog":
            behavior = params.get("behavior")
            if behavior not in {"accept", "dismiss"}:
                fail("BROWSER_ARGUMENT", "Dialog behavior must be accept or dismiss")
            prompt_text = params.get("prompt_text", "")
            if not isinstance(prompt_text, str) or len(prompt_text.encode("utf-8")) > 8192:
                fail("BROWSER_ARGUMENT", "Invalid dialog prompt text")
            self.dialog_policy[tab_id] = {"behavior": behavior, "prompt_text": prompt_text}
            return {"tab_id": tab_id, "dialog_policy": "prepared_for_next_dialog", "behavior": behavior}
        return {"tab_id": tab_id, "revision": self.revisions[tab_id], "tabs": self.tab_list(), "dialogs": self.dialog_events.get(tab_id, [])}

    async def semantic_snapshot(self,tab,page,timeout):
        # Playwright's DOM-derived aria_snapshot includes plaintext password
        # values. Use native AX names/states, and separately read visible,
        # non-password field values. Never read the value of a masked field.
        session=self.dialog_sessions.get(tab)
        temporary=session is None
        if temporary:session=await self.context.new_cdp_session(page)
        try:
            tree=await asyncio.wait_for(session.send('Accessibility.getFullAXTree'),timeout/1000)
        finally:
            if temporary:await session.detach()
        lines=[];used=0
        for node in tree.get('nodes',[]):
            if node.get('ignored'):continue
            role=node.get('role',{}).get('value','')
            name=str(node.get('name',{}).get('value',''))[:2000]
            if role in {'none','generic','StaticText','InlineTextBox','RootWebArea'}:continue
            states={prop['name']:prop.get('value',{}).get('value') for prop in node.get('properties',[]) if prop['name'] in {'checked','expanded','selected','disabled','focused','level','required'}}
            line='- '+role+(' '+json.dumps(name,ensure_ascii=False) if name else '')+(' '+json.dumps(states) if states else '')
            used+=len(line.encode('utf8'))
            if used>MAX_TEXT//3:lines.append('[Semantic snapshot truncated]');break
            lines.append(line)
        values=await page.locator('input,textarea,select,[contenteditable="true"]').evaluate_all('''elements=>elements.filter(e=>{
            const style=getComputedStyle(e),box=e.getBoundingClientRect();
            return e.type!=='password'&&e.type!=='hidden'&&style.display!=='none'&&style.visibility!=='hidden'&&box.width>0&&box.height>0;
        }).slice(0,20).map(e=>({label:(e.getAttribute('aria-label')||Array.from(e.labels||[]).map(l=>l.innerText).join(' ')||e.name||e.id||'').slice(0,200),
            text:String(e.value??e.innerText??'').slice(0,512)}))''')
        if values:lines.append('Visible non-password fields: '+json.dumps(values,ensure_ascii=False))
        return '\n'.join(lines)

    async def verify_result(self,page,params,deadline):
        if params.get('expect'):
            try:await self.check_state(page,params,params['expect'],deadline)
            except Exception as error:fail('BROWSER_OUTCOME_UNCONFIRMED',f'Interaction was sent but the expected result was not confirmed. Do not automatically repeat it; inspect actual state. {str(error)[:700]}')

    async def close(self):
        self.closing = True
        # Cancel incomplete downloads before closing their temporary context;
        # completed files have already been copied to owned task storage.
        for download,task in self.download_tasks.items():
            if not task.done():
                self.transfers[task.get_name()]['status']='cancelled'
                try:await download.cancel()
                except Exception:pass
        if self.download_tasks:
            await asyncio.gather(*self.download_tasks.values(),return_exceptions=True)
        # Do not cancel a coroutine inside a Playwright call. Context closure
        # terminates its operations; the supervisor enforces the outer deadline.
        if self.context:
            await self.context.close()
        if self.capture_task:
            await self.capture_task
        if self.playwright:
            await self.playwright.stop()


async def main():
    service = None
    try:
        config = await read_frame()
        if not config or config.get("op") != "start" or config.get("protocol") != PROTOCOL:
            fail("BROWSER_PROTOCOL", "Expected supervisor startup configuration")
        for field in ("session_id", "token", "profile_dir", "artifact_dir"):
            bounded_string(config.get(field), field)
        if config.get("generation") != 1:
            fail("BROWSER_IDENTITY", "Unsupported generation")
        service = Service(config)
        emit({"id": "ready", "ok": True, "result": await service.start()})
        while True:
            request = await read_frame()
            if request is None:
                break
            if request.get("op") == "shutdown" and request.get("token") == config["token"]:
                await service.close()
                transfers=list(service.transfers.values())
                service = None
                emit({"id": request.get("id"), "ok": True, "result": {"closed": True,'transfers':transfers}})
                break
            try:
                emit(await service.action(request))
            except BrowserError as error:
                emit({"id": request.get("id"), "ok": False, "error": {"code": error.code, "message": error.message}})
            except Exception as error:
                emit({"id":request.get('id'),'ok':False,'error':{'code':'BROWSER_CONTROL_FAILED','message':type(error).__name__}})
    except Exception as error:
        code = error.code if isinstance(error, BrowserError) else "BROWSER_STARTUP_FAILED"
        message = error.message if isinstance(error, BrowserError) else type(error).__name__
        emit({"id": "ready", "ok": False, "error": {"code": code, "message": message}})
    finally:
        if service:
            try:
                await service.close()
            except Exception:
                print("Managed browser cleanup failed; supervisor must reap its owned process tree", file=sys.stderr)


if __name__ == "__main__":
    asyncio.run(main())
