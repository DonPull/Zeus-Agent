# Phase 4: durable task state and reliable context

Status: focused design for alignment before runtime implementation. The
[native reference](benchmarks/native-baseline-20261104.md) is now recorded.
This packet proposes small sequential slices; it does not authorize one large
state, memory, protocol and Team rewrite.

## Tangible differences

The plan will reflect actual running, paused, failed and interrupted work without
requiring the model to remember to update it. Later user corrections, attachment
handles, verified outputs and unfinished work will remain discoverable after
compaction/restart. The app will distinguish an agent's completion claim from
the effects and checks it actually observed.

There is no promise that code can deterministically understand or verify every
open-ended user goal. Semantic planning and some completion judgments still need
a model. The deterministic part owns persistence, source/version identity,
progress transitions, evidence and context assembly.

## Decisions proposed, compared with current code

| Current approach | Proposed change |
| --- | --- |
| Model-authored plan text is reinjected as the source of truth; every four actions a reminder asks the model to update it | Versioned SQLite task checkpoint; runtime events update execution status automatically. Model-authored plans are versioned proposals linked to actual user input |
| One overwritten `chat_memory` string appended to system instructions | Source-backed task facts/notes with revision, trust category and freshness; older memory retained as historical notes |
| First-line snippets of old messages become a system-role summary | Context builder preserves critical state and source references; untrusted page/tool/model text remains data and never becomes product policy |
| Master gets its history/plan while workers get a separate objective prompt | Shared checkpoint contract, with a worker's delegated scope and the same current user requirements/constraints |
| `final_answer` ends execution without a general evidence contract | Preserve conversational answers, add explicit work-completion claims/check outcomes with honest partial/unknown states |
| Sparse syntax failures are repaired with more text-only turns | First diagnose actual response/stream output; evaluate native structured tools as a separate measured design rather than weakening multi-directive rejection |

Keep SQLite authority, persist-before-emit, backend visibility, stable message
IDs/sequence, task single-flight, normal policy and owned-process cancellation.
Do not add a competing PLAN.md authority, change saved user models or implement
Smart permissions/MCP/skills as part of this packet.

## Code findings and research

- `chat.rs::compact_master_history` triggers above 60 messages or 160,000
  characters. It keeps the first system/initial user/last 20 messages; the
  middle becomes first-line snippets limited to 180 characters. Later-line
  requirements and corrections can disappear. User and tool rows are labelled
  together, and those snippets enter a system-role message.
- `load_master_history` appends `chat_memory` directly to system context.
  `UpdateMemory` overwrites one task row. There is no source/coverage revision.
- The master loop reminds the actor after four actions and reinjects the latest
  action-plan markdown. This is deterministic prompting, not deterministic plan
  freshness or a source-backed requirements contract.
- `FinalAnswer` publishes a summary and ends the loop. Existing publication and
  cancellation fixes remain valid; they do not prove semantic goal completion.
- The repeated reference exposed rejected duplicate directive blocks, including
  one failed attempt. Chat streaming currently reads `delta.content`; inspection
  did not reveal a simple double append of `message.content`. Without raw
  synthetic stream evidence, the exact origin remains unknown.

[Anthropic's context-engineering guidance](https://www.anthropic.com/research/effective-context-engineering-for-ai-agents)
discusses selective retrieval, compaction and persistent structured notes. Our
additional inference is that Zeus must guarantee checkpoint updates through
runtime transactions rather than depend only on the model writing notes.
This research supports the direction, not a universal retention guarantee.

## First slice: automatic execution checkpoint (4A)

Add an additive `task_checkpoints` snapshot with a monotonically increasing
revision and small `task_checkpoint_events` entries referencing existing
message/run/action/worker/attachment IDs. Reuse existing journals; do not copy
image bytes or entire transcripts into another event log.

Input acceptance increments the actual user-input revision. Only accepted human
chat inputs are requirements sources: hidden `directive_result` messages stored
as role=user are tool evidence, not new user instructions. A new question does
not automatically cancel the original objective. Preserve original and later
inputs losslessly with stable IDs; semantic amendments can be proposed with
source references and an explicit base revision.

Automatic hooks cover run acceptance, tool dispatch/result, delegation,
handoff/approval pause, resume, cancellation, failure, completion claim and
restart reconciliation. Event identity is idempotent and committed with the
underlying durable transition. No database lock crosses provider/process waits.
Join owned cleanup before terminal publication as today.

The current plan card reads a backend projection with stable identity/version.
It can show execution and pending milestones correctly even if the model never
calls `update_action_plan`. That directive remains a compatible proposal API;
stale proposals cannot overwrite a newer user revision. A tool succeeding does
not automatically prove a semantic milestone done, and ending the run does not
mark every remaining plan step successful. Preserve raw historical proposals.

Initial migration creates no fabricated verified facts. Existing memory/plan
content remains readable and labelled historical/model-authored. Start with
automatic execution state and a provenance-bearing plan, not a new general
natural-language requirements compiler. No extra inference call is necessary
for lifecycle projection.

## Next slices, each reviewed before implementation

**4B: context/memory.** Build a common bounded context package before model
dispatch: current user revision, checkpoint, delegated scope, current accepted
constraints, pending work, evidence/attachment references and recent exchanges.
Raw text remains recallable by source IDs. Summaries have source coverage and
revision; they are derived caches, not authority. Summarization failure must
preserve the last valid checkpoint and return an explicit context error rather
than silently dropping requirements. Do not assume a byte estimate is an exact
tokenizer or catalogue membership proves a model's context limit. Benchmark
critical-fact recall before reducing context precision.

**4C: completion evidence.** Add structured completion claims for actionable
work, linked to known criteria/artifacts/observations and check outcomes.
Semantic checks may use bounded, accounted model judgment when necessary.
Unsupported verification stays unknown, rather than becoming a fake pass or
blocking every ordinary conversational answer. This needs its own exact user
journey and policy before changing final-answer behavior.

**Transport diagnostic.** Retain bounded response-side stream evidence for a
synthetic reproduction without headers/credentials or ordinary user traffic.
Verify decoding/assembly, generated multi-directive behavior and supported
structured-tool responses separately. A later tool transport change must keep
the same policy executor, one-action contract, accounting and portable fallback,
with explicit capability/protocol identity. Do not execute one of several
ambiguous directives merely because that makes the benchmark pass.

## Acceptance, order and limits

1. Prove checkpoint projection from actual durable events: normal effects,
   denied/uncertain actions, stale proposals, pauses, Stop, restart, transaction
   rollback and repeated notifications. SQLite/bridge ownership stays unchanged.
2. Force compaction with later-line corrections, conflicting stale plans,
   hidden tool text pretending to be user instructions, historical images and
   earlier verified effects. Test raw-source recovery and checkpoint revisions.
3. Add M01/M02 reference and negative controls before claiming long-task memory
   coverage. A long transcript alone does not prove compaction happened.
4. Run the existing regression suite and compare unchanged D01/B01/V01 settings
   against the frozen b40f032 reference, retaining failures and all-role cost.
   Budget new live checks explicitly; no automatic full model sweep.
5. Scope a separate controlled multi-step browser-efficiency track for batching,
   observation volume, readiness and recovery. Preserve outcome checks and test
   delayed hydration; no blanket timeout reduction or forced clicks.

Recommend implementing **4A first**, following a small response-format diagnostic
for the observed failure. Review 4B/4C contracts separately. Native document
previews, conversation portability, classifier auto-approval, autonomous MCP,
skills and full Team supervision stay in their existing later workstreams.
