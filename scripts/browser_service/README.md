# Shared browser runtime

Phase 3C uses one shared owner for normal Solo/Team browser work. There is no browser-engine selector or `ZEUS_MANAGED_BROWSER` opt-in. Older history readers never execute a browser. See [current delivery and acceptance](../../docs/PHASE_3C_WORK_LOG.md).

Prepare an isolated environment explicitly from the repository root:

```powershell
python scripts/browser_service/setup_runtime.py --destination .zeus/browser-runtime/venv --install --extensions
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

Profiles belong to Zeus tasks, with no automatic personal-profile imports. The trusted runtime preloads its audio controller and, by default, pinned official uBlock Origin Lite (2026.1026.1812, GPL-3.0 upstream). `--extensions` explicitly downloads and verifies that release; the app never downloads or updates it implicitly. Ad blocking can be disabled in global settings for compatibility. Missing/changed required assets fail explicitly. Agent-controlled sound is blocked by default, enabled during an opened handoff, and restored on Resume; a setting permits agent audio. The page viewport is 1600×900 CSS pixels at scale/DPR 1.

Master/workers/scripts share the same context for a root run. A later user turn creates another session using the task's retained profile. Script/worker exit releases control, not the browser. Completion and Stop join browser cleanup. Watch shows current pixels at a fixed viewed target of 8 FPS/JPEG quality 80, without adaptive throttling. Replay shows actual requests/outcomes and sampled before/after evidence, not an 8-FPS stored video. History and explicit image deletion are available without starting a browser. Diagnostic export remains internal. Sampling is not a guarantee that the user's goal succeeded.

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

Operations: observe, inspect, navigate, click, fill, press, type_text, select_option, wait, tabs, new_tab, select_tab, close_tab and prepared dialog handling. The coordinator can take control; callers can release it. Use returned tab/frame/revision handles for scoped targets. Read-only inspection does not change the automation's selected tab. Explicit screenshots reach the calling role's configured direct/helper image route once; passive viewing uses no model calls. Optional stable action UUIDs support retrieving the same recorded request without executing it twice; unknown outcomes never authorize a new automatic mutation.

For keyboard-driven widgets, `call('type_text', target={'css':'#board'}, value='example')` sends a whole string rather than one broker request per letter. Prefer `fill` for ordinary inputs. Readiness and confirmation belong to the actual page, for example:

```python
call('click', target={'role':'button','name':'Save'}, timeout_ms=5000,
     ready={'target':{'css':'#form'},
            'condition':{'kind':'attribute','name':'data-ready','value':'true'},
            'settle_ms':100},
     expect={'target':{'role':'status'},
             'condition':{'kind':'text','value':'Saved','match':'equals'}})
```

`wait` also accepts `condition` and optional `settle_ms`. Text, input value, `data-*`/`aria-*` attributes and enabled/disabled conditions are supported. Checks and the interaction share one deadline. Settling is explicit and bounded, not a universal sleep. Visibility/actionability alone cannot guarantee hydration: choose relevant page signals and verify the intended result. If the result is unconfirmed or text entry may be partial, inspect actual state before deciding whether any repeat is safe. Zeus does not automatically retry the mutation. See [Playwright hydration guidance](https://playwright.dev/python/docs/navigations#hydration) and [actionability](https://playwright.dev/python/docs/actionability).

No raw CDP, arbitrary page evaluation, custom launches, default-profile takeover or extensions are exposed to actors. Unsupported operations fail explicitly. Arbitrary host Python remains subject to the existing policy and is not sandboxed by this service.

On Windows, ordinary sessions now use full Chromium offscreen without minimizing or hiding its native window. An agent's `ask_user_for_login` request produces Open browser / Resume Zeus / Stop run controls for that same process, context and tabs. Agent operations pause while page capture/observation continue. Pending native dialogs block Resume. An explicit `ZEUS_BROWSER_WINDOW_MODE=headless` diagnostic override is recorded per run; it does not support native handoff. Other platforms currently retain that headless limitation.

`call('upload_file', target={'css':'input[type=file]'}, path='report.pdf')` selects a validated, snapshotted task-workspace file under normal policy. Selection is distinct from server acceptance; use `expect` for relevant page confirmation. `call('download', target={'text':'Export CSV'})` waits for real bytes and returns a verified retained task path. Ordinary clicks/human downloads are also tracked. Limits are 50 MiB/file, 250 MiB retained downloads/session and 64 download attempts. Temporary disk checks are application limits, not strict OS quotas. Download files survive context closure. Source upload snapshots are temporary.

Human observations are page-local, grouped and explicitly untrusted; batch images are approximate. Browser chrome/native-dialog pixels are not recorded. Original screenshot pixels retain their visible browser presentation; Show actions adds optional metadata overlays. Masked input values are omitted from observations, including the accessibility-derived resume context. See [the Phase 3D packet](../../docs/PHASE_3D_EXECUTION_DESIGN.md).

Run the real service probes without an LLM:

```powershell
.zeus/browser-runtime/venv/Scripts/python.exe tests/browser_service/test_service.py
node scripts/run_regression.js
# Native handoff UI checks use a private Win32 desktop and never switch it:
node scripts/run_regression.js --ui-files browser_handoff
# Opt-in foreground diagnostics: schedule a pause with the user first!
.zeus/browser-runtime/venv/Scripts/python.exe tests/browser_service/probe_native_handoff.py --interactive
```

Full setup, regression and bounded live commands: [evaluation guide](../eval_harness/README.md).

Bounded live-model handoff diagnostics use a fresh synthetic page and independent
server outcomes for successful help, unchanged Resume, cancellation and idle
cancellation. Run the envelope preview first; explicit `--live` permits paid
calls. Limits apply per fresh app process/scenario. The validated Sol/chat
control is explicit below; retained Luna attempts had protocol/continuation
failures. These are native supervised diagnostics, not an isolated benchmark.

```powershell
.zeus/browser-runtime/venv/Scripts/python.exe tests/browser_service/probe_live_handoff.py --chat --model gpt-6.1-sol
.zeus/browser-runtime/venv/Scripts/python.exe tests/browser_service/probe_live_handoff.py --live --chat --model gpt-6.1-sol
# Optional public-site compatibility smoke: no model calls or hidden answers.
.zeus/browser-runtime/venv/Scripts/python.exe tests/browser_service/probe_wordle_compatibility.py --live-site --offscreen
```

For an enabled native button whose continuous animation prevents a mouse click
from becoming stable, ordinary `press` with Enter is an available alternative.
Confirm the intended result; keyboard dispatch alone is not a success check.
Do not use force-clicks or universal animation suppression as a substitute for
checking readiness and outcomes.

Maintainer-only recording snapshot (no browser or inference):

```powershell
node scripts/diagnostics/export_browser.js --task TASK_UUID --session SESSION_UUID
# Optional explicit app/test data directory:
node scripts/diagnostics/export_browser.js --task TASK_UUID --session SESSION_UUID --data-dir "D:\absolute\zeus-data"
```

The wrapper builds a separate `zeus-diagnostics` executable, opens the existing database read-only, validates ownership and invokes the same terminal-recording exporter used by acceptance tests. It writes a snapshot under `browser-exports`; it does not migrate the database, alter original images or start the GUI. This copies existing evidence for debugging, not storage savings or conversation portability. `--help` makes no export. Routine tests use hidden windows and a separate evaluation executable so they do not relink the user's running app.
