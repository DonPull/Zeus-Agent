# Phase 4A — automatic execution checkpoints

5 November 2026. Implementation and offline validation complete; bounded live
follow-up pending on a frozen source commit.
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
| Model plan reinjected as system-level source of truth | Execution metadata and model plan supplied as labelled assistant data; current human requests remain authoritative |
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

The full offline regression passed **320 checks**: 57 JavaScript unit checks,
37 mission/grader controls, 100 Rust checks, 23 Python browser-service checks,
100 desktop checks and three private-desktop handoff cases. The frontend build
and whitespace check passed. After final review removed an unnecessary plan
excerpt limit, the 100 Rust checks and 30 relevant desktop checks passed again,
including retention of the full end of a long plan in actor context.

Backend state tests cover revision/source identity, stale proposals,
worker/master result ownership, approval waits, transaction rollback, legacy
migration, original-plan retention, stable UI projection and restart uncertainty.
Desktop checks exercise approval/resume, Stop, stale-plan repair and reload,
with actual screenshots inspected; status/results rows have a layout check.
The misleading generating-reply indicator is hidden during a recorded human
wait. Existing parser/accounting/cancellation and
browser checks are retained.

Commands: `node scripts/run_regression.js`, `npm.cmd run build`, then
`cargo test --lib --locked` and
`node scripts/run_regression.js --ui-files task_state,stream_format,runtime`.
Screenshots/wire diagnostics are under ignored `test-results/offline/`; private
handoff evidence is in
`.zeus/evaluations/native-handoff-402fd81a7bca46e299c09294a2d94e44/`.
These private-desktop checks do not establish active-game focus behavior.

Freeze the candidate commit for six bounded native
D01/B01/V01 Solo/Team attempts using the earlier exact `gpt-6.1-terra` low/Chat
configuration, unchanged mission limits/graders, normal approvals and synthetic
fixtures. Maximum dispatch is 68 model requests across all six attempts; retain
every failure and actual role usage. No broad model sweep or automatic retry.
Compare with the matching six-attempt calibration; one trial per cell is only
a smoke comparison, not evidence of a general efficiency or capability gain.
Provider credits remain unknown unless reported authoritatively.

## Remaining Phase 4 work

4B still owns source-backed memory, context budgeting/compaction, indexed/paged
history search, exact original-message/attachment retrieval and the long-run
retention/recall tests. 4C owns structured completion evidence and its exact
user journey. The full 12-core Benchmark v1 milestone follows Phase 4 before
Smart permissions, as recorded in the live roadmap.
