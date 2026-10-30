# Phase 3: reliable images and managed browser execution

Status: **3A approved and implemented. The subsequent approved [stabilization patch](STABILIZATION_PATCH_1.md) repairs the reproduced native crash, model-selector render crash and duplicate publication. Remaining completion/browser/diagnostic gaps are tracked in [the issue register](KNOWN_ISSUES.md); this is not a stable-v1 certification. Section 10 retains the original 3A evidence. Browser packets retain separate design checkpoints.**

Prepared: 2026-10-28. Reviewed baseline: `f3c1c80`, containing Phase 2A/native 2B and the confirmed Responses history repair. That checkpoint has 149 passing automated checks and a passing frontend build. This packet follows the user's requirement to align on substantial changes before implementation.

## 1. Recommendation and tangible differences

Start with **3A: reliable image attachments**, including the provider identity needed to deliver them correctly. Then tackle browser ownership and observations in separate increments. The six-mission diagnostic subset supports targeted repairs; a larger Phase 2 pilot, isolated executable grading, held-out tasks and repeated capability baselines remain pending. Moving to these repairs before expanding the baseline is a proposed reprioritization, not a claim that Phase 2 is finished.

| Increment | Tangible difference | Required evidence |
|---|---|---|
| 3A: images and provider identity | Uploaded/pasted images reach a capable actor or its explicitly configured helper. Same-name uploads remain distinct. Failed uploads remain retryable, with specific errors. | Picker/paste, persistence, bytes on both protocols, restart, normal permissions, helper/direct paths and a small real-Abacus perception check. |
| 3B: shared browser owner | Solo and Team acquire the same browser service lazily. Data-only scripts launch no browser. Scripts and worker handoffs share a session; owned resources close at a terminal run transition. | Real local-browser continuity, ownership, readiness/failure, task isolation, cancellation and process cleanup. |
| 3C: live view and replay | Reopened Live View shows current state. Replay records attempts and actual outcomes, survives cancellation/restart, and no longer ends when a Python script exits. | Independently changing fixture pixels, hydration, failed-action evidence, bounded capture, restart and ordered action checks. |
| 3D: handoff and compatibility | A real visible handoff pauses/resumes automation. Legacy APIs show actual support and recording coverage. | Headed Windows workflow, ownership, explicit recovery across any necessary restart, truthful unsupported responses. |

The first implementation approval should cover **3A only**. Sections 6-8 give the researched browser direction; finalize that contract and a feasibility check before implementing 3B. Memory, Smart approvals, Team supervision, model ranking, audio/video/voice, image generation and OS sandboxing retain separate phases.

## 2. Code findings and reproduction

Approved 3A decisions (compared with the old implementation):

- Explicit provider/model binding replaces prefix-based provider choice; new hosted roles default to Abacus and legacy selections retain a visible migration path.
- Durable attachment IDs and validated immutable storage replace filename overwrites and text-only path notes.
- Capable actors receive actual image parts; configured helper fallback/override remains supported, with deterministic initial dispatch.
- Atomic attachment-aware send and retryable drafts replace sending incomplete input after an upload failure.
- Typed delivery errors and retained usage replace successful-looking text wrappers around perception failures.

These are source-path findings unless a reproduction is stated. They explain failure modes without proving which settings caused an earlier manual conversation to fail.

| Finding | Source | Consequence |
|---|---|---|
| Default vision is `gemini-3.8-flash`; every `gemini` model routes to Google and requires its separate key. | `settings.rs::default_vision_model`, `gateway.rs::get_api_config` | An Abacus-only installation can upload successfully and fail at visual analysis. Selecting an Abacus Gemini ID does not preserve provider identity. |
| Hosted/local catalogues become model-name strings. Local registration can override an overlapping hosted ID; absent hosted credentials can fall back to localhost. | `gateway.rs::fetch_available_models`, `get_api_config` | Connection, model and capability are ambiguous. Another model-name heuristic is insufficient. |
| `ChatMessage.content` is a string; the UI appends a file-path note. Bytes reach inference only if the actor invokes `analyze_visual`. | `App.jsx::handleSend`, `gateway.rs::ChatMessage`, `orchestrator.rs::AnalyzeVisual` | Even a capable actor does not directly see uploads. Successful storage is insufficient evidence of perception. |
| Storage overwrites `attachments/<original basename>`; it has no attachment record, byte/dimension quota or content decoding. | `chat.rs::save_task_attachment` | Same-name uploads collide. Extensions/frontend MIME labels are trusted too much. |
| Draft/tray clears before save. An upload failure shows a toast while remaining text is still sent. | `App.jsx::handleSend` | A task can run without its necessary input, and the user loses the pending attachment. |
| Visual failures become text inside `visual_analysis_result`. MIME follows extension; the helper always uses Chat Completions and temperature 0.1. | `gateway.rs::analyze_visual`, `orchestrator.rs::AnalyzeVisual` | Capability, format, credential and provider failures are conflated; parameter support can differ by model. |
| Solo Python gets no managed browser endpoint. Workers ensure a browser for every script and swallow startup errors with `.ok()`. | `chat.rs::RunAction`, `worker.rs::RunAction` | Solo/Team execution differs; data scripts launch unnecessary browsers. Instructions cannot supply a missing endpoint. |
| Each Python action allocates a recording ID and finalizes at `atexit`. | `python_runner.rs::run_python_action` and preamble | Many session cards can describe separate scripts against one browser process rather than separate actual browsers. |
| Every manifest write sets `completed_at`. Click wrappers record before clicking. A failed capture still leaves a screenshot filename. | Embedded `_zeus_write_manifest`, click wrappers, `_zeus_record_step` | Active sessions appear completed; failed clicks lack outcomes; replay can reference nonexistent images. |
| Frames depend on instrumented sync actions and private locator details. | Embedded Playwright monkey patches | Idle animation/loading is not live; async/uncovered APIs leave gaps. |
| No browser-manager terminal close operation; handoff only logs; configure/extension directives return success without applying changes. | `browser_manager.rs`, `orchestrator.rs::execute_directive_bypass_gatekeeper` | Cleanup/handoff are incomplete; successful-looking tool results can mislead the actor. |
| Replay loads every image into one base64 response; Live View trusts premature completion. | `browser_manager.rs::get_browser_session`, `BrowserLiveViewModal.jsx` | Long recordings create large responses; hydration can mark an active session complete. |
| Workspace checks use string prefixes and strip the Windows extended-path prefix after replacing separators. | `gatekeeper.rs::evaluate_file_permission` | Workspace actions can ask unnecessarily. A naive repair could widen access; require boundary/deny tests. |

The **actual embedded recorder preamble** was run with a controlled failing click/capture stub: session still active; manifest already completed; one recorded click without outcome; referenced screenshot missing. This was an instrumentation probe, not a real-browser/capability test. Synthetic evidence: `.zeus/evaluations/phase3-discovery/recorder-probe.json`. No new model calls were made in this design work. Python Playwright 1.62.0 is installed locally; deployment availability still needs explicit handling.

## 3. Research and alternatives

Abacus documents multimodal Chat Completions and base64 image inputs. Images through the primary gateway do not require a direct Google/OpenAI account. Retrieve exact model IDs from the chosen connection; catalogue membership alone does not prove image capability. [Abacus overview](https://api.abacus.ai/help/route-llm/), [image inputs](https://api.abacus.ai/help/route-llm/chat-completions/image-analysis).

Chat uses `text`/`image_url` content parts; Responses uses `input_text`/`input_image`. Base64 data URLs carry bytes. Use typed internal content and protocol serializers while preserving valid assistant history. This is format guidance, not a recommendation for separate OpenAI billing. [Official OpenAI vision guide](https://developers.openai.com/api/docs/guides/images-vision), [Abacus Responses contract](https://api.abacus.ai/help/route-llm/responses).

Always using a helper is a smaller workaround but adds inference and potentially loses details even when the actor can see images. Sending images to every model fails on text-only endpoints. **Recommend direct input for confirmed capable actors, configured-helper fallback for text-only actors, and an explicit helper override.** Automatic model ranking is outside 3A.

Playwright documents lower fidelity for CDP attachment than its own protocol; Playwright server connections also require compatible client/server versions. These support an owned service, without proving CDP alone caused the existing bugs. [Connections](https://playwright.dev/python/docs/api/class-browsertype#browser-type-connect-over-cdp), [server/version requirements](https://playwright.dev/docs/api/class-browsertype#browser-type-launch-server).

Persistent contexts and traces can provide storage continuity and browser-operation/screenshot/DOM/network evidence. Traces supplement the app journal, can contain sensitive content, and do not prove goal completion. [Persistent contexts](https://playwright.dev/python/docs/api/class-browsertype#browser-type-launch-persistent-context), [tracing](https://playwright.dev/python/docs/api/class-tracing).

Use locator actionability checks and structured page observations alongside screenshots, rather than timing guesses or artificial human delays. These are general tools, not game strategies. [Actionability](https://playwright.dev/docs/actionability), [accessibility snapshots](https://playwright.dev/python/docs/aria-snapshots).

Chrome 136 changed debugging behavior for its default profile. Current `main` mode cannot be assumed to work by omitting a custom data directory. External browser attachment needs explicit ownership/compatibility semantics. [Chrome announcement](https://developer.chrome.com/blog/remote-debugging-port).

## 4. First implementation packet: 3A

### Provider binding

Introduce a `ModelRef` with connection ID and exact model ID. Its resolver supplies credential reference, endpoint origin, protocol and capability record. Once explicitly bound, none is selected by model-name prefix. Retain Abacus, Gemini development, Xiaomi development and configured local connections; IDs can legitimately overlap.

Persist additive task-role bindings with unique `(task_id, role)` and the model ID to which the binding applies. Update atomically with existing model/effort settings; a stale binding cannot follow an unrelated new model. Global/default bindings remain in settings; disabled roles have none. Credentials stay in the credential store, outside tasks/messages/manifests.

New hosted selections default to **Abacus**; direct development/local routes are explicit choices. Group catalogue options by connection with provenance/freshness. Hardcoded fallback names must not be shown as verified live availability. Missing credentials return a connection error rather than switching to localhost. Keep the offline mock separately validated.

Existing tasks preserve their effective legacy route until resolved and persisted; do not silently change the billable provider. Expose the legacy route and a direct action to bind it to Abacus. A legacy Gemini helper with no Google key should explain the mismatch and offer that action. Old model-name-only data cannot establish user intent. Migrations must preserve historical records and cover Abacus-only, direct development, local and overlapping IDs.

Capabilities use supported/unsupported/unknown states keyed by connection/model, with evidence and freshness. Begin with a small documented/tested adapter matrix and real provider metadata where supplied. Unknown image support needs explicit validation/override; never silently remove image input. Emit temperature/reasoning fields only when supported. Apply explicit bindings across actor, worker, verifier, Watcher and vision entry points so settings have one meaning. Extend effective configuration/accounting with connection and protocol provenance, preserving actual endpoint origins. This repairs correctness; Phase 7 retains intelligence/cost optimization.

### Durable attachments and atomic send

Add `attachments`, `message_attachments` and per-request delivery-attempt records. Store UUID, task, original display name, storage key, detected MIME, byte count, SHA-256, image dimensions, creation time and storage state. Links hold message, attachment and order. Delivery state is scoped to run/request/route, so reuse or failure never mutates the original input into another attachment.

Publish under `tasks/<task>/workspace/attachments/<UUID>/<sanitized-name>` using an owned temporary file and atomic publication. Validate task ownership and resolved containment, including reparse points. Honor explicit denials. User upload authorizes processing that exact task input, not arbitrary filesystem access or publication.

Proposed initial image limits: PNG/JPEG/WebP; 10 MiB each, 30 MiB and eight images per message; 25 million decoded pixels/image. Use a maintained decoder with allocation limits, not headers alone. Preserve original bytes; reject malformed, unsupported animated and oversized input clearly. Ordinary non-image uploads keep a separate generic-file path; do not call a PDF/video a PNG. Resizing and audio/video processing are later features.

Return a typed DTO from `saveTaskAttachment`. Add an optional ordered attachment-ID list to `sendUserMessage`, preserving text-only callers. Validate ownership/readiness and link inputs to the persisted user message in the transaction starting the durable run. The existing idempotent request ID prevents duplicate sends/messages.

Keep draft/tray until backend acceptance. If any required upload fails, stop the send and retain Retry/Remove; sending without it is an explicit user action. Hydrate persisted chips/previews on reload, without optimistic durable messages. Clean up staged orphans by owned ID after a grace period, never by broadly deleting workspace files.

Legacy path notes remain readable. Only actual user-message references inside that task's owned attachment directory may be explicitly imported after validation; never interpret an arbitrary webpage/model path note as an upload. Missing/overwritten historical bytes remain unavailable rather than being reconstructed.

### Model input and helper behavior

Build structured text/image input from backend attachment links. Base64 exists transiently in provider payloads, not stored chat/debug text. Serialize Chat and Responses correctly, preserving text-only history. **Auto** sends images directly to a confirmed capable actor; a confirmed text-only actor uses the configured capable helper. **Use helper** preserves an explicit Zeus Eyes workflow. If no valid path exists, fail preflight with an actionable error and retain input. No silent provider or expensive-model substitution.

New-turn helper dispatch is deterministic and bounded, rather than relying on the actor remembering a tool call. The helper receives the relevant question and ordered images; its observations identify attachment/model sources and are untrusted evidence, not policy. Retain `analyze_visual` for follow-up inspection and authorized browser screenshots. Use one workspace-aware resolver for path input; remove fallback to an unrelated process current directory.

Track queued/dispatched/succeeded/failed/cancelled delivery attempts, with typed errors for invalid media, missing bytes, disabled helper, unsupported capability, credential failure, provider rejection, empty analysis and cancellation. HTTP success is delivery/response evidence, not proof an image was understood. Attribute direct image usage to the actor and helper usage to vision without double counting.

Retain attachment references across current compaction/restart. Include current-turn/explicitly referenced images and stable handles for older inputs; do not resend every historical image forever. If an image cannot fit the request allowance, report it rather than silently dropping it. Full memory redesign stays in Phase 4.

### Implementation sequence and acceptance

1. Reproduce routing and delivery failures with isolated settings/strict mocks; add same-name and failed-upload controls. Capture the actual selected endpoint/model error before attributing any remaining live failure.
2. Implement provider binding, resolver and additive migrations. Prove role consistency, missing-key behavior and legacy compatibility.
3. Implement attachment storage/linking and atomic send, including validation, quotas, idempotency and reload.
4. Implement both multimodal serializers and deterministic helper fallback, then picker/paste/retry UI through the bridge.
5. Run offline checks and small Abacus confirmation using existing V01 facts/graders. Preserve every result.

| Check | Required result |
|---|---|
| Abacus Gemini/direct Gemini; hosted/local same ID | Declared connection/credential, stable routing and no second provider requirement for Abacus. |
| Picker, paste, image-only send, duplicate filenames | Correct ordered links and exact validated bytes; distinct hashes/storage survive reload. |
| Invalid/renamed/oversized image, failed upload | No invalid inference input or silent text-only continuation; retryable draft/items. |
| Direct Chat, direct Responses, helper, helper disabled | Correct schema and declared path or explicit preflight failure; valid multi-turn history. |
| Cross-task ID, escaping/link path, explicit deny, missing bytes | Reject unintended reads/transmission while preserving normal approvals. |
| Provider rejection, empty result, interruption, cancellation | Specific original error, correct run state/known or unknown usage, no duplicate hidden request. |
| Restart/compaction, old-image reference, repeated request ID | Retained identity/order, no overwritten image or duplicate durable user message. |
| Worker follow-up inspection | Same service/policy with actual role attribution. |

Mocks prove software delivery, not vision quality. After they pass, use at most two native supervised trials: direct and helper, four model requests each, one in flight, 2,048 output tokens/request, 75,000 token equivalents including reservations per trial, twelve directives and 120 seconds each. Freeze exact economical Abacus IDs after catalogue/capability preflight; use a validated mini/flash model where available. Record unsupported if none qualifies rather than choosing an expensive model. At most eight requests total; provider credits remain unknown. No prompt tuning/retry-until-pass loop. Native isolation and general authorization remain unverified.

## 5. Compatibility and rollback

Use additive migrations; retain old model choices/messages/raw usage. Back up the owned development DB before migration tests, test a legacy schema and rerun migrations. Include changed routing/delivery semantics in configuration fingerprints; a helper-only and direct-image trial are different configurations.

Split 3A into coherent provider, attachment, delivery and UI commits. Return unsupported while a route is incomplete. Code rollback can leave new tables/files inert without deleting historical evidence. Optional bridge fields preserve text-only clients. Development providers remain supported; no new mandatory upstream accounts.

## 6. Browser service direction for 3B

Recommend a **long-lived automation broker per active task/run**, supervised by Rust. Initially prefer trusted Python async Playwright, reusing an existing runtime dependency. A Node Playwright server is an alternative if a packaging/compatibility spike demonstrates an advantage; it requires an explicit runtime/version-distribution decision. Do not rewrite the app into either language.

The broker owns Playwright/context/pages. Agent Python remains a separate process, calling a small client or typed browser directives over bounded task/run-authenticated IPC, without arbitrary code execution inside the broker. Standard operations: observe, navigate, locator actions, keypress, wait for a condition, tabs, dialogs, upload/download and screenshot. Supply DOM/accessibility evidence and pixels. Any later page-evaluation escape hatch needs explicit permission/recording semantics.

Solo and Team use the same service and authorization. Acquire lazily; data scripts start no browser. Wait for readiness and return startup errors. Serialize mutation via a lease; verifiers can inspect without concurrent conflicting writes. General worker concurrency stays in Phase 6.

Distinguish goal session, process generation, context, tab and action IDs. Initially scope the goal session to `(task_id, root_run_id)` across all scripts/workers. Subsequent user runs create sessions unless an explicit resume contract links them. Crashes/restarts record generations and gaps, rather than fake process continuity. Profile persistence is separate from process lifetime.

Rust owns durable `browser_sessions`, `browser_tabs`, `browser_actions` and artifact references. Journal requests before dispatch and outcomes/uncertainty before durable events/tool results. No DB mutex over broker I/O. Manifests become atomic derived exports; screenshots/traces remain owned artifacts.

Transitions: starting -> active -> optional handoff -> active -> finalizing -> completed/cancelled/failed/interrupted. Pending approvals/handoff retain the session; Python/worker exit does not finalize it. Root-run termination closes owned resources. A crash during an external side effect yields uncertainty and reconciliation rather than automatic replay. Startup marks orphaned sessions interrupted and exposes partial evidence.

Use a dedicated owned profile; imports/extensions are explicit, never automatic repository-profile copies. Externally attached browsers carry external ownership and are disconnected without closing user processes. Do not promise takeover of Chrome's default profile. This service is a reliability boundary, not an OS sandbox.

## 7. Preview and replay direction for 3C

Capture independently in the broker. Prototype two JPEG frames/second, bounded encoded size, one capture in flight and a latest-frame-only queue; measure overhead and reduce idle/no-viewer rate. Never launch a separate preview browser. Slow UI drops stale frames, not action records. Expose capture failure/staleness with timestamps.

Hydrate status/latest frame with a version/sequence, merge events by task/session/generation, and reconcile subscriptions so late hydration cannot overwrite newer state. Clear state/unsubscribe on session switches. Only authoritative terminal status marks completion.

Replay paginates actions and lazily loads bounded images. Include redacted action/target/value, before/after references, timestamps and succeeded/failed/cancelled/uncertain outcome. Image availability is separate from action success; overlays identify their actual frame. Legacy recordings retain incomplete-coverage labels and are never promoted into verified history.

All normal broker actions must be recorded. Raw CDP/arbitrary scripts/manual human actions carry explicit coverage limits until supported; partial monkey patches cannot promise exact history. Optional trace chunks provide debugging evidence with bounded retention and sensitive DOM/network handling; keep them local and do not automatically upload them.

Mask known sensitive fields; omit raw password/token fills and authenticated URL secrets. Sensitive handoff can pause/redact capture with visible gap markers. Redaction is incomplete; do not promise arbitrary page pixels are secret-free. Finalize storage caps/retention/delete/export in the 3C packet. A full storage cap marks truncation visibly.

## 8. Browser acceptance and handoff checkpoint

Before 3B implementation, prove a small broker against B01 with a pinned/validated runtime/browser. No inference is needed for ownership/readiness. Confirm deployment detection, Windows process-tree cleanup, cancellation, IPC authentication/framing/limits and independent capture feasibility. Avoid another private-locator monkey-patch layer.

Required real-browser cases: multiple scripts and worker handoff retain one session/state; data-only actions start zero browsers; tasks cannot share tabs/frames; failed clicks/navigation remain failed; reload/reopen hydrates active state; fixture timer changes preview pixels without an agent action; crash/cancel retains partial replay and leaves no owned processes/listeners; role changes preserve authorization; unrelated user browsers remain untouched. Screenshot stubs cannot establish this coverage.

For 3D, prototype headed Windows handoff before choosing visibility policy. Headless/headed conversion can require a restart: preserve logical session, record the generation and validate restored state, without promising every in-progress form survives. Keeping the owned browser headed with controlled visibility is an alternative to validate. During handoff the actor stops mutations, UI offers Resume/Cancel, and sensitive input stays out of model logs.

Configure/extension/main-browser controls must perform the operation or return typed unsupported; do not keep success stubs or silently remove exposed controls. A later fixed live B01 diagnostic can measure use of these tools after software checks pass. Preserve outcome/authorization distinctions; no Wordle-specific engine or broad intelligence comparison.

## 9. Review checkpoint

The approved implementation packet was **3A**: explicit default Abacus routing, direct images for capable actors, configured-helper fallback/override, stable task attachments and atomic send/retry. These material behavior/migration choices were presented before coding; the delivery record follows.

Browser implementation, visibility and recording retention have their own checkpoint after 3A. A completed run, a correct artifact and independently verified authorization remain separate observations. The repeated capability baseline remains open work.

## 10. Phase 3A delivery record (2026-10-28)

### Tangible changes and final decisions

| Decision | Previous behavior | Delivered behavior |
|---|---|---|
| Bind provider and model together | Prefixes/local registration chose the provider; missing hosted keys could fall back to localhost | Explicit per-role connection/model/protocol bindings; new hosted selections use Abacus; missing credentials fail clearly. Existing routes are preserved until explicitly changed. |
| Preserve attachment identity | Same-name files overwrote one another; chat contained path notes | UUID storage, content decoding, dimensions/hash/ownership checks, ordered message links and stable handles. |
| Deliver actual image input | The actor saw text and had to remember to call a helper | Auto sends image parts directly to a confirmed capable actor. Otherwise a configured capable helper runs deterministically; Helper mode explicitly forces that path. Unknown support is conservative and configurable. |
| Accept the complete send atomically | A failed upload could still send text and clear the draft | Upload/preflight failure retains draft and tray; committed run/message/links trigger an acceptance event. Image-only input, paste, previews and reuse use the same service. |
| Expose perception failures | Failed helper calls became successful-looking analysis text | Typed errors, original provider rejections, request/role/connection accounting and durable delivery state. Follow-up inspection shares permission/cancellation handling. |

The provider catalogue retains connection provenance and freshness, with no fabricated availability fallback. A small exact adapter matrix supplies known image/protocol support; users can declare support for other exact model IDs. Catalogue membership alone does not establish capability. The per-request route snapshot records the resolved protocol and whether image support came from the dated adapter or a user declaration. Automatic ranking/model substitution is not implemented.

The additive migrations preserve historical messages, model choices and raw usage. An online SQLite backup of the development database was retained before attachment integration at `.zeus/evaluations/dev-db-backups/before-3a-attachment-integration-20261028T152031Z.db`. Existing Gemini selections can still resolve to the direct Google development connection until the user selects **Abacus** in that role's provider control; spending is not silently redirected. Global and task settings expose provider, protocol, image-support declaration and Auto/Helper preference. The [bridge contract](../BRIDGE.md) documents DTOs, acceptance, errors and migration behavior.

Images are static PNG/JPEG/WebP, limited to 10 MiB and 25 million pixels each; message limits are eight attachments and 30 MiB. Byte decoding validates the actual content, with strict dimensions and a best-effort 128 MiB decoder allocation allowance. That allowance is not an OS memory boundary. Uploaded bytes have stable identity and are hash-checked; the filesystem is not read-only or isolated. Cross-task IDs, changed bytes, explicit denials and link/reparse storage are rejected. Opportunistic cleanup removes at most two unchanged unlinked uploads older than seven days per upload; linked history is retained. Historical overwritten images cannot be recovered or silently imported from arbitrary text notes.

### Software validation

The offline checks cover both provider payload protocols, same-name inputs, local/hosted duplicate IDs, direct/helper/override paths, disabled/unknown capability, stale settings rollback, picker/paste/image-only sends, reload/previews/reuse, follow-up handles, invalid/oversized media, changed bytes, cross-task IDs, explicit deny/reparse paths, repeated request IDs, provider errors and cancellation. A real database close/reopen test retains ordered links, dimensions, explicit routes and completed delivery history while interrupting unfinished attempts. Decoder tests cover PNG/JPEG/WebP, truncation, byte limits and a valid-header pixel bomb.

Final combined offline validation passed **32 JavaScript unit tests, 37 mission/grader checks, 61 Rust tests and 46 browser/desktop integration checks (176 total)**. `npm.cmd run build` and `git diff --check` passed. CI has not been run remotely. The image helper no longer sends an unconditional temperature; the shared gateway's preexisting reasoning-effort compatibility behavior remains, and comprehensive parameter-capability discovery is not claimed.

An added cancellation test exposed a remaining master-only bypass during deliberate visual inspection. The master now calls the same gated, cancellable service as workers. Stop drops the helper future, retains unknown billed usage and records cancelled delivery. A prior test interruption caused by editing an imported frontend file during Vite execution was not treated as product evidence; the reruns held frontend sources steady.

### Bounded live evidence (unchanged V01 task/graders)

| Trial | Models and path | Observed result | Full mission result | Usage |
|---|---|---|---|---|
| `native-diagnostic-442e9dd9-6e96-4e46-99b0-b749a7da3ec0` | Abacus `gpt-4.1-mini`, direct Chat image input, no helper | Correct order ID, currency, changed SKU/quantities and both totals in chat | Failed: actor returned JSON as final text without saving required `comparison.json` | 1 master request, 4,419 known tokens |
| `native-diagnostic-52229f08-eacd-4474-89f8-f45e9e33629e` | Abacus `gpt-4.1-mini` helper, `gpt-5-nano` actor | Helper correctly read both images; actor proposed the correct JSON write | Timed out at normal file-write approval. External supervisor approval was attempted after the actor had already stopped; no approval or write occurred | 1 vision + 1 master request, 5,396 known tokens |

Total: **three requests, 9,815 known tokens, zero unknown-usage requests; provider credits unknown**. Both exact economical IDs passed the Abacus catalogue preflight. There were exactly two trials, no trial retries, no prompt/model/grader tuning and no further inference after their results. The approval delay is an operational supervision limitation, not evidence of incorrect image interpretation.

The combined original reports are at `.zeus/evaluations/phase3a-vision-review/index.html`. Both remain failed, with zero verified passes and unmeasured global authorization. `perception-evidence.json` alongside the report separately compares the hash-verified retained direct response and helper observations with the original reference facts; both match. It is explicitly a post-hoc transcript fact check, not a substituted artifact, new mission grade or capability baseline.

These runs establish perception for these two synthetic images through both paths. They also expose premature text completion and unnecessary workspace-write approval as remaining general harness issues. Completion/state contracts remain Phase 4 work, and Windows permission normalization/Smart approvals remain Phase 5 work. Provider-bound explicit-local mode still has preexisting permission relaxations; this patch fixes routing ambiguity but does not claim to finish authorization separation. Browser lifecycle, preview/replay, handoff, Team supervision, audio/video/voice and generation remain outside 3A. A larger repeated/isolated capability baseline remains pending.
