# Durable work checkpoint — 1 November 2026

**UNFINISHED. Do not describe this patch as fully validated or push it as a
stable release.** The user requested a shutdown-safe checkpoint because the
Codex weekly allowance is nearly exhausted. Continue from these files after
the PC/allowance restarts; do not restart the investigation from scratch.

Stable starting commit: `85da77099a31f6652ba51bf38bee7ece07c08707`.
Working directory: `D:\Hristian projects\Zeus-Agent` (PowerShell).
Detailed design/findings: [BROWSER_RELIABILITY_FOLLOWUP.md](BROWSER_RELIABILITY_FOLLOWUP.md).

## Implemented on disk

- Pinned official uBO Lite setup (`--extensions`), SHA-256 verification, default
  ad blocking and compatibility toggle. Package already prepared locally under
  `.zeus/browser-runtime/extensions/ubol-2026.1026.1812`.
- Browser-level audio extension: muted during agent operation, unmuted during
  opened human handoff, remuted on Resume; optional agent-audio setting.
- 1600×900 viewport, DPR/scale 1, 1640×1000 native window; capture validation
  updated. Visual delivery now reads actual encoded dimensions rather than
  inventing 1280×720 dimensions. Older images remain supported.
- Stronger action target outline and recent-action feed. Read-only inspection
  keeps a short existing annotation; navigation clears old target geometry.
- General text-directive/keyboard/batching/readiness guidance, no Wordle solver.
- Read-only selected-run analysis, Windows rendering/input probes, opt-in live
  handoff diagnostics, and opt-in public-site compatibility smoke.

## Evidence already obtained — do not repeat paid calls unnecessarily

Latest user-authorized Wordle task `b8493c79-6497-4b69-947c-ca5f1f0b6d58`:
641.613 seconds, 102 model requests (84 worker), four failed clicks cost
121.349 seconds. Read-only report:
`.zeus/evaluations/wordle-20261101-analysis`. Raw provider cache counts sometimes
exceed reported input counts; do not invent normalized totals or credits.

Windows rendering: `.zeus/evaluations/hidden-rendering-private` and
`hidden-rendering-active`. Offscreen/transparent ~15–16 ms screenshot; hidden
SDK ~2016 ms; hidden direct CDP ~1016 ms. Virtual focus did not fix it. Keep
offscreen for now; transparency is viable but not proven preferable.

**Actual concurrent input passed:**
`.zeus/evaluations/concurrent-clicks-and-input-focused/report.json`.
Each of three modes performed 20 browser clicks and 20 browser typing
operations, with 22/20/20 real human keystrokes staying exclusively in the
owned foreground test entry; no browser foreground takeover. An earlier
typing-only run also passed. Failed focus-acquisition attempts sent no keys
and remain inconclusive. User coordinated the manual focus clicks. No further
foreground test is currently required; future visible checks need coordination.

Live handoff evidence:

- `live-handoff-sol-20261101`: successful help and unchanged Done/Resume passed
  with GPT-6.1 Sol/chat. Cancellation cases hit a shared-process 12-request cap.
- Harness repaired to use a fresh app process with the same cap for each case.
- `live-handoff-sol-cancel-20261101`: cancel and idle-cancel both passed (3
  requests each). No model polling while paused; one cancellation notice;
  owned processes cleaned up. Four scenarios passed across the retained runs.
- Luna failures are retained in `live-handoff-20261101`,
  `live-handoff-chat-control-20261101`, `live-handoff-text-transport-20261101`.
  Mostly narration/false tool-unavailability, not completed handoff attempts.
  This repeats known ZA-005; do not silently upgrade their grades or change
  the user's saved models. The clarified text transport only partly helped.
- Combined records: `.zeus/evaluations/browser-followup-review/live-results.json`.
  All live trials so far: **30 requests, 59,288 provider-reported tokens, zero
  unknown-usage requests, provider subscription credits unknown**. Native
  supervised diagnostics are not an isolated capability/authorization baseline.

## Unresolved checks — immediate next work

1. **Recent-action feed UI assertion:** new autoplay check in
   `tests/regression/replay_polish.spec.js` around line 93 expected >1 caption
   after replay reached action 6, but found 0. Pure helper test passes. Inspect
   real frame annotations/action IDs, component lifetime/conditional mounting,
   and whether the test waits past caption expiration. Do not merely weaken
   the assertion. Stronger single-target overlay was visually inspected and
   looks correct. Need inspect a multi-caption screenshot after fixing.
2. **Actual Wordle compatibility:**
   `.zeus/evaluations/wordle-adblock-compatibility/report.json` failed waiting
   for a locked-in first guess. This smoke navigated Unlimited and typed before
   confirming all game readiness/overlays; collect screenshot/text/feedback on
   failure, distinguish late hydration/focus from blocker compatibility. It
   makes no model calls and does not inspect game answers. Do not claim the
   blocker works on Wordle until this is checked.
3. **Validation runner interference:** full and release runs were mistakenly
   started together and shared Vite on port 1420 and `test-results/offline`.
   Release exiting shut down the shared server; later full-run desktop tests
   fail at startup (~16 sec each). These are invalid infrastructure results.
   Run UI groups **sequentially**, never together. The user cancelled the
   pending cleanup tool approval, so the full runner may still be alive.
   Last unified-exec session was `20442`; after shutdown it will no longer
   exist. Stop only that owned `node scripts/run_regression.js` process/tree
   if still running. Never stop the user's `zeus-agent.exe` or unrelated Node.

## Validation status (accurate, not a green full-suite claim)

- Frontend production build passed.
- 48 JS tests, 37 mission/grader tests, 88 Rust tests passed.
- 22 real Python browser-service checks passed, including sound transitions,
  real ad-script blocking and normal page controls.
- Earlier full run: 88/94 regular UI checks passed; six size-related failures
  were fixed. Affected recording/visual-delivery/replay rerun: **8/8 passed**
  before the new feed-history assertion was added.
- Private native handoff UI checks: **3/3 passed**.
- Latest optimized run: **13/15 passed**; capture freshness and new caption
  assertion failed. Freshness was run while the other suite was starting and
  needs sequential confirmation. The caption assertion needs investigation.
- Latest full run is invalid due to the shared-server interference above;
  do not sum those failures into a product-regression count.
- No measured claim of two-minute Wordle completion or lower credit spend.

After fixing the unresolved checks, run sequentially:

```powershell
node scripts/run_regression.js --ui-files replay_polish,browser_capture,browser_visuals,browser_recordings
node scripts/run_regression.js
node scripts/run_regression.js --release
npm.cmd run build
git diff --check
```

Inspect resulting screenshots with the image tool. Update the delivery record,
KNOWN_ISSUES/ZA-005 and implementation-plan status. Commit a completed patch
only after appropriate checks pass; a WIP checkpoint must remain clearly
labelled. Do not push unfinished work. Do not start the next major phase here.

All source, notes, prepared assets and ignored `.zeus/evaluations` evidence are
on disk and survive normal shutdown. Running processes and provider streams
do not; rerun only the interrupted necessary checks. No API keys were copied
into these documents or reports.
