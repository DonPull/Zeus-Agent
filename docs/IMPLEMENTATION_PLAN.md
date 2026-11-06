# Zeus Agent: stabilization and development plan

Updated: **6 November 2026. This is the canonical live implementation roadmap.**
Current status and delivery order below take precedence over historical milestone
tables and the dated delivery notes later in this file. Update the current
checkpoint, status table and relevant focused packet when scope or delivery
changes; preserve past evidence as history rather than leaving it as current status.

Current checkpoint: Phase 3A–3D and the browser reliability/usability follow-ups
are delivered. The initial matched native benchmark reference is also recorded:
three missions, six pilot attempts, then 18 repeated attempts with 17 successful
outcomes. It is an early measurement foundation, not the full benchmark suite.
The [Phase 4 design](PHASE_4_TASK_STATE_DESIGN.md) has been reviewed positively,
with the user's lightweight-check and lossless-history requirements incorporated.
Phase 4A automatic task state and the bounded response-format diagnostic are
delivered with 324 offline checks passing. The initial six-attempt live check
retained one browser deadline/recovery failure; its general repair is delivered,
and all three separate post-repair Solo outcomes passed. See the
[4A work log](PHASE_4A_WORK_LOG.md) for retained failures, source/receipt hashes,
usage and comparison limits.
4B context and searchable originals are delivered with **344 offline checks**
and **four successful live history probes**, including old-fact/image retrieval
after repeated compaction and restart. See the [4B work log](PHASE_4B_WORK_LOG.md)
for decisions, retained development failures, usage and limits. 4C completion
evidence is delivered with **370 distinct automated checks** at that checkpoint;
six matched native outcomes and two post-repair reviewer controls passed. Its
[contract](PHASE_4C_COMPLETION_DESIGN.md) and [work log](PHASE_4C_WORK_LOG.md)
retain the initial reviewer abstention, validation limits and all usage.
**Phase 4A–4C foundations are delivered. Full Benchmark v1 is next, before Phase 5.**
The user has authorized full v1 implementation. Its
[active delivery packet](BENCHMARK_V1_DELIVERY_PLAN.md) and
[work log](BENCHMARK_V1_WORK_LOG.md) now track twelve authored contracts and
70 passing reference/negative controls and all twelve native scripted workflow
paths. Actual new controls cover downloads, corrections, compaction and process
restart. Candidate pilot/repeated manifests and a Sandbox boundary probe are
prepared. The approved Windows feature setup needs a manual restart; isolated
actor/grader runtimes, guest lifecycle validation and repeated live measurements
remain incomplete. No full baseline is claimed yet.
Current combined regression coverage is **421 distinct checks**, from a complete
411-check run and focused follow-ups; the full-v1 work log records the receipts.
The matched sample used more requests and reported tokens than the pre-Phase-4
reference, with more duplicate-directive rejections; context/protocol efficiency
is explicitly open work, not a claimed improvement.

The completed browser and benchmark commits are merged/pushed to main and the
temporary browser branch is deleted. The delivered
[benchmark baseline checkpoint](BENCHMARK_BASELINE_CHECKPOINT.md) records the
small matched native-supervised pilot, repeat/resume/comparison tooling and its
limits. Browser-agent speed and efficiency remain an explicit follow-up using
these measurements; current browser behavior is not considered fully optimized.
The user is actively using the PC: notify them before tests that expose windows
or need focus, while routine checks remain hidden.

The [native reference checkpoint](benchmarks/native-baseline-20261104.md) is now
recorded on clean source `b40f032`: six calibration outcomes passed, followed
by 17/18 repeated outcomes. The tooling supports frozen/resumable matched
configurations and build comparison; this three-mission native slice does not
complete Benchmark v1 or demonstrate active Team collaboration. One retained
protocol failure and browser recovery overhead inform the next
[Phase 4 design](PHASE_4_TASK_STATE_DESIGN.md), now being delivered in small
slices. Browser efficiency remains an explicit measurement track.
**Full 12-core-mission Benchmark v1 completion is scheduled immediately after
Phase 4, before Phase 5**, as the explicit return to Phase 2D/2E. Do not postpone
it until the Team redesign, automatic routing or self-improvement phases. See
the scope and acceptance checklist below; no calendar date is promised before
the remaining engineering and execution-environment work is scoped.

Further [capability/handoff research](CAPABILITY_AND_HANDOFF_RESEARCH.md) records agent-requested intervention, rejection of browser passthrough as the selected design, background-window rendering constraints, autonomous MCP/app setup, reusable/self-created skills, and revised uncertain-low-impact/rationale handling. Proposed capability/skills workstreams 5B/5C depend on the relevant state/authorization foundation and require their own aligned designs.

Prepared: 2026-10-27. Baseline: `3b43f38` (`chore: checkpoint existing documentation and benchmark work`).

## 1. Product decisions and scope

This plan records the agreed product direction and delivery order. It is the current development plan; older milestone documents remain historical context. Existing "completed" labels and the historical 10/10 result are historical claims, not acceptance evidence for this plan.

Manual testing on 2026-10-28 found a native stack-overflow crash, duplicate-answer orchestration and UI/diagnostic gaps. The approved [stabilization patch](STABILIZATION_PATCH_1.md) repairs the reproduced crash, blank model selectors and duplicate publication. [The active issue register](KNOWN_ISSUES.md) separates validated repairs from remaining goal-completion, browser and diagnostic gaps. These repairs do not establish a stable v1. Current economical-model selection is recorded in [the live-test policy](LIVE_TEST_MODEL_POLICY.md).

- Zeus is a general desktop agent for completing user goals. Preserve Rust/Tauri, React, SQLite authority, persist-before-emit, the bridge boundary, task single-flight execution, and task cancellation.
- Use **Zeus Solo** for one acting agent and **Zeus Team** for coordinated agents. These are working names. Both must use the same execution services and authorization rules.
- Abacus ChatLLM/RouteLLM is the primary hosted model gateway. Do not design the product around users managing many upstream provider accounts.
- Local/self-hosted models remain a supported route for Solo, Team, and mixed configurations. Gemini and Xiaomi integrations can remain development adapters; remove neither during stabilization without an explicit decision.
- Distinguish provider connection, model ID, model capabilities, collaboration mode, permission mode, and execution environment. Model choice must not implicitly enable weaker permissions.
- Compare earlier and current Zeus versions under controlled conditions. Published model leaderboard scores are optional context, not a required baseline.
- Wordle is a historical diagnostic example, not a product priority, dedicated subsystem, or central benchmark. General browser competence is the objective.
- Current priorities: trustworthy regression tests and capability benchmarks, current functionality, execution reliability, durable task state, context/memory, and authorization.
- Before implementing a phase, give a short plain-language description of its tangible effect: user-visible features, specific fixes, or developer/reliability improvements, including what the phase does not yet resolve.
- Also provide a concise decision list for each functionality, explicitly identifying changes from the current approach. The user's verifier example was illustrative, not an approved implementation proposal.
- Efficient live models may be used when they materially improve testing; there is no blanket prohibition on live inference. Keep deterministic regression checks where appropriate, choose economical models for targeted integration checks, and retain usage/results. Expensive frontier-model sweeps and substantial benchmark runs still need a bounded plan.
- Refresh economical live-model choices against dated primary benchmark evidence and the actual Abacus catalogue. Do not equate public API prices with subscription credits or reuse outdated models merely because their adapters are familiar.
- Recoverable runtime failures should return typed errors and user feedback; native aborts require a demonstrated cause/fix rather than a blanket catch mechanism. Manual crashes remain blockers despite passing scripted tests. Reuse existing UI styles and give changed controls a basic visual/layout check.
- Compaction changes the model's working context, not the durable conversation. Automatically preserve original messages, linked image/document bytes and source references; make history searchable/readable back to the start of the chat. Do not depend on the model remembering to archive it. Explicit deletion/retention choices still apply; indexes/summaries never replace originals.
- Keep plan/state checks proportionate: automatic local lifecycle bookkeeping, meaningful revision/evidence checks and targeted replanning, without a mandatory approval/verifier/model turn for every harmless operation. Measure retention, successful goals, latency and cost; fewer tokens alone do not prove a better compactor.
- Routine automated tests should run in the background without flashing windows or stealing the user's focus. Hidden test windows must start hidden; background Python/command tools should capture output without opening consoles. Preserve intentional app/browser/handoff visibility. Reuse existing command-specific Codex approvals with plain invocations where possible.
- Later capabilities: image generation/editing, audio and video analysis, transcription, voice interaction, automatic model selection, supervised improvement, and unrestricted operation inside a real sandbox.

## 2. How each major topic will be handled

For each phase, agree on a focused design before implementing its substantial changes. A phase can contain several independently reviewable topics; approval of the roadmap does not silently approve every later design decision.

Each topic's design should contain:

1. A concrete user journey, observed problem, and examples of success and failure.
2. Code findings and relevant primary-source research, with uncertainty stated.
3. Alternatives, the recommended approach, and why the simpler alternatives are insufficient.
4. Scope, interfaces, state transitions, data migrations, compatibility, and failure behavior.
5. Acceptance checks and regression coverage, defined before changing behavior.
6. A bounded implementation sequence, evaluation cost envelope, and rollback method.
7. Decisions requiring user alignment, kept separate from routine engineering choices.

After alignment: implement a small complete slice, run the relevant checks, compare results, then expand. Routine fixes inside an approved design do not require repeated approval. Keep research proportional to the decision; do not create an open-ended research or rewrite project.

## 3. Current delivery order and status

| Phase / workstream | Status | Deliverable and next acceptance evidence |
|---|---|---|
| 0 — checkpoint and alignment | Delivered | Original baseline and agreed roadmap retained |
| 1 — regression/accounting foundation | Delivered; maintained continuously | Honest failure records, shared usage/limits and offline CI foundation; current combined validated coverage is 421 distinct checks; see the full-v1 work log for full-run and follow-up receipts |
| 2A — mission contracts/graders | All twelve authored; grader controls delivered | Six original plus B02/B03/C03/M01/M02/R01, with 70 reference/negative controls; these are grader tests, not twelve live capability results |
| 2B — real-runtime driver | Native integration delivered; isolation pending | Normal-policy actor, artifact export, outcome grading and partial coverage; native host remains unisolated |
| 3A–3D — execution, attachments and browser | Delivered with tracked limitations | Crash/publication repairs, shared browser, live/replay, handoff, verified transfers and usability follow-ups |
| 2C — small matched reference checkpoint | Delivered for three native missions | Six pilot plus 18 repeated D01/B01/V01 attempts; 17/18 repeated outcomes, retained protocol failure, actual role use and unknown provider credits |
| 4 — state, memory and context | 4A–4C foundations delivered; performance gap retained | Automatic checkpoints, source-aware context/searchable originals and scoped completion evidence; full benchmark and measured context/protocol efficiency are next |
| 2D/2E — complete Benchmark v1 | **Immediately after Phase 4, before Phase 5** | All 12 core mission contracts/graders/runtime paths, validated benchmark isolation/coverage, repeated matched current Solo/Team baseline, versioned comparison report |
| Browser speed/efficiency track | Explicit follow-up alongside v1 completion; measured gap ZA-012 | Profile context size and duplicate-directive recovery as well as browser observation/wait/batching overhead; retain outcomes and compare identical configurations before accepting an optimization |
| 5 — permissions and Smart mode | Planned after state and full v1 baseline | Scoped files/commands/scripts/browser policy, goal-alignment and consequences checks, prompt-injection tests and calibrated shadow classifier |
| 6 — Team contracts and supervision | Planned after 4/5; benchmark v1 already available | Delegation/scope/evidence contracts, early redirection and independent verification; rerun v1 before/after without changing graders |
| 5B — autonomous MCP/app/desktop setup | Planned extension after relevant 4/5 foundations; focused design required | Discover/connect suitable services/apps with bounded setup, authentication and normal permissions; not implied by unrestricted host scripts |
| 5C — reusable and agent-created skills | Planned extension after relevant 4/5 foundations; focused design required | Versioned/provenance-bearing skill discovery, reuse and creation, with injection/quality checks |
| 7 — automatic model selection | Planned after full v1 and Team measurements | Measured success/resource tradeoffs, availability and explicit overrides |
| 8 — supervised improvement | Planned after regression, benchmark, state and authorization foundations | Bounded candidate patch/test/reject/review loop, protected evaluator and main branch |
| 9 — future multimodal capabilities | Planned after core stability | Image generation/editing, audio/video analysis, transcription and voice; real processing and failure tests |
| 10 — product sandbox/subscription delivery | Separate later designs | Production containment, onboarding, managed subscriptions and service guarantees; benchmark-only isolation is not this product feature |

Phases are delivery order, not a prohibition on fixing a directly observed critical defect earlier. Add a regression check, keep scope narrow, and record the reason for any reprioritization. Prefer sequential delivery initially; no blanket agent delegation is proposed.

### Full benchmark delivery commitment

The existing six grader fixtures and three-mission native reference are useful
early infrastructure. They do not complete Benchmark v1. The next scheduled
benchmark milestone is **2D/2E immediately after Phase 4**, rather than an
unspecified revisit in a distant phase. Author/prove memory/recovery cases during
Phase 4 so the new functionality has direct acceptance checks as it lands.

| Required for full core v1 | Remaining work |
|---|---|
| 12 core missions | All twelve contracts and native scripted paths authored; retain them while completing actual isolated execution and live validation |
| Every mission actually runnable and gradeable | Enable C01/C02/D02 submitted-program grading in a validated benchmark environment; finish browser/download/restart/research drivers and independent controls |
| Independent evaluator and stated authorization coverage | Prepare/validate benchmark-only isolated actor and executable-grader boundaries, clean resets and protected fixtures before claiming isolated or verified results; do not wait for product Phase 10 |
| Repeated matched Solo/Team measurements | Freeze current architecture/model/policy/limits and task versions; retain failures and report actual role usage even if Team does not delegate or outperform Solo |
| Build comparisons and efficiency | Preserve raw source/configuration/task/grader identities, latency, interventions and all-role usage; keep unknown credits explicit and validate matched before/after comparisons |
| Frozen release and usable report | Publish versioned v1 contracts, proven graders, reviewed repeated baseline and reproducible commands; report per-category/coverage gaps rather than a misleading single score |

The four planned stretch missions are an additional track, separate from the
12-core headline. Their later expansion does not keep core v1 permanently
unfinished. The full benchmark measures the app as it exists; fixing every
failure or finishing the Phase 6 Team redesign is not a release prerequisite.
Phase 5 Smart mode and Phase 6 Team changes then reuse v1 for before/after checks.
Execution-environment installation and larger live budgets receive their own
bounded concrete setup/run packet; a declaration in a document is not isolation.

## 4. Phase 1: make measurement trustworthy

### Test execution and records

- Inventory current Rust, JavaScript, integration, UI, and live-agent checks. Run the existing offline checks first and record their actual status; do not assume a green baseline.
- Repair runner spec discovery, JavaScript variable scope, finalization, process cleanup, result writing, and exit-status propagation. Missing requested suites and recording failures must produce explicit errors, not successful empty reports.
- Use one configuration resolver and record the **effective** provider/model/role configuration used by the runtime. A `solo` label is insufficient if a worker still runs.
- Give every experiment, task, trial, architecture configuration, and grader version a stable identity. Aggregate using those identities, never bare `prompt_id` alone.
- Retain all trials, including crashes, timeouts, cancellations, incomplete outcomes, unsupported tasks, and infrastructure failures. Distinguish these statuses without silently removing them from the user-success denominator.
- Missing metrics remain unknown; they do not receive perfect scores. A correct denial is not a safety failure.
- Separate immutable raw trial records from derived dashboards. Record source commit/build, prompt and fixture hashes, grader version, effective settings, and available model snapshot identifiers.
- Store routine run artifacts in isolated, ignored experiment directories. Commit only intentional, redacted baseline manifests and representative evidence.

### Accounting and budgets

- Preserve raw provider usage and normalize it once, including cached-token and reasoning breakdowns without counting a subset twice.
- Account for master, worker, verifier, perception, Watcher, routing, and classifier requests, including billed retries and partial requests when usage is available.
- Distinguish raw tokens, measured provider credits, estimated credits, currency estimates, and subscription allowance. Do not relabel token units as provider credits or assume a universal conversion ratio.
- Use Abacus's supported catalogue/pricing data where available. Reconcile against supported authoritative usage data when available; mark estimates and unavailable accounting explicitly. Do not depend on undocumented account-scraping endpoints.
- Give the task a shared authoritative budget. Child execution must not maintain an independently stale spend total. Include run, experiment, and account-level ceilings where needed.
- Enforce output/step/time limits as well as spend limits. A provider may return final usage only after a request; report that granularity and use conservative limits rather than promising an impossible exact pre-spend cap.
- Verify local, hosted, and mixed configurations. No cloud key must be required for pure offline regression tests.

### Regression foundation

- Rust unit/integration tests for state transitions, ordering, cancellation, migrations, and policy behavior.
- JavaScript tests for configuration, recording, aggregation, graders, and runner failures. Prove the evaluator itself with known-pass and known-fail examples.
- Mock HTTP/SSE provider responses for success, malformed data, empty replies, disconnects, unsupported modalities, throttling, and usage variants.
- A small UI suite for message ordering, task selection, approvals, attachments, stop, session display, and replay. Test the UI through the existing bridge boundary.
- A real managed browser against local fixture pages for browser integration; screenshots fabricated by the test are insufficient to validate capture.
- Start Windows CI with offline checks. Keep expensive live-model evaluations separately triggered, quota-bounded, and excluded from ordinary pull-request checks.

Exit: the known measurement defects have reproducing tests; intentional failures cannot be reported as passes; one offline command produces an honest report and exit status. Establish the contract and a small working suite before expanding coverage.

## 5. Phase 2: a capability benchmark we can believe

This is the official **Zeus Benchmark v1** project suite being built: it must compare Solo against Team, and an identical configuration on an older against a newer Zeus build. Version missions/graders/configurations, repeat trials, retain failures and report verified goal completion/quality against total agent usage and cost per successful goal. Product verifier/routing/retry costs belong to agent cost; external benchmark-grader expense is reported separately. The existing six missions/native diagnostics are a partial foundation, not the finished repeated benchmark. Establish a bounded baseline before major task-state/Team architecture changes.

Focused design prepared after the Phase 1 commit: [Phase 2 benchmark design](PHASE_2_BENCHMARK_DESIGN.md). The user approved its first implementation packet, six missions with proven graders (2A), and permits efficient live models where useful. This grader-validation slice needs no inference; later runtime/environment work and larger baselines remain separate decisions. The rest of this section records the approved roadmap direction.

### Initial task portfolio

Proposed starting size: **12 core missions plus 4 stretch missions**, adjusted after reference solutions and cost calibration. This is a useful development sample, not enough to certify general intelligence or production reliability.

| Core area | Proposed count | Example outcomes |
|---|---|---|
| Browser | 3 | Complete a multi-page workflow, handle a dialog, download the correct artifact, preserve state |
| Coding | 3 | Repair a bug, implement a small feature, build a working small application with functional and visual requirements |
| Files and data | 2 | Reconcile heterogeneous records; migrate and validate a data pipeline |
| Memory and recovery | 2 | Follow corrections over a long task; recover without repeating a completed external action |
| Research | 1 | Produce a sourced synthesis checked against a stable evidence collection |
| Vision | 1 | Inspect a supplied image or rendered UI and act on its actual contents |

Stretch missions combine these skills: application creation plus visual refinement, a long browser/data workflow, multi-source research with conflicting evidence, and a long mission with injected failures and changing requirements. User-provided difficult prompts belong here after we clarify what counts as success.

### Grading and fairness

- Give each task clear user requirements, a working reference solution, and an independent outcome evaluator. Verify graders against both valid alternatives and plausible incorrect outputs.
- Inspect actual final state: database records, output contents, running behavior, source-grounded claims, and rendered UI. Self-reported success and file existence alone are insufficient.
- Keep expected answers, hidden checks, and grader code outside the acting agent's writable environment. Detect edits to protected fixtures and tests. Do not reward an agent for weakening its evaluator.
- Use model judges only for dimensions requiring judgment. Specify rubric anchors, retain evidence, calibrate with human-reviewed examples, and record judge uncertainty and disagreement.
- A completed goal and correct authorization are hard conditions. A diagnostic quality score, including an agreed 8.5/10 threshold, cannot compensate for failing either condition.
- Report first-attempt success, consistency across trials, semantic quality, latency, interventions, actual or estimated credits, and cost per successful task. Report both mean and tail resource consumption where sample size permits.
- Use fixed fixture versions, reset environments, fixed tool policy, and matched budgets. Start with three trials for selected comparisons; increase replication before making claims about small differences. Do not treat three trials or a small suite as statistical proof.
- Interleave baseline and candidate trials when hosted model behavior can drift. Separate provider drift from harness changes as far as provider identifiers and paired runs permit.
- Separate stable local/recorded-evidence tasks from an explicitly labeled live-web track. A remote site's outage should remain visible without being mistaken for a deterministic runtime defect.
- Keep development, validation, and rotating held-out tasks separate. Inspect development failures during tuning; do not repeatedly tune against the final hold-out set.

### External benchmarks and regression policy

- Rename synthetic "official mini" suites truthfully while preserving historical result identities. Do not discard useful local fixtures.
- Add a small real external benchmark adapter later, with original task identifiers and the upstream evaluator preserved. Comparing Zeus versions does not require implementing every public benchmark.
- Use a supported runtime entry point for non-UI trials, with the same services and policy as the desktop app. Avoid turning UI polling or test-only permission bypasses into an alternate agent architecture.
- Define per-category comparison tolerances after observing baseline variance. Show confidence/uncertainty and a tradeoff report; one aggregate number is insufficient.
- Deterministic failures block a change immediately. A noisy live-score drop triggers confirmation trials. A confirmed material capability decline blocks promotion unless we explicitly accept the tradeoff.
- Reject or revert the isolated candidate change, preserving unrelated user work. Never reset the main workspace automatically after one unfavorable score.

Exit: a frozen benchmark v1, proven graders, raw baseline trials, a cost envelope, and an honest report that can be regenerated from records.

## 6. Phase 3: stabilize current execution, images, and browsers

Focused proposal after the reviewed Phase 2 checkpoint `f3c1c80`: [Phase 3 reliability design](PHASE_3_RELIABILITY_DESIGN.md). Recommend implementing image/provider/attachment correctness as packet 3A, then shared browser ownership (3B), preview/replay (3C) and handoff/compatibility (3D). This proposed prioritization uses the existing six-mission measurement slice while the broader Phase 2 baseline remains pending. The packet is for alignment before substantial Phase 3 implementation; the following roadmap requirements remain applicable.

After the user's successful stabilization retest, checkpoint `42bd730` commits Phase 3A and stabilization patch 1. [Phase 3B browser ownership](PHASE_3B_BROWSER_OWNERSHIP_DESIGN.md), proposal checkpoint `d375c83`, was approved and implemented on 2026-10-30. [Its delivery record](PHASE_3B_WORK_LOG.md) preserves that opt-in build's evidence. Phase 3C supersedes its rollout status: one shared Solo/Team owner is the sole ordinary executor, with explicit pinned setup, Live View/Replay and read-only older history. The old launcher/CDP recorder and product execution choices are retired, not offered as another mode.

Phase 3B's original validation passed **229 offline checks plus three release regressions**, frontend build and ordinary production compile. Its subsequent manual/background-window repairs passed **235 offline checks** and production compile; relevant release checks retain their exact recorded builds. The implementation/follow-ups are committed as **`711ddb7`**. Two original same-build Abacus Luna B01 attempts were retained: one falsely claimed tools were unavailable and did no work; the other correctly updated the ticket through one browser session, but hit the fixed 12-request cap before final-answer completion. No fully verified live pass or broader capability baseline is claimed. Known goal-completion failures are still high priority; the browser service does not silently replace Phase 4.

The approved [Phase 3C design](PHASE_3C_LIVE_VIEW_REPLAY_DESIGN.md) is implemented. [Its delivery/decision record](PHASE_3C_WORK_LOG.md) documents independent bounded capture, large Fit/zoom/full-screen viewers, safe hydration, paged actual-action evidence, calling-role direct/helper pixels, explicit storage gaps/export/delete, owned runtime setup and old-engine retirement. Final validation passed 257 offline and seven optimized checks. Of two same-build bounded Luna B01 attempts, one falsely claimed tools unavailable; the other completed the independently checked UI workflow and honest summary in 12 requests, using one session with retained replay and clean shutdown. Authorization remains partially evaluated; no fully verified isolated baseline is claimed. Next focused browser work is 3D for login/handoff/transfers in the Zeus-owned browser. Access to the user's daily browser is undecided/unapproved. Phase 4 initiation/completion/memory remains high priority, including the retained failed reply.

The user then approved a focused [browser UX, links and execution follow-up](BROWSER_UX_FOLLOWUP.md) before 3D. It replaces webview-navigating artifact links with task-file metadata/reveal and OS web opening; makes Watch active-only and Replay terminal-only; fixes viewed capture at 8 FPS/quality 80 without adaptive throttling; consolidates readable replay navigation/playback; moves recording export to developer tooling; and adds coherent keyboard input plus bounded readiness/result checks. Native document previews, compression, conversation portability and personal-browser access remain future decisions. This follow-up does not replace 3D or Phase 4, or establish an agent capability/speed improvement by itself.

The user subsequently requested [replay UI refinements](REPLAY_UI_REFINEMENT.md): free numeric playback rates, seamless image loading, stable rows/URLs, clearer metadata, centered zoomed images, title-bar full screen, shared modal close controls and dark scrollbars. This remains a focused presentation/reliability patch; later architectural phases still require their agreed design checkpoints.

### Shared execution services

- Route Solo and Team through one tool executor, authorization path, cancellation hierarchy, artifact service, and usage ledger. Extract incrementally from current code; do not rewrite the whole runtime.
- Keep provider protocols behind the gateway. Associate capabilities with a provider connection plus model ID; avoid model-name guesses that silently change endpoint or security behavior.
- Return typed tool outcomes: attempted action, status, output, error, artifacts, and evidence references. Remove success responses for unimplemented operations; implement them or return an honest unsupported result.
- Cancel and reap owned process trees and browser resources. Bound output capture, listeners, timeouts, and retries. Scope IPC listeners and credentials to the run and clean them up.
- Reconcile uncertain outcomes before retrying actions with external effects. Durable messages are not proof that an external action did or did not complete.

### Images and attachments

- Reproduce the reported failure with a known small image, the actual selected endpoint/model, and sanitized errors before choosing the fix.
- Introduce an attachment record with stable ID, detected media type, size, storage identity, and processing status. Use unique names and validate bytes rather than trusting file extensions alone.
- Deliver actual image inputs to a capable acting model through Abacus. Retain a perception-helper path for text-only or explicitly configured workflows.
- Validate model capability and credential readiness before dispatch; report disabled vision, unsupported formats, missing files, empty analysis, and provider errors distinctly.
- Add a complete picker/paste -> persistence -> request payload -> observable image-answer test. Include two attachments with the same filename and a resumed task.
- Establish a media attachment contract extensible to later audio/video work, without implementing those modalities now.

### Browser lifecycle and observations

- Give the runtime ownership of a browser session identity across scripts and agent handoffs. Distinguish a goal session, browser process/context, tab, and individual action.
- Create browsers lazily for browser work; both Solo and Team receive the same session access. Preserve session state across tool calls and workers under an explicit ownership/lease policy.
- Keep one owned session for a single-browser goal; support multiple tabs when the goal needs them. Do not merge unrelated goals or close a user's unrelated browser resources.
- Run live capture independently of the next agent action, with bounded frame rate and backpressure. Reopening Live View must hydrate the current active state correctly.
- Record action start, outcome/error, relevant before/after state, timestamps, artifacts, and stable sequence numbers. Never record a successful click before knowing whether it succeeded.
- Use a durable action journal plus trace/screenshot artifacts. Update manifests atomically; set completion only at a real terminal transition. Evaluate Playwright tracing within a managed service rather than relying on incomplete monkey patches.
- Implement a real human handoff and resume lifecycle, including a visible browser where required. Do not present a logging stub as a successful handoff.
- Phase 3D alignment adds optional click/target/key/text overlays in Live View and Replay, stored separately from image pixels. Normal handoff must preserve the existing process/context/tabs and unsaved state. The user's preference is to retain human page actions and visible content seamlessly in that same replay, rather than blanket-excluding the human segment; exact capture coverage and credential-event semantics require the focused design. See [alignment notes](PHASE_3D_ALIGNMENT_NOTES.md).
- Apply the agreed visible-content policy: retain normal human/browser presentation, preserve native password masking, and omit underlying masked credentials from input telemetry/model context. Do not blanket-blackout the human segment. Browser chrome/native dialogs remain outside page-pixel capture; gaps, storage caps and deletion/export controls remain explicit. This user preference supersedes the original blanket screenshot-masking suggestion.
- Close owned resources when the goal completes or is terminated, according to the agreed persistence policy. Cancellation and interrupted-recording finalization must not depend solely on Python `atexit`.

Exit: actual local-browser integration tests verify continuity across scripts, live hydration, truthful replay, errors, human handoff, cancellation, and cleanup. The same image and browser missions work in Solo and Team. Wordle-specific code is out of scope.

## 7. Phase 4: task state, plan, memory, and compaction

The [focused Phase 4 packet](PHASE_4_TASK_STATE_DESIGN.md), updated after the
5 November feedback, records the delivered 4A–4C implementation contract.
The requirements below remain applicable; original-history preservation and
retrieval are explicit 4B deliverables, not optional future memory features.

### Deterministic responsibilities

Extend SQLite-backed task state rather than treating freeform chat or a markdown plan as the authoritative execution record. Candidate concepts are requirement revisions, plan steps, attempts, evidence, blockers, pending approvals, artifacts, and summaries; exact schema belongs in the phase design.

- Stable IDs and versioned updates tie each plan step to the current requirements and observed evidence.
- The runtime updates mechanical state after tool start/finish, worker state changes, approvals, budget pauses, cancellation, and interruption. The model does not have to remember to do this bookkeeping.
- Before every model call and after compaction/restart, the context builder supplies the current task contract, requirement revision, plan, blockers, relevant evidence, and recent work.
- Meaningful user corrections mark affected plans for review. Reconcile conflicting requirements before work that depends on them or claims to satisfy them; unrelated questions and useful independent work do not require a separate replanning turn.
- Require replanning at meaningful checkpoints and detected divergence, rather than demanding another model call after every harmless micro-action.
- A step or goal cannot be marked verified solely because a model says it is done. Use outcome predicates where possible and explicit verifier/human judgments with evidence where semantic checks are necessary.
- Simple tasks can use a minimal implicit plan; avoid a mandatory planning conversation for a one-step request.

Deterministic code can guarantee revision tracking, updates, reinjection, and enforcement of known checks. It cannot guarantee that a model initially interpreted an ambiguous request correctly. The UI and evaluator must preserve that distinction.

### Memory and context

- Separate durable task facts/constraints, verified findings, model hypotheses, reusable user preferences, and compacted history. Preserve source/provenance and corrections.
- Preserve originals automatically in SQLite and linked attachment storage. Extend transcript recall with indexed, paged search and exact source/attachment reads, shared by Solo and task-owned workers. Do not introduce a vector database without demonstrating a retrieval need.
- Use context budgets appropriate to the selected model, reserving output/tool headroom. Handle large individual messages and tool results as well as long transcripts.
- Create semantic summaries at controlled checkpoints, retain the raw transcript, and validate coverage of critical requirements and unresolved work before replacing context.
- Keep original requirements, current state, pending authorizations, and key evidence outside lossy summary-only storage. Do not promote instructions found in a webpage or log into trusted policy memory.
- Apply equivalent compaction and recovery rules to workers and verifiers. Failed summarization has a defined bounded fallback; it must not silently drop constraints.
- Reconcile external state on resume before replaying an uncertain side effect. Distinguish interrupted, paused, failed, and successfully completed runs.

Exit: scripted long-session tests preserve requirements through corrections, repeated compaction, worker handoff, and restart; old facts and attachments remain retrievable even when absent from a summary; stale-plan tests reconcile affected work; replay does not duplicate a previously observed side effect. Capability trials measure actual semantic retention, successful outcomes, latency and cost separately.

## 8. Phase 5: permissions and Smart mode

### Repair the authorization boundary

- Inventory every executable route: native tools, shell, Python, child processes, verifier probes, HTTP, browser actions, downloads/uploads, extensions, and human handoff.
- Fix cache task/account/policy scoping, explicit-deny precedence, canonical path handling, prefix boundary checks, and approval persistence before making permissions more automatic.
- Remove permission weakening tied to local model selection or evaluation labels. An explicit test policy is allowed, but must be recorded and never mistaken for the production policy.
- Keep authorization policy outside writable agent context. Bind a decision to the actual command/script, arguments, resolved targets, working directory, and relevant policy revision; reassess when those change.
- Do not describe Python audit hooks or a browser profile directory as OS isolation. Define supported security guarantees honestly.
- Protect cookie/session credentials at rest and prevent logs, memory, browser recordings, and exported traces from exposing them unintentionally.

### Parent-command UX

Recommended pipeline: **parse actual shell syntax -> enumerate valid scoped rule candidates -> optionally rank with Jev -> render exact scope -> user chooses -> deterministic policy engine stores and enforces**.

- Example: `npm install playwright` can offer **Always allow npm install in this project**. The scope includes the workspace and relevant flags/targets, not just a display string.
- Handle the shell actually used on Windows, including CMD/PowerShell quoting, wrappers, environment expansion, redirections, nested scripts, and compound commands. Unknown syntax falls back to an exact one-off decision.
- Compound commands require independent decisions for their executable components. A prefix cannot authorize an unrelated trailing command.
- Do not suggest bare interpreter rules for `python -c`, `node -e`, or shell evaluation. A model cannot invent an arbitrary broad allow rule.
- Jev can select among parser-validated candidates or abstain; it does not define rule semantics. Cache presentation choices separately from authorization decisions.
- Offer approve once, scoped persistent allow, deny once, persistent deny, and denial with alternative guidance. Explain what the persistent rule covers, support revocation, and test both native and Python-originated cards.

### Smart classification

The 2026-11-01 alignment requirement is two separate axes: **relationship to the current user goal** and **consequences/authorization**. Apply this to browser UI actions as well as files, commands and scripts. Aligned low-impact actions can pass; aligned consequential actions need approval unless already authorized; clearly off-goal actions should be held/rejected and workers redirected through the master rather than spamming the user. Uncertain alignment with verified bounded low impact may pass under a limited exploration allowance; repeated uncertainty/no progress triggers review. Consider worker explanations as evidence to cross-check, without letting them grant consent or rewrite the goal. Current user requirements/delegation scope, explicit rules and text/visual/tool/skill prompt-injection resistance remain authoritative. The [proposed decision matrix](PHASE_3D_ALIGNMENT_NOTES.md) and [concrete classifier/calibration explanation](CAPABILITY_AND_HANDOFF_RESEARCH.md) are input to Phase 5's focused design, not an already selected classifier or approval shortcut.

- Strict and Smart are permission modes. Host and Sandbox are execution environments. Keep collaboration mode independent of both.
- Apply deterministic hard boundaries and explicit user authorizations first. Classify remaining uncertainty using a compact trusted action envelope and clearly delimited untrusted evidence.
- Evaluate separate consequences such as overwriting existing work, secret access, external publication, account changes, destructive targets, and privilege expansion. Do not rely on one unexplained generic danger score.
- Benchmark Jev via Abacus against a simple non-model policy and a stronger model where useful. Provider documentation is not proof of authorization accuracy.
- Start in shadow mode: record decisions while existing enforcement remains active. Review false allows, false blocks, abstentions, adversarial content, policy changes, and model drift.
- Missing classifier access, failures, or uncertainty lead to a defined ask/deny path. A model's confidence cannot override a hard boundary.
- Auto-approve bounded low-impact operations only within the validated environment and user scope. Defer unrestricted arbitrary execution to a real sandbox; do not claim static parsing solves arbitrary program behavior.

Exit: held-out policy cases, actual execution-path tests, and human-reviewed shadow data meet agreed thresholds. Show prompt reduction alongside dangerous-action mistakes and correct denials, not as a substitute for them.

## 9. Phase 6: make Team useful and verifiable

- Give each delegated job a typed contract: relevant original user requirements, objective, scope, inputs, permitted resources, expected outputs, evidence, budget, dependencies, and escalation conditions.
- Add an early worker interpretation checkpoint for substantial jobs and progress/evidence checkpoints during execution. The coordinator can redirect, cancel, ask for clarification, or take over without waiting for a complete failure cycle.
- Keep the coordinator's supervision event-driven and bounded; do not add an expensive permanent model call after every tool action.
- Give verifiers access to original requirements and an interactive inspection loop. They can inspect files, execute authorized checks in the appropriate boundary, inspect the app/browser, and request visual evidence.
- Keep hidden benchmark graders independent of the in-product verifier. A verifier's approval is a product outcome to evaluate, not the benchmark's ground truth.
- Run checks through the shared tool executor. Read-only inspection and running potentially mutating project tests are different capabilities.
- Use structured verdicts with requirements checked, evidence, blockers, uncertainty, and escalation reason. Permit abstention or an inconclusive result instead of forcing an unsupported approval.
- Bound repairs and detect wrong-objective, no-progress, and repeated-failure cases. Distinguish a local fix from a contract requiring coordinator replanning.
- Start with one supervised worker and explicit browser/write ownership. Introduce parallel workers only after artifact isolation, merge/conflict behavior, resource budgets, and cancellation are specified.
- Compare Solo, Solo plus independent verification, Team, and selective delegation under matched budgets. Keep Team only where it earns its overhead; preserve explicit user selection.

Exit: injected misunderstanding is detected before extensive wrong work; plausible but false completion is rejected using independent evidence; repairs/escalations are bounded; category-level comparisons show the actual tradeoffs.

## 10. Phase 7: model selection and architecture experiments

- Build the shortlist from models actually available through the user's Abacus connection or configured local endpoint. Cache capability and pricing snapshots with provenance and freshness.
- Use Artificial Analysis as optional comparative data, mapped carefully to provider IDs, model versions, modalities, and effort settings. Gateway availability and measured Zeus behavior take precedence over a general leaderboard rank.
- Start with tested presets and manual overrides. Then evaluate a bounded router for task type, model capability, cost envelope, and evidence-based escalation.
- Evaluate Abacus's own routing option as a candidate, not an assumed improvement. Record the resolved model when available; identify trials where it is not observable.
- Separate model-role selection from Solo/Team selection. A cheap worker is not automatically the best implementer, and Team is not inherently cheaper or slower.
- Optimize success under an agreed budget and cost per successful goal, including planning, judging, retries, routing, and human intervention. Revalidate on model or pricing changes.

Exit: routing is explainable at the product level, honors overrides and availability, handles failure without silent provider fallback, and meets validation targets relative to fixed presets.

## 11. Phase 8: supervised improvement, not self-reported progress

The proposed routine is practical as a bounded engineering workflow. It can use Codex, Antigravity, or a separate Zeus instance; the controller interface should not depend on one vendor.

1. Select a development mission and run a frozen Zeus build under fixed budgets and policy.
2. Monitor events, artifacts, progress checks, and resource use. Stop deterministically at agreed limits. A semantic monitor can recommend earlier termination with reasons; record that as a terminated trial, never a successful result.
3. Grade the actual outcome and the agreed quality dimensions using independent checks and a calibrated reviewer where needed.
4. Diagnose a specific failure and propose a general hypothesis. Change source/prompts in an isolated branch/worktree; never patch a currently executing trial.
5. Add the relevant regression test and implement a focused candidate change. Do not rewrite expected answers, weaken tests, change grading weights, or add task-name-specific behavior to improve the score.
6. Build and rerun the development mission, preserving the full trial and patch history. Apply a maximum number of candidates, total credit/time budget, and no-progress stop.
7. Run the regression suite and separate validation missions before proposing promotion. Reserve final hold-out evaluation for promotion rather than repeatedly exposing it to the patching agent.
8. Produce a reviewable change with evidence, remaining failures, and measured tradeoffs. Human review is required for merging until a separate promotion policy is explicitly agreed.

The 8.5/10 target may be a useful development stopping condition after rubric calibration. It is not a universal definition of success, and eventually passing one prompt is not the same as reliable first-attempt performance. Unsolvable or flawed tasks must be fixable through a separately versioned evaluator review, not covertly changed by the optimization loop.

Exit: demonstrate one useful candidate and one rejected candidate; confirm that a failing validation blocks promotion and that exhausting the budget stops the routine cleanly.

## 12. Phase 9: future multimodal capabilities

Proposed order, each with its own design review:

1. **Image generation/editing:** first-class tools and artifact outputs through the Abacus-supported API format, reference-image handling, generation/edit distinction, provenance, quotas, and follow-up visual inspection. Use measured presets first; external rankings are optional input later.
2. **Audio input/transcription:** validated attachments, supported formats, duration limits, transcription with timestamps when supported, chunking, cancellation, and retention. Verify whether an account-accessible Abacus model supports the required behavior rather than assuming Studio features equal API access.
3. **Video analysis:** extract synchronized audio and frames when native video input is unavailable, retain timestamps and coverage, and disclose sampling gaps. Transcribing speech and understanding visible events are separate acceptance goals.
4. **Voice interaction:** begin with push-to-talk -> transcription -> the existing agent -> spoken response. Add streaming, interruption, echo handling, and full-duplex interaction only after provider/API and latency evaluation. Tool actions retain the same authorization semantics.

Do not add separate upstream subscriptions merely because a tutorial uses one. Identify missing capabilities early and decide explicitly whether to defer, use local processing, or add an optional adapter.

Exit per modality: the agent really processes the supplied media, outputs are verified against known content, duration/size/cost limits work, and interruption releases resources.

## 13. Phase 10: sandbox autonomy and commercial delivery

### Execution sandbox

- Evaluate Windows-appropriate OS isolation or VM/container-backed execution for the actual toolchain and browser workload. Decide compatibility, startup overhead, persistence, and recovery through a prototype before promising behavior.
- Protect existing host data with explicit mounts/imports and a controlled output/export path. Avoid exposing host credentials, authenticated profiles, management sockets, or privileged services by default.
- Isolate process trees, network access, secrets, and resources. A sandbox with authenticated network access can still publish or delete remote data; external actions require a broker/policy boundary.
- Offer unrestricted autonomy **inside the agreed sandbox boundary**, not an unqualified claim that arbitrary host execution is safe.
- Validate containment using actual adverse workloads and document residual risks. Keep an emergency stop that terminates owned resources independently of agent cooperation.

### Abacus-managed product subscription

- Validate an approved commercial/provisioning arrangement with Abacus before building automatic customer subscription purchases. Public API availability does not establish a reseller entitlement or account-provisioning mechanism.
- Confirm allowed customer/account structure, supported seat/provisioning APIs, quota isolation, usage reporting, rate limits, account lifecycle, and vendor outage behavior.
- Keep shared production secrets out of the desktop binary. Design an authenticated service/broker if the approved commercial arrangement requires centrally held credentials; preserve direct local-model operation.
- Validate economics using actual agent workloads: allowance consumption, heavy-user behavior, payment/support/hosting costs, and overage handling. The $15 minus $10 difference is gross headroom, not established net profit.
- Include tenant isolation, data retention/export/deletion, signed releases, safe migrations, updater/recovery policy, and support diagnostics in production readiness.

Commercial discovery can proceed early without delaying stabilization. Do not automate purchases or contact the provider during planning without a separate instruction.

## 14. Research basis and unresolved decisions

Primary sources checked on 2026-10-27:

- [Abacus RouteLLM overview](https://api.abacus.ai/help/route-llm/): unified model access and model catalogue/pricing discovery. Account-specific access still needs checking during implementation.
- [Abacus billing](https://api.abacus.ai/help/chatllm-ai-super-assistant/faqs/billing): the published Basic plan is $10/month with 20,000 **credits**, not tokens. Do not assume a fixed credit/token exchange or unlimited frontier-model use.
- [Abacus SystemOne/Jev](https://api.abacus.ai/help/route-llm/systemone) and [Decisions](https://api.abacus.ai/help/route-llm/decisions): classification can potentially use the existing provider connection; verify the current account and payload format before selection.
- [Anthropic: Demystifying evals for AI agents](https://www.anthropic.com/research/demystifying-evals-for-ai-agents): supports separating capability evaluation from regression protection and examining repeated-trial outcomes. Our specific portfolio, thresholds, and promotion rules remain design proposals.
- [Claude Code permissions](https://code.claude.com/docs/en/permissions): reference for scoped rules and compound-command behavior, not a claim that Zeus inherits Claude Code's implementation or guarantees.
- [TypeSafe introduction](https://docs.typesafe.ai/introduction): structured decision interfaces; suitability for Zeus permissions must be measured independently.
- [Playwright Trace Viewer](https://playwright.dev/python/docs/trace-viewer): existing action/snapshot tooling to evaluate for replay.
- [Artificial Analysis API](https://artificialanalysis.ai/data-api/docs/reference): optional source for comparative model data, not the authority on gateway availability or Zeus task performance.
- [Python audit-hook documentation](https://docs.python.org/3/library/sys.html#sys.addaudithook): audit hooks are not an OS sandbox.
- [Abacus customer terms](https://abacus.ai/customer-terms-of-service): public terms do not establish the intended provisioning/resale arrangement; obtain an explicit commercial answer before committing to that product model.

Decisions to agree before the corresponding work, not blockers to reviewing this roadmap:

| Decision | Proposed default | Needed before |
|---|---|---|
| Near-term release target | Windows desktop first; preserve existing portability boundaries | Phase 1 design |
| First implementation scope | Measurement repair and offline regression foundation | Phase 1 implementation |
| Benchmark tasks and rubric | 12 core + 4 stretch; mandatory outcome and authorization gates | Phase 2 |
| Live evaluation budget and models | Small calibrated Abacus baseline, fixed configurations, bounded trials | First paid evaluation |
| Task state and plan UX | Runtime-owned records plus an agent-maintained semantic plan with stale-state enforcement | Phase 4 |
| Parent suggestions | Deterministic candidates, optional Jev ranking, scoped rule semantics | Phase 5 |
| Smart activation thresholds | Shadow calibration first; thresholds chosen from representative cases | Smart auto-approval |
| Team supervision and parallelism | Bounded coordinator checkpoints; one worker initially | Phase 6 |
| Improvement-agent authority | Isolated candidate branches; no evaluator changes or automatic merges | Phase 8 |
| Voice and media ordering | Image tools, audio, video, then voice interaction | Phase 9 |
| Bundled subscriptions | Vendor-supported commercial provisioning; economics validated | Phase 10 product delivery |

## 15. Approved Phase 1 implementation packet

This is the approved first implementation scope. Later major topics still receive their own concrete designs when we reach them.

### Scope and touchpoints

- Repair `tests/benchmarks/benchmark_engine.js`, `score_recorder.js`, and the runners under `scripts/eval_harness/` without changing agent prompts or delegation strategy.
- Add focused JavaScript tests for those components using the existing Node toolchain. Do not run the desktop app to test pure configuration or aggregation functions.
- Update existing gateway usage normalization, spend persistence, budget reads, and the call sites that currently discard usage. Preserve provider behavior except for measured accounting corrections and explicit error handling.
- Add Rust accounting/migration/state tests and a small offline UI smoke set. Existing tests requiring live providers remain opt-in.
- Add documented regression commands and a Windows CI workflow. Update inaccurate benchmark labels and descriptions while preserving historical provenance.
- Do not yet add Smart approval, a new browser backend, plan/memory schemas, automatic routing, a benchmark optimization agent, voice, or generation features.

### Configuration contract

Resolve defaults, named profile/matrix configuration, explicit CLI overrides, and task overrides in one documented order: defaults -> profile/matrix -> explicit CLI -> explicit task override. Validate unknown flags and unsupported role combinations before starting a trial. Persist the resolved configuration and verify that task settings actually match it.

The experiment representation uses explicit role enablement; an adapter can translate that to the current persisted `None` sentinel until a separate settings migration is approved. Do not make a production settings rewrite a prerequisite for fixing the benchmark runner. Include provider connection identity, model ID, effort, collaboration mode, permission policy, limits, and fixture/grader versions in the configuration fingerprint.

### Proposed trial record

| Field group | Required contents |
|---|---|
| Identity | Schema version, experiment ID, suite/version, task ID, trial ID, configuration fingerprint |
| Build | Source commit, dirty-tree indicator/diff hash if applicable, executable/build identity |
| Configuration | Effective roles/providers/models/effort, policy, tool/environment versions, limits |
| Execution | Start/end, terminal status, error category, termination reason |
| Outcome | Passed, failed, not evaluated, or unsupported; independent check results and evidence references |
| Metrics | Tokens, provider-credit measurements/estimates, duration, interventions, measured tool failures; unknown values remain null |
| Evaluation | Grader identity/version, task/fixture hashes, optional anchored quality judgments |
| Artifacts | Relative paths and integrity hashes for the retained trace, outputs, and sanitized diagnostics |

Execution success and goal success are separate fields. A process exiting successfully does not establish a successful task. A no-check task is ungraded, and an ungraded trial cannot become a benchmark pass by default. Trial records are written before aggregation; a dashboard failure does not erase raw records.

For accounting, attach request identity, task/run/role, requested model, reported model when available, normalized usage, and raw usage. Persist request usage and task totals atomically with migration coverage; deduplicate the same reported request, not distinct billed retry attempts. Preserve unknown billed usage after a disconnect rather than fabricating zero.

### Small implementation increments

1. Capture current offline-test status and introduce failing reproductions for the identified runner/configuration/aggregation defects. Validate a known incorrect output is rejected by the grader.
2. Implement the configuration resolver, honest terminal statuses, reliable finalization, collision-free records, and exit-code propagation. Test all pure functions without launching Tauri.
3. Correct usage normalization, capture omitted role usage, refresh shared budget checks, and cover migrations/atomic persistence. Keep estimated credits distinguishable from tokens and authoritative credits.
4. Wire record generation into one existing synthetic suite through the existing runtime. Use controlled mock replies first; preserve real provider execution as an explicit option.
5. Add offline orchestration/bridge smoke coverage and Windows CI; document which commands can use hosted credits. Generate a demonstration report containing intentional passes and failures.

Proposed command interface: `npm run test:unit` for JavaScript checks; `cargo test --lib` in `src-tauri` for backend tests; `npm run test:ui` for an explicit offline UI allowlist; `npm run test:regression` to orchestrate the approved offline set. `npm run bench:smoke` remains a separately invoked capability evaluation command. Final command wiring must not implicitly include all existing paid advanced E2E specs.

### Acceptance checklist

- Two suites using task ID `1`, two architectures, and multiple trials all retain their records and appear in the correct comparison groups.
- A Solo matrix actually disables workers/verifiers as configured; CLI overrides affect effective runtime settings, not just report labels.
- Missing suite, no selected tasks, provider timeout, intentional agent failure, assertion failure, and result-write failure each produce the defined record/error and a truthful command exit status.
- The runner continues collecting other tasks after a task failure, then returns a failed aggregate status. It never silently reports an empty successful benchmark.
- A known invalid answer fails; absent safety/tool observations remain unknown; a legitimate permission denial does not automatically lower a safety grade.
- A fixture with input=75, total output=1,186, and reasoning subset=1,024 records 1,261 tokens, not 2,285. Credit estimates remain separate from that token total.
- Worker, verifier, Watcher, and perception usage contributes to the same task ledger exactly once per billed request. A child cannot leave the parent's next budget check stale.
- Existing database fixtures migrate without losing messages or historical raw usage, and persistence failures cannot leave an inserted usage event with an unupdated task total.
- Ordinary regression commands run with no hosted credentials and cannot accidentally fall back to a live provider. They can be rerun against isolated fixtures without corrupting manual chats.
- A report can be rebuilt from retained raw records with no model calls, while its build/configuration/grader provenance remains visible.

Implement only these increments. Choose Phase 2's live models, task portfolio, and credit envelope before the first paid capability baseline; approval of this packet does not authorize a live evaluation budget.

## 16. Phase 1 delivery record

Implemented on 2026-10-27:

- One configuration resolver, actual task-settings readback, correct spec discovery, explicit live opt-in, bounded trial finalization, and nonzero exit status for failed or unverified results.
- Schema-v2 immutable trial records; separate execution, outcome, and authorization states; collision-free aggregation; reports rebuilt from raw records; unknown metrics remain unknown. Legacy suite directory names are retained, with synthetic benchmark labels.
- Per-request accounting shared across Master, Worker, Verifier, Watcher, and vision calls. Reasoning/cached subsets are not added twice; retries have distinct identities; interrupted requests retain unknown usage; usage and task totals update atomically. Historical units are preserved rather than repriced. Provider credits remain unavailable, not inferred from token counts.
- Isolated mock-provider desktop regression checks, JavaScript evaluator tests, backend accounting/migration tests, Windows CI configuration, and a scripted report containing deliberate failures. No hosted evaluation was run.
- Fixed the Windows test executable manifest so backend tests actually start. Corrected broken legacy test fixtures and an invalid outside-workspace test target; improved malformed-directive diagnostics and explicit empty-response handling.

The command and result contracts are documented in [the evaluation guide](../scripts/eval_harness/README.md). CI is configured but has not been executed remotely. The broader browser/session/replay regression coverage described in section 4 belongs with the Phase 3 repair work; Phase 1's small smoke set does not establish those features as reliable. Attachment storage coverage does not establish model perception. Live suites still need independent authorization and quality graders in Phase 2 before they can produce a fully verified pass. Artifacts are retained locally in ignored directories and are not comprehensively redacted for publication.

Local validation: `npm run build` passed; the combined offline command passed **26 JavaScript tests, 46 Rust tests, and 10 desktop/integration tests**. The demonstration retained five scenarios and reported exactly one verified pass, as expected. Dashboard rebuilding and a capability dry run completed without model calls. `git diff --check` passed. The baseline checkpoint remains `3b43f38`. The user reviewed Phase 1 and requested its commit on 2026-10-27; the next deliverable is the focused Phase 2 benchmark design.

## 17. Phase 2A delivery record

Phase 1 was committed as `818eb67`. The user approved the focused Phase 2A packet and requested a short tangible-impact explanation before every phase. Efficient live models are permitted when they materially help testing; there is no general inference ban.

Phase 2A adds six versioned mission contracts (B01/C01/C02/D01/D02/V01), deployable synthetic inputs, known reference solutions, independent outcome graders with expected/observed evidence, and negative controls. It changes developer measurement capabilities, not the app UI or production agent behavior. Browser/image bugs remain for their repair phase.

`npm run bench:validate` validates the graders. The full regression command now includes that group, plus two real headless-browser reference runs for the local ticket portal. Code execution in this authoring slice is limited to explicitly trusted reference/control programs; grading arbitrary agent programs still needs the Phase 2B execution boundary. No agent capability score or global authorization guarantee is claimed. See [mission usage and limits](../tests/benchmarks/missions/README.md).

Validation: **26 JavaScript unit tests, 37 mission/grader tests, 46 Rust tests, and 12 browser/desktop integration tests passed**. The image fixture pixels were visually inspected. The portal reference initially hung while reading a response body; the fixture now consumes its response, supplies Content-Length, and the reference binds observed browser requests directly to the server mutation audit. No model inference was needed for this grader-validation slice. The user subsequently reviewed and authorized committing Phase 2A with the native Phase 2B work.

## 18. Phase 2B native diagnostic delivery record

The user selected native supervised diagnostics on 2026-10-28. Tangible developer changes: all six missions can run through the actual bridge with ordinary permissions, retain journals/debug logs/screenshots/artifacts, and receive independent outcome assessments. Model requests, concurrency, output, estimated tokens, directives, and runtime are bounded across roles/retries. Tests use a separate feature-gated executable linked to the production library, fresh storage and no inherited browser profile; they leave the user's running app and manual conversations alone. Efficient live diagnostics remain explicit opt-in and use the user's Abacus provider, not a newly required direct provider account.

Three bounded `gpt-5-nano` diagnostics exposed and confirmed a production gateway repair: Responses history incorrectly labeled previous assistant output as `input_text`, causing a provider HTTP 400 on the next step. The gateway now sends valid plain-string history, retains original provider errors, and preserves billed usage on incomplete/failed Responses events. The final confirmation completed four requests without that protocol error and created its file; the independent grader rejected the incorrect amounts, duplicate handling, and totals key despite the agent's completion claim. All failures remain recorded. Total live usage: eight requests, 20,475 known tokens, two unknown-usage requests, unknown provider credits. One single synthetic-file read received a recorded supervisor approval through normal policy. No model/prompt/grader tuning loop or broad baseline was run.

Current validation: **31 JavaScript unit tests, 37 mission/grader tests, 53 Rust tests, and 28 browser/desktop integration tests passed (149 total)**. The complete offline command passed with 52 Rust tests, followed by a passing backend run after adding the provider-failure state-transition test. The strict mock rejects the old history format; a two-turn runtime check covers the fix. Coverage includes deadline cancellation, shared-role request limits, unknown usage, directive limits, partial collection errors, false completion claims, and exact image bytes delivered to the mocked vision helper. Browser preview/replay and live image perception remain unproven.

This completes the native diagnostic slice of 2B, not the whole benchmark phase. Native actors share host permissions and authorization remains unverified. Live executable submissions are exported without host-side execution; only exact known scripted controls can be executed by graders. A Windows path-normalization bug causing unnecessary approvals remains a dedicated production repair. Isolated execution/grading, independent authorization observations, a larger frozen pilot, core expansion, and repeated baselines remain pending. Details, actual operational limits, experiment IDs and research references are in [the Phase 2 packet](PHASE_2_BENCHMARK_DESIGN.md). The user reviewed the zero-pass diagnostic report, accepted the explanation, and authorized committing these changes and proceeding on 2026-10-28. Frontend build and `git diff --check` also passed.

## 19. Phase 3A delivery record

Phase 2A/native 2B was committed as `f3c1c80`. The user reviewed and approved the [Phase 3A packet](PHASE_3_RELIABILITY_DESIGN.md), and added a standing requirement for concise decisions with old/new approaches alongside each tangible-impact summary. The verifier example was illustrative and did not authorize a verifier rewrite.

Phase 3A delivers explicit provider/model bindings with Abacus as the new hosted default, connection-labelled catalogues, durable validated attachment IDs, direct multimodal actor input or deterministic configured-helper delivery, atomic acceptance/retry behavior, persisted previews/reuse and typed delivery failures. Existing routes preserve legacy behavior until explicitly changed. Both payload protocols, role accounting and cancellation use shared services. The [bridge contract](../BRIDGE.md) documents the internal API changes and one-time provider selection for legacy Gemini routes.

Two bounded native V01 trials used three requests and 9,815 known tokens, with no unknown usage or trial retries. Both direct actor and helper correctly read all requested screenshot facts. Neither full mission passed: the direct actor returned correct JSON in chat without saving the file; the helper/actor run timed out waiting for normal workspace-write approval, and the external supervisor's approval arrived too late. All original failures remain. A separate hash-verified transcript comparison confirms the image facts without changing the artifact grades. Combined local evidence: `.zeus/evaluations/phase3a-vision-review/index.html` and its `perception-evidence.json`. Provider credits and global authorization remain unknown.

Premature text completion, general Windows permission normalization and preexisting explicit-local permission relaxations remain open work under task-state/authorization phases. These narrow image confirmations do not replace the larger repeated/isolated benchmark. Browser packets 3B-3D retain separate design checkpoints and have not been implemented.

Final validation: **32 JavaScript unit tests, 37 mission/grader checks, 61 Rust tests and 46 browser/desktop integration checks passed (176 total)**, as did the frontend build and `git diff --check`. Changes remain uncommitted for review. Full details, final old/new decisions, experiment IDs and limitations are in section 10 of the Phase 3 packet.

## 20. Manual-test follow-up and priority correction

The user reported an image follow-up stack overflow on 2026-10-28, two duplicate-answer examples, inconsistent UI and weak post-crash event coverage. These are recorded as ZA-001–ZA-006 in [KNOWN_ISSUES.md](KNOWN_ISSUES.md), including the task IDs, actual screenshot size, persisted interrupted run/request evidence, confirmed duplicate-publication mechanisms and concrete regression requirements. The exact overflowing frame remains unverified. The existing attachment handle was correctly reused; explicit reattachment was not required.

A small diagnostics-only follow-up adds an explicit all-conversations debug query and a self-contained export with the full visible transcript, raw master/worker messages, attachment/model metadata and current run/usage snapshots. It labels the backend log as volatile and cannot restore missing pre-crash events. Durable lifecycle logging and the runtime/UI defects remain tracked work. No blanket panic-catching, stack-size increase, conversation strategy rewrite or new inference test was introduced in this diagnostic slice.

The user's suggested GPT-6 Luna and MiMo-V2.6-Flash were researched on Artificial Analysis. A read-only Abacus catalogue check confirmed `gpt-6-luna`; MiMo-V2.6-Flash was not listed. No inference calls were made. [The model policy](LIVE_TEST_MODEL_POLICY.md) replaces stale familiarity-based selection with a dated shortlist, adapter checks and frozen task-appropriate configurations. It does not silently change existing tasks or enable automatic routing.

Recommended next checkpoint: targeted crash reproduction/repair, duplicate-answer completion/publication and Windows workspace permission handling before new browser implementation. Then run a small mixed live acceptance pack as each repaired flow stabilizes, with a broader repeated suite gating the agreed first stable release. Long-term voice/generation/routing features need not postpone verification of the current core.

Diagnostic follow-up validation: 34 JavaScript unit tests, 61 Rust tests and 46 browser/desktop integration checks passed, plus the frontend build and `git diff --check`. The prior 37 unchanged mission/grader checks remain the last validated mission set. The manual crash remains open despite these results. Changes remain uncommitted.

## 21. Stabilization patch 1 delivery

The user authorized the focused repair on 2026-10-28 and useful bounded live testing. [The delivery packet](STABILIZATION_PATCH_1.md) records tangible differences, old/new decisions, native reproduction, exact validation and all seven live trials. The native large-image/fresh-TLS crash has a heap-pinning fix, the undefined-variable dropdown render crash is repaired, final responses publish once, Windows file-policy containment is shared, and a prepared external controller can decide declared synthetic permission cards directly. No browser-service redesign or production Smart approval mode was added.

Validated checks now total 196 (36 JS, 37 mission/grader, 67 Rust, 56 desktop), plus production frontend and release-runtime builds. Three of seven live artifact outcomes passed using Abacus Luna; combined helper execution still has retained completion/protocol/output-limit failures. These development diagnostics are not a repeated capability baseline or complete authorization proof. Provider credits remain unknown. Phase 3B-3D, deterministic task state/memory/completion, broader live acceptance, durable backend logs and full UI polish remain pending. On 2026-10-30 the user confirmed successful manual retesting and authorized committing this checkpoint and moving forward. Next substantial changes still receive a focused design before implementation.

## 22. Browser and chat usability follow-ups

Phase 3B/3C delivery and manual follow-ups are recorded in their focused work logs. Subsequent accepted browser/link presentation changes are in [BROWSER_UX_FOLLOWUP.md](BROWSER_UX_FOLLOWUP.md), [REPLAY_UI_REFINEMENT.md](REPLAY_UI_REFINEMENT.md), and the current [chat workflow follow-up](CHAT_WORKFLOW_REFINEMENT.md). The last checkpoint before this follow-up is `fa22ac2`.

This user-authorized increment removes replay seek flashes, skips image gaps during playback/jumps, improves playback scheduling, fixes modal/composer/header usability, names new conversations using their normal model reply, repairs the reported Done-plan projection, and adds an inert persistent card gallery. It does not implement the larger deterministic task-state/memory/completion phase. After validation and manual review, return to the existing roadmap with a focused tangible-impact and decision packet before the next substantial phase.

## 23. Phase 3D delivery and next checkpoint

The user approved implementation on 2026-11-01 and separately scheduled both active-desktop experiments. [The delivery packet](PHASE_3D_EXECUTION_DESIGN.md) records the decisions, exact native evidence and limitations. Ordinary Windows sessions now use full pinned Chromium offscreen; native human handoff preserves its process/context/tabs, pauses agent operations without model polling, and provides Open browser / Resume / Stop. Human page observations remain in the same recording, optional capture-bound action overlays are available, and managed uploads/downloads have owned snapshots, real-byte verification and durable transfer outcomes. Browser/service loss and cancellation close handoff cards truthfully. Masked credentials are excluded from events and resume/model observations without blanket-masking visible human content.

Validation: **288 offline checks and 18 optimized desktop checks pass**, plus frontend production/optimized runtime builds, targeted unfinished-download cancellation and diff checks. The new checks use real local browser interactions and normal policy with mock model responses; native window/handoff UI tests run on a private desktop, not over the user's game. No live-model credits, account purchases, classifier inference, MCP connections or skill installations were used. These are integration/regression results, not an agent-intelligence score.

Before major Phase 4/6 state/Team changes, prepare the bounded canonical benchmark baseline checkpoint: exact current build/configurations, repeatable reset/grading, Solo/Team comparison where meaningful, all-role usage/cost and retained failures. The six-mission/native foundation remains partial; neither Phase 3D nor historical Wordle success completes Zeus Benchmark v1. Phase 4 still needs its focused plan for deterministic task state, always-current plans, completion, memory and compaction. Phase 5 retains two-axis Smart authorization, prompt-injection defenses and measured classifier selection; direct paid Jev/alternative providers are permitted options to investigate, with no funding/provider choice implied here. Proposed MCP/desktop and skills workstreams 5B/5C keep their own alignment gates. Native document previews, conversation portability and replay compression remain future scope.

## 24. Browser reliability follow-up

The user authorized investigation and stabilization after a 641.6-second Wordle
diagnostic, ad/audio disruption, a small viewport and hard-to-read overlays.
The [focused follow-up](BROWSER_RELIABILITY_FOLLOWUP.md) records tangible changes,
old/new decisions, read-only timing analysis, expanded Windows experiments,
concurrent physical-input evidence and bounded live handoff diagnostics. This
increment precedes the canonical baseline checkpoint above. The full regression
passed **293 checks**, with its saved exit-code receipt of 0 verified after
restart. Four live Sol handoff scenarios passed; Luna protocol/continuation
failures remain retained. The original site compatibility smoke now confirms
real resolved feedback with blocking enabled after normal keyboard activation
of an animated onboarding button. This is not a measured speed/cost baseline
or a universal browser-isolation guarantee. Final optimized acceptance passed
18/18; frontend and ordinary app builds pass. An initial intermittent preview
cadence failure is retained rather than hidden by the final pass. The completed
patch is merged and pushed to main through `423ad89`; its temporary branch is
deleted. The follow-up packet records the evidence and limits.
