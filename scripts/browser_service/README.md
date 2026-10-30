# Managed browser runtime (Phase 3B development opt-in)

The new owner is used only with `ZEUS_MANAGED_BROWSER=1`. The normal app still uses the previous browser route until Phase 3C delivers compatible Live View/Replay. [Delivery and evidence](../../docs/PHASE_3B_WORK_LOG.md) and [design](../../docs/PHASE_3B_BROWSER_OWNERSHIP_DESIGN.md).

Prepare an isolated environment explicitly from the repository root:

```powershell
python scripts/browser_service/setup_runtime.py --destination .zeus/browser-runtime/venv --install
# Needed if this SDK's matching browser is not already installed:
.zeus/browser-runtime/venv/Scripts/python.exe -m playwright install chromium
```

Dependencies are pinned in `requirements.txt`. Setup does not modify global Python packages; it does download dependencies when `--install` is given. Tests/app never install implicitly. Playwright and the actual Chromium version must match the pinned manifest. CI uses Python 3.11 on Windows.

To try the managed route in a new development launch:

```powershell
$env:ZEUS_MANAGED_BROWSER='1'
$env:ZEUS_BROWSER_PYTHON=(Resolve-Path .zeus/browser-runtime/venv/Scripts/python.exe).Path
npm.cmd run tauri dev
```

These settings belong to that shell/process. Without an override, the app looks for `browser-runtime/venv/Scripts/python.exe` beneath its app workspace root; it never falls back to global Python. The override must be an absolute executable path. Stop active runs before changing runtimes. Unset the opt-in for a later legacy launch; retain data rather than deleting profiles/recordings.

Managed profiles are separate Zeus-owned task profiles, with no automatic imports or extensions. One context lives for one root run; a later user turn creates another session. Script/worker exit releases control, not the browser. The resource card currently shows lifecycle status only. It explicitly does not offer a working visual viewer.

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

Operations: observe, navigate, click, fill, press, select_option, wait, tabs, new_tab, select_tab, close_tab and prepared dialog handling. The coordinator can take control; callers can release it. Use returned tab/frame/revision handles for scoped targets. Optional stable action UUIDs support retrying the same recorded request without executing it twice; unknown outcomes never authorize a new automatic mutation.

No raw CDP, arbitrary page evaluation, custom launches, default-profile takeover, login handoff, extensions or file transfers are implemented on this path. Unsupported operations fail explicitly. Arbitrary host Python remains subject to the existing policy and is not sandboxed by this service.

Run the real service probes without an LLM:

```powershell
.zeus/browser-runtime/venv/Scripts/python.exe tests/browser_service/test_service.py
node scripts/run_regression.js
```

Full setup, regression and bounded live commands: [evaluation guide](../eval_harness/README.md).
