# Phase 3D execution contract

Approved direction: 2026-11-01. This packet makes the already approved scope concrete; classifier selection, MCP/desktop automation and skills remain later workstreams.

## Tangible changes

An agent can request human help, wait without model polling, expose the existing browser, and resume from its actual page. Live/Replay gain optional action annotations. Human page activity joins the same recording. Browser transfers retain files and report what actually completed. Normal automation must remain unobtrusive on the user's Windows desktop.

## Decisions and differences from current code

- Replace unsupported login requests and retired restart comments with a durable, agent-requested handoff. No second login browser or cookie copying.
- Start a window-capable browser in the background only after Windows feasibility is established. Headless-to-headed conversion is not a documented Playwright feature. Preserve the same process, context and pages throughout intervention.
- Handoff phases: requested -> open -> completed; cancellation/run termination -> cancelled; transport/window failure -> failed or pending with a visible retryable error. Only a pending request belonging to a live run/session can expose or resume a window. Resume requires opening it first. Stop cancels the run. Duplicate/stale UI calls cannot resolve another request.
- Stop all agent browser operations during human ownership. Do not hold the service I/O lock or database mutex while awaiting human input. Keep live capture running. Resume drains observations and obtains fresh page state before releasing ownership. Do not replay a human submission automatically.
- Record bounded page-local click/input/key/scroll/navigation observations during handoff, labelled Human and observed, not verified tool successes. Group text changes. Record normal visible content; preserve native password masking and do not extract plaintext masked credentials. Browser chrome/native dialogs and event/screenshot timing gaps are explicit limitations. Page-originated telemetry cannot grant permissions.
- Add structured annotation metadata, with actor, input description and frame provenance. Draw only geometry associated with the displayed capture; labels may describe an interaction without asserting an exact point. Keep original image bytes unchanged. Default Show actions off, available in Live and Replay.
- Introduce explicit upload/download operations at the managed policy boundary. Upload only validated task-owned files; selecting a file proves browser selection, not server acceptance. Download completion requires saving real bytes, validating owned path/size/hash and retaining an artifact before browser shutdown. Include failed/cancelled/uncertain outcomes.
- Continue the fixed 8 FPS/JPEG 80 viewed preview. Do not introduce adaptive throttling or make every live frame a retained recording.

## Windows experiment and gate

Run synthetic pages only, separate profiles and owned process trees. Initial probe uses a private Win32 desktop and never switches the input desktop. Compare normal/minimized/hidden/offscreen/restored rendering, input, state and screenshot timing. A second common-desktop check may briefly expose a window and must wait for the user to pause their game; announce its precise start and completion. Do not manipulate their app/browser/game.

Initial private-desktop report: `.zeus/evaluations/windows-visibility-0745ad945cd84021833336a3c3b769a7/report.json`. All modes preserved input and page state. Normal/offscreen/restored captured 16 distinct frames in approximately 2 seconds; minimized/hidden took approximately 31–32 seconds. The test browser never became the foreground process. This favors nonminimized offscreen operation; it does not yet validate foreground behavior on the user's active desktop. Do not ship a default window policy on this evidence alone.

## Persistence and service boundary

Keep SQLite authoritative. Handoff cards carry root run/session/phase, persisted before emission; service controls are supervisor-only and are excluded from actor operation validation. Recover pending cards as cancelled after process loss. Session/action/frame identities and generation remain bound to one root run. Record human events through the existing action journal and frame reservations; retain explicit coverage gaps when evidence cannot be captured or a queue/quota is exhausted. Native window calls target only an owned browser window whose process/profile identity is established, never the user's browser by title alone.

Browser transfer/annotation additions use additive schema/API changes and the existing bridge. Runtime cancellation closes all owned processes once. Avoid test-only policy bypasses; offline browser tests use synthetic sites and the same service. Desktop UI tests use isolated storage and feature-gated test executables without touching the running app.

## Acceptance

- Regression coverage for stale/duplicate handoff decisions, paused agent calls, same-page resume, cancelled waits, restart recovery and cleanup.
- Real pinned-browser tests for preserved unsaved input/in-memory state, grouped human observations, fresh resume state, input provenance, and capture gaps.
- UI checks for Open browser/Resume/Stop states, error feedback, inert gallery cards and action overlay toggling/scaling without image replacement or layout shifts.
- Upload/download fixtures verify exact bytes, failed/cancelled outcomes, traversal/outside-workspace rejection, retention after context close and ordinary policy denial.
- Existing regression suite, frontend build and runtime build pass. Inspect actual screenshots of new UI. Use a small live model acceptance only where it adds evidence beyond deterministic integration tests; label native diagnostics honestly.
- Commit complete reviewable increments and record measured results/remaining limits here. No claim of full desktop recording, universal injection immunity, or a complete benchmark baseline.

## Delivered behavior and decisions

The implementation now provides native Windows handoff in the same pinned full-Chromium process/context/tabs. All roles share the existing root owner. The user's acceptance opens that owned window; Resume returns it offscreen and supplies fresh page context. There is no cookie-copy/relaunch path or interactive passthrough viewer. Unattended handoff waits do not call a model. Pending native JavaScript dialogs remain available to the human and block premature Resume. Browser/service loss closes the request with an explicit failure; Stop remains once per root run. Durable handoff changes also advance the session projection version so the chat actually shows Waiting for you.

Windows uses nonminimized offscreen operation by default after the scheduled experiments. The explicit `ZEUS_BROWSER_WINDOW_MODE=headless` diagnostic override and other platforms report native handoff unavailable. This changes window policy, not the shared executor or ownership rule.

Show actions is available in Live/Replay and defaults off. It draws bounded input/key labels and a target outline measured against the displayed capture when sufficient geometry exists. A target outline describes the target at capture time, not an independently verified exact historic click point. Captures crossing a new interaction omit stale annotations. Original pixels remain unchanged, and the fixed 8 FPS/JPEG 80 viewed-preview contract is retained without adaptive throttling.

Human clicks, grouped input, keys/shortcuts, scrolling and page/tab changes journal in the same session as observed page activity, with Human labels, event times and untrusted provenance. Batches receive approximate post-event images rather than falsely claiming exact before/after coverage for every human event. Browser chrome/native dialogs are outside page-pixel capture. Queue overflow and archive quotas remain explicit. The user's preference to retain normal visible content is honored; standard password fields retain normal browser masking. A new test found that Playwright's DOM-derived accessibility snapshot exposed raw password values. Observation now uses native accessibility names/states plus bounded visible non-password control values, keeping masked credentials out of the resume/model context.

Browser `upload_file` validates the opened task file, snapshots bytes before ordinary policy evaluation and returns selected plus the requested page-state confirmation. It does not claim independent server acceptance. One task file is selected per call. `download` waits for actual bytes; ordinary-click and human downloads are also tracked. Completed files retain verified name/size/hash/path and survive browser cleanup. Source snapshots are removed after the operation. Incomplete transfers retain failed/cancelled/interrupted outcomes. Limits are 50 MiB/file, 250 MiB retained downloads/session and 64 download attempts; periodic temporary-volume checks are not strict OS disk quotas. The additive transfer journal appears in bounded debug exports alongside the full existing conversation history.

## Windows evidence

- Private initial rendering probe: `windows-visibility-0745ad945cd84021833336a3c3b769a7`. State survived every mode; offscreen rendering stayed fast, whereas minimizing/hiding caused long screenshot waits.
- First scheduled visible attempt: `windows-visibility-167d1fdcf2284b7c84ce80d3371f0e1c`. It stopped before measurements because DOM title readiness did not imply native window-title readiness. The probe now waits for propagation.
- Scheduled active-desktop rendering retry: `windows-visibility-e28361802ec54f02aaf4bb712ac0bf7a`. Normal/offscreen/restored: 16 distinct captures in approximately 2 seconds; minimized: 32.2 seconds; hidden: 28.9 seconds. Input, unsaved draft, in-memory marker and target identity survived. Its combined foreground flag did not distinguish explicit display from background activity.
- Production-service private probe: `native-handoff-584e4cbd4b6c43d6b55d0dc955f40927`. Same target/draft/submission survived handoff, human observations were collected, capture took 19 ms.
- Separately scheduled ten-second active-desktop focus probe: `native-handoff-2fde0bb661364cd090061e8f2a15079a`. Same state survived; capture took 14 ms; no owned-browser foreground takeover was observed in sampled background launch/resume phases. Windows also declined the test process's foreground request for explicit display, so the explicit Open browser operation raises the owned window visibly without requiring OS activation permission. User pause/completion were announced around both visible intervals. No physical desktop input or personal browser profile was used.

Artifacts above live under ignored `.zeus/evaluations/`. The private Win32 desktops were never switched onto the user's display. These are short checks on this Windows installation, not universal hardware guarantees or agent-intelligence benchmarks. The foreground checks do not justify silently running future interactive tests over the user's applications.

## Validation and remaining scope

The full offline command passes **288 checks**: 47 JavaScript, 37 independent mission/grader, 87 Rust, 20 real Python/browser-service and 94 normal native desktop checks, plus three native handoff desktop cases. Native Open/Resume/Stop/service-loss cases run on a private desktop through `probe_native_handoff.py --e2e`; ordinary UI tests explicitly use headless diagnostic setup. This prevents test windows appearing over the user's game. **18 optimized acceptance checks** also pass: 15 normal desktop cases and the same three native handoff cases. Frontend production build, optimized evaluation-runtime build and diff checks pass. Completed-file retention plus cancellation of an unfinished real download was additionally checked in the focused six-case service group.

Final full-run native evidence: `.zeus/evaluations/native-handoff-7780c09f92bb45f180d2c2b7520bf78e/`. Optimized native evidence and screenshots: `.zeus/evaluations/native-handoff-da6c0e1e773540ff91452346fdef1730/`. Ordinary final screenshots are under `test-results/offline/`. Browser test workspaces/SQLite journals remain isolated under `tests/e2e/.test_workspace/`; the interactive app executable was not relinked or restarted. Final message consistency replaces a stale “later handoff capability” sensitive-input error with the now-supported `ask_user_for_login` instruction.

The first full run found a real lifecycle regression: rejecting the new transfer directory before the startup guard left a failed browser acquisition labelled completed. Directory preparation now belongs inside guarded startup; all 15 ownership checks pass. An older layout check also expected annotations to appear before the new toggle was enabled; it now verifies off/on state and retains the geometry assertions. Transfer integration additionally found and fixed Windows deep-path handling: Python requires a Win32 namespace prefix for file I/O, while Chromium rejects that prefix for its download directory. Initial transfer-test bridge-readiness and sandbox-startup failures were corrected without changing runtime policy or outcome graders.

Screenshots of overlays and requested/open handoff cards were visually inspected; this caught and fixed the misleading model-contact spinner, stale In progress browser badge and reason spacing. A real service-loss test confirms the card/session fail without an application crash. Tests cover masked-password exclusion from events and resume context, human native-dialog handling, real uploaded/downloaded bytes, normal policy denial, outside-task rejection, preserved completed files and cancellation of unfinished downloads. No live inference, account purchase, new classifier integration, MCP connection or skill installation was performed.

Phase 5 still owns classifier/provider selection and calibration, two-axis Smart authorization and the broader injection boundary. Direct paid classifier APIs remain an approved option to investigate, not a provider selected or funded by this patch. MCP/desktop capabilities and skills remain later aligned workstreams. Conversation/document portability and native document previews remain deferred. The canonical repeated Solo/Team/build-comparison benchmark remains incomplete: prepare a bounded baseline checkpoint before larger Phase 4/6 changes. This delivery does not independently prove arbitrary-website task success or improve a capability score by assertion.
