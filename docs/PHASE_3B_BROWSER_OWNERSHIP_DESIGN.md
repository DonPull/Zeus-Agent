# Phase 3B: one owned browser session per run

Status: **Approved and implemented on 2026-10-30; local software gates passed. Development opt-in only, pending the 3C viewer gate.** Prepared against `42bd730`, the manually retested Phase 3A/stabilization checkpoint; proposal committed as `d375c83`. This expands sections 6–8 of [the Phase 3 packet](PHASE_3_RELIABILITY_DESIGN.md). [Implementation and evidence](PHASE_3B_WORK_LOG.md) records 229 passing offline checks, three passing release cases, and both live outcomes: one failed initiation, one independently correct browser update whose execution hit its request cap. No fully verified end-to-end live pass is claimed. The design below preserves the approved scope; its preflight-only statements describe the proposal checkpoint.

## 1. Tangible differences

**Normal-launch testing note:** 3B's ownership changes apply only when the app starts with the explicit managed opt-in. A normal launch still exercises the legacy browser/recording path. [Setup](../scripts/browser_service/README.md) and [the user's manual-test investigation](PHASE_3B_MANUAL_FOLLOWUP.md). Default rollout waits for 3C's coherent viewer; this phase alone does not fix normal-launch Live View/Replay.

For a browser task, Zeus Solo and Zeus Team should reuse one managed browser session across tool calls, Python scripts and worker handoffs. A data-processing script should launch no browser. Finishing a script should not end the session; the root run ending or being cancelled should close owned resources. Startup failures should become useful errors rather than disappearing into a fallback. An ordinary approval wait should preserve the session.

This is the foundation for reliable Live View and Replay, not a promise that those experiences are finished by 3B alone. Phase 3C adds independent capture, live hydration and the replay viewer; 3D implements visible human handoff and explicit compatibility controls. Treat 3B and 3C as one user-facing browser rollout if the current cards cannot display the new service coherently. Keep intermediate changes reviewable without making the app pretend unsupported viewing works.

General goal completion, memory/compaction, Smart approvals and Team reasoning remain separate. In particular, a browser session closing after a run ends does not prove the user's goal was accomplished. ZA-005's retained live completion failures stay open.

## 2. Decisions to scan

| Area | Current code | Recommended decision |
|---|---|---|
| Ownership | Browser processes belong to a task map; recording IDs belong to individual Python scripts | Rust owns one logical session per `(task_id, root_run_id)`, with explicit process generations, contexts, tabs and action IDs. |
| Acquisition | Workers call `ensure_browser` for every Python action; Solo passes no endpoint | Acquire lazily through one shared browser executor. A script without a browser operation starts zero browsers. |
| Automation | Independent scripts connect over CDP or launch their own browser | A trusted long-lived Python async Playwright service owns the context/pages. Actors use typed operations or a thin Python client; ordinary calls do not expose raw CDP or execute arbitrary code inside the service. |
| Synchronization | Script/worker lifetimes define accidental control boundaries | Serialize mutations with a run-scoped ownership lease; another worker can inspect or take over explicitly. Script exit releases its lease, not the browser. |
| Startup | Spawn returns a port immediately; workers discard errors with `.ok()` | Validate dependency versions and wait for a bounded ready handshake. Return typed missing-runtime, startup, timeout or crash errors. |
| Authorization | A subset of monkey-patched operations reaches the existing Watcher | Every managed operation passes the common Rust gate with its actual target/arguments. Preserve normal Watcher/approval behavior; do not replace it with a new Smart classifier. |
| Recording | A script can send session events and overwrite a JSON manifest | SQLite journals requests and outcomes from the trusted execution path. Actor text/events are not execution evidence. Manifests are derived exports; full replay presentation is 3C. |
| Cancellation | Child-process kill and Python `atexit` are expected to finish recording | Root-run finalization owns shutdown, listener cleanup and process-tree containment. Interrupted effects remain uncertain and are not automatically repeated. |
| Profiles | New task profiles can silently copy repository browser state/extensions | Use a separate Zeus-owned automation profile, without automatic imports or extension discovery. Preserve old data; explicit import/extension support gets a later validated contract. |
| Compatibility | Main-browser and handoff controls can report success without doing the operation | Keep historical recordings readable with coverage labels. Unsupported new-path controls return an explicit state; do not promise default-profile takeover or full raw-Playwright compatibility. |

## 3. What the code actually establishes

These are source findings at the checkpoint, not new reproductions of every reported browser symptom:

- [worker.rs](../src-tauri/src/worker.rs), `Directive::RunAction`: calls `ensure_browser` before every Python action and converts any error to `None`. [chat.rs](../src-tauri/src/chat.rs), the equivalent Solo path: passes `None`. The roles do not receive the same managed browser behavior.
- [browser_manager.rs](../src-tauri/src/browser_manager.rs), `ensure_browser`: caches by task, checks whether the child exited, launches a browser and returns a selected port without waiting for automation readiness. No root-run ownership/finalization contract is present. It seeds a new profile and discovers extensions automatically; `main` omits a dedicated user-data directory.
- [python_runner.rs](../src-tauri/src/python_runner.rs), `run_python_action`: generates a fresh `sess_*` per script, launches an IPC accept loop without a retained shutdown handle, and installs synchronous Playwright monkey patches. This can create multiple history sessions even when a browser process is reused; session count and browser-process count are different observations.
- `_zeus_record_step` records some clicks before the actual call returns. `_zeus_write_manifest` sets `completed_at` during intermediate writes. `atexit`/page close finalizes the script's recording, rather than the root goal run. Some values are stored directly, so redaction needs a real contract.
- [BrowserLiveViewModal.jsx](../src/components/BrowserLiveViewModal.jsx) hydrates from the last recorded action and also trusts `completed_at`. The underlying source is action-driven, so a page changing while the actor thinks cannot provide a fresh independent feed. [get_browser_session](../src-tauri/src/browser_manager.rs) loads every step image into one response.
- [browser_replay_ui.spec.js](../tests/e2e/browser_replay_ui.spec.js) fabricates screenshots/manifests through Python. It tests presentation plumbing, not browser continuity, action success or live pixels. The offline B01 reference verifies its own fixture/browser, not Zeus's currently missing browser ownership service.
- [gatekeeper.rs](../src-tauri/src/gatekeeper.rs), `evaluate_browser_action`: uses existing policy summaries and the configured Watcher; without policies it permits the action. This is the current authorization behavior, not independent proof of safe arbitrary browser effects. 3B centralizes coverage without claiming Phase 5 is complete.

## 4. Research and feasibility boundary

Primary documentation checked on 2026-10-30:

- Playwright describes CDP attachment as lower fidelity than its native protocol and warns that manual launch arguments can break functionality. It also documents that a main Chrome user profile is unsupported for automation and that concurrent instances cannot share one user-data directory. These support a managed context/profile rather than repeated raw attachments. [BrowserType](https://playwright.dev/python/docs/api/class-browsertype).
- The Python API is not thread-safe, requires Windows's subprocess-capable event loop, and warns against cancelling a task during a Playwright call. Use one async owner, bounded operations and supervisor-driven shutdown rather than cross-thread page objects or arbitrary task cancellation. [Python library limitations](https://playwright.dev/python/docs/library#known-issues).
- Browser binaries are version-specific. Pin and validate the SDK/browser pair; do not silently select whatever Chrome is first on PATH. [Browser installation](https://playwright.dev/python/docs/browsers).
- Context tracing records browser/network activity but does not establish outcome assertions. Use trace artifacts as debugging evidence, alongside an independent fixture grader and a durable action journal. [Tracing](https://playwright.dev/python/docs/api/class-tracing).
- Windows Job Objects can supervise a process group and terminate it when the owning job handle closes. Verify nested-job compatibility and failure handling on Windows before claiming complete descendant cleanup. This is process lifetime management, not an OS sandbox. [Microsoft process documentation](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects).
- Chrome's changes to remote-debugging switches reinforce using a dedicated automation profile rather than taking over the default profile. [Chrome platform notice](https://developer.chrome.com/blog/remote-debugging-port).

Local metadata preflight found Python Playwright **1.62.0**, Chromium manifest revision **1234**, browser version **151.0.7922.34**, and the matching executable present. This proves installation metadata only. No browser was launched and no capture/cleanup capability was established. One immediate driver-start/stop metadata probe emitted pending-task shutdown warnings; that is not a passing readiness or cleanup test. The real supervised-service spike must exercise a complete startup/action/shutdown sequence. Do not rely on APIs shown only in newer online documentation without verifying support in the pinned SDK.

Recommended development baseline: Python 3.11 and Playwright 1.62.0 with its matching Chromium, validated together. During the spike use the existing installation read-only. Before integration, put the browser service's dependencies in a separately managed, pinned environment rather than modifying the user's global packages. Missing runtime/browser produces setup guidance; neither agents nor tests silently install or upgrade packages. The application already requires Python for script tools; a bundled production Python installer remains a separate distribution decision.

### Alternatives

1. **Keep CDP and repair the script monkey patches:** smaller initial diff, but independent script control and incomplete interception continue to undermine lifecycle, capture and evidence. Reject as the normal managed path.
2. **Trusted Python service, typed IPC (recommended):** reuse the existing interpreter ecosystem, keep browser objects in one event loop, and expose a bounded surface. The client intentionally supports a documented subset, not every Playwright API.
3. **Node Playwright service:** viable if the spike shows a concrete Python packaging or lifecycle problem. The frontend's npm dependencies do not by themselves provide a production Node sidecar. Switching adds a distribution decision; do not create two competing service implementations.

## 5. Runtime contract

Rust owns session identity, policy decisions, journaling, clients, process lifetime and cancellation. The trusted service owns Playwright objects and executes validated operations. Agent Python stays in its existing action process and uses a thin client for browser calls; it cannot upload source code to execute inside the trusted service. Unrestricted host scripts remain outside the managed-browser guarantee and retain their separate approval boundary; this design does not pretend to sandbox arbitrary Python.

Initial typed surface: `observe`, `navigate`, `click`, `fill`, `press`, `select_option`, bounded condition waits, tab list/create/select/close, and explicit dialog handling. Address frames with stable scoped handles rather than private Playwright internals. Upload/download need shared file-permission checks and owned artifact destinations before they are enabled; return typed unsupported until that increment is complete. Raw page JavaScript, direct CDP, arbitrary browser launch flags and extension execution are not implicit escape hatches.

`observe` supplies bounded visible/semantic content and optional pixels. Page content is untrusted input, never policy. Targets use validated role/text/test-ID/CSS selectors or observation references with a page revision; stale targets fail rather than clicking a guessed element. Keep existing visual-analysis routes available for actual perception. Automatic model ranking is not part of this phase.

Each command carries protocol version, request/action ID, session/generation/tab, client identity and a bounded timeout. Rust derives task/run/role from the authenticated channel, not an actor-supplied task ID. The supervisor/service link is private framed stdio; stdout carries protocol only and stderr is bounded diagnostics. If Python clients need loopback IPC, the Rust endpoint is run-scoped, authenticated, size-limited and closed on finalization. No service-debug endpoint is passed to arbitrary clients. Tokens remain transient and out of chat, manifests and logs. These controls do not exclude a malicious process already running as the same user.

Proposed bounds to confirm in the spike: 1 MiB command frames, 256 KiB textual observations, 2 MiB image artifacts, one mutation in flight, bounded queued requests, 15-second startup and 30-second default action deadlines with a 60-second maximum. Images travel as owned artifacts, not unbounded protocol/base64 frames. Bounds and truncation are explicit in results. Future capture uses a separate latest-frame slot, not this mutation queue.

## 6. Persistence, lifecycle and uncertain effects

Additive tables, with exact migration names finalized during implementation:

| Record | Essential fields |
|---|---|
| Session | task/root-run/session IDs, owner kind, status, generation, profile identity, runtime versions, timestamps and terminal reason |
| Tab | session/generation/tab IDs, current URL/title, selected state and closed state |
| Action | action/request IDs, monotonic sequence, caller/role, redacted arguments and authorization reference, lifecycle timestamps, outcome/error and evidence IDs |
| Artifact | session/action ownership, kind, relative storage key, media/bytes/hash, retention/availability state |

Use a unique active-session constraint per task/root run and idempotent action IDs. No SQLite mutex may span browser or service I/O. Persist request intent before dispatch; persist actual outcome before emitting the durable event/tool result. A pending row establishes intent, not proof of dispatch or completion. An action's success, a screenshot's availability, a session's closure and the goal's semantic success remain separate fields.

Session flow: `starting → active → finalizing → completed|cancelled|failed|interrupted`; track `waiting_for_approval` separately so it does not trigger closure. Reserve handoff state but do not report a working handoff before 3D. Browser tabs can close without closing the session; zero tabs is a valid state and the next permitted operation can create one. A worker releasing its mutation lease cannot close the root owner's browser.

Root finalization runs on every completed/error/cancel/budget/deadline path, not only a successful final answer. Stop accepting commands, resolve or invalidate pending approvals, revoke clients/leases, close context/service and wait for owned descendants/listeners to exit. Use a short bounded graceful close, then the owned process-tree mechanism. Establish containment before allowing the trusted service to start its driver/browser. A Rust drop guard is a fallback; it must not rely on awaiting cleanup in `Drop`.

Do not directly cancel an in-progress Playwright coroutine. On Stop, prevent new actions and request supervised context/service closure. Mark an operation cancelled only when that result is known; an acknowledged request with an unknown side effect is `uncertain`. A lost reply never causes an automatic repeated click, note submission or purchase. Reconcile known IDs/evidence or ask for explicit recovery. On app restart, mark orphaned sessions/actions interrupted/uncertain and expose the gap. Do not kill a saved PID without ownership/identity validation: IDs can be reused.

The logical session spans all actions in one root run. A later user turn starts a new session unless a separately defined resume operation links it. Profile persistence is independent: retain a Zeus-owned task profile for supported site state, with exclusive use and an explicit reset action. Do not copy the existing parent profile or delete legacy recordings/profiles as part of migration. External-browser attachment and its disconnect-without-kill semantics stay a 3D compatibility topic.

## 7. UI and rollout compatibility

Keep current visual style and add only necessary session status/error feedback. One root session produces one lifecycle card that updates from durable state; repeated actions/scripts do not create more cards. Distinguish “browser closed” from “task verified complete.” State/status hydration uses authoritative sequence/generation, so reopening or late events cannot revive an ended session.

New session DTOs include schema/recording-coverage versions; historical manifest readers remain separate and read-only. Validate task/session ownership and bound image retrieval rather than accepting arbitrary paths or eagerly loading all history. Never reinterpret old fabricated or incomplete steps as verified new actions.

3B establishes the journal/artifact contract needed by 3C, but does not silently route new sessions into an incompatible old viewer. If basic status/artifact compatibility cannot be provided safely, switch the default browser route only together with the reviewed 3C viewer work. That is an integration checkpoint, not a permanent second architecture or an unannounced removal of Live View/Replay.

Existing `configure_browser`, extension and handoff success stubs must not be used to claim the new service has those capabilities. During migration, show a precise unsupported response for that path, with old stored settings retained. Actual account/profile import, visible handoff, recording retention/export and full replay UX keep their own decisions in 3C/3D.

## 8. Acceptance tests before the default route changes

| Scenario | Independent evidence required |
|---|---|
| Data-only Python in Solo and Team | Zero browser sessions, driver/browser launches and browser cards. |
| Two separate scripts/actions | Same session/generation/tab; a form value, cookie/local storage and UI state survive the first client's exit. |
| Worker handoff | A second role continues the original state under the same root session; no competing mutation or model-based permission relaxation. |
| Concurrent acquire | Two callers cannot create two active sessions. A losing/cancelled startup leaves no process/listener. |
| Readiness failure | Missing SDK/browser, invalid executable, incompatible version and failed startup return typed errors and never a usable-looking endpoint. |
| Normal approvals | A denied action has no effect; an approval wait keeps state; revocation/expiry prevents delayed execution after cancellation. |
| Task isolation | Foreign session/tab/action IDs and stale generations fail; frames/artifacts/credentials do not cross tasks. |
| Actual failed action | A missing locator or refused navigation produces a failed action, not a recorded success; screenshot failure is separate. |
| Completion and Stop | Owned context/service/descendants/listeners disappear; unrelated user processes stay alive. Include busy navigation and pending approval. |
| Lost reply/crash/restart | Exactly-once fixture counter/notes establish whether an effect happened; uncertainty remains visible, with no automatic duplicate mutation. |
| Protocol controls | Wrong token, forged client/task, duplicate action ID, oversized/malformed frame, queue overflow and late result cannot authorize or create fake success. |
| App lifecycle/UI | Session status survives reload; one card per root session; no unexpected UI errors. Existing image/settings/duplicate-response checks still pass. |

Use real local browsers and B01's ticket portal plus small synthetic continuity/timer/failure pages. Inspect actual DOM, application-side state/audit records, owned processes and listeners. Record browser/runtime versions, logs and child stderr. Synthetic one-pixel screenshots remain permissible UI controls, but never evidence for ownership or live capture.

The initial spike must also demonstrate that a changing page can be observed independently while an actor is idle, so 3C does not inherit an unworkable capture design. Full capture scheduling, stale-frame UI, pixel assertions and playback belong to the 3C acceptance packet. Safety/outcome graders stay independent of runtime status and model narration.

## 9. Implementation order and gates

1. **Feasibility spike, outside production routes:** supervised Python service lifecycle, pinned dependency preflight, one context, two clients, bounded observation, independent screenshot feasibility, Windows process-tree shutdown and negative IPC control. No live LLM calls. Retain failures; if this fails, revisit the service choice before integration.
2. **Durable session owner:** additive schema, root-run lifecycle integration, idempotent acquisition, readiness/failure, orphan recovery and strict artifact identities. Include migration/state-transition tests.
3. **Common tool path:** typed browser operations, existing authorization/approval binding, mutation lease and documented Python client. Switch Solo/Team together; data-only actions stop acquiring browsers. Keep raw action execution outside the managed claim.
4. **Status and compatibility:** one lifecycle card, coherent hydration, cancellation/failure feedback, historical reader boundaries and truthful unsupported controls. Confirm the 3C integration gate before changing the user-visible default route.
5. **Acceptance and regression:** run the real-browser matrix, all existing 196 checks, frontend build, normal production compile and relevant release cases. Inspect the changed UI at normal/narrow widths. No hidden expected errors or background process leftovers.
6. **Targeted live diagnostic only after software checks:** at most two fixed-build B01 attempts through Abacus `gpt-6-luna`, medium effort, Responses, 12 total model requests per trial, one request in flight, 8,192 output tokens/request, 1,000,000 token-reservation allowance and five minutes per trial. Record all roles, approvals, artifacts and failures; keep independent B01 criteria unchanged. Two trials are a smoke check, not an intelligence/cost baseline or global authorization proof. Credits remain unknown unless the provider reports them. Do not retry automatically until green or execute agent-produced programs as graders.

Keep commits separated into lifecycle/schema, service/client, integration and acceptance where dependencies permit. No browser implementation is included in this proposal commit. If an acceptance gate fails, repair the affected slice or keep the previous default route; do not discard unrelated work, erase histories or weaken the grader. Additive data can stay inert on a code rollback. Stop/reconcile live sessions before switching service versions.

## 10. Alignment checkpoint

The material choices are the trusted Python service with a bounded API, root-run session lifetime, managed profile without automatic imports, existing-policy enforcement on every managed action, explicit uncertainty rather than automatic replay, and the coordinated 3B/3C rollout when viewer compatibility requires it. The SDK/Chromium pair is a proposed validated baseline, not a claim that the metadata probe proved feasibility. Implementation starts after this packet is aligned; the first result is the no-LLM lifecycle spike, not a full browser rewrite.
