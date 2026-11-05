# Phase 4C — completion claims and evidence

Approved direction: distinguish execution ending from the user's goal being
satisfied, using lightweight checks and honest unknown states. This packet
specifies the implementation following the user's “proceed”.

## Tangible changes and decisions

| Current behavior | Change |
|---|---|
| A final answer ends a run; only a claim event is recorded | Persist a completion report bound to that run, conversation, original claim and human-input revision |
| Tool returns and model-written Done steps can look like success | Show reported completion, actual check results and independent model review separately; no automatic promotion of plan steps |
| No common artifact/check contract | Optional structured criteria with source references and bounded native file/result/browser-condition checks |
| Plain text can finish after actual work without evidence metadata | Record an implicit, unverified report for work turns; ordinary conversation/retrieval-only replies retain their existing behavior |
| Missing evidence is ambiguous | Unsupported, unauthorized, stale, unavailable or unchecked evidence stays unknown |

The model may include `completion` inside `final_answer`:

```json
{"summary":"Saved the report.","completion":{"status":"completed","base_input_revision":1,
 "criteria":[{"id":"report","description":"Requested report saved",
 "source_message_ids":["original-user-message-id"],
 "checks":[{"kind":"file_exists","path":"report.json"},
           {"kind":"json_value","path":"report.json","pointer":"/currency","expected":"EUR"}]}],
 "review":false}}
```

Older final-answer payloads remain valid. Checks describe narrow predicates,
not proof that the model chose all correct criteria. A source link establishes
provenance, not semantic entailment.

## End-of-turn workflow

1. Recognize explicit structured claims or an actual work attempt in this run.
   History search, file reads and visual questions alone do not create a work
   completion ceremony. Simple conversation remains one ordinary reply.
2. Evaluate at most 16 bounded checks against actual owned artifacts or durable
   execution/browser records. No submitted code, tests or commands are executed.
   Respect explicit read denials and task containment. Unknown authorization
   becomes unknown evidence, with no extra approval cards.
3. A definite failure in a declared check accompanying a completed claim permits
   at most one correction round in the conversation/run. The first unsupported
   summary is not published as a completed answer. Feed back the actual failures;
   never replay an uncertain side effect. Partial/blocked/unknown claims and
   unknown checks do not force a repair loop.
4. An explicitly requested `review:true` may make one read-only call to the
   configured verifier for the master, with bounded context, 2,048 output tokens,
   one provider attempt and a 30-second deadline. All usage remains accounted.
   No verifier setting means unknown; there is no implicit master-model fallback.
   Reviews return supported, not supported, or unknown and must cite an actual
   supplied original human source for either conclusive judgment. Stale, failed,
   omitted or unknown declared checks skip the paid review. A human-input change
   during review makes the published report stale and whole-goal status unknown.
   Supply the actual run's tool/browser dispatch metadata, including worker,
   denied and uncertain attempts, separately from the actor's prose. These are
   runtime records, not an operating-system audit of changes made externally.
   The complete package caps at 16 human messages, 64 tool attempts, 64 browser
   operations and 64,000 serialized bytes; overflow abstains without omitting
   earlier requirements or actions.
   Workers use the existing delegation review rather than adding a second review.
5. Persist the report before emitting it. Keep claim/check/review states separate.
   Review failure, cancellation or restart cannot turn a pending review into a pass.
   Preserve the original final directive, failed attempts and source IDs.

Supported predicates are `file_exists`, `file_sha256`, `json_value`,
`process_exit` and `browser_condition`. File checks apply only to regular files
inside the owned task workspace, reject network/reparse paths, and never open an
application. Hash reads cap at 32 MiB; JSON reads at 2 MiB. Process exit is an
execution fact, not proof that output or stdout assertions are correct.
Browser-condition evidence requires an actual successful explicit condition
recorded by the managed browser in this run; a successful click alone is insufficient.

The UI presents a compact expandable evidence card using the existing chat
styles. It labels model reviews as model judgments and evidence as a historical
snapshot. Whole-goal verification remains unknown where no adequate independent
assessment exists. Existing execution status still means the run finished,
paused or stopped; it does not become a semantic success flag.

## Acceptance and limits

Test real file predicates, incorrect/missing artifacts, fabricated or foreign
source IDs, stale revisions, explicit denials, links, failed/uncertain processes,
click-without-condition, bounded repairs, cancellation/restart, transaction
rollback, duplicate notifications, worker scope and ordinary question behavior.
Inspect the rendered card at wide/narrow widths. Run the full regression suite.

Use a small frozen live D01/B01/V01 matrix with the existing economical model and
limits, keeping outcomes, failed attempts and usage. Any independent benchmark
grade remains separate from the app's own checks/review. The full 12-core
Benchmark v1 follows Phase 4, before Phase 5; this patch does not replace that
milestone or the planned stronger Team verifier.
