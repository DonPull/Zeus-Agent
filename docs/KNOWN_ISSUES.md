# Reliability issues and manual-test findings

Updated: 2026-11-04. This is the active stabilization backlog. Passing regressions cover their tested cases, not universal production stability. The [stabilization patch](STABILIZATION_PATCH_1.md), [Phase 3C](PHASE_3C_WORK_LOG.md), [Phase 3D](PHASE_3D_EXECUTION_DESIGN.md) and [browser reliability follow-up](BROWSER_RELIABILITY_FOLLOWUP.md) preserve repairs and live failures. Shared browsing, live/replay, native handoff and verified transfers are delivered; general goal completion, arbitrary-site recovery, benchmark coverage and broader UI improvements remain open.

## ZA-001 — Native stack overflow during stored-image follow-up

**Priority: release blocker. Status: reproduced and repaired; debug and optimized-release regression passed.**

Stabilization evidence: a valid synthetic 2560 × 1440 image over 5 MB reproduces the same native stack abort on the nested visual-tool path with fresh HTTPS connections. Heap-pinning the nested directive future removes that reproduced failure without increasing stack sizes. Automatic helper → manual inspection → three text-only follow-ups now passes in debug and release with empty native stderr and no UI exceptions. Separate cancellation and full process restart/reinspection tests pass. Before/after evidence is retained in `.zeus/evaluations/stabilization1/reproduction/`; this identifies the failing path and effective repair, not an instruction-level stack trace. The original report and investigation requirements below remain as historical evidence.

User task: `a2ade521-87a6-4526-aed4-d7c1ff769cb3`. First turn identified duplicate game icons successfully, using the configured helper and then an explicit inspection. A text-only follow-up asked for another icon identification and a current patch-notes link. The actor correctly reused `attachment:796695a8-eae2-489e-a2b6-0a97c18ea8a1` without another upload or clicking the reuse button. After sequence 3204 (`analyze_visual`), the process exited with:

```text
thread 'tokio-rt-worker' (37204) has overflowed its stack
exit code: 0xc00000fd, STATUS_STACK_OVERFLOW
```

Read-only database inspection confirmed the input is a validly accepted PNG, **2560 × 1440, 5,802,409 bytes**, within the declared limits. The first two vision requests completed. The follow-up vision request has a durable `in_flight` row with unknown usage, and its delivery was marked interrupted on restart. The run was recovered as interrupted, rather than completed. A request row establishes dispatch intent, not proof of provider receipt. The last known boundary is after vision accounting began and before a result was persisted. These facts do not identify the overflowing frame.

Investigate the nested async directive/helper/gateway path, synchronous serialization/media work and actual process stack behavior. Measure before choosing a remedy. A larger stack alone is not a demonstrated fix; do not invent a generic catch-and-continue mechanism. Rust's [`catch_unwind`](https://doc.rust-lang.org/std/panic/fn.catch_unwind.html) catches unwinding panics, not process-aborting failures. Normal provider/file/validation errors should return a typed failure and toast; a native stack abort needs prevention, and process isolation only if independently justified.

Required repair evidence: synthetic screenshots comparable in dimensions and encoded size; the exact helper → manual inspection → text-only follow-up sequence; repeated inspections; normal cancellation; both debug and release runtime where feasible; actual child-process exit/stderr capture. Test the production library without increasing the stack to hide the failure. Preserve the reproduction and provider/input provenance. Existing small-image scripted follow-up checks and two narrow live trials did not establish this case.

## ZA-002 — Duplicate visible answers from orchestration

**Priority: high. Status: both reported source mechanisms repaired and regression-tested.**

The broad narration scan is removed and final-answer preambles no longer publish as a second visible answer. Legitimate repeated answers in separate turns remain possible. Complete conversational answers, final-answer preamble/summary, reload and bounded malformed-directive recovery have runtime controls. A narrow short standalone action-announcement heuristic remains for protocol repair; it is not a general semantic completion guarantee. Configured provider/model identity is supplied to the actor as runtime metadata.

User task `9dfeeaf2-6d34-4122-84d4-80dcaae24786`, sequences 3188–3191: a normal answer to “which LLM are you” was persisted, then a forced continuation requested a directive, followed by the same answer as a final-answer summary. The narration heuristic matches phrases such as “I'll” anywhere in a reply, including a conversational closing. Any later iteration is also treated as narration. This can convert a completed conversational answer into another model request and repeated output.

The image task shows the second mechanism: the response preamble is persisted as visible chat before `final_answer.summary` is separately persisted. When the preamble already contains the answer, the user sees two copies. These are distinct database messages, not evidence of React rendering one ID twice.

Repair the backend completion/publication contract. Do not hide similar messages with frontend text deduplication: legitimate repeated user-requested answers must remain possible. Preserve raw model output for diagnosis, publish one authoritative final response, and distinguish conversational completion from outstanding actions. Cover both source mechanisms with negative controls and streamed/final reconciliation. Also expose the configured/reported model identity accurately rather than asking the model to guess it.

## ZA-003 — Incomplete post-crash diagnostics

**Priority: high. Status: export enrichment implemented and validated; durable backend events still pending.**

Before this follow-up patch, Copy debug log requested all persisted **master** messages, including hidden ones, with no pagination or deliberate text truncation. It omitted worker conversation histories because the query always constrained `conversation = 'master'`. Its text formatter also omitted message IDs, conversation, model and attachment metadata. Normal user/assistant text was present in the raw section, so a separate chat export was unnecessary for those words; calling it the full internal history was too broad.

The backend logger is an in-memory per-task buffer capped at 2,000 entries. Restart loses it, explaining why a recovered conversation can have stored messages but an empty backend section. An empty buffer must not be presented as evidence that no backend work occurred.

The small diagnostics patch adds an explicit all-conversations query option and a single debug export containing the visible master transcript, all raw task messages, attachment/model metadata, current run and usage, with coverage stated. It does not reconstruct missing process events. Stabilization adds startup reconciliation of orphaned in-flight request rows, retaining unknown usage, and test-owned child-process exit/stderr evidence. Next hardening: bounded durable run/request/tool lifecycle records, version/build and policy provenance, explicit truncation/gap indicators and production child-process exit information. Avoid logging credentials, image base64 or unbounded payloads. Runtime metadata is authoritative evidence; model narration is not.

Validation of this diagnostic slice: 34 JavaScript unit tests, 61 Rust tests and 46 browser/desktop checks passed, along with the frontend build and `git diff --check`. Report tests retain a long chat verbatim, preserve ordering/worker content, expose missing backend events and exclude attachment previews/bytes. The real bridge delegation check proves the debug query includes worker conversations while normal chat remains master-only. These checks do not reproduce or fix ZA-001.

## ZA-004 — Inconsistent new UI and unclear attachment reuse

**Priority: medium; visible usability debt. Status: model-selector layout repaired and visually checked; broader cleanup pending.**

Provider/model/detail controls now stack vertically with scoped grid/spacing and ellipsis, consistent labels, and combobox/listbox semantics. Actual desktop screenshots were inspected at normal and narrower widths. This limited repair does not finish attachment-card styling, accessibility or the complete UI polish pass.

New attachment chips, provider controls and advanced model settings include inline/default browser styling and do not consistently fit the existing spacing, alignment and control styles. Future changes should reuse existing classes/components and receive a visual check at normal and narrow window widths. Schedule a focused polish/accessibility pass rather than claiming this UI is finished.

“Use in next message” explicitly adds the same stored attachment to a new message's input. It is **not required for follow-up inspection**: the actor can invoke `analyze_visual` with the historical handle, as the reported conversation demonstrates. The label makes that distinction unclear. Prefer a subtle optional “Attach again” action or remove it from the normal flow after reviewing the reuse journey. Do not require users to reattach images for ordinary follow-up questions, and do not resend every historical image on every turn. Durable memory/compaction must retain discoverable handles and input ownership.

Manual follow-up on 2026-10-30 found permission titles inherited `user-select:none` from a shared header helper. Titles now explicitly allow text selection, covering approval/handoff/choice cards. A desktop check drags over a real title, verifies selected text, then approves the ordinary card. Broader UI polish remains pending.

## ZA-005 — Correct perception without completing the requested artifact

**Priority: high. Status: workspace-policy defect repaired; reliable goal completion remains open.**

The 2026-11-01 browser follow-up reproduced narration/false tool-unavailability
with Luna on both wire protocols. A transport clarification helped it navigate
once but did not establish reliable continuation. Separate Sol controls passed
successful help, unchanged Done/Resume, cancellation and idle cancellation.
All failures remain retained; this is not a general Solo/Team or model-ranking
baseline. See [the follow-up](BROWSER_RELIABILITY_FOLLOWUP.md) and its
[durable work checkpoint](RESUME_BROWSER_RELIABILITY.md).

Phase 3B's two fixed-build Luna B01 browser attempts reproduce the broader orchestration gap. One falsely claimed browser tools were unavailable despite receiving the managed-tool contract; no tool was invoked. The other made the correct update through one real browser, recovered from a wrong locator, and independently passed all five outcome criteria, but exhausted its 12-request allowance before final-answer completion. Planning/narration/protocol-repair turns contributed overhead. Both failures remain retained; this does not prove an insufficiently intelligent model or a broken browser service. Deterministic initiation/completion and accurate tool availability are still required. See [exact records and usage](PHASE_3B_WORK_LOG.md#two-fixed-build-live-diagnostics).

The seven stabilization diagnostics retain both passes and failures. Direct Luna V01 and D01 generated correct artifacts, and one helper run wrote the correct file after an immediate real supervisor approval. That helper run still failed its combined follow-up execution at a request cap; other helper runs stopped with prose, protocol problems or provider output exhaustion. Three of seven artifact outcomes passed; no fully verified authorization passes are claimed. See the stabilization packet for exact configurations and the combined report. General deterministic task state/completion is still required; upgrading the model or relaxing the grader is not the repair.

The Phase 3A V01 task was deliberately small: compare two supplied order screenshots and **save `comparison.json`** containing order ID, currency, changed SKU/quantities and totals in integer cents. This was not a complex application-development task.

Direct Abacus `gpt-4.1-mini` read the images correctly but replied with JSON in chat and did not save the file. Helper `gpt-4.1-mini` also read them correctly; actor `gpt-5-nano` proposed the correct write, then the run timed out waiting for ordinary approval. The external supervisor's approval arrived too late. Thus neither task produced its required artifact. They are not failed perception tests and do not prove the models could not solve the comparison. Their original outcome grades stay failed.

The unnecessary approval was linked to Windows extended-path normalization. The shared policy now resolves local containment and evaluates explicit rules before automatic allowances, preserving task/global specificity. Prefix boundaries, traversal, case, relative/new files and unverified network paths have controls. The synthetic supervisor approves only bounded declared file operations through normal cards, once, and denies unexpected actions. The remaining premature text result needs a stronger task-state/completion contract; chat text is never extracted as the graded artifact.

## ZA-006 — Stale economical-model choices and evaluation gaps

**Priority: medium; prerequisite for broader live runs. Status: selection policy updated, automatic routing remains later work.**

Phase 3A live trials used **GPT-4.1 mini and GPT-5 nano**, not GPT-4o or GPT-5 mini. Some offline fixtures use GPT-4o mini as a model label but contact only a local mock. The live choices were bounded familiar adapters, not a researched claim of the best current intelligence per dollar.

Before future live suites: refresh primary benchmark sources; verify exact available IDs through Abacus; verify protocol, image input and effort behavior; choose a task-appropriate economical model; freeze its exact configuration and retain source/date. The user's suggested GPT-6 Luna (low/medium/high) and MiMo-V2.6-Flash are candidates. Public direct-provider token prices are **not Abacus subscription-credit charges**, and leaderboard intelligence is not Zeus goal-completion performance. Compare expected total task cost including reasoning, retries, helper calls and corrections. Current AA Intelligence Index versions differ from older cached comparison pages; use one methodology/version for any score comparison.

Keep deterministic software/negative-control tests, add targeted real-provider protocol checks as each feature stabilizes, then run a bounded mixed live acceptance pack covering text conversation, follow-up images, files, browser continuity, cancellation, recovery and permissions. Repeat under frozen configurations and keep failures. A broader suite should gate a first stable release, not wait until every long-term feature is implemented. Voice, generation, automatic routing and a full Team redesign need not delay a reliable scoped v1.

## ZA-007 — Global model selector blanks the UI

**Priority: high. Status: reproduced, repaired and regression-tested.**

Opening the global model list called `getDisabledReasonForRole`, which referenced an undefined `connection`. React's render exception removed the UI. It now reads the selected role binding. Previous tests wrote settings through the bridge and missed the dropdown interaction. The new desktop test opens/selects every role in global and task settings, saves/reopens, and fails on unexpected page errors. Scoped settings/root render boundaries show recoverable feedback; a controlled fault test verifies recovery without treating ordinary test exceptions as acceptable. These boundaries do not catch native aborts or arbitrary asynchronous errors.

## ZA-008 — Parsed inline directives leak into narration; retry advice ignores prior effects

**Priority: medium for publication; high before automatic recovery/retry. Status: observed in retained Phase 3B live evidence; not repaired in this browser-owner slice.**

The second B01 run parsed and executed an inline `update_action_plan` directive, but the JSON remained in the visible narration. The runtime's generic request-cap error also suggested resending the message even though the browser had already saved the ticket. No duplicate mutation occurred, and the new journal does not automatically retry uncertain effects. Before enabling automatic recovery, fix backend publication boundaries and make error advice respect completed/uncertain work. Keep the raw conversation and real side-effect audit as regression fixtures; do not hide command content using frontend visibility heuristics.

## ZA-009 — Shared browser, Live View and Replay delivered; compatibility remains

**Priority: high for arbitrary-site reliability. Status: 3C ownership/live/replay and 3D native handoff/transfers delivered; broader compatibility and completion remain open.**

The browser reliability follow-up adds default prepared ad blocking, browser-level
audio policy, a 1600×900 viewport and clearer action annotations. Its final full
regression passed 293 checks. Four bounded live Sol handoff scenarios passed,
while Luna initiation/continuation failures remain under ZA-005. The public-site
reference smoke now verifies one submitted Wordle guess with actual feedback
after normal keyboard activation of an animated onboarding button. None of this
establishes a repeated five-game speed/cost improvement; the canonical benchmark
checkpoint must measure that separately.

The first optimized follow-up run after restart displayed seven live updates
in a two-second window against a minimum of eight. A targeted control displayed
16 and final full optimized acceptance displayed nine, without product changes
or reducing the assertion. Capture duration was 23 ms in the controls; the
cause of the cadence variation remains unestablished. The 8 FPS setting is a
target, not a guaranteed rendered rate. Keep the retained failing timing record
when evaluating preview performance; do not represent a rerun pass as a repair.

Phase 3C replaces the executable old launcher/recorder with the sole shared owner. Independent real pixels feed large Fit/zoom/full-screen viewers; paged history retains actual outcomes and available before/after images, coverage gaps, export and explicit image deletion. Runtime setup persists without engine flags. Root completion now waits for browser cleanup, fixing a repeat-run ordering failure. Final validation passed 257 offline checks and seven optimized native checks. Two fixed-build live Luna B01 attempts retained an initiation failure and a completed independently checked workflow/final summary: one session, 13 exported images, zero owned processes remaining. The latter meets this rollout gate, not general task reliability or isolated authorization certification. [Decisions and evidence](PHASE_3C_WORK_LOG.md).

Phase 3B implements one session per task/root run across Solo/Team/scripts, lazy acquisition, readiness validation, normal policy binding, durable actual-action journaling, stable status projection, root cleanup and restart uncertainty. Seven real-browser probes, 17 new desktop checks, relevant existing regressions and three release cases passed. The second bounded live B01 attempt confirmed one session and graceful cleanup with zero owned descendants. These checks establish their cases, not universal browser competence or a completed goal.

Historical 3B boundary: `ZEUS_MANAGED_BROWSER=1` was development opt-in; that build intentionally kept the old ordinary route until a usable viewer existed. 3C removed that execution branch and retained bounded read-only older-recording adapters. 3D delivered supervised native handoff and transfers in the Zeus-owned profile. Personal-browser access remains unapproved. [Historical 3B evidence](PHASE_3B_WORK_LOG.md).

The subsequent manual Wordle diagnostic used the **legacy route**, with a stored CDP worker prompt and no managed sessions. Its four `sess_*` lifecycles are script recordings; the supplied log has only one explicit process spawn. The worker then downloaded every `.js` URL in the page resource inventory, including unrelated advertising integrations. This explains the Python network cards; it is not proof of prompt injection or a reason to auto-allow those domains. Hidden-control targeting, unknown feedback treated as absent, five-games/five-wins objective drift and the “at any cost” recovery instruction remain general execution/supervision work. One legacy approval remained pending after cancellation; general run-bound approval expiry remains open. [Investigation and scoped repairs](PHASE_3B_MANUAL_FOLLOWUP.md). Debug exports now explicitly label the current exporting process's route even with no managed sessions.

## ZA-010 — Duplicate Stop notices from nested cancellation handlers

**Priority: medium. Status: reproduced from the call paths, repaired and targeted native checks passed.**

Workers, master loop/tool waits and the outer send error boundary each called `finish_cancelled_run`. A delegated cancellation could therefore persist three distinct notices, matching the user's log. Children now propagate `RUN_CANCELLED`; only the root boundary finalizes after unwinding/owned browser cleanup. Notice, interrupted plan, attachment cancellation and terminal run state commit together. Re-entry returns the existing cancelled run without another notice or accidentally releasing a newer task run. No frontend text deduplication or history deletion is used. Checks cover master/worker/verifier waits, a worker approval, database/visible uniqueness after reload, transaction rollback and per-run identity.

## ZA-011 — Live/replay viewers are too small and do not reliably fit the available space

**Priority: medium. Status: scoped display repair implemented and locally validated.**

The user reported consistently small viewing panes. Existing Live/Replay widths were limited to 85/90% and capped at 1100/1200 pixels. Images used intrinsic sizing with percentage maxima, which could leave available space unused or clip vertically. Resize observers also ran while the initially closed modal had no mounted viewport and did not reattach on opening.

Both panes now use the app viewport minus a 16-pixel margin on each side. A shared fit helper uses the real available content dimensions, preserves aspect ratio, and keeps overlay scale tied to the displayed image. Resize observers attach when each modal opens. A native display-only control renders a representative 1280×720 page image and checks both viewers while resizing between 1920×1080, 1320×840 and 1000×760. It does not claim to verify agent capture or task execution. Explicit zoom/actual-size/full-screen controls remain in the 3C proposal.

The frontend build and full **236-check** regression passed (41 Node, 37 mission/grader, 73 Rust, 7 real Python-browser probes, 78 desktop). The new display test was then strengthened to open each initially closed viewer and verify target-overlay coordinates at every size; the complete UI group passed again (7 real browser probes and 78 desktop checks). Six screenshots were retained and representative large/narrow views inspected. No live-model calls were made. [Validation record](PHASE_3B_WORK_LOG.md#viewer-sizing-and-phase-3c-plan-clarification--2026-10-31).

The same feedback clarified that **execution engines** are separate from browser **profiles**. Accepted 3C now retires old execution and preserves only historical readers; there is no permanent engine selector. Zeus-owned profiles remain the scope, with personal-browser access undecided. The new shared viewer adds explicit zoom/full-screen controls and independent capture; see ZA-009 for final validation.

## Next stabilization checkpoint

The subsequent [browser UX follow-up](BROWSER_UX_FOLLOWUP.md) addresses relative file links unloading chat, active-session Replay affordances, freshness/status presentation, centered replay jumps/playback and generic readiness/input overhead. It removes the normal recording-export button while retaining a separate maintainer CLI. Fixed viewed capture targets 8 FPS/quality 80, with no load-based throttling and no corresponding increase in archive frequency. Native document rendering, compression, conversation transfer, comprehensive UI polish and browser hydration on arbitrary sites remain outside this patch. The work log retains the exact validation and limits; these controls alone do not establish faster or more reliable live-model task completion.

Phase 3C passed **257 offline checks plus seven optimized checks**, frontend build and production compile. Its two bounded live attempts retain one false tool-unavailability reply and one independently correct workflow/final summary with recorded history and clean shutdown. Authorization is still partially evaluated; no fully verified isolated baseline is claimed. The earlier 3B/stabilization results remain historical and are not retroactively upgraded. Next browser design is 3D; deterministic initiation/task state/completion/memory remains high priority, as does a mixed-task live acceptance pack with frozen settings and retained failures. Remote CI remains unverified.

## Chat/replay usability follow-up — 2026-11-01

The user's next manual review identified replay seek flashes and delayed highlighting, gaps during playback, accumulated playback delays, scrolling modal headers, hidden expanded-draft images, permanent prompt truncation in titles, and a completed plan displayed at 0%. These are addressed in the [chat workflow follow-up](CHAT_WORKFLOW_REFINEMENT.md), with explicit decisions and regression coverage. The plan failure was `[Done]` being parsed as pending; it is not evidence that semantic goal verification is solved. Playback rate remains limited by actual image validation/decoding/rendering. General task-state reliability, arbitrary-site recovery and broader UI polish remain tracked work.
