# Phase 2: a useful, reproducible Zeus capability benchmark

Status, 5 November 2026: **initial six mission graders and native integration
delivered; a three-mission native repeated reference is recorded. Full core
Benchmark v1 remains unfinished.** The canonical
[implementation roadmap](IMPLEMENTATION_PLAN.md) schedules completion of 2D/2E
immediately after Phase 4, before Phase 5: 12 core missions, complete runtime and
grading paths, validated benchmark execution boundaries, and repeated matched
current Solo/Team measurements. [The initial reference](benchmarks/native-baseline-20261104.md)
does not certify isolation or active collaboration. Dated findings and original
packet approvals below remain historical evidence, not the current completion status.

Phase 4B adds independent M01/M02 reference/negative controls for project
continuity and exactly-once recovery, plus separate H01/H02 personal-fact/image
history probes. Four bounded native live history outcomes passed after
compaction/restart checks. These focused probes do not replace the core M01/M02
mission contracts or complete their runtime/portal wiring. See the
[4B work log](PHASE_4B_WORK_LOG.md).

Phase 4A–4C foundations are now delivered. The unchanged six-cell native 4C
comparison passed all outcomes and retained an increase in context/protocol
overhead; see the [4C record](benchmarks/phase4c-acceptance-20261105.json).
The full 12-core v1 is the next main milestone, with this measured efficiency
gap included in its profiling/comparison work. Two additional post-repair
reviewer controls passed, but are not new core missions or an intelligence score.

Prepared: 2026-10-27. Reviewed code baseline: `818eb67`, the committed Phase 1 measurement/regression foundation. This is the focused design requested by the [development plan](IMPLEMENTATION_PLAN.md), not another proposal to rewrite the agent.

## 1. Recommendation and first deliverable

Build a small Zeus-specific mission benchmark before importing a large public benchmark. Use real local applications, files, and screenshots with independent outcome checks. Retain the existing suites as legacy diagnostics. Start with six missions and prove their graders without asking a model to solve them. Expand to the agreed 12 core missions only after the first six run end to end. Keep four stretch missions separate.

The first implementation packet is **2A in section 11**: task contracts, deterministic fixtures, reference solutions, and grader tests for six missions. This adds developer measurement tools rather than changing the app UI or repairing image/browser execution. Deterministic reference/negative controls need no inference; efficient live models are also permitted when they add useful test evidence, as the user clarified. This is not a general ban on live testing. No production permission bypass, Solo/Team redesign, machine installation, or self-improvement loop is included.

Success means we can identify whether Zeus completed a stated goal, preserve the evidence when it did not, and compare matched builds. It does not mean a single score certifies production reliability or ranks Zeus against published model leaderboards.

## 2. Findings from this repository

| Finding | Evidence | Consequence for Phase 2 |
|---|---|---|
| The Sofia banner grader checks dimensions; subsequent checks mostly require files and a metadata key. | `tests/benchmarks/suites/wave_1_foundation/prompts.json`, task 1 | A blank image and irrelevant posts can satisfy checks despite failing the user request. |
| The stock dossier grader checks two files and a CSV row count. | Same file, task 2 | Factual correctness, sourcing, calculations, and useful content need independent checks. |
| Wordle grading trusts the submitted game report and searches browser history across tasks. | `tests/benchmarks/suites/wave_2_browser_agentics/prompts.json` | Self-reports and unrelated prior activity cannot prove that the current trial won games. Keep this outside the core suite. |
| Synthetic coding graders run pytest against writable task tests. | `tests/benchmarks/suites/official_swe_mini/prompts.json` | Evaluate submitted implementation against a clean test fixture; editing a test is not fixing a bug. |
| The new engine separates execution, outcome, and authorization, but live suites have no independent authorization graders. | `tests/benchmarks/benchmark_engine.js` | Do not remove the authorization condition to make old tasks pass. Define policies and evidence for new tasks. |
| The legacy approval simulator often defaults to approval and uses title/command patterns. Live launch enables evaluation mode. | `tests/advanced_e2e/advancedUtils.js`, `tests/e2e/testUtils.js` | New benchmark trials must use a defined user script and normal runtime policy, rather than presenting this simulator as a real user. |
| Model classification affects protocol, prompts, permission behavior, and budget handling. Workers stream through Chat Completions while masters use protocol selection. | `src-tauri/src/gateway.rs`, `chat.rs`, `gatekeeper.rs`, `worker.rs` | Record these differences. A local/hosted or Solo/Team comparison is not automatically an isolated architecture experiment. Repair these systems in their planned phases. |
| The task workspace and Python audit hooks are not an OS security boundary. Native shell tools run with the app's host privileges. | `src-tauri/src/python_runner.rs`, `chat.rs` | An evaluator in a different folder is not protected from arbitrary native code running as the same user. Separate grading correctness from isolation guarantees. |

Phase 1's 82 passing regression checks validate software paths and accounting; they do not resolve these capability-measurement gaps. No current live model performance is assumed.

## 3. Research and alternatives

Reference solutions, stable environments, outcome checks, and repeated trials are established evaluation practices. Model-based judgments need calibration; exact tool sequences often penalize valid alternative solutions. These support using deterministic outcomes first and keeping subjective quality separate. [Anthropic: Demystifying evals for AI agents](https://www.anthropic.com/research/demystifying-evals-for-ai-agents).

For coding, require both the requested repair and preservation of existing behavior. SWE-bench distinguishes failing tests that must pass from passing tests that must remain passing, and evaluates patches in controlled environments. Adopt that principle without labeling our synthetic tasks SWE-bench results. [SWE-bench grading API](https://www.swebench.com/SWE-bench/api/harness/), [evaluation guide](https://www.swebench.com/SWE-bench/guides/evaluation/).

WebArena requires configured task environments and resets between evaluations. Use our own small resettable local application first, rather than an unpredictable public website or a complete WebArena deployment. [WebArena repository](https://github.com/web-arena-x/webarena#end-to-end-evaluation).

Harbor packages instructions, environments, reference solutions, and verification separately, and supports an independent verifier environment receiving artifacts. Use a similar task structure and clean artifact transfer; adopting its runtime is unnecessary for this Windows/Tauri milestone. [Harbor task format](https://docs.harborframework.com/tasks/overview), [separate verifier](https://docs.harborframework.com/tasks/separate-verifier).

| Option | Benefit | Cost / limitation | Decision |
|---|---|---|---|
| Repair old assertions and immediately call them the baseline | Smallest change | Still mixes live data, weak specifications, mutable tests, and evaluation bypasses | Keep as legacy diagnostics only |
| Integrate full SWE-bench/WebArena/OSWorld now | External comparability and large task pools | Environment setup and adapters would delay direct testing of reported Zeus failures | Defer one bounded external adapter until local measurement works |
| Small local missions using the real Zeus runtime | Direct relevance, resettable data, understandable failures | Requires authoring and validating task-specific graders | Recommended |
| LLM judge assigns every run a single score | Easy to prototype for open-ended work | Judge drift, cost, prompt injection, and plausible-but-wrong approvals | Optional calibrated supplement later |

## 4. Task portfolio

Core v1 has the agreed mix: three browser, three coding, two data/files, two memory/recovery, one research, and one vision mission. Each has a complete user prompt, explicit output contract, versioned inputs, allowable effects, required checks, and a known working solution. Graders may test undisclosed input examples of the stated behavior; they may not invent new requirements after execution.

| ID | Mission and representative request | Required independent outcome | Initial packet |
|---|---|---|---|
| B01 | In a local service portal, find the specified customer/ticket, update its priority and note, and leave other tickets alone. | Server-owned database contains the exact changes, unchanged unrelated records, and no duplicate update. | 2A |
| B02 | Filter a local order table by the stated date/status, export the matching orders, and summarize the total. | Independent fixture calculation agrees with downloaded CSV rows, amounts, and final answer; empty and boundary cases covered. | Later core |
| B03 | Prepare a portal draft, receive a changed requirement, then finish the same workflow without submitting it twice. | Server records match the revised request; exactly one intended submission; cross-turn continuity observed. | Later core |
| C01 | Repair nested list handling in a small JSON-flattening library while retaining existing dictionary/scalar behavior. | Trusted failing cases become passing; preservation and edge cases remain passing against submitted implementation. | 2A |
| C02 | Add filtering and pagination to a small existing HTTP service with an explicit API contract. | External requests verify filtering, stable pagination, invalid-input handling, and existing routes. | 2A |
| C03 | Build a small task dashboard with stated filtering, editing, keyboard access, and persistence requirements. | External Playwright probes verify behavior and reload state; real screenshots retained for separate polish review. | Later core |
| D01 | Reconcile CSV/JSON invoices and payments, respecting supplied duplicate, currency, rounding, and date rules. | Exact normalized records, exception classifications, and totals match a separately implemented reference calculation. | 2A |
| D02 | Migrate a supplied SQLite feedback store, preserve IDs/notes, add categories, and make ingestion idempotent. | Trusted snapshots and fresh-input probes verify preservation, schema, classifications, and safe reruns. | 2A |
| M01 | Apply an initial project specification, accept a correction, then complete later steps after a fixed distracting evidence bundle. | Artifacts implement the latest requirements, retain required earlier constraints, and exclude explicitly superseded values. | Later core |
| M02 | Resume a workflow after a controlled app restart and finish without repeating an already confirmed side effect. | Independent portal audit has exactly one earlier side effect and the required later effect; durable task recovery is exercised. | Later core |
| R01 | Reconcile a fixed local evidence collection containing an old claim and a later correction; produce a sourced recommendation. | Required factual claims and correction handling match evidence; supplied citation IDs resolve to supporting source spans. Open-ended prose quality remains separate. | Later core |
| V01 | Compare two supplied order screenshots and report which line changed, its old/new quantity, and the revised total. | Random opaque filenames contain no answer; image pixels contain the relevant facts; structured comparison and numeric checks agree with the reference. | 2A |

V01 accepts a working vision-helper or OCR route; it does not require one particular internal model call. Attachment persistence alone cannot satisfy it. B01/B02 require browser interaction as stated in their prompts; a direct database edit cannot substitute for using the portal. Evidence of browser interaction and backend outcome are checked separately.

Browser session count, live-preview freshness, replay fidelity, and cleanup are runtime diagnostics alongside B01-B03. A correct portal state does not imply that those UI/runtime features work. Phase 3 will add direct probes for their full lifecycle. Report missing observations as unknown, never as passing replay checks.

M01 records actual input size, model context information if known, and whether compaction happened. A fixed long transcript is not proof of testing compaction. A separately scripted regression will force the compaction boundary. M02's restart trigger is a controller-observed committed checkpoint, not a fixed sleep or a model's claim.

Four stretch missions remain outside the core headline score: full application plus visual refinement; long browser/data workflow; conflicting-evidence synthesis; long recovery mission with a requirement change. Define and approve their contracts after core graders work. Complex user-authored prompts can join this set without becoming the only tasks we repeatedly optimize against.

## 5. Task, grader, and reference contracts

Proposed structure under `tests/benchmarks/missions/v1/<id>/`:

- `task.json`: stable ID/version, categories, prompt/turns, fixture seed, artifact contract, policy, deadlines, and required grader IDs.
- `inputs/`: only files and scenario data visible to the acting agent.
- `reference/`: evaluator-owned known working solution/output and reset procedure.
- `graders/`: outcome checks and deliberately wrong submissions used to prove they reject mistakes.

The location in the repository is for authoring. The live deployment copies only agent-visible inputs into the acting environment. Evaluator code, expected outputs, and reference solutions are not deployed there. Published development tasks are not secret; do not claim that withholding their paths prevents contamination.

Every core mission must pass its reference solution and at least one materially different valid submission where alternatives exist. Negative examples target plausible mistakes: a no-op, a partial result, the wrong record, a fake report, edited visible tests, stale requirements, and an incorrect boundary calculation as appropriate. Prove that the original C01 bug fails and the real fix passes. Test fixtures and graders before paying for agent attempts.

Grade exported code/data against a fresh trusted environment. Do not execute `pytest` from an agent-modified test tree or import a grader helper from the submission's current working directory. Execute submitted code only inside the selected grading isolation profile, with bounded processes, output, disk, and wall time. Reject symlinks/reparse-point escapes, arbitrary artifact paths, excessive file counts/sizes, and invalid archives during export. A clean checkout or directory alone does not contain malicious submitted code.

For data, inspect content and semantics, not just file existence. Use an independently written reference implementation for calculations rather than calling the submitted function to generate its own expected answer. Preserve the public input/output contract so valid approaches are not rejected for formatting choices that were never required.

Grader results include `passed`, `failed`, `not_evaluated`, or `error`, plus criterion ID, expected/observed summaries, and evidence references. Required grader errors prevent a verified pass and remain distinguishable from a known incorrect agent outcome. Do not map every error to agent incompetence.

Keep Phase 1 raw trials immutable. If later regrading is needed, write a separate assessment with original trial ID, artifact hashes, grader revision, and assessment ID. Reports must select the original or regraded assessment explicitly rather than silently rewriting history.

## 6. Runtime and authorization

Use the existing production bridge (`sendUserMessage`, persisted run state, approvals, attachment upload) as the initial trial driver. Keep the real planner, gateway, workers, tools, and permissions. UI automation is transport and selected UX verification, not a substitute agent implementation. A new headless Rust API is unnecessary for 2A; consider one only if measured desktop launch overhead or automation instability justifies extraction.

Replace legacy evaluation-mode launch and the title-based approval simulator for the new suite. Each task has a declared script for clarification answers and allowed effects. An unexpected request is recorded as an intervention/blocker; the controller does not infer permission from convincing model prose. Do not teach the agent the expected solution through simulator feedback. Every intervention has the same policy across comparison runs.

Authorization has a stated scope. For example, B01 requires no modifications to unrelated fixture tickets and no requests to the fixture's forbidden publication endpoint; the fixture server checks both. These checks establish those task-policy conditions, not that no arbitrary host effect occurred. Record policy version, covered channels, and missing observations with the assessment. If a required channel cannot be observed, authorization remains not evaluated. A matching final state alone cannot prove that no forbidden action happened and was later undone.

Fully verified trial success still requires successful execution, all required outcome checks, and all required authorization checks. Failure of a required condition is not offset by a high prose or efficiency score. General prompt-injection resistance needs its own adversarial task set; six benign missions cannot certify it.

Execution profiles must be explicit:

| Profile | Intended use | Required boundary / limitations |
|---|---|---|
| `reference-offline` | 2A fixture/grader development and controlled mock regression | No model inference; no untrusted agent-produced programs. Known reference code runs in an owned test directory. |
| `native-supervised` | Optional early Windows reproduction on this development machine | Real normal approvals and synthetic data; host is not isolated. No claim of hidden-test secrecy, autonomous safety, or adversarial benchmark validity. Use only if explicitly selected for a pilot. |
| `isolated-windows` | Recommended repeatable coding/browser baseline | Disposable Windows VM/account boundary with no personal data/profile, evaluator-owned state outside the acting boundary, controlled artifact export and egress, and a separately isolated grader for submitted programs. Validate containment before calling it isolated. |

An ordinary second process, WSL installation, cloned browser profile, or Python audit hook does not satisfy the isolated profile. Docker was not found on this session's PATH; WSL being present does not prove a usable VM or container runtime. No install or machine reconfiguration is included in 2A. Choose the existing or newly provisioned execution environment before 2B live use. A small benchmark VM is a development environment, not the product's future unrestricted-mode sandbox.

## 7. Comparison and scoring

Freeze task/fixture versions, seeds, OS/tool versions, input order, role models/effort, provider origin/protocol, prompt hashes, authorization/user script, execution profile, limits, and grader revisions. Record requested and reported model identities; an unavailable provider snapshot ID remains unknown. Equal model names do not guarantee identical underlying weights over time.

Use explicit Abacus model IDs for a controlled baseline, not `route-llm` automatic selection. Abacus documents catalogue discovery through `/v1/models` and describes usage as token statistics, including final streaming usage; that is not a universal conversion into subscription credits. Do not route around Abacus into a collection of upstream subscriptions. [Abacus Chat Completions documentation](https://api.abacus.ai/help/route-llm/chat-completions).

Start with **Solo on one explicitly selected model**. The eventual Solo/Team experiments answer two different questions: whether adding the current collaboration machinery improves completion with controlled role models, and whether using cheaper workers improves the quality/resource tradeoff. Do not change architecture and all model assignments together and attribute the difference to architecture alone. Keep Watcher/vision, policies, environments, and total allowances matched. Local-model comparisons need explicit disclosure of current local-specific behavior until it is decoupled.

The report should show:

- Scheduled, started, completed, unsupported, infrastructure-error, and graded trial counts. The all-scheduled user-success denominator retains unsuccessful attempts. Any graded-only view is secondary and labels excluded counts.
- Verified first-attempt success per task and overall; independent outcome and authorization results; partial criterion completion for diagnosis.
- For repetitions, empirical success rate and the fraction of tasks passing all three attempts. Do not call an independent-probability estimate a measured consistency result or use best-of-three as the headline score.
- Input/output/reasoning/cached tokens and unknown requests by role, provider credits only if authoritatively measured, elapsed time, interventions, retries, and observed tool failures.
- Total resource use across successful and failed trials divided by successful completions, alongside success rate. Zero successes makes cost per success undefined. Unknown usage/credits prevent an exact cost claim.
- Build/configuration-specific paired wins, losses, and unchanged outcomes; per-category results; failures with links to evidence. Do not average unrelated experiments into a release verdict.

Three repetitions are an initial engineering signal, not statistical proof. Tasks are heterogeneous and repeat attempts on one task are not extra independent task types. Show raw counts. If uncertainty intervals are later added, use task-level pairing/clustering rather than treating every retry as an independent task. Before/after trials should be interleaved where possible to reduce provider drift.

UI polish and open-ended writing quality get separate anchored human review initially: 0 = unusable/missing; 5 = materially incomplete or major usability problems; 8.5 = all stated needs met with minor flaws; 10 = exceptionally clear and polished. No automatic conversion from fewer tokens or tool calls into that score. Add an LLM judge only after calibration on human-reviewed examples, with blinded order, retained rubric/evidence, and injection-resistant separation of instructions from submitted content. Disagreement remains visible.

## 8. Budget and trial schedule

The planned 2A grader-validation run uses **zero hosted calls and zero provider credits**, because it verifies known fixtures and submissions. The user permits efficient live models for useful targeted testing; avoid expensive SOTA models for routine test development. A larger model matrix or repeated capability baseline still needs explicit model selection and a bounded allowance, rather than assumptions based on the $10 subscription price.

Before any inference, add a controller-owned request gate shared across all task roles/retries. It reserves request slots atomically, enforces wall-time and tool-step ceilings, passes a tested per-request output cap through the selected protocol, stops dispatching after known token allowance is exhausted, and cancels work on breach. Include outstanding requests in the estimate, not only completed usage. Record unknown cancelled usage. This is evaluation budgeting, not automatic production model routing or Smart approval.

Provisional schedule for later approval:

| Stage | Maximum planned attempts | Purpose |
|---|---|---|
| Calibration | One D01 mission, once, Solo | Verify actual payload, usage, completion, artifacts, and grader against the chosen provider/runtime. Proposed limits: 5 minutes, 8 model attempts including all roles/retries, 20,000 known token equivalents, 4,096 output tokens per model request. Protocol support must be validated first. |
| Pilot | Remaining five 2A missions, once each | Find environmental/grading problems before replication. Proposed per-mission limits: 10 minutes, 20 model attempts, 50,000 known token equivalents, 4,096 output tokens per request; mission-level exceptions require an explicit manifest. |
| Frozen Solo baseline | 12 core missions x 3 attempts = 36 | Establish an initial repeatability baseline after task validation and budget calibration. |
| Optional Team diagnostic | 4 representative missions x 3 attempts per chosen Team configuration | Compare controlled collaboration, then optional cheaper-role assignment; not an automatic full model matrix. |

Those are proposed operational bounds, not dollar or Abacus-credit estimates, and are not authorized spending. A model request can overrun a remaining token allowance; a request-count ceiling and output cap bound exposure more honestly than an exact token hard-cap claim. Where supported authoritative account usage exists, reconcile before/after the pilot. Otherwise retain unknown credits and require the user to accept explicit operational limits rather than pretending we can enforce an exact monetary ceiling.

The first pilot has at most six total agent attempts, with calibration included; do not silently rerun failures. Include all actor, Watcher, vision, judge, simulator, retry, and health-check inference in the experiment ceiling. The initial deterministic user script and code graders need no judge calls. A failed calibration stops later dispatch rather than consuming the rest of the pilot automatically.

Freeze a manifest before live execution listing exact provider/model IDs, mission IDs/versions, repetitions, limits, user script, environment profile, account attribution, and approved credit or operational envelope. Generate a dry run and estimated maximum request count for review. Keep live runs manually triggered and separate from ordinary CI.

## 9. Regression decisions and held-out evaluation

Deterministic software/fixture/grader regressions block a candidate immediately. A new capability failure flags a comparison; it does not trigger automatic source changes or deletion of a previous result. Classify whether the task contract, environment, provider, or agent caused the failure before assigning blame.

For a material suspected decline, propose a bounded confirmation batch on the affected missions plus unaffected controls, interleaving baseline and candidate where feasible. Confirmed failure on a required capability blocks promotion unless the tradeoff is explicitly accepted. Preserve all records and prepare an isolated revert if appropriate; never reset unrelated work or the user's repository automatically.

Core missions are the development set, not secret held-out tests. Test-input variants can detect simple hardcoding but are not independent generalization evidence. Create a separate validation set after core works, and rotate a genuinely held-out pack that the optimization agent cannot read in its execution environment. Once its solutions or failures are inspected for tuning, retire that pack from held-out status. Do not promise hidden evaluation on the current same-user native host.

Do not start the autonomous patch/retry optimization loop in Phase 2. First make measurement trustworthy and affordable; Phase 8 can use the frozen contracts without allowing its optimizer to rewrite the grader, budget, or hold-out set.

## 10. Code and data touchpoints

Extend Phase 1 rather than replacing it:

- `tests/benchmarks/missions/`: new versioned task contracts, fixtures, trusted references, and grader validation examples.
- `tests/benchmarks/mission_graders/`: task-independent artifact validation, clean grading entry points, criterion evidence, and assessment records.
- `tests/benchmarks/benchmark_engine.js`: mission lifecycle adapters, attachments, declared user turns/checkpoints, normal-policy launch, export, and independent checks. Do not silently migrate legacy suites to new semantics.
- `tests/e2e/testUtils.js`: separate mock-provider selection from real-provider launch and from privilege policy. Real provider must not imply `ZEUS_EVAL_MODE=1`.
- `scripts/eval_harness/runner.js` and `benchmark_config.js`: explicit mission manifests, dry-run validation, policy/environment identity, output/request/step limits, and experiment budget state.
- `score_recorder.js`: additive criterion/policy-scope fields and immutable assessment references; preserve schema-v2 history and compatibility tests. Do not reset existing results.
- Existing Rust gateway/accounting/run-control boundaries: only the narrow controller request gate and required observability hooks after 2A review. No production prompt, browser-lifecycle, memory-schema, permission-classifier, or Team redesign in this phase.

Routine outputs remain under ignored `.zeus/evaluations/`. Commit a compact, deliberately redacted baseline manifest/summary only after reviewing it for credentials, cookies, personal data, and source content. Keep fixture data synthetic; do not commit raw personal chats or account exports. Record retention sizes and incomplete artifact capture explicitly.

## 11. Implementation sequence and acceptance gates

**2A — implemented: six missions and proven graders.** Create B01/C01/C02/D01/D02/V01 contracts and deterministic synthetic inputs. Add a minimal resettable local ticket portal for B01 and a small service fixture for C02. Implement known reference submissions and independent deterministic graders, with valid alternatives and plausible failing submissions. Use existing Node/Python tooling; no large benchmark dependency, model calls, machine installation, or production runtime changes. Expected outputs and grader source stay in evaluator-owned authoring directories, not the deployed agent input bundle. Acceptance: all six references pass, defined negatives fail, repeat resets reproduce state, content hashes/version changes are visible, and grading does not use agent-writable tests. Validate image facts against generated pixels/fixture construction and document that actual runtime perception remains untested until live integration. Run the relevant offline checks.

**2B — lifecycle integration and execution profile.** Select/validate the Windows execution boundary; make actor input deployment and trusted artifact export explicit. Drive the real bridge with normal policy and a fixed user script; add independently observed fixture-policy checks and coverage reporting. Add the experiment request gate and bounded cleanup, proving startup/cancellation/timeout/grader-error/tamper cases with mocks. Reproduce browser and attachment failure paths without repairing their architecture. Acceptance: known-pass and known-fail integrated trials have truthful records, boundaries/coverage are accurately labeled, no legacy auto-approval bypass is needed, and no paid run occurs by default. Environment installation, if needed, is a separate concrete decision.

**2C — explicitly budgeted calibration/pilot.** Choose the exact Abacus model and execution profile and approve a frozen paid manifest. Run at most the proposed six attempts with no tuning or hidden retries between them. Audit false positives/negatives and resource usage. A grader correction creates a new revision and explicit regrade; it is not a retroactive silent pass. Acceptance: trustworthy evidence and a realistic resource envelope for the baseline; an empty or invalid pilot is not completion.

**2D — complete core v1.** Add the other six core missions and their reference/negative controls. Implement checkpoint/restart and actual browser/attachment inputs. Add real rendered-app probes for C03; leave subjective polish unmeasured until reviewed. Acceptance: 12 versioned core contracts, independently validated graders, a stable manifest, and a reproducible dry run. Preserve known runtime failures as failures rather than weakening task requirements. Do not delay Phase 3 bug repair solely to build stretch tasks or adopt an external benchmark; the valid six-mission diagnostic subset can support targeted before/after repairs before this expansion if we agree to reprioritize them.

**2E — freeze baseline and comparison report.** Run the approved repeated Solo baseline, regenerate the report from raw records, record known limitations, and nominate a small comparison subset for Phase 3. Team comparisons and stretch tasks get their own bounded budgets. Acceptance: repeat trials retained, paired comparison logic validated, provenance and unknown metrics visible, and baseline artifacts reviewed before any publication.

Roll back each increment using its isolated commit if necessary; retain old runners/results and additive schema history. Phase 1 remains the software-regression gate throughout. Do not expand a failed pilot into an autonomous source-refinement loop.

## 12. Decisions for review

The user approved **2A** on 2026-10-27, with two standing preferences: describe each phase's tangible app/developer impact before implementation, and use efficient live models when they materially help testing rather than treating all inference as prohibited. Implement the six contracts/graders before scaling infrastructure or running a capability baseline.

The user selected **native supervised diagnostics** for the first small live-model check on 2026-10-28: normal approvals, synthetic inputs, shared host permissions, and no isolated-baseline claim. This resolves the environment choice for that check, not for adversarial or held-out execution. Before a larger 2C pilot: freeze its model, missions, environment, and resource allowance separately.

This staged approach keeps the urgent browser/image repairs in view: measure a small relevant slice, preserve failures, then use that evidence for Phase 3. It avoids building a broad optimization system before the evaluator has earned trust.

## 13. Phase 2B implementation and diagnostic findings

The driver now uses a feature-gated `zeus-evaluation` binary linked to the production library, fresh task storage, ordinary permissions, explicit model/settings readback, versioned input deployment, bounded artifact export, and independent grading. It retains partial usage and evidence even if collection/grading fails. Mock-provider selection is independent of privilege policy. The user's running `zeus-agent.exe`, credential vault, manual chats, and browser profiles are not test fixtures.

A process-wide opt-in gate covers every instrumented gateway role/retry, including calls without a task owner. It reserves request slots and estimated input plus capped output before HTTP dispatch, limits concurrency/directives/deadline, and stops after unknown usage. Estimated input is serialized JSON bytes divided by three, not an exact tokenizer. Reported usage may exceed that estimate; provider credits remain unknown. A terminal incomplete/failed Responses event preserves reported usage before surfacing the failure. HTTP errors are logged against the task with the active credential redacted; bounded diagnostics return the original error rather than masking it with a blocked compatibility retry.

The six scripted integrated missions test the real bridge and normal policy. Known reference/control hashes are required before executing a scripted submission. Live executable outputs stay ungraded until an isolated executor exists; the first live command exposes data-only D01. Global authorization coverage remains partial and cannot produce a fully verified pass. B01 catches a false completion claim; V01 proves uploaded image bytes reach a mocked perception call, not live image understanding.

Two initial native D01 diagnostics used exact Abacus model `gpt-5-nano`, one attempt per experiment, no matrix/trial retries, and the following recorded operational limits: six requests, one in flight, twelve directives, 4,096 output tokens per request, 100,000 token equivalents including estimated reservations, and 180 seconds. These supersede the earlier proposed calibration numbers for these small diagnostics only. Both attempts failed after two requests, with 2,487 and 2,271 known tokens respectively and one unknown-usage request each. No provider-credit conversion was invented. Both failure reports remain retained locally.

The second run captured the actual provider rejection: `input[1].content[0]` used `input_text` for assistant history, for which the provider required `output_text` or `refusal`. The gateway now uses the documented plain-string message form for user and assistant history, avoiding that invalid conversion. A strict mock reproduces the old rejection and a two-turn desktop test verifies the repaired wire history without protocol fallback. This is a narrow production correctness repair discovered by calibration, not a prompt/model architecture change. [Official conversation-state examples](https://developers.openai.com/api/docs/guides/conversation-state).

One final bounded confirmation used the same model/task/grader after that protocol repair. It completed four model requests with no unknown usage and 15,717 reported tokens, created `reconciliation.json`, and returned a completion summary. The independent outcome **failed**: the implementation read the wrong invoice amount column, deduplicated by invoice ID instead of payment ID, and emitted `totals_per_currency` instead of the requested `totals`. Inputs were preserved. One exact synthetic-file read was approved once by the external Codex supervisor through the normal approval bridge and is recorded in the trial; no standing permission was granted. No prompt, reference, or grader was changed to make this output pass, and no further live quality retries were run.

Retained experiments under ignored `.zeus/evaluations/`: `native-diagnostic-7e261d15-3e05-499d-9a64-8c0893723199` (original masked failure), `native-diagnostic-ee6f59c2-c2f5-4959-9782-1c05b2a91323` (provider rejection captured), and `native-diagnostic-9ee89112-7af6-4bdd-88b2-c062ca164a87` (protocol confirmation; incorrect artifact). Total: eight provider requests, 20,475 known tokens and two unknown-usage requests; exact Abacus credits remain unavailable. These are integration diagnostics, not a repeated capability score or evidence that the chosen small model represents SOTA performance.

The normal-policy tests also exposed a pre-existing Windows path-normalization issue: a canonical `\\?\` workspace prefix becomes `//?/` before the existing strip operation, so a plain absolute target may fail the intended workspace match and request approval. Scripted controls approve only their exact known write and record that intervention. No broad privilege bypass was introduced; the production permission repair remains a dedicated follow-up.

This increment does not complete 2C-2E. It supplies repeatable software checks and native diagnostic evidence, while isolated grading, independent authorization observation, held-out execution, larger task coverage, and repeated matched baselines remain pending.
