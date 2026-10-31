"""Trusted managed-browser process. Only the supervisor writes this stdio pipe.

No actor source, CDP endpoint, filesystem path or launch arguments are accepted
by the action protocol. The first frame is supervisor-owned configuration.
"""
import asyncio
import hashlib
import importlib.metadata
import json
import os
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
OPERATIONS = {"observe", "inspect", "navigate", "click", "fill", "press", "select_option", "wait", "tabs", "new_tab", "select_tab", "close_tab", "dialog"}


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

    def register(self, page):
        for key, existing in self.pages.items():
            if page is existing:
                return key
        if len(self.tab_list()) >= 16:
            asyncio.create_task(page.close())
            return None
        key = uuid.uuid4().hex
        self.pages[key], self.revisions[key] = page, 0
        page.on("framenavigated", lambda _: self.revisions.__setitem__(key, self.revisions.get(key, 0) + 1))
        page.on("dialog", lambda dialog: self.handle_dialog(key, dialog))
        if self.selected is None:
            self.selected = key
        return key

    async def handle_dialog(self, tab_id, dialog):
        policy = self.dialog_policy.pop(tab_id, None)
        event = {"type": dialog.type, "expected": policy is not None, "handling": "pending"}
        events = self.dialog_events.setdefault(tab_id, [])
        events.append(event)
        del events[:-16]
        try:
            if policy and policy["behavior"] == "accept":
                await dialog.accept(policy.get("prompt_text", ""))
                event["handling"] = "accepted"
            else:
                await dialog.dismiss()
                event["handling"] = "dismissed"
        except Exception:
            event["handling"] = "failed"

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
        self.context = await self.playwright.chromium.launch_persistent_context(
            str(profile), headless=True, viewport={"width": 1280, "height": 720},
            accept_downloads=False, timeout=12000,
        )
        self.context.set_default_timeout(30000)
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
                "session_id": self.config["session_id"], "generation": self.config["generation"], "tabs": self.tab_list()}

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

    async def screenshot(self, page, key, destination_dir=None, timeout=3000):
        # All browser captures share one flight, including explicit observations.
        async with self.capture_lock:
            return await self.capture_image(page, key, destination_dir or self.artifact_dir, timeout)

    async def capture_image(self, page, key, destination_dir, timeout):
        started = int(time.time() * 1000)
        masks = [frame.locator('input[type="password"], input[autocomplete*="password"], input[name*="token" i], input[name*="secret" i]') for frame in page.frames[:100] if not frame.is_detached()]
        data = await page.screenshot(type="jpeg", quality=60, timeout=timeout, mask=masks, scale="css")
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
                "masking": "known-sensitive-inputs"}

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
            try:
                if self.capture_lock.locked():
                    self.capture_metrics["skipped"] += 1
                elif self.mailbox:
                    self.capture_metrics["attempts"] += 1
                    tab, page = self.page({})
                    revision = self.revisions[tab]
                    artifact = await self.screenshot(page, f"slot-{(self.preview_seq + 1) % 2}.jpg", self.mailbox)
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
            delay = interval
            if self.mailbox:
                try:
                    with (self.mailbox / "viewer.json").open("rb") as stream:
                        heartbeat = json.loads(stream.read(129))
                    if heartbeat.get("until_ms", 0) > time.time() * 1000:
                        delay = min(delay, 0.5)
                except (OSError, ValueError, TypeError):
                    pass
            await asyncio.sleep(delay)

    async def action(self, request):
        if request.get("protocol") != PROTOCOL or request.get("session_id") != self.config["session_id"] or request.get("generation") != self.config["generation"]:
            fail("BROWSER_IDENTITY", "Invalid protocol/session/generation")
        if request.get("token") != self.config["token"]:
            fail("BROWSER_AUTH", "Invalid supervisor token")
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
        captures = {}
        reservations = request.get("captures", {})
        if reservations.get("before"):
            captures["before"] = await self.boundary_capture(reservations["before"], params)
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
        if reservations.get("after"):
            captures["after"] = await self.boundary_capture(reservations["after"], params)
        if captures:
            response["captures"] = captures
        response["tabs"] = self.tab_list()
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

    async def execute(self, op, params, timeout, screenshot_id=None):
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
            return {"tab_id": tab_id, "revision": self.revisions[tab_id], "url": page.url[:8192], "http_status": response.status if response else None}
        elif op == "observe":
            text = await page.locator("body").inner_text(timeout=timeout)
            encoded = text.encode("utf-8")
            text = encoded[:MAX_TEXT // 2].decode("utf-8", errors="ignore")
            semantic = await page.locator("body").aria_snapshot(timeout=timeout)
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
        elif op in {"click", "fill", "press", "select_option", "wait"}:
            locator = self.locator(page, params)
            if op == "click":
                await locator.click(timeout=timeout)
            elif op == "fill":
                field_type = (await locator.get_attribute("type", timeout=timeout) or "").lower()
                name = (await locator.get_attribute("name", timeout=timeout) or "").lower()
                if field_type == "password" or any(word in name for word in ("password", "token", "secret")):
                    fail("BROWSER_SENSITIVE_INPUT", "Sensitive input requires the later supervised handoff capability")
                value = params.get("value")
                if not isinstance(value, str) or len(value.encode("utf-8")) > 65536:
                    fail("BROWSER_ARGUMENT", "Invalid fill value")
                await locator.fill(value, timeout=timeout)
            elif op == "press":
                await locator.press(bounded_string(params.get("key"), "key", 100), timeout=timeout)
            elif op == "select_option":
                await locator.select_option(bounded_string(params.get("value"), "option", 2000), timeout=timeout)
            else:
                state = params.get("state", "visible")
                if state not in {"visible", "hidden", "attached", "detached"}:
                    fail("BROWSER_ARGUMENT", "Invalid wait state")
                await locator.wait_for(state=state, timeout=timeout)
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

    async def close(self):
        self.closing = True
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
                service = None
                emit({"id": request.get("id"), "ok": True, "result": {"closed": True}})
                break
            try:
                emit(await service.action(request))
            except BrowserError as error:
                emit({"id": request.get("id"), "ok": False, "error": {"code": error.code, "message": error.message}})
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
