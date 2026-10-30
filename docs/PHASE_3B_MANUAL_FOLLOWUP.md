# Phase 3B manual-test follow-up

2026-10-30. User-supplied task `a096856b-d7b7-4e58-a339-2abd5211b3f7`, root run `d3fa53e1-741e-4d98-b865-5e302e14bd88`. The prompt asked Zeus to use a public site's unlimited mode, continue until five wins, and report each game's history. This is a general browser/goal-following diagnostic, not a product requirement for a dedicated Wordle solver.

## What this run establishes

**The normal launch still used the legacy browser route.** The worker's stored system prompt explicitly instructs `connect_over_cdp` with `ZEUS_BROWSER_WS_ENDPOINT`; the managed override is absent. Actual executed scripts follow that contract. The managed journal contains no sessions/actions, and the `[browser] Spawned browser` event comes from the old manager. This is not a manual test of the new Phase 3B owner.

The delivery was development opt-in pending the coordinated 3C viewer gate. That limitation was technically documented, but insufficiently prominent for normal app testing. The previous delivery's tangible effects apply to the opted-in route, not the default launch. Do not switch it silently as a response: the new route intentionally does not yet offer compatible Live View/Replay or complete profile/handoff support.

The supplied log contains **one explicit browser-process spawn** and **four `sess_*` recording lifecycles**. The latter are legacy per-script recordings, not proof of four separate process launches. Browser page state persists across some scripts. The user's experience of repeated browser cards/start-stop events is valid; the log does not by itself establish an exact count of windows/processes opening and closing.

## Why Python requested unrelated domains

The executed worker script at sequence 3280 enumerates `performance.getEntriesByType('resource')`, selects every URL containing `.js`, then downloads each with `urllib.request.urlopen` and searches its text for game-related strings. The network audit hook produces the Python permission cards. The URLs come from the visited page's resource inventory; this was an indiscriminate script-inspection recovery attempt, not evidence that the user asked to visit those domains.

Some identified resources are advertising integrations: Google's documentation lists `pagead2.googlesyndication.com` as an AdSense script ([Google](https://developers.google.com/publisher-ads-audits/reference/audits/script-injected-tags)); Ezoic documents its `www.ezojs.com` script ([Ezoic](https://docs.ezoic.com/docs/ezoicads/integration/)). This identifies examples, not a security verdict on every URL. The shown code downloads/searches text; it does not execute the downloaded JavaScript. Nothing in this log proves prompt injection caused the behavior.

Separate GitHub raw-content requests fetch a five-letter word corpus, as the submitted scripts state. Those have a task-related purpose; repeatedly downloading the same list and later fetching all third-party scripts still wastes effort. Do not solve approval noise by automatically allowing these domains. Keep explicit network permissions and improve general recovery/supervision.

## Other failures to preserve

- The worker initially returned many directives in one response. The parser rejected them and explicitly ran none; it did not execute the hypothetical bulk sequence.
- An executed script had a Python syntax error. Later scripts targeted an invisible input and hidden restart control despite a working keyboard-input example earlier in the conversation.
- Feedback extraction mapped any unrecognized class to absent, converting uncertainty into false evidence. A three-guess board was labelled a loss without establishing a terminal game state.
- Several scripts used `range(5)` rather than continuing until five verified wins. The delegated objective and success condition drifted.
- The log has no successful vision inspection of the troublesome board. Repeated markup/storage dumps increased context without establishing correct perception. General visual/semantic observation and recovery checks belong in 3C/4/6; do not hardcode this site's solver or selectors into the runtime.
- The old worker prompt says to achieve objectives “at any cost” and find ways around roadblocks including permissions. It should be revisited in the general task/authorization contract; permission failures must not be invitations to bypass policy.
- One legacy Python network card remained pending after Stop in the supplied export. General run-bound approval expiry/recovery remains a later repair; the managed route already has specific expiry controls. This follow-up does not claim all legacy pending cards are revoked.

## Repairs made in this follow-up

| Before | After |
|---|---|
| Worker, master and outer error handlers each publish cancellation | Inner handlers propagate `RUN_CANCELLED`; only the root send boundary finalizes after unwinding and managed cleanup. |
| Cancellation notice, interrupted plan and terminal state persist separately | One transaction persists them; repeated finalization is idempotent per run and cannot release a later run. Backend owns publication; no frontend text deduplication. |
| Permission headings inherit `user-select:none` from shared header styling | `.approval-card-title` explicitly uses text selection, including ordinary approval/handoff/choice headings. Actions and permissions are unchanged. |
| Empty managed journal leaves the actual route implicit | Debug exports include `runtime_at_export` with explicit `route:legacy|managed-v1`, enabled state and runtime contract. This is the exporting process's current route, not a reconstruction of historical run configuration. |

No browser-default switch, model selection change, domain allowlist, Wordle-specific runtime code or extra live-model trial was added. Existing Phase 3B live records keep their original source/configuration hashes; they are not relabelled tests of this later repair.

## Verification

Targeted native checks passed: Stop during master stream, worker stream, worker permission wait and verifier stream each leaves one durable visible notice, retained after reload. Mouse dragging selects a real permission title, and approval still works. Rust checks cover duplicate finalization, foreign ownership, a later run remaining active, and transaction rollback. A native export check verifies an explicit legacy route with no managed sessions.

Full validation passed **235 offline checks**, the frontend build, ordinary production compile and three optimized release regressions. [Exact groups and retained log](PHASE_3B_WORK_LOG.md#manual-test-follow-up). No additional live-model requests were made for these deterministic publication and selection repairs. Remote CI has not been run; the user requested these changes be included in the implementation checkpoint before Phase 3C planning.

## Next development decisions

3C should provide a coherent capture/viewer/replay rollout and make active runtime/capability coverage visible in normal use. Its acceptance should include a generic dynamic widget with hidden inputs and real visible feedback, rather than relying solely on conventional forms. Separately, deterministic completion/recovery and early worker supervision must detect unknown observations, stalled strategies, objective drift and inappropriate broad fetching. The manual case informs those general contracts; it does not make game playing the roadmap's priority.
