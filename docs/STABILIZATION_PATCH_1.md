# Stabilization patch 1

Approved scope: user instruction on 2026-10-28 to stabilize current functionality before adding features. Existing uncommitted Phase 3A work remains the starting point. No browser-service overhaul or new approval product mode is included.

Review checkpoint: on 2026-10-30 the user reported that manually retested functionality worked as expected and authorized committing the combined Phase 3A/stabilization changes. This confirms the reviewed slice, not the remaining browser or goal-completion work.

## Tangible changes

- Opening/selecting models in global or task settings must keep the application visible and preserve the chosen provider/model across save/reopen.
- Large valid image uploads must support repeated text-only follow-up inspection without reattachment, native process termination or lost task state.
- Ordinary conversational replies and final-answer directives must publish one final response per result without unnecessary forced requests.
- Intended task-workspace file operations must use correct containment and honor explicit denials, without sibling-prefix/traversal/link escapes.
- Diagnostic runs can proceed while the user is away through a prepared external supervisor using normal per-action approval APIs. Decisions and unresolved actions remain visible in evidence.

## Decisions and changes of approach

| Area | Previous approach | Patch decision |
|---|---|---|
| Reproduction | Small images and bridge-settings writes dominated coverage | Exercise actual dropdowns and large valid synthetic inputs, the reported multi-turn sequence, and normal native stack settings. Capture page errors and child-process exit/stderr. |
| Crash | Fatal native error on nested visual-tool work | Reproduce with large images and fresh HTTPS connections, then heap-pin the nested directive future. Keep normal stack sizes and certificate validation; do not claim aborts can be caught. |
| UI failure | A render exception could unmount the whole app | Fix the undefined-variable bug and add scoped recoverable rendering boundaries, with tests that still fail on unexpected UI exceptions. |
| Responses | Broad keyword-based narration forced continuation; preamble and final summary both became chat | Publish final summaries once. Ordinary text remains conversational completion; a pending malformed directive or short standalone action announcement gets bounded protocol repair. Preserve raw output, and keep artifact grading separate from chat completion. |
| Permissions | Raw string prefixes and broken Windows extended-path normalization preceded explicit policy | Apply explicit rules, preserving existing task/global specificity, before automatic allowances. Resolve local task-relative/canonical containment, test boundaries/reparse paths, and leave unverified UNC/device paths to explicit policy/approval without probing them. No new broad eval bypass. |
| Supervision | An external operator had to react before a short deadline | Install a bounded synthetic-task decision policy before dispatch; use normal bridge approvals and record each decision. Arbitrary commands/scripts/publication/account actions are not blanket-approved. |
| Live verification | Older familiar adapters and two narrow image trials | Validate economical current Abacus candidates, freeze exact configurations, run a bounded representative acceptance pack, retain all failures, and diagnose app/model/control failures separately. |

## Validation and operating bounds

Start with failing software reproductions. Add global/task model-selection tests, two duplicate-response controls, large-image repeated follow-up/recovery/cancellation checks, policy negative controls and supervisor decision tests. Run the offline suite and production frontend build after implementation. Inspect changed UI in the real desktop shell. Add narrowly scoped error-boundary fault injection only in test-owned frontend fixtures, not user-facing agent directives.

Live work uses fresh synthetic workspaces, normal approvals and the production library in a separate executable. Begin with catalogue/adapter preflight for Abacus `gpt-6-luna`, then explicit economical image routes. Initial envelope: at most 12 trials, 120 total model requests, one per app process in flight, 8,192 output tokens/request, bounded total token reservations, and at most five minutes/trial. Start below these ceilings; expand only when a specific unresolved concern justifies it. Public provider prices are not Abacus subscription-credit measurements. The user's available monthly credits authorize useful testing, not a requirement to consume them.

The supervisor is controller-owned and fixture-specific: safe bounded task-file reads/writes and known actions can receive an immediate one-time decision. Deny unexpected effects and stop with an explicit reason when independent review is necessary. No persistent allow rule, no hidden policy bypass, no evaluator answer used to authorize an action. Outcome grading and authorization coverage remain separate; native tests are not an OS sandbox.

Completion requires relevant automated checks passing, changed flows exercised through the UI/runtime, retained live evidence, no unresolved reproduction of the reported blockers and clear residual limitations. Browser preview/replay defects already outside this slice must remain explicit; passing this patch cannot establish those unimplemented repairs as complete.

## Delivery and reproduction evidence — 2026-10-29

The native failure was reproduced with a deterministic valid 2560 × 1440 PNG larger than 5 MB. Plain HTTP did not trigger it; the same automatic-helper → manual-inspection → repeated text-only follow-up path over fresh local HTTPS connections aborted a normal debug runtime with `STATUS_STACK_OVERFLOW`. Boxing/pinning `execute_gated_native_directive_inner` at the caller removes the reproduced failure by reducing the enclosing future's stack footprint. It does not prove a particular machine instruction was the overflowing frame. No stack-size increase or blanket `catch_unwind` was added. Before/after process evidence is retained in `.zeus/evaluations/stabilization1/reproduction/`. The offline CA is trusted only by test/evaluation builds with explicit offline mode, not normal production builds; TLS validation remains enabled.

The global dropdown crashed because `getDisabledReasonForRole` read an undefined `connection`. It now reads the role's configured binding. Actual clicks through all five global and task selectors, save/reopen and unexpected-page-error detection cover the missing interaction. Scoped render boundaries display a recoverable panel for a render failure; they do not catch native process aborts. Model/provider/detail controls now stack correctly, use existing styles, and have combobox/listbox semantics. Desktop screenshots were visually inspected at normal and narrower widths. A complete UI polish pass remains pending.

Duplicate-publication fixes are backend-owned: final-answer preambles remain in raw history and one summary is visible. A complete conversational answer containing a closing “I'll…” no longer forces another request. Three bounded protocol repairs handle malformed directives and narrowly detected short standalone action announcements; this English heuristic is **not** semantic goal verification. Exhaustion returns `MODEL_PROTOCOL_ERROR`, preserving every raw output. The actor receives its configured provider/model identity; helper instructions distinguish perception from actor execution.

Local file permissions now share one path identity implementation, including Windows extended paths, new leaf files, case and component boundaries. Explicit policy runs before workspace/local/evaluation allowances, retaining the established specificity semantics. Existing explicit-local/legacy-eval relaxations are not removed by this patch. Arbitrary UNC/device paths stay lexical and cannot acquire an automatic local allowance. Startup reconciles interrupted request rows without inventing zero usage.

The prepared external supervisor successfully approved an actual normal permission card for `comparison.json`, once, without the user being present. Negative desktop controls deny an out-of-workspace write; unit controls reject arbitrary commands/scripts/network actions and unsafe paths. The controller authorizes only declared bounded synthetic file operations, independently of their answer correctness, and creates no permanent allow rule. This is an active diagnostic controller, **not** the future production Smart approval mode or an unattended service that survives closing Codex.

## Live results and remaining failures

Seven separately recorded Abacus `gpt-6-luna` development trials used **49 requests and 153,720 reported tokens**, with zero requests missing usage. Actual Abacus subscription-credit charges remain unknown. Builds/configurations changed during diagnosis; these are not a repeated baseline or an architecture comparison. Combined report: `.zeus/evaluations/stabilization1/live-review/index.html`; compact per-trial evidence: `summary.json` beside it. Original immutable trials and failures remain untouched.

| Trial | Configuration | Independently graded result |
|---|---|---|
| `179a28ec` | V01 direct, medium, 8 requests allowed | Correct artifact; execution succeeded, 3 requests. |
| `72b5fd3f` | V01 helper + follow-ups, medium, 12 allowed | Image follow-ups worked, but no artifact; malformed/premature actor output exposed. |
| `524c8bc8` | Same configuration, after prompt/protocol repair | Follow-ups worked; standalone “I'll save…” still ended without an artifact. |
| `e049ebb4` | Same configuration, after announcement repair | Correct artifact and real supervisor approval; 12-request cap prevented the last follow-up answer. Combined execution remains failed. |
| `562d0cb0` | D01 reconciliation, medium, 10 allowed | Correct artifact and unchanged inputs; execution succeeded, 9 requests. |
| `a92b0d72` | V01 helper + follow-ups, medium, 18 allowed | Provider returned `response.incomplete` at the per-response output cap; retained as failed. |
| `03677671` | Same 18-request variant, low effort | No artifact; follow-up prose violated required JSON. Retained as failed; lower effort is not established as a better default. |

Three of seven artifact outcomes passed; no trial establishes full independent authorization coverage. The report therefore still has zero **fully verified** passes. Outcome correctness, execution completion and authorization proof are separate. Graders were not loosened, chat JSON was not submitted as a file, and no failed trial was retried automatically or removed. The larger request allowance explicitly labels a different three-turn operating envelope.

Reliable goal completion remains open: a model can still stop with prose or an incomplete action, even though the UI/runtime survives. Deterministic task contracts, durable plans/memory and evidence-based completion remain the next task-state work. Browser ownership/live preview/replay repairs, broader visual polish and durable backend event logging also remain open. Do not represent this patch as a stable-v1 certificate.

## Verification record

The full offline suite passed 36 JavaScript unit tests, 37 mission/grader checks, 66 Rust tests and 56 desktop checks. A final path-policy addition then passed all **67 Rust tests**, bringing the validated set to **196 checks**. The frontend production build and optimized evaluation-runtime build passed. Debug fresh-TLS large-image inspection, cancellation, full process restart with historical attachment reuse, model selector interactions, render-fault recovery and normal approval decisions are covered. The additional **optimized-release fresh-TLS large-image regression passed**, with no native stderr or unexpected UI errors (process evidence in `release-stack-after.json`). The GitHub workflow adds the same focused release check; remote CI has not been run.

The final 56-check desktop rerun after the path-policy addition also passed. `cargo check --locked --bin zeus-agent` passed without evaluation features, checking the normal application's compilation separately from the test executable. All test-owned evaluation processes were stopped; the user's main app was not stopped. Local validation details are retained in `.zeus/evaluations/stabilization1/validation.json`.

For subsequent patches: run the affected negative/control checks, the ordinary regression groups and frontend build; exercise changed controls in the real desktop shell; retain native exit/stderr and unexpected UI errors; use a bounded real-provider case when the change affects provider behavior. Re-run the release transport case when nested async or image/TLS code changes. A failure must be explained or fixed rather than hidden by a mock or stronger model.
