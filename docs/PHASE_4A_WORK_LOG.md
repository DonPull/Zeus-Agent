# Phase 4A — automatic execution checkpoints

5 November 2026. Implementation and offline validation complete. Initial live
comparison retained one browser failure; the general deadline repair is offline
validated and its separate post-repair live follow-up is pending.
This is the first slice of the [Phase 4 design](PHASE_4_TASK_STATE_DESIGN.md),
not completion of Phase 4 or the official full benchmark.

## Tangible change and decisions

The plan panel follows actual execution without a periodic model-authored
status update. It distinguishes Working, Waiting for you, Stopping, Stopped,
Interrupted, Run failed, Paused and Run finished. Milestone progress is labelled
as reported by the agent. A tool result or finished run does not automatically
complete semantic milestones; an unfinished active step remains unconfirmed.

| Previous behavior | Implemented behavior |
|---|---|
| Latest plan markdown treated as execution authority | SQLite checkpoint and idempotent source-reference events; plans remain model proposals |
| Model reminder after four actions | Local lifecycle bookkeeping without an extra model request or permission |
| A plan could overwrite newer input without a source revision | Accepted human input revision, proposal/run binding and retained stale proposals that cannot replace the current plan |
| Cancellation wrote another action-plan message | One stable, versioned checkpoint projection; original plans retained, interrupted step presentation derived |
| Budget/iteration/review stop could appear as a completed run | Explicit paused terminal state; ordinary conversational completion remains supported |
| Model plan reinjected as system-level source of truth | Labelled checkpoint/proposal data through the existing tool-evidence transport; current human requests remain authoritative |
| HTTP chunks decoded independently | Both Chat and Responses decode complete SSE lines across arbitrary byte boundaries, preserving Unicode and final lines at EOF |

The additive migration retains old messages/plans and labels legacy input
coverage unknown. Event transactions cover accepted input, root lifecycle,
parsed actor directives/results, approval/choice/handoff state and worker
transitions. Existing browser/action journals remain the detailed evidence;
no image or transcript copies are added to the checkpoint event table.
Results received and uncertain attempts are distinct from verified effects.
This does not certify all host activity or repair the separate verifier-probe
execution/authorization path planned for the later shared-executor work.

A newer input marks an older plan's coverage stale; it does not automatically
cancel the original goal or block independent work. Checkpoint updates make no
semantic inference or general claim that an arbitrary user goal has been proved.

## Response-format diagnostic

Synthetic response-only SSE bytes and decoded outcomes are retained by the
desktop tests under ignored `test-results/offline/stream_format-*` directories.
The controls split Unicode inside a network chunk and include both incremental
content and a final full-text field. Each protocol emits one exact answer with
one request. Rust tests also exercise every fixed chunk width, byte-by-byte
Unicode delivery, invalid input and EOF without a newline.

The earlier repeated-directive failure is not explained by this Unicode defect.
Ambiguous multiple directives remain rejected without executing any of them.
No native function-calling migration or relaxed parser is included; that needs
a separate measured transport decision. The tests retain synthetic responses,
not credentials, request headers or ordinary private provider traffic.

## Validation

The final full offline regression passed **324 checks**: 57 JavaScript unit checks,
37 mission/grader controls, 102 Rust checks, 23 Python browser-service checks,
102 desktop checks and three private-desktop handoff cases. The frontend build
and whitespace check passed. After final review removed an unnecessary plan
excerpt limit, the 100 Rust checks and 30 relevant desktop checks passed again,
including retention of the full end of a long plan in actor context.

Backend state tests cover revision/source identity, stale proposals,
worker/master result ownership, approval waits, transaction rollback, legacy
migration, original-plan retention, stable UI projection and restart uncertainty.
Desktop checks exercise approval/resume, Stop, stale-plan repair and reload,
with actual screenshots inspected; status/results rows have a layout check.
The misleading generating-reply indicator is hidden during a recorded human
wait. The deadline repair adds real missing-locator recovery, repeat-ID
non-reexecution, delayed human approval and hard script-timeout controls.
Existing parser/accounting/cancellation and
browser checks are retained.

Commands: `node scripts/run_regression.js`, `npm.cmd run build`, then
`cargo test --lib --locked` and
`node scripts/run_regression.js --ui-files task_state,stream_format,runtime`.
Screenshots/wire diagnostics are under ignored `test-results/offline/`; private
handoff evidence is in
`.zeus/evaluations/native-handoff-7d81c37f95754f9495af6fbb19852a73/`.
These private-desktop checks do not establish active-game focus behavior.

### Initial live comparison and observed failure

Frozen `8c13c82` ran six native D01/B01/V01 Solo/Team attempts using the earlier
exact `gpt-6.1-terra` low/Chat configuration, unchanged mission limits/graders,
normal approvals and synthetic fixtures. Outcome: **5/6**, 32 requests,
53,198 reported tokens, zero missing-usage requests, provider credits unknown.
Every actual request used master; Team delegation is not demonstrated.
Raw attempts remain in `.zeus/evaluations/phase4a-smoke-20261105/`, including the
failed B01 Solo attempt and source/usage evidence. The
[reviewed receipt/comparison record](benchmarks/phase4a-smoke-20261105.json)
includes immutable raw-trial hashes.

The matching calibration had 6/6 outcomes, 32 requests and 57,056 reported tokens.
Descriptive before/after results:

| Cell | Outcome before → after | Agent seconds before → after | Reported tokens before → after |
|---|---|---|---|
| D01 Solo | pass → pass | 23.581 → 24.141 | 9,068 → 10,439 |
| D01 Team-enabled | pass → pass | 43.911 → 35.275 | 14,990 → 13,484 |
| B01 Solo | pass → fail | 28.574 → 58.817 | 6,908 → 7,231 |
| B01 Team-enabled | pass → pass | 28.397 → 27.030 | 14,865 → 10,057 |
| V01 Solo | pass → pass | 19.456 → 12.205 | 5,400 → 5,706 |
| V01 Team-enabled | pass → pass | 15.437 → 16.740 | 5,825 → 6,281 |

One trial per cell is a smoke comparison, not evidence of an efficiency gain.
The lower aggregate token total also includes a failed task. There are zero
fully verified passes because global authorization remains not evaluated on
the native host. Cache/reasoning fields are retained separately, never added
again or converted into subscription credits.

B01 Solo selected a priority in a form, guessed a nonexistent note selector,
and hit the script's 30-second hard timeout while the locator also had a
30-second default. Cancelling the in-flight caller correctly ended the browser
with uncertainty; this then prevented inspection/recovery in the same run.
The agent reported the task incomplete; the portal update never committed.
This is not proof that checkpoint prompting caused the failure.

### General deadline repair and follow-up

Browser calls inside scripts now use the remaining active script budget, with
return/capture headroom. The limit is applied after policy, startup and queue
waits; permission-card time still does not consume the outer execution budget.
Requested action identity and policy hashes remain unchanged. Effective timeout
is recorded in the response. An ordinary locator failure can return before
the process is killed, leaving the same browser available for inspection.
Hard timeouts, lost services and uncertain side effects still require owned
cleanup; there is no silent restart, forced click or blind mutation retry.
This is a bounded recovery repair, not a broad browser-speed optimization.

The request-only checkpoint uses the existing user-role tool-evidence convention
with explicit model-proposal labels; it is not persisted as another human input.
This also avoids leaving assistant-role bookkeeping as a response prefill:
[Hugging Face's chat-template guidance](https://huggingface.co/docs/transformers/chat_templating#continue_final_message)
describes that behavior in its text-generation pipeline. This is a compatibility
precaution, not a claim that Abacus used that pipeline or that it caused B01.
Forty relevant desktop/protocol/limit checks passed after this final adjustment.

The follow-up is three new Solo attempts, one per mission, on a newly frozen
repaired commit. Maxima are D01 10, B01 16 and V01 8 requests: at most 34 further
requests, keeping total dispatch within the original 68-request allowance
(32 already used + at most 34). No automatic trial retry, model sweep or
replacement of the failed original receipt is allowed.

## Remaining Phase 4 work

4B still owns source-backed memory, context budgeting/compaction, indexed/paged
history search, exact original-message/attachment retrieval and the long-run
retention/recall tests. 4C owns structured completion evidence and its exact
user journey. The full 12-core Benchmark v1 milestone follows Phase 4 before
Smart permissions, as recorded in the live roadmap.
