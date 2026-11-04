# Browser reliability checkpoint — 4 November 2026

The PC restart preserved the source and all retained reports. The final full
regression completed before shutdown on 1 November: **293 checks passed**, with
an explicit runner exit-code receipt of **0**. Optimized acceptance completed
after restart: **18/18 passed**. The patch is complete; the commit containing
this document is the delivery checkpoint. Do not restart the investigation or
repeat paid trials simply because the session reset.

Branch: `wip/browser-reliability-20261101`.
Starting stable commit: `85da77099a31f6652ba51bf38bee7ece07c08707`.
Existing checkpoints: `1ea1691` and `a4f571d`.
Working directory: `D:\Hristian projects\Zeus-Agent` (PowerShell).
Delivery record: [BROWSER_RELIABILITY_FOLLOWUP.md](BROWSER_RELIABILITY_FOLLOWUP.md).

## Delivered behavior

- Prepared, pinned official uBO Lite, enabled by default with a compatibility
  toggle. No automatic extension downloads or upstream-manifest changes.
- Browser-level sound blocking during agent control; sound enabled in an opened
  human handoff and restored to the agent preference on Resume.
- 1600×900 CSS viewport, scale/DPR 1, 1640×1000 native window. Image validation
  uses actual encoded dimensions and still accepts older recordings.
- Stronger replay target highlights and up to four recent-action captions,
  newest at the bottom, with expiry of at least four seconds and a four-entry bound.
- Text/semantics first, bounded waits, coherent scripts and outcome verification.
  Ordinary keyboard activation is a documented fallback for an animated native
  button; no force-click, automatic mutation retry or site-specific solver.
- Read-only run analysis, Windows/input experiments and opt-in live handoff
  diagnostics. Four live handoff scenarios passed; failed trials remain retained.

## Verified results and evidence

### Software checks

- Final full suite: 48 JS + 37 mission/grader + 88 Rust + 23 real Python browser
  service + 94 desktop + 3 private native handoff checks = **293 passed**.
  Log: `.zeus/evaluations/browser-followup-review/full-final.log`.
  Exit receipt: `full-final-exit.txt` in the same directory contains `0`.
- Final optimized acceptance passed **18/18** on 4 November (15 desktop plus
  3 private native handoff). Native report:
  `.zeus/evaluations/native-handoff-195c7058508a41f39c1a81f5f3df0a91`.
  Summary: `.zeus/evaluations/browser-followup-review/optimized-20261104-final.json`.
- Frontend production build and ordinary `zeus-agent` debug build passed again
  on 4 November, along with `git diff --check`.
- The recent-action stack and target outline were visually inspected. Images:
  `.zeus/evaluations/browser-followup-review/replay-recent-actions.png` and
  `replay-action-overlay.png`.

Earlier overlapping full/release runners shared Vite/test output and invalidated
those attempts. The final full suite ran sequentially and passed. Do not count
the invalid attempts as product failures or run two desktop suites together.

The first optimized run after restart had one real timing failure: seven
rendered updates in two seconds against the unchanged minimum of eight. The
targeted control then delivered 16, and final acceptance delivered nine. No
product change or threshold reduction occurred between these runs; only
last-capture-duration logging was added. Root cause is unestablished. Keep this
preview cadence variation visible; target 8 FPS is not guaranteed throughput.
Retained failure: `optimized-20261104-initial.json` and
`optimized-20261104-failure` beside the final summary.

### Wordle compatibility — resolved

The initial reference smoke skipped onboarding. The visible, continuously
animated Play button did not stabilize for a mouse click. Activating that native
button with Enter, then selecting Unlimited and using visible keyboard controls,
produced real resolved feedback with the stock prepared ad blocker enabled.

Passing report: `.zeus/evaluations/wordle-verified-feedback/report.json`.
It confirms production offscreen mode, 1600×900, agent audio disabled, blocking
enabled, an actual submitted CRANE row with all five resolved feedback classes,
and no page exceptions. This is a trusted reference compatibility check with
**zero model calls**, not a five-game agent speed or intelligence result.

Failed controls with/without blocking and the isolated Complete-filtering
experiment remain in `.zeus/evaluations`. Increasing extension host permissions
did not fix the missing onboarding; that experimental manifest was **not**
promoted into product setup. The new local animated-button regression verifies
one real keyboard effect while the animation remains running.

### Windows and foreground input — completed

Reports: `.zeus/evaluations/hidden-rendering-private`, `hidden-rendering-active`,
`concurrent-input-manual-focus`, `concurrent-clicks-and-input-focused`.

Offscreen/transparent captures took about 15–16 ms; hidden/minimized SDK captures
about 2016 ms, hidden direct CDP about 1016 ms. Virtual focus did not repair the
slow hidden rendering. Transparency worked but demonstrated no clear advantage;
keep the simpler offscreen production behavior.

The final active-desktop input test passed in three modes (ordinary offscreen,
offscreen/nonactivating, transparent/nonactivating): **20 browser clicks and 20
browser typing operations per mode**, alongside 22/20/20 OS input keystrokes
sent by the test driver into its synthetic foreground entry after a user focus click.
Text stayed in its intended destination and the browser did not take foreground.
Failed focus-acquisition attempts sent no keys and remain inconclusive. No more
foreground experiments or user focus clicks are needed for this patch.

### Paid handoff diagnostics — completed, retain every trial

- Sol/chat: success and unchanged Done/Resume passed in
  `live-handoff-sol-20261101`. The cancellation cases initially hit the shared
  process request cap; the driver now starts a fresh capped process per case.
- Cancel and idle-cancel passed in `live-handoff-sol-cancel-20261101`, three
  requests each. No inference polling while paused, one Stop notice and joined
  owned-process cleanup. Four scenarios passed across these Sol runs.
- Luna failures: `live-handoff-20261101`, `live-handoff-chat-control-20261101`,
  `live-handoff-text-transport-20261101`. Narration/false tool-unavailability
  remains known ZA-005. Transport clarification helped navigation once but did
  not establish reliable continuation. The user's saved models were not changed.
- Combined: `.zeus/evaluations/browser-followup-review/live-results.json`.
  **30 requests, 59,288 provider-reported tokens, no missing usage records**;
  provider subscription credits unknown. Native supervised diagnostics are not
  an isolated authorization/capability benchmark.

## Remaining roadmap work

The selected original Wordle task `b8493c79-6497-4b69-947c-ca5f1f0b6d58` took
641.613 seconds and 102 model requests; four failed clicks consumed 121.349
journal seconds. Analysis: `.zeus/evaluations/wordle-20261101-analysis`.
Provider cached-token fields sometimes exceed reported input counts. Preserve
the raw fields; do not invent normalized context size or subscription credits.

This patch has **not measured a repeated speed/cost improvement**. Next is the
bounded canonical benchmark baseline checkpoint, then a focused aligned Phase 4
design for deterministic task state/completion, plans, memory and compaction.
See [the roadmap](IMPLEMENTATION_PLAN.md). Smart permissions, classifiers,
autonomous MCP and skills keep their separate alignment/design gates.

All source, prepared assets and ignored evaluation reports are on disk and
survive shutdown. Running process/session IDs do not. No credentials were copied
into these notes. The completed patch is committed locally on the branch above;
main remains unchanged and no push is part of this checkpoint. Do not relabel
retained failures or treat a shutdown as authorization for the next major design.
