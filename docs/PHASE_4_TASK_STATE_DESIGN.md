# Phase 4: durable task state and reliable context

Status, 5 November 2026: direction reviewed positively by the user, with explicit
requirements for lightweight checks and lossless, searchable conversation
retention. Those requirements are incorporated below. Phase 4A and the bounded
stream diagnostic are delivered with 324 offline checks passing; the initial
live check retained a browser deadline failure. Its general repair is delivered
with three separately recorded successful post-repair Solo outcomes. See the
[4A work log](PHASE_4A_WORK_LOG.md). The approved 4B implementation is in
acceptance validation; see its [work log](PHASE_4B_WORK_LOG.md). 4C remains
unimplemented. The
[native reference](benchmarks/native-baseline-20261104.md) is recorded;
delivery remains small sequential slices with focused review for
4B/4C, rather than one state, memory, protocol and Team rewrite.

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
| Originals already persist, but recall is a newest-first substring query without stable source IDs or attachment results | Preserve originals automatically and add indexed, paged search plus exact source/attachment retrieval from the beginning of the chat |
| Master gets its history/plan while workers get a separate objective prompt | Shared checkpoint contract, with a worker's delegated scope and the same current user requirements/constraints |
| `final_answer` ends execution without a general evidence contract | Preserve conversational answers, add explicit work-completion claims/check outcomes with honest partial/unknown states |
| Sparse syntax failures are repaired with more text-only turns | First diagnose actual response/stream output; evaluate native structured tools as a separate measured design rather than weakening multi-directive rejection |

Keep SQLite authority, persist-before-emit, backend visibility, stable message
IDs/sequence, task single-flight, normal policy and owned-process cancellation.
Do not add a competing PLAN.md authority, change saved user models or implement
Smart permissions/MCP/skills as part of this packet.

## Proportionate checks and performance

Bookkeeping should remove work from the actor. Do not require a separate plan,
approval, verifier call or checkpoint ceremony for every click, file read or
ordinary reply. Lifecycle updates are small local transactions and derived
projections, with no additional model call. Replanning happens when a meaningful
scope change or conflicting evidence needs it; unrelated questions and harmless
exploration do not freeze the run until the model rewrites a plan.

Enforce concrete invariants: current ownership/revision, an actual recorded
effect versus an attempted action, and explicit user constraints. Unknown
semantic progress remains honest without becoming a blanket execution ban.
Do not make all useful work depend on proving an arbitrary goal mechanically.
Measure checkpoint/context-building latency, requests, token use and successful
outcomes. A material slowdown or capability drop requires investigation and an
explicit tradeoff, not acceptance because more checks sound robust.

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
- Compaction currently transforms the model request's in-memory history; it
  does not delete stored `messages`. Linked input attachments are retained;
  opportunistic cleanup is limited to unchanged, unsent/unlinked orphans.
  `RecallMessages` searches this task with SQL LIKE, newest first, up to 50
  matches. It returns role/kind/content/time, but no stable message ID/sequence,
  attachment results or continuation cursor. Workers can already invoke it.

[Anthropic's context-engineering guidance](https://www.anthropic.com/research/effective-context-engineering-for-ai-agents)
discusses selective retrieval, compaction and persistent structured notes. Our
additional inference is that Zeus must guarantee checkpoint updates through
runtime transactions rather than depend only on the model writing notes.
This research supports the direction, not a universal retention guarantee.

[Letta's first-party memory architecture reference](https://github.com/letta-ai/skills/blob/main/letta/agent-development/references/memory-architecture.md)
also separates working context from database-backed conversation history that
can be searched on demand. Its separate agent-populated archival-memory feature
is not the mechanism selected for Zeus: retention of accepted chat messages and
their attachment links must be automatic, not an optional model-authored note.

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
preserve the last valid checkpoint. Use bounded retry or a valid fallback context
that retains critical state and source references; return an explicit context
error only when no valid bounded package can be assembled, rather than silently
dropping requirements. Do not assume a byte estimate is an exact
tokenizer or catalogue membership proves a model's context limit. Benchmark
critical-fact recall before reducing context precision.

### 4B original history and retrieval contract

Compaction changes the working context sent to a model. It must not delete,
overwrite or replace the original conversation with a summary. SQLite remains
the canonical transcript; there is no need to create a competing text-file
archive. Preserve accepted user/assistant messages and persisted hidden/tool/
worker conversations, their stable IDs, sequence, timestamps and source type.
Retain original user-uploaded image/document bytes and message links under
existing ownership/integrity rules. Retain referenced full tool-output artifacts
where the tool already stores them; do not claim previously truncated or missing
external output was captured in full. Summaries, search indexes and extracted
metadata are rebuildable derivatives, never substitutes for the originals.

Acceptance-time persistence/indexing is automatic. Neither the actor remembering
to call `update_memory` nor compaction succeeding can be a prerequisite for
retaining an original. Restart must preserve the same discoverable history.
Compaction/age alone must not prune linked chat inputs. Explicit user deletion
or an explicitly chosen retention policy remains meaningful: remove/invalidate
associated search entries rather than reviving deleted content through an index.
Missing/changed/deleted bytes produce an honest unavailable result.

Use two retrieval operations behind the shared task-scoped service:

1. **Find history:** indexed local search and chronological browsing, with
   source/role/kind, date or sequence range, and attachment metadata filters.
   Return bounded relevant excerpts, stable message IDs/sequences, attachment
   handles, result coverage and a continuation cursor. Old results must remain
   reachable; the newest 50 matches are not the complete archive.
2. **Read sources:** fetch a selected original message or surrounding exchange
   by stable ID, paging long content without changing the stored text. Resolve
   its original image/document attachments through the existing validated
   reader/visual route when needed. Keep old `recall_messages` calls compatible
   through an adapter; do not add parallel authorities or default cross-chat
   access. Solo and task-owned workers share the same retrieval service.

Start with a local full-text index, useful filters and source browsing; evaluate
paraphrased queries before declaring recall solved. If measured relevance gaps
justify semantic or hybrid search, add it as a replaceable index with explicit
cost/latency, never as the only surviving copy. Attachment search initially uses
original filenames, dates, surrounding user text and validated extracted text
for supported formats. Prior image observations can be indexed as model-derived
clues linked to the original. Pixel contents require actual image inspection;
do not claim filenames or embedding similarity prove what an image depicts.
No universal document parser or native preview UI is implied by storing files.

Give the actor a compact archive-availability/coverage cue, so it can search when
the user references old information or the current goal needs it. Do not replay
the full archive, auto-analyze every image, or scan every old message on every
turn. Retrieval results retain provenance and remain subject to normal policy;
an old instruction is not automatically the latest instruction.

Required retention/retrieval scenarios:

- A friend's name mentioned near the start, absent from the compacted summary,
  is found for a later birthday-message request. Include a paraphrased
  relationship reference, not only an exact name/keyword query.
- An old image is found and inspected after repeated compactions and restart,
  without reattachment; two images with the same filename remain distinct.
- An early document or user correction is found after many newer matching
  messages; pagination/ranking cannot silently hide it behind the newest 50.
- The actor distinguishes an original statement, a later correction and a
  worker/tool claim. Untrusted recalled text does not gain system authority.
- Explicit deletion, stale indexes, missing bytes and interrupted summarization
  are handled without fabricated memory or silent source loss.

The target is preserved information plus measured recall/goal continuity over
long runs. Storage and deterministic state can be guaranteed within their stated
contracts; perfect model understanding or zero capability degradation cannot be
promised. Compare retention accuracy, successful outcomes, requests, token use
and latency before/after forced compaction, across multiple compactions and
restart. Do not accept a smaller context merely because it costs fewer tokens.

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
   earlier verified effects. Test raw-source recovery, archive indexing/paging,
   attachment retention and checkpoint revisions, including the scenarios above.
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

After Phase 4, complete the full 12-core-mission Benchmark v1 milestone before
Phase 5. Add the memory/recovery missions during this phase and use the existing
three-mission reference for interim comparisons. The full benchmark evaluates
the then-current Solo/Team configurations and reports actual role use; it does
not wait for the Phase 6 Team redesign or require Team to outperform Solo.
