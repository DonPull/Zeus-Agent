# Shared browser runtime

Phase 3C uses one shared owner for normal Solo/Team browser work. There is no browser-engine selector or `ZEUS_MANAGED_BROWSER` opt-in. Older history readers never execute a browser. See [current delivery and acceptance](../../docs/PHASE_3C_WORK_LOG.md).

Prepare an isolated environment explicitly from the repository root:

```powershell
python scripts/browser_service/setup_runtime.py --destination .zeus/browser-runtime/venv --install
# Needed if this SDK's matching browser is not already installed:
.zeus/browser-runtime/venv/Scripts/python.exe -m playwright install chromium
```

Dependencies are pinned in `requirements.txt`. Setup does not modify global Python packages; it does download dependencies when `--install` is given. Tests/app never install implicitly. Playwright and the actual Chromium version must match the pinned manifest. CI uses Python 3.11 on Windows.

Set **Global settings → Browser → Browser runtime Python** to the absolute path of the prepared interpreter and save. The app-owned default is `browser-runtime/venv/Scripts/python.exe` under Zeus's app workspace (`venv/bin/python` on POSIX). A debug build can also discover this checkout's explicitly prepared `.zeus/browser-runtime/venv`. Packaged builds cannot depend on a repository checkout. No environment override is required.

Then launch normally:

```powershell
npm.cmd run tauri dev
```

`ZEUS_BROWSER_PYTHON` remains an explicit development interpreter override, not an engine choice. Zeus never falls back to global Python or installs dependencies implicitly. Runtime setup is frozen at root-run acceptance; a setting change applies to the next run. Missing or mismatched setup returns a typed error. Text/data-only work needs no browser installation.

Profiles belong to Zeus tasks, with no automatic imports or extensions. Master/workers/scripts share the same context for a root run. A later user turn creates another session using the task's retained profile. Script/worker exit releases control, not the browser. Completion and Stop join browser cleanup. Watch shows sampled current pixels; Replay shows actual requests/outcomes and available before/after evidence. History, export and explicit image deletion are available without starting a browser. Sampling is not a video or a guarantee that the user's goal succeeded.

Actors use one directive per turn:

````text
```zeus-directive
{"type":"browser_action","op":"navigate","params":{"url":"https://example.com"}}
```
````

Or use the injected client inside an approved Zeus Python action:

```python
from zeus_browser import call
page = call('observe')
call('fill', target={'role': 'textbox', 'name': 'Search'}, value='example')
call('press', target={'role': 'textbox', 'name': 'Search'}, key='Enter')
```

Operations: observe, inspect, navigate, click, fill, press, select_option, wait, tabs, new_tab, select_tab, close_tab and prepared dialog handling. The coordinator can take control; callers can release it. Use returned tab/frame/revision handles for scoped targets. Read-only inspection does not change the automation's selected tab. Explicit screenshots reach the calling role's configured direct/helper image route once; passive viewing uses no model calls. Optional stable action UUIDs support retrieving the same recorded request without executing it twice; unknown outcomes never authorize a new automatic mutation.

No raw CDP, arbitrary page evaluation, custom launches, default-profile takeover, login handoff, extensions or file transfers are implemented on this path. Unsupported operations fail explicitly. Arbitrary host Python remains subject to the existing policy and is not sandboxed by this service.

Run the real service probes without an LLM:

```powershell
.zeus/browser-runtime/venv/Scripts/python.exe tests/browser_service/test_service.py
node scripts/run_regression.js
```

Full setup, regression and bounded live commands: [evaluation guide](../eval_harness/README.md).
