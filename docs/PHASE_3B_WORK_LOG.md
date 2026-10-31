# Phase 3B implementation and evidence

Historical build record. [Accepted Phase 3C delivery](PHASE_3C_WORK_LOG.md) now supersedes the opt-in/viewer rollout status below; its results do not rewrite these earlier live failures.

Approved packet: [browser ownership design](PHASE_3B_BROWSER_OWNERSHIP_DESIGN.md). Baseline `d375c83`, including stabilization checkpoint `42bd730`. Implemented and locally validated on **2026-10-30**; the user requested a checkpoint commit including the follow-up fixes before Phase 3C planning. The managed route is **development opt-in pending the coordinated 3C viewer rollout**. This is not a stable-v1 or benchmark-baseline claim.

## Tangible differences and decisions

| Before | Implemented in the managed route |
|---|---|
| Script/worker lifetime creates browser and recording boundaries | One Rust-owned session per task/root run, shared by Solo, Team and Python clients. Data-only scripts create no browser. |
| Scripts attach over CDP, launch independently or rely on incomplete monkey patches | A long-lived trusted Python Playwright owner executes typed actions. Scripts use `from zeus_browser import call`; raw CDP/arbitrary service code is unavailable. |
| Startup can return an endpoint before readiness and discard errors | Pinned SDK/browser validation, a bounded readiness handshake and useful typed errors; no fallback to a different runtime. |
| A script can report its own session/step evidence | SQLite records authenticated requests, policy references, actual outcomes, tabs and owned artifacts. Actor events cannot fabricate managed execution. |
| Script exit ends recording; Stop relies on child/atexit behavior | Script exit releases control. Root completion/error/Stop owns cleanup; Windows Job containment is established before browser launch. |
| Lost replies risk repeated effects | Stable action IDs, explicit uncertainty, no implicit retry/restart, and interrupted-state reconciliation after app restart. |
| Late chat events/refresh can replace newer resource state | One durable status card per session, with backend projection versions protecting against stale events and hydration. |
| New task profiles silently import parent data/extensions | Separate Zeus-owned profiles, without implicit imports. Main-browser takeover, extensions and human handoff return unsupported on this route. |

The existing Watcher/approval policy is retained. Every managed operation passes the shared Rust gate. This neither implements Smart approvals nor makes arbitrary host scripts an OS sandbox. Old recordings and the legacy default remain accessible. The new card truthfully says visual viewing is unavailable until 3C.

## Runtime and diagnostic contract

- Explicit isolated environment: ignored `.zeus/browser-runtime/venv`, Playwright **1.62.0**, pyee **13.0.1**, greenlet **3.5.4**, typing_extensions **4.15.0**. Matching Chromium **151.0.7922.34**, SDK revision **1234**, verified at runtime. Global Python packages were not changed; neither app nor tests silently install dependencies. [Setup and manual opt-in](../scripts/browser_service/README.md).
- Private framed supervisor stdio; authenticated, scoped Python-client IPC; no raw CDP address. A Windows kill-on-close Job is assigned before the startup frame permits Playwright/browser launch. Cleanup targets only owned descendants.
- Bounds: 1 MiB protocol frame, 15-second startup, 30-second default action timeout (60 maximum plus transport grace), 16 queued callers/tabs, 5,000 action IDs, 256 MiB stored responses per session. Observations have bounded text/semantics and optional JPEG artifacts of at most 2 MiB, with verified ownership/hash. A bounded read-only controller observation can inspect an existing active owner but cannot launch a session or mutate the page.
- Generic mutation-response metadata retains method, URL without query/fragment/auth, status, tab and bounded-body SHA-256. No raw request headers, cookies or bodies are logged by that feature. DOM, URLs, locator values and screenshots can still contain private page content; this is not comprehensive content redaction.
- Debug export retains the complete stored chat, plus a separately labelled bounded browser journal (20 sessions, 100 actions/session, 2 million action characters). Evaluation artifacts retain at most 1,000 actions and 10 verified screenshots. Explicit truncation does not become missing-chat coverage.

## Software acceptance

`node scripts/run_regression.js` completed with exit **0** after the final runtime changes:

| Group | Passing checks |
|---|---:|
| Node unit/configuration/report/projection tests | 41 |
| Mission and grader controls | 37 |
| Rust library, schema migration and state transitions | 71 |
| Real Python service/browser probes | 7 |
| Native desktop regressions | 73 |
| **Total** | **229** |

The seven real-browser probes cover two process clients sharing actual state, authenticated protocol/idempotency controls, real changing pixels while the actor is idle, frames/tabs/ARIA and stale targets, actual dialog outcomes, oversized frames, and normal/forced descendant cleanup. Independent timer captures establish feasibility for 3C, not a delivered live viewer.

The desktop suite adds 15 ownership checks: two scripts/one session/card and reload, Solo/Team data-only laziness, worker handoff, missing runtime, failed locators and duplicate IDs, foreign IDs, busy Stop, forged IPC/session events, linked ancestors, simultaneous clients, script timeout/uncertainty, normal policy denial, expiry/late approval, task deletion joining cleanup, and full app crash/restart recovery. Two additional scripted B01 controls validate actual browser success and reject backend-only mutation as proof of browser interaction. Ordinary image/settings/duplicate-publication checks remain in the full suite.

Additional passing gates:

- `npm.cmd run build`: 316 modules.
- `cargo check --locked --bin zeus-agent`: ordinary production build, without evaluation features.
- `cargo build --release --locked --bin zeus-evaluation --features evaluation-runner`.
- Three optimized native regressions: previous large-image/fresh-TLS crash sequence, one root browser across Python scripts, and Stop during navigation. All **3 passed**.
- Visual inspection at 1000×760 and 1320×840; the new resource card uses existing styles. Existing narrow sidebar/header layout debt remains ZA-004.
- No test-owned evaluation/service processes remained after teardown. The user's `zeus-agent.exe` was not killed or relinked.

Windows CI now explicitly prepares the pinned isolated environment, installs its matching browser and runs these groups/release cases without model secrets. **Remote CI has not been run.**

### Failures found during development

Failures were repaired and complete affected groups rerun; they were not reclassified as expected successes:

- The first probe supervisor cleaned up twice and read closed stderr. Cleanup became idempotent; all seven probes subsequently passed.
- Inherited conflicting Node color settings produced benign stderr. Service startup clears those settings and `NODE_OPTIONS`; diagnostics remain retained separately from real process-containment failures. Nonempty stderr alone is not a failed cleanup.
- Reload/restart controls needed to reopen the task and wait for the restarted frontend; Team fixtures needed full effective settings. The original browser-state assertions were retained.
- The backend-only negative control needed normal explicit one-time permission for its known synthetic PATCH. It still cannot satisfy the independent browser criterion.
- Final review found a genuine stale-status race; backend projection versions and an additive migration now protect both events and database hydration. Controls verify ordinary message ordering/visibility is unchanged.

## Two fixed-build live diagnostics

Exactly two attempts through the actual Abacus catalogue/API; no automatic retries, model upgrades, cap increases or grader changes. Both used `gpt-6-luna`, medium effort, Responses, no helper/Watcher, normal permission policy, the prepared synthetic supervisor, a fresh local ticket portal and the same source/configuration hashes. No approval cards were needed in these particular live attempts; the denied/expired-card controls are separate offline tests. This is native supervised host execution with partial authorization coverage.

Limits per attempt: 12 model requests, one in flight, 8,192 output tokens/request, 1,000,000 reservation allowance, 24 directives and five minutes.

| Experiment | Actual result | Requests / known tokens |
|---|---|---:|
| `native-diagnostic-5c47b5dd-c402-4c3f-bd49-781f87022e4a` | Failed outcome. Actor announced work, then falsely claimed browser tools were unavailable. No browser or mutation occurred. Runtime returned normally, which does not mean the task succeeded. | 1 / 2,212 |
| `native-diagnostic-5623405d-4ff6-4231-937a-2c94a021e984` | All five outcome criteria passed, including independent actual-UI/request evidence and exactly one correct update. Execution failed at the 12-request cap before final-answer completion. | 12 / 56,146 |

Total **13 requests / 58,358 reported tokens**; provider subscription credits remain **unknown**. Cached/reasoning subsets are retained, not added a second time. These two trials are not an intelligence/cost baseline and yield **zero fully verified end-to-end passes**.

The second trial used one session/generation/tab. Nine journal entries include eight successes and one genuine failed `fill` against an input when the page used a textarea. The model recovered using a fresh observation. The final ticket had the exact high priority/note; unrelated records and publication state were preserved. The external observer checked the browser's successful PATCH body digest/tab against the fixture audit and the real “Saved T-102” state. Cleanup was graceful (`forced:false`, zero remaining owned processes, empty service stderr). Session status remains failed because the root hit its request cap; it is not relabelled completed because the ticket changed.

Source commit: `d375c83b5c1825a2e7dd81b6c02421ea401b22d5`; dirty-build hash: `ccc38be811bda5ee2d98b3302f3744fa5ebe7e01b302c8cb81d415a44bd62d2a`; configuration fingerprint: `e5bbf55bf8dded87c62e7c75e5b75f9b9fcbe410a4c50a604f32edc46ea4110d`. Documentation was finalized after these trials; runtime/test sources stayed frozen across them.

Local retained review: [combined dashboard](../.zeus/evaluations/phase3b-review/index.html), [live details](../.zeus/evaluations/phase3b-review/live-summary.json), [software validation](../.zeus/evaluations/phase3b-review/validation.json), [release resource-card screenshot](../.zeus/evaluations/phase3b-review/release-browser-card.png). Generated files are ignored, not portable committed evidence. Each original experiment retains immutable trial records, all stored conversations, backend logs, assessment, screenshots and exported artifacts.

## Remaining work and promotion boundary

- **3C:** independent live capture/hydration, stale-frame handling, viewer/replay, pagination/retention/export and historical coverage labels. Do not switch the default route before this integration gate.
- **3D:** visible human handoff, supported profile/login and extension controls, transfers and explicit compatibility. Current managed route is a bounded headless subset.
- **ZA-005 / Phase 4:** deterministic initiation/completion, task/plan truth and context recovery. The live runs expose false tool-unavailability, redundant plan/narration turns and finishing after the cap. The service did not repair those orchestration defects.
- **ZA-008:** inline parsed directive JSON can leak into visible narration; generic error advice can suggest resending after a side effect. Record and repair publication/recovery behavior before claiming a polished reliable agent. No duplicate mutation was observed in these trials.
- Exact-once IDs apply to requests in this journal, not semantic equivalence of different IDs, external sites or all host actions. Native authorization, prompt injection and unrestricted scripts still require later permission/sandbox work.

No extra live attempts were used to turn these results green. The prior default stays in place while these gates remain open.

## Manual-test follow-up

The user's subsequent normal-launch test used the legacy route, not the managed opt-in. [Findings and repairs](PHASE_3B_MANUAL_FOLLOWUP.md) distinguish process launches from per-script recordings, explain indiscriminate third-party resource fetching, and retain observation/objective-drift issues for the general execution/supervision work.

This follow-up centralizes cancellation at the root boundary, persists its notice/plan/run state atomically with idempotent finalization, permits selection of permission titles, and adds explicit current-route metadata to debug exports. The default browser route stays legacy. The full suite passed **235 checks: 41 Node, 37 mission/grader, 73 Rust, 7 real browser-service probes and 77 desktop**. The frontend build and ordinary production compile passed. Targeted desktop checks verify actual title dragging/normal approval and one Stop notice during master/worker/verifier waits; another checks the exported route with an empty journal. The retained full-run log is [local follow-up validation](../.zeus/evaluations/phase3b-followup-regression.log).

The optimized evaluation runtime was rebuilt after these changes; the three release cases (large-image/fresh-TLS follow-ups, one owned browser across scripts, and Stop during navigation) all passed again. No evaluation processes remained after teardown. `git diff --check` passed.

The original 229-check and two live-trial evidence above belongs to the prior frozen build. No extra live-model calls were made for this follow-up. Remote CI is still unverified. This implementation checkpoint includes the follow-up changes; generated local trial data and the isolated runtime remain ignored.

### Background-window follow-up

The user reported disruptive rapid window flashes during development. Hidden evaluation launches previously created a visible/focused Tauri window and only hid it in `setup`. Visibility/focus are now set in the generated context before native window creation. Python discovery/action processes and captured shell commands also use Windows's `CREATE_NO_WINDOW`; they already capture output and do not need an interactive console. Normal app launches and deliberately visible browsers/handoffs are unaffected.

The existing native bridge regression now checks actual window visibility and focus while exercising the real rendered webview. Production compile and the full **235-check** regression rerun passed, including all 77 desktop cases. Automatic synthetic-supervisor live diagnostics also now choose a hidden window; the explicit manual-supervision variant retains a visible window for human cards, and the manifest records that distinction. No live-model calls are used for this change.

The user's saved Codex rules already allow `node scripts/run_regression.js`. The prior PowerShell redirection/control-flow wrapper required separate approval; a plain invocation reused the saved rule without another manual prompt. No global permission settings or allow rules were changed. General Codex automatic review is documented separately by OpenAI; it is not Zeus Smart mode.

## Viewer sizing and Phase 3C plan clarification — 2026-10-31

The user clarified that one shared browser executor should be the only production path, and asked why Live/Replay appeared small. The revised [3C proposal](PHASE_3C_LIVE_VIEW_REPLAY_DESIGN.md) distinguishes the old CDP/script recorder from the new persistent owner, independently of browser profiles. After acceptance, retire old execution rather than expose a permanent engine selector; preserve read-only older recording support. Master/workers share the active root-run browser and can use multiple tabs. Independent tasks remain isolated; root completion closes its browser. Start with Zeus-owned profiles and supervised login; personal-browser access remains undecided. A dedicated profile is not an OS sandbox. This is a design amendment, not implementation of the 3C capture or rollout.

The separately requested display repair removes the 1100/1200-pixel modal caps: Live/Replay use the app window with 16-pixel margins. Both fit the image to the actual available space, preserving aspect ratio and target overlays, and attach resize observers when opened. Actual-size/zoom/full-screen controls remain proposed for 3C. This changes presentation of existing recordings, not their provenance, source resolution or browser-engine selection.

Validation:

- `npm.cmd run build` passed, 316 modules.
- `node scripts/run_regression.js` passed **236 checks**: 41 Node, 37 mission/grader, 73 Rust, 7 real Python-browser probes and 78 desktop.
- The new display test was strengthened afterward to open each initially closed viewer and verify overlay coordinates while resizing. `node scripts/run_regression.js --ui` then passed all 7 browser probes and 78 desktop checks. Product code was unchanged between these runs.
- A controller-created 1280×720 page image exercises the actual native webview, existing recording reader and both real viewer components at 1920×1080, 1320×840 and 1000×760. This fixture is display evidence, not agent/browser-capture evidence. Six screenshots are retained in [local viewer review](../.zeus/evaluations/viewer-layout-review/); representative large and narrow views were visually inspected.
- No live-model requests were made, and no test-owned evaluation processes remained. Tests ran hidden; the user's app was not stopped or relinked. `git diff --check` passed. Remote CI remains unverified.

The historical standalone replay UI assertion now expects a large viewport-bounded modal instead of its obsolete 1200-pixel cap. That historical suite was not separately executed; the new default regression exercises both viewers with actual images and overlays.
