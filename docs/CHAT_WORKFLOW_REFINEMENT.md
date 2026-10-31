# Chat workflow and replay follow-up

Approved from the user's replay/settings/composer feedback on 2026-10-31; completed on 2026-11-01. This follows `fa22ac2`. The scope is the requested usability repairs, an inert design gallery and concise chat names. It does not change browser execution, permissions, model routing or the agreed 8 FPS live capture.

## Tangible changes and decisions

| Previous approach | Current behavior |
|---|---|
| Transient loading overlays and header text during seeks | Keep the displayed image and its action metadata together until the replacement decodes. No flashing seek overlay or loading suffix. Genuine missing/invalid evidence remains an explicit gap. |
| Timeline highlight inherits a background transition | Update the highlight without animation and center the selected strip item before paint. |
| Every recorded action participates in playback/jump navigation | Playback, arrow keys and +/- buttons count image-bearing actions. Direct strip clicks still select an exact action without an image. A failed selected image is skipped by subsequent jumps. |
| Each playback tick starts its delay after image I/O | Maintain a playback deadline, prefetch six upcoming images with three workers and cache bounded metadata/decoded images. Slow I/O does not add another full interval. |
| Settings header scrolls with the form | Fixed header with shared SVG Close, separately scrolling body, wider global/task settings and chat log. Debug-copy actions have a fixed gap from the title. |
| Large draft hides the attachment tray | Expanded composer includes both the tray and input; pasted images stay visible in either size. |
| Deprecated benchmark control in the conversation header | Hide that entry point. Developer evaluation tooling remains separate. |
| Browser card says Browser closed / Replay | Stable **Browser session** title, separate lifecycle badge, **Watch** during execution and **View replay** after termination. |
| Permanent first-prompt truncation as the new chat title | Ask the configured master for short title metadata in its normal response. No separate title request. Persist a generated name once and preserve manual renames, including an in-flight race. |
| Markdown `[Done]` produces pending fallback steps | Parse Done/Completed as completed. Repair the matching historical all-pending projection at read time, while preserving explicitly structured step status. |
| Full plan notes repeat the step list | Show the structured steps once; show optional notes only when additional narrative exists. |
| Narrow header wraps controls into further rows | Measure the controls, center the title in row one, right-align row two and put excess actions in an accessible overflow menu. `ChatHeader.jsx` isolates this change for straightforward revision. |

## Playback rate and resource bounds

The rate input has no fixed maximum selection. The old implementation incurred image retrieval/decoding and then the full configured delay on every action, so entering 90 steps/s did not produce 90 displayed steps/s. The deadline clock and lookahead remove that avoidable accumulation. Every available action still gets selected; this is not a video player that silently drops intermediate recorded states to meet a wall-clock target.

Actual throughput still depends on disk access, native path/hash/format validation, bridge transfer, image decoding and UI rendering. The viewer retains at most 120 metadata records, 12 decoded images with a nominal 64 MiB encoded-plus-decoded budget, and the displayed/current candidate images. Those protected images can exceed the nominal budget individually. Closing invalidates pending work and revokes image URLs. Native ownership/integrity checks still apply to prefetched images.

A 189-action synthetic archived-image fixture advanced at 90 requested steps/s in approximately **2.9 seconds** in the initial native check. This is evidence that the avoidable delay was reduced, not a guarantee for arbitrary recordings or a model capability score. Larger/distinct images may remain slower.

## Titles and plans

`task_title_state` is an additive, foreign-keyed SQLite table. Pending/default, generated and manual are distinct states. Title metadata is bounded and kept out of rendered streaming text; the original proposal is retained as a hidden diagnostic message. The first accepted generated name wins. A named existing conversation or a manual rename is preserved. A model that omits valid metadata can be asked again on a later normal turn; no extra paid loop runs solely to name a chat.

The reported action-plan failure was a parser/projection mismatch: the model wrote `[Done]` but the fallback parser only understood `[x]`. The frontend repair recognizes the same textual statuses for historical matching all-pending plans without rewriting the conversation. New plans persist whether their steps were explicitly structured or derived from Markdown. Additional plan notes can describe constraints, evidence or decisions beyond individual steps, so that section remains available only when such content exists. This repair does not mark an arbitrary plan complete solely because a model says the whole task finished; deterministic task-state/completion work remains a separate planned phase.

## Persistent design gallery

The idempotent maintainer command `node scripts/diagnostics/create_ui_showcase.js --data-dir ABSOLUTE_DIRECTORY` creates **UI showcase — card variants**, task `9ea2d928-5083-4e9a-aa6a-54efb1d2aa71`, in an existing owned database. It adds one task and synthetic messages in one transaction and does not migrate or modify existing chats. It creates no runs, workers, browser owners or real approvals. Both the frontend composer and backend send preflight reject execution in this gallery.

There are 29 inert card examples interleaved with captions: nine managed-browser variants, command/file approvals, handoffs, choices, workers, execution outcomes, older recording cards, errors, user attachments and assistant Markdown/reasoning. Its Action Plan panel also has sample steps. Browser badges cover Preparing, In progress, Finishing, Finished, Stopped, Error, Interrupted, and waiting for either approval or user input. Finished describes normal session termination, not independent verification of the user's goal. Because these are actual rendering components, future styling changes are reflected when the gallery is revisited. Preview controls cannot execute actions or open fictitious recordings.

## Validation

The native checks cover delayed image delivery, obsolete seeks, direct gap selection versus image-aware jumps, metadata stability, numeric rates, high-rate playback, fixed settings headers, wide debug-log spacing, one/two-row header layouts, overflow actions, expanded image drafts, title generation/manual rename races, completed plans and inert gallery creation. Screenshots are captured after opening animations and visually reviewed; test processes use hidden isolated workspaces and do not relink or close the user's running app.

One bounded live Abacus `gpt-6-luna` low-effort Responses request named a synthetic conversation **Planning a Vegetable Garden** while answering normally: 2,514 known tokens, no unknown requests, no tool actions. Provider credits remain unknown. The first diagnostic attempt failed before dispatch because the controller accessed the bridge too early; its evidence was retained and the controller now waits for bridge readiness. No repeated live benchmark or broad capability claim is made.

Final validated coverage: **275 offline checks plus 14 optimized desktop checks** (47 JavaScript, 37 mission/grader, 84 Rust, 14 real Python/browser-service, 93 native desktop). The frontend production build, ordinary app/diagnostics compile and `git diff --check` passed. The first 93-case desktop run had one outdated interrupted-card wording assertion; all 15 ownership checks passed after updating it to assert the new title and badge separately. The first optimized run had 13 passes and a delay-controller failure: its bare dynamic import could attach to a different hot-reload module instance. The controller now imports the viewer's actual resource URL, preserving its version. The corrected replay check and all 14 optimized checks passed. Neither correction relaxed image/ownership/geometry checks or native authorization.

The requested gallery was inserted into the actual AppData database and verified read-only: one task, 58 messages, 29 preview cards, zero runs, zero workers and zero managed-browser sessions. Existing conversations were not edited. The receipt is `.zeus/evaluations/chat-workflow-gallery-receipt.json`. The first UI and first optimized artifacts remain under `.zeus/evaluations/chat-workflow-refinement-first-ui` and `chat-workflow-refinement-first-optimized`; final screenshots are in `test-results/offline`. These local artifacts remain untracked. Restart/refresh the updated app to see the gallery and all new behavior.
