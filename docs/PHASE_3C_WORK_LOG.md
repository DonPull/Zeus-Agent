# Phase 3C implementation record

Status: **Implemented and locally accepted on 2026-10-31.** Starting checkpoint `3ca1c51`. The agreed [design](PHASE_3C_LIVE_VIEW_REPLAY_DESIGN.md) remains the acceptance contract. The shared owner is now the sole production executor, with readable Live/Replay and ordinary persisted setup. Final offline/release gates passed; one of two bounded live attempts completed the independently checked workflow and honest final response. This is not a stable-v1 or general capability certification. Intermediate results retain their own build scope.

## Tangible changes and decisions

- One browser owner shared across participating roles remains the intended sole production executor after acceptance. Browser profile choice is independent; personal-browser access is not added.
- Independent, masked JPEG capture uses alternating bounded mailbox slots and atomic, identity-bound descriptors. The Rust collector uses neither the actor broker lock nor its control lease. Binary reads carry pixels; notifications carry only identity/version information. The two verified-image cache entries expire by exact sequence rather than returning another image.
- Capture errors preserve last known pixels with explicit error/freshness state. Publication revisions, capture sequences and session projection versions are separate. Viewer heartbeat expires; it cannot keep the browser alive.
- Immutable before/after evidence is separately reserved before dispatch and associated with the actual action result. Failed or missing evidence does not change the action outcome. Reservations and uncertain files remain charged until explicit deletion; they cannot evade archive limits.
- Replay uses paged metadata and selected binary image reads. Old-format history is a read-only adapter with bounded files and owned-path checks. It does not start a browser or certify old actions.
- The UI is being connected to one shared viewer with Fit/zoom/full-screen controls, lifecycle/error labels and paged action navigation. Task-level recording discovery, terminal export and explicit image deletion are being integrated. These changes still need their full validation gate.

## Evidence so far

The first capture foundation compiled in an ordinary production check. Four focused Rust tests passed for real JPEG validation/identity/hash/dimensions, a two-image exact-sequence cache, persistent error/recovery versions, and reservation/migration handling. Eight real browser-service tests passed, including changing actual pixels during a long actor action, explicit no-tab state, client continuity and process containment.

The first UI group passed all 78 existing desktop cases. Its new capture control stopped before exercising the feature because its test setup omitted the required task budget; that fixture was corrected without changing the outcome assertions. The corrected focused native test then passed: changing real fixture pixels reached the webview through the production collector/binary RPC during a nine-second actor wait; foreign-task reads were rejected, passive reads added no model requests, and cleanup left zero owned descendants. These are software controls with scripted model replies, not an agent-capability result.

Subsequent complete candidates passed 252, 255 and then **257 offline checks** (41 Node, 37 mission/grader, 81 Rust, 11 real Python-browser probes, 87 native desktop checks). These intermediate green runs do not replace final validation after the subsequent review repairs.

## Final implementation decisions

| Functionality | Change from the earlier code |
|---|---|
| Browser execution | Remove the old executable discovery/profile cloning/CDP launcher and per-script recorder. The shared owner is the sole candidate executor; older recording readers are data adapters only. No per-role browser or permanent engine selector. |
| Lifecycle | Root completion is published only after browser cleanup joins. Script/worker completion releases control. A later root run may open the retained task-owned profile. |
| Setup | Persist a prepared runtime interpreter path, freeze it per root and report readiness/provenance. No global Python fallback or automatic install. The debug checkout may discover its explicitly prepared venv; packaged builds use saved/app-owned setup. Stale personal/custom-browser preferences require explicit acknowledgement to use the dedicated profile. |
| Viewing | Independent sampled pixels, large shared Live/Replay viewer, Fit/100/150/200%, scroll and user-triggered DOM full screen. Close/reopen/reload reads published state; it never starts a browser or calls a model. |
| Recording | Actual action outcomes and immutable available before/after images, independent idle samples, typed missing/deleted/quota coverage. Cursor pages contain at most 100 actions and 512 KiB; very long details have explicit presentation summaries. Keyboard/button navigation uses actual page cursors rather than assuming fixed page sizes. |
| Storage | Two transient slots and two verified backend images, 2 MiB/image, 256 MiB/session, 2 GiB total new visual archives, 10,000 frame entries/session. Reservations/uncertain staging remain charged; only explicit deletion frees bytes. No silent deletion of older history. |
| Export/delete | Terminal-only export to a fresh owned folder: recording.json, full actions.jsonl, verified relative JPEGs/hashes. Explicit two-step image deletion preserves journal/profile/input/user outputs. Diagnostic reports retain the export before stopping their separate app. |
| Perception | Explicit screenshots deliver exact bytes once to the calling master/worker through its declared direct Chat/Responses or configured helper route. No master substitution, implicit expensive fallback or passive-frame inference. Delivery state/role/request provenance is durable and included in bounded debug exports. |
| Dynamic widgets | Generic fixed-code inspect returns bounded visible text, safe attributes, colors and visibility. Hidden inputs fail normally; missing/unknown feedback remains unknown. No site/game solver or arbitrary actor JavaScript. |
| Team setting | Verifier `None` now actually disables verifier inference and labels the result as not independently verified. This repairs the setting, not the planned Team verifier architecture. |

The browser service remains Playwright **1.62.0**, Chromium **151.0.7922.34** (revision 1234). Profile ownership is not an OS sandbox. Login/CAPTCHA handoff, transfers and extensions remain unsupported pending 3D; personal-browser takeover is unapproved.

The new modules are browser_capture.rs (identity/validation/quota/collector), browser_recordings.rs (bounded readers/export/delete) and browser_visuals.rs (calling-role delivery). React uses only the bridge. Heavy history/image/export/delete commands run through spawn_blocking; Tauri documents that synchronous commands otherwise execute on the main thread. [Primary command documentation](https://v2.tauri.app/develop/calling-rust/#async-commands). Existing database authority/persist-before-emit/single-flight and policy behavior are retained. Migration uses an additive savepoint and a first-use SQLite VACUUM INTO backup, including committed WAL; tests prove rollback and late producer/task-deletion guards.

Final bridge names: getBrowserCapture, heartbeatBrowserViewer, readBrowserLiveImage, listBrowserRecordings (50 summaries/page), getBrowserRecordingPage (default 50/max 100), readBrowserRecordingImage, exportBrowserRecording, deleteBrowserRecordingImages, getBrowserVisualDeliveries. Metadata notifications contain no image payload. Reads validate ownership, actual image bytes/dimensions/MIME/hash and owned non-reparse paths. These checks provide logical integrity, not isolation from arbitrary same-user native programs.

## Failures found and corrected during acceptance

- The first new desktop fixture omitted its required task budget; corrected the setup, retaining the original pixel assertions.
- Added boundary captures made an old Stop fixture cancel the initial navigation instead of its intended slow navigation. It now waits for the independent local server to receive the slow request; cancellation/uncertainty assertions remain unchanged.
- A role-delivery control exposed the existing verifier-None setting still making a provider request; repaired the setting and retained exact request/role assertions.
- A repeated 87-case desktop run reported **86 passed, one failed**: the root was already `completed` while its browser was `finalizing`. This was a product ordering defect. Successful run finalization moved to the root boundary after joined cleanup. The test was not relaxed or changed to wait for cleanup after completion. The original failure is retained in `.zeus/evaluations/phase3c-review/completion-cleanup-ordering-failure.md`.
- Review added the missing replay byte bound and variable-page cursor navigation, plus a Unicode/large-entry pagination control. One last-image scheduling edge now drains a pending image even if it arrives as the previous drain completes.

## Capture measurements and visual review

The runner retains `.zeus/evaluations/browser-capture-measurements.json`: static, animated, slow-navigation and keyboard-widget fixtures, capture on/off, 2.4-second observation samples per case (19 calls in the recorded sample). On the first extended run, observe medians were 4.89–5.25 ms; capture medians were 11–23.5 ms and one navigation-overlapping capture took 1,116 ms. Slow navigation was 1,504.63 ms off / 1,505.24 ms on. The final descriptor reported 22 attempts, no busy skips and one initial navigation capture failure; mailbox size was 67,150 bytes. This is a short local probe, not proof of no overhead, sustained throughput or agent capability. A slow capture stays bounded and independent of actor I/O; freshness/error state remains necessary.

Representative actual changing browser pixels were inspected in the large native Live viewer. Three-size Live/Replay layout controls use a clearly labelled controller-created display fixture, not fabricated agent evidence. Screenshots are retained in `.zeus/evaluations/phase3c-review/`. Routine launches and diagnostics stay hidden/unfocused; full screen is user-triggered and ordinary tests do not take over the desktop to exercise native full-screen transitions.

## Final gate record

The final command `node scripts/run_regression.js --unit --missions --backend --ui --release` passed **257 offline checks plus seven optimized native checks** after the ordering/page repairs. The unchanged live-reload/completion assertion passed in debug and release. The optimized subset covers the large-image fresh-TLS crash regression, flag-free saved setup, live close/reload, shared script owner, busy Stop, real replay/export/delete and worker-helper pixel delivery. Frontend production build passed (319 modules); `cargo check --locked --bin zeus-agent` passed. No unexpected UI exceptions or native stderr were recorded in these acceptance controls. Remote CI was updated but not run from this session.

Final four-case capture measurements retain observe medians 4.94–5.66 ms off / 4.98–5.66 ms on, capture medians 12–15 ms, a 1,189 ms navigation-overlapping maximum, 22 attempts/zero busy skips/one initial navigation capture failure and 67,150 transient bytes. These supersede the first extended sample numerically, not its limitations. An inspection through WMI for an additional global process scan was denied by the host; cleanup evidence is the service's owned process accounting and the separate supervised app shutdown, not a successful global WMI scan.

Exactly **two** paid Abacus `gpt-6-luna`/medium/Responses B01 attempts ran. Each allowed 16 requests, one in flight, 8,192 output tokens/request, one-million-token reservation allowance, 24 directives and five minutes. No cap increases, model escalation, trial retries or extra paid repair runs occurred. Both retained the same source parent `3ca1c512e140277ceed9b6f4c20f1fa4c8c782d9` and dirty-source hash `118dfe6916a4b2cd078b685604b1450ec508398334a2e777b44118d6695f2fa0`; final edits after these attempts are documentation/review records only.

| Attempt | Result | Usage and retained evidence |
|---|---|---|
| `native-diagnostic-6465291a-ce1e-40f2-bbee-2a2c677dfd68` | Execution returned normally but the goal failed. The model claimed browser-action tools were unavailable; no browser request occurred. | 1 master request, 2,344 reported tokens; full failed reply/assessment retained. |
| `native-diagnostic-7928ba1e-cf32-48e1-b4ab-5522bc64b52d` | Workflow and final summary passed: correct T-102 priority/note, existing data preserved, exactly one update, no publication, independently observed UI interaction. | 12 master requests, 57,502 reported tokens, 30,025 cached tokens (a subset), 55.147 seconds. One session, seven browser journal requests including the external observer, 13 exported images; completed cleanup, zero owned processes remaining, empty service stderr. |

Total reported usage is **13 requests / 59,846 tokens**, not provider credits. Provider credits remain unknown. No intervention was needed in these two runs; normal permissions and the prepared synthetic controller stayed enabled. The working run used persisted setup with no browser runtime environment flags. Actual final pixels were visually inspected and show the requested note and high priority.

The second result has `execution_status:succeeded`, `outcome_status:passed`, `outcome_passed:true`, but `passed:false` because independent authorization coverage is still partial/not evaluated. The diagnostic command therefore remains nonzero by design. Do not relabel it a fully verified isolated benchmark, erase the first failed attempt, or compare this 16-request envelope directly with 3B's 12-request runs. Its actual workflow/final response/recording/cleanup satisfy 3C's local promotion prerequisite, not universal goal reliability.

Review: [local evidence index](../.zeus/evaluations/phase3c-review/index.html), [failed live attempt](../.zeus/evaluations/native-diagnostic-6465291a-ce1e-40f2-bbee-2a2c677dfd68/index.html), [completed live workflow](../.zeus/evaluations/native-diagnostic-7928ba1e-cf32-48e1-b4ab-5522bc64b52d/index.html). Generated recordings/images, test workspaces and runtime dependencies remain ignored; commit only intentional code/tests/docs.

## Next boundaries

The retained false tool-unavailability reply remains a high-priority initiation/completion defect for Phase 4; the browser owner does not repair semantic task state by itself. Durable backend event logs, broad UI polish/accessibility, general approval expiry, calibrated Smart approvals and full Team verification remain tracked separately. 3D needs its own aligned plan for login/handoff/transfers inside the Zeus-owned browser. No personal-browser attachment is approved. A repeated mixed-task capability baseline and OS-isolated authorization grading remain open; neither two smoke attempts nor passing regression controls certify them.
