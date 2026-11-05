# Phase 4B — working context and searchable originals

Updated: 5 November 2026. Implemented and validated.
This is the focused companion to the [live roadmap](IMPLEMENTATION_PLAN.md)
and the [approved Phase 4 contract](PHASE_4_TASK_STATE_DESIGN.md).

## Tangible differences

An actor can find an early conversation, read its exact source in pages, and
inspect a linked old image without another upload. Long conversations use a
bounded working package with source references, real human amendments and
execution-state metadata. The original transcript and linked bytes remain
authoritative across compaction and restart.

## Decisions and changes in approach

| Previous approach | Delivered implementation |
|---|---|
| Newest 50 substring matches, with whole matched text | Shared task-local FTS5 search, explicit filters, bounded excerpts and snapshot/keyset continuation; chronological browsing is available even with no search terms |
| No exact source reader | Stable ID/sequence/date/provenance, Unicode-character paging, up to two surrounding messages on either side, original attachment handles |
| First line of each discarded turn became a system-role “milestone summary” | Local selection of original sources plus a coverage cue; archived tool/model text never becomes a system instruction |
| One overwritten memory string injected into system policy | Versioned fallible model notes, optional source IDs, human-input revision and coverage; invalidated derivatives do not restore edited/deleted sources |
| Master-only compaction; worker history grew independently | Same context/retrieval service for Solo and task-owned workers, including actual master-chat human amendments |
| Memory prompt asked for an extra update after important constraints | Retention and indexing are automatic. A source-linked brief is optional, avoiding a required paid bookkeeping turn |
| Attachment metadata available only during history loading | Search linked filenames/IDs, and bounded verified UTF-8 extraction for supported text formats; inspect image pixels through the existing visual route |

No embedding service, paid summarizer or document preview UI is introduced.
Compaction deliberately has a deterministic fallback: source selection and
retrieval cues work even when there is no model brief or an earlier generation
was interrupted. This is not a claim that an extractive package is a perfect
semantic summary. Older requirements outside the selected package may require
retrieval; latest real human instructions override stale model notes.

## Storage, context and limits

- SQLite remains the transcript authority. FTS5 is a rebuildable derivative
  maintained by source/link transactions and backfilled once on migration.
  Search joins canonical sources, so orphan index entries cannot become messages.
- Search defaults to ten results, capped at 30. Query terms use literal lexical
  OR-prefix matching, not executable FTS syntax or semantic similarity. Cursors
  retain query/filter identity and a source-sequence snapshot. Source/role/kind,
  conversation, date, sequence and attachment filters are available.
- Exact message pages default to 8,000 Unicode characters, capped at 16,000.
  Offsets do not split UTF-8 characters. Long source text is not changed on disk.
- Original attachment ownership, path/reparse-point checks, SHA-256 integrity and
  explicit deletion rules remain in force. Linked chat inputs are not aged out.
  Supported UTF-8 text previews/extractions are capped at 1 MiB; unsupported
  formats stay available through normal policy-checked file tools. Images
  require actual pixel inspection, not filename inference.
- A working package keeps recent source exchanges plus the initial human input
  and recent human amendments separately from tool traffic. Source excerpts
  explicitly name the exact reader when they do not fit. Current execution
  revision/state and source-linked notes remain labelled as data.
- The text envelope is conservative, not an exact tokenizer or a catalogue
  guarantee of any model's context window. Image transport has separate existing
  quotas. A configuration that cannot fit returns an explicit context error;
  it never deletes originals to make the next request smaller.
- Compaction receipts record source coverage, retained IDs, human revision and
  input/output text sizes. They are diagnostics, not evidence that model
  understanding is complete.
- No claim is made to recover tool output that was never captured. Previously
  retained full tool-output files continue through their existing file route.

## Validation

Backend and desktop controls cover pagination past 50 newer matches, source
corrections and tool provenance, Unicode pages, rollback/rebuild/deletion,
source-linked note versions, legacy-memory migration, same-name image identity,
repeated compaction/restart, ordinary worker retrieval/accounting and changed
document bytes.

The H01 control requires a corrected personal name and shared childhood
activity that are absent from the compacted working package. Its paraphrased
request cannot be answered from an exact-name search supplied by the controller.
The H02 control requires the first of two same-name images, actual original
image delivery, and image facts including a total that differs in the later
image. Reference/negative controls reject stale names, fabricated completion,
wrong image facts and lost/changed source hashes.

Scripted desktop controls prove plumbing and retention, not model intelligence.
The separate dry-by-default `diagnose_history.js` schedules short-history and
forced-compaction/restart variants for both missions on one fixed economical
model. Each has at most 12 requests, 300,000 reported tokens, 4,096 output tokens
per request and four minutes, including warm-up requests across restart.
All attempts and unknown usage are retained. Provider credits remain unknown.
These are native supervised stress comparisons, not a full isolated Benchmark
v1 or a before/after-version efficiency claim.

Final offline validation: **344 checks passed** — 63 JavaScript controls,
37 mission/grader checks, 112 Rust tests, 23 real browser-service tests,
106 desktop checks and three private-desktop handoff checks.
`npm.cmd run build` also passed. Production runtime code is unchanged by the
later diagnostic readiness fix.

Development validation retained two test-assertion corrections for the new
source wrappers and short-window preview measurements of six and seven rendered
frames in two seconds. A resize check also caught an unsettled hidden-window
layout. The preview/layout thresholds remain unchanged.

The hidden desktop harness now disables background timer throttling and renderer
background priority only for its test WebView. It still creates an invisible
window and sends no desktop input. These are diagnostic switches, consistent
with [Microsoft's WebView2 testing guidance](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/webview-features-flags)
and [Chromium's flag definitions](https://chromium.googlesource.com/chromium/src/+/HEAD/content/public/common/content_switches.cc).
Production browser/UI flags and the fixed 8 FPS policy are unchanged. A subsequent
focused measurement observed 15 source frames and 13 rendered images in two
seconds. This supports the hidden-window scheduling explanation; it is not a
general production throughput guarantee.

The [validation record](benchmarks/phase4b-validation-20261105.json) retains
earlier failed development runs and the final successful run. The initial live
driver also hit a bridge-readiness race before any model inference. Its four
startup-only failures remain at `.zeus/evaluations/phase4b-history-20261105`;
commit `982a3e2` adds the normal UI-readiness wait without changing the product
runtime.

### Live history results

All four separately retained probes passed on clean `982a3e2` with exact Abacus
`gpt-6.1-terra`, low effort, explicit Chat protocol. Both compacted cases recorded
two compactions, restarted the app, recovered the requested original information
and preserved all original message hashes/sequences. Image inspection actually
used the first original image in both image cases.

| Probe | Outcome | Requests including warm-up/helper | Reported tokens | Entire cell time |
|---|---|---:|---:|---:|
| H01 corrected personal fact, short history | Passed | 1 | 6,410 | 5.979 s |
| H01 forced compaction and restart | Passed | 4 | 21,097 | 17.669 s |
| H02 first same-name image, short history | Passed | 3 | 8,255 | 12.963 s |
| H02 forced compaction and restart | Passed | 7 | 30,734 | 25.910 s |

Total: **15 requests, 66,496 reported tokens, zero unknown-usage requests**.
There were 13 master and two vision requests, all on the stated model; no Team
capability result is claimed. Input/output were 65,218/1,278 tokens; reasoning
(334) and cached input (37,908) are separately reported subsets, not extra tokens
to add to the total. Provider credits remain unknown.

The [reviewed machine record](benchmarks/phase4b-history-20261105.json) preserves
configuration, outcomes, source commit and SHA-256 receipt hashes. Raw synthetic
messages, retention/compaction receipts and usage remain under
`.zeus/evaluations/phase4b-history-ready-20261105`.
Cell times include startup/catalogue checks and, where relevant, warm-up/restart.
Retrieval added requests and tokens in these probes. These four successful
one-attempt cases do not prove no long-horizon degradation, a universal speed or
cost improvement, semantic search quality, or full benchmark completion.

## Remaining work

Phase 4C completion evidence remains separate. The full 12-core Benchmark v1
still follows Phase 4 and precedes Phase 5 smart permissions. H01/H02 are focused
history acceptance probes, distinct from the planned core M01 project-specification
continuity and M02 exactly-once workflow recovery missions. Independent
M01/M02 reference/negative controls are authored in `memory_core_controls.js`;
their full actor/portal runtime wiring remains part of Benchmark v1. This does
not complete the full mission runner, isolation/authorization coverage, repeated
Solo/Team comparisons or held-out long-horizon evaluation.

Browser speed/efficiency remains an explicit follow-up. Native document
previews, conversation transfer, replay compression and new capabilities/skills
are not part of this patch.
