# Browser reliability follow-up — 1 November 2026

Status: implementation and validation in progress. This is a stabilization
increment before the canonical benchmark/state-management checkpoints, not a
Wordle-specific solver or a completed intelligence baseline.

## Tangible changes and decisions

| Area | Previous approach → this increment |
| --- | --- |
| Ads | Unfiltered dedicated Chromium → pinned official uBlock Origin Lite, enabled by default, with a global compatibility toggle. Keep the existing pinned browser rather than adding another browser distribution. |
| Audio | Headed browser could play unsolicited audio → trusted browser sound policy blocks it during agent control, allows it when the user opens a handoff, and restores the preference on Resume. A setting permits agent audio. Page JavaScript cannot undo browser-level muting. |
| Viewport | 1280×720 CSS pixels → 1600×900 at scale/DPR 1; matching native window size and image validation. Fit scales the preview without zooming the website. |
| Replay targets | Thin outline → thicker contrasting outline, halo and translucent fill. Geometry remains bound to the displayed capture. |
| Action captions | One rapidly replaced caption → up to four recent displayed interactions, newest at the bottom, with bounded lifetimes based on playback speed. Backward/nonadjacent manual seeks reset the feed. Old target boxes never appear on newer frames. |
| Live annotations | Every inspection cleared the preceding annotation → read-only inspection preserves its existing short lifetime. No action is delayed to make an overlay visible. |
| Browser work | Initial screenshot encouraged even when text sufficed → text/semantics first, visual calls when needed, explicit keyboard targets, coherent scripts with outcome checks, short timeouts for speculative optional controls. Long waits remain available for actual loading/countdowns. |
| Handoff checks | Scripted integration tests only → opt-in, bounded live-model diagnostics with independent synthetic server outcomes; successful help, unchanged Resume, cancellation and idle cancellation. All failed attempts remain retained. |

The live preview remains fixed at an 8 FPS target and JPEG quality 80 while
viewed. There is no adaptive throttle. Live frames are a bounded mailbox, not an
8-FPS disk recording. Replay sampling/retention remains separate.

## Actual slow run

The user authorized read-only analysis of the latest Wordle conversation:
task `b8493c79-6497-4b69-947c-ca5f1f0b6d58`, run
`f0d36e09-4795-4db1-9b4c-7990eb4af5dc`.

- Duration: **641.613 seconds** (10 minutes 41.6 seconds).
- Requests: **102**: 84 worker (`gpt-6.1-terra`), 7 master and 2 verifier
  (`gpt-6.1-sol`), 9 vision (`gemini-3.8-flash`).
- The four failed clicks consumed **121.349 journal seconds**. Evidence includes
  an absent ad-close control, an unstable Play button, an ad interstitial
  intercepting Unlimited, and an absent NEW GAME control.
- 252 successful inspections took about 6.456 journal seconds in total. The
  scripts often polled with short sleeps; counting these requests alone does
  not mean the browser spent minutes executing them.
- Worker request-to-first-persisted-output estimates sum to **276.21 seconds**,
  median 3.07 seconds, maximum 12.545 seconds. These are estimates, not stored
  provider completion timings. Activities can overlap; do not add every role's
  estimates together to claim an exact wall-clock decomposition.
- The user reports **1152 provider credits**. The local ledger does not expose
  provider credits, so that value cannot be independently reconciled here.
  Provider token/cache fields are retained separately, including records where
  reported cached tokens exceed reported input tokens. Their provider-specific
  meaning needs confirmation before using them as a normalized context total.

Rebuild the selected-task report without inference or database writes:

```powershell
python scripts/diagnostics/analyze_browser_run.py --task TASK_UUID --output .zeus/evaluations/selected-run
```

Raw local reports contain task text and stay in ignored evaluation storage.
They do not read API keys or unrelated conversations. Ads and excess model
turns are demonstrated causes; this patch does not establish a two-minute
completion time or a measured credit reduction on the original configuration.
That requires a repeated comparison with unchanged models/settings/grading.

## Windows experiments

Additional experiments were explicitly authorized while the user's PC was
available, and a separate manual focus click was coordinated.

| Method, active desktop | Median screenshot | Result |
| --- | ---: | --- |
| Offscreen, ordinary Playwright | 15 ms | Fresh animation, preserved target/draft |
| Hidden, ordinary Playwright | ~2016 ms | Works, rendering/actionability much slower |
| Hidden with virtual focus emulation | ~2016 ms | Does not repair hidden rendering |
| Minimized with virtual focus emulation | ~2016 ms | Same limitation |
| Hidden, direct CDP screenshot | ~1016 ms | Still too slow for the chosen live preview |
| Transparent click-through/nonactivating window | 15–16 ms | Viable rendering alternative; additional native styles required |

These checks preserve the same browser target, in-memory state and unsaved
draft. Private-desktop results were repeated on the actual input desktop.
The broad visibility matrix's foreground log is not a focus-isolation proof:
foreground can persist from a preceding mode. The separate concurrent-input
test establishes that distinction.

In that test, offscreen, offscreen with nonactivation styles, and transparent
with nonactivation styles each passed **20 real human keystrokes concurrent
with 20 agent typing operations**, with exact text separation and no browser
foreground takeover during the measured phase. The guard sent no physical
input in two earlier attempts that could not acquire the sentinel's focus;
those attempts are inconclusive and retained. The final run required one
manual focus click. No personal window received test input.

Keep offscreen production behavior for now: it provides physical separation
from the user's pointer coordinates with fewer additional native-window
behaviors. Transparency is a demonstrated alternative, not an established
universal improvement. A private Win32 desktop is useful for diagnostics but
is not the same as Task View desktops or a seamless ordinary-user handoff.
There is no documented supported Playwright headless/headed hot conversion.
Passing these checks is not a guarantee for every GPU, Windows build, native
dialog, application, or future desktop-automation tool using physical input.

Retained local evidence:
`.zeus/evaluations/hidden-rendering-private`, `hidden-rendering-active`,
`concurrent-input-active`, `concurrent-input-active-2`,
`concurrent-input-manual-focus`.

## Automated and manual handoff checks

The live diagnostic uses a fresh synthetic check-in page. Only its external
controller supplies the synthetic human verification. The server independently
records accepted completions and rejects premature submissions; no model
artifact is executed by the grader. Native host actors are not isolated from
the test host, and this is not an injection-resistance benchmark.

```powershell
# Dry-run prints the model and operational envelope; no model calls.
.zeus/browser-runtime/venv/Scripts/python.exe tests/browser_service/probe_live_handoff.py
# Explicit paid diagnostic; native windows remain on a private desktop.
.zeus/browser-runtime/venv/Scripts/python.exe tests/browser_service/probe_live_handoff.py --live
```

The cases check:

1. Help really clears the blocker: Resume uses the same session, the model
   confirms actual state, and exactly one check-in reaches the server.
2. User says Done without clearing the blocker: no completion is accepted;
   Zeus requests help again or reports blocked honestly.
3. Cancel the request: the run stops once, one cancellation message appears,
   and owned browser processes are joined/closed.
4. Leave it unanswered briefly: no additional model calls while paused, then
   cancellation performs the same cleanup.

The ordinary integration suite also covers stale handoff decisions, browser
loss, native dialog handling, sensitive-field observation and state continuity.
No real login, password, CAPTCHA or external account is needed to exercise the
handoff mechanics. For an additional manual acceptance check, use the same
controlled fixture/test infrastructure rather than searching for a website
whose login or bot protection happens to block the model that day.

## Validation and remaining work

Pending final regression, native UI and live-control outcomes. The first four
Luna/Responses attempts failed before handoff; a chat-protocol control also
failed before handoff. A clarified text-transport control navigated once but
then returned narration instead of the next tool action. These are retained
capability/protocol-compliance failures, not passes and not proof that handoff
itself failed. Do not silently switch the user's saved models or erase those
trials. A control using the user's current master model is running separately.

The larger work on deterministic completion/state, context/compaction, native
tool interfaces, cost normalization and the repeated Solo/Team benchmark still
needs its own measurement/design checkpoint. Do not weaken outcome checks or
shorten every timeout to hide latency.

## Primary references

- [Playwright extensions and persistent Chromium](https://playwright.dev/python/docs/chrome-extensions)
- [Official uBO Lite release and asset digest](https://github.com/uBlockOrigin/uBOL-home/releases/tag/2026.1026.1812),
  [upstream source/license](https://github.com/uBlockOrigin/uBOL-home)
- [Chrome browser sound/content settings](https://developer.chrome.com/docs/extensions/reference/api/contentSettings),
  [tab muting](https://developer.chrome.com/docs/extensions/reference/api/tabs)
- [Chromium focus-emulation protocol definition](https://github.com/ChromeDevTools/devtools-protocol/blob/master/pdl/domains/Emulation.pdl)
- [Chrome headless architecture](https://developer.chrome.com/docs/automation-and-testing/headless)
