# Replay UI refinement

Approved from the user's screenshot and manual feedback after `74cec46`. This patch changes presentation and image transitions; browser ownership, model bindings, permissions and capture settings stay the same.

## Tangible changes and decisions

| Previous behavior | Refined behavior |
|---|---|
| Four playback-speed choices | Numeric steps/second input, including decimals, rounded to one decimal place; minimum representable positive rate 0.1. Empty/invalid/non-positive values restore the last valid rate. No fixed menu or arbitrary upper-rate selection. |
| Clear the image while retrieving its replacement | Keep the previous decoded image mounted, decode the candidate offscreen, and replace it only if its selection/session is still current. A loading label identifies the previous image. Actual missing/deleted/invalid evidence still shows an explicit gap. |
| Action, timestamp and image controls flow/wrap with content | Fixed-height rows with separate action, time and image-selector columns. The selector retains its space when disabled; long URLs and status text truncate within their row. Action changes do not move the viewport. |
| Unlabelled operation/status/actor text | **Action: Press · Succeeded** in the main row; actor identity and raw diagnostic details remain under Details. Dates stay readable and separated from Image timing. |
| Full screen next to image size | Full-screen icon in the window title bar, immediately before Close. Size controls only image scaling. |
| Different close glyphs/boxes | One centered SVG close-button component for browser/history/file/settings/task-settings/permissions/chat-log/action-plan UI. Existing IDs and close behavior are preserved. Chat log gains an explicit close button. |
| Counter text aligned by an inherited flex rule | Three-column navigation with equal button groups and a genuinely centered counter. Timeline pills have room above a dark scrollbar. |
| Top-left placement for all explicit zoom sizes | Center each image axis when there is free space at 100/150/200%; when an axis overflows, its top/left remains reachable by scrolling. |
| White/native and inconsistent scrollbar colors | Shared dark track/thumb tokens and dark native-control theme across the app, including modal content and replay navigation. Existing compact scrollbar widths remain where appropriate. |

The image loader keeps one displayed image, one in-flight candidate and one latest pending request. Obsolete results cannot replace a later seek or another session. Playback waits for the selected image or an explicit gap; closing/switching invalidates pending work and revokes image URLs. This is a seamless swap, not an archive format or a crossfade that mixes two recorded states. Deliberately expanding Details may resize the viewport; automatic content changes do not.

## Validation

Completed: **267 offline checks plus 11 optimized desktop checks passed**, together with the final frontend production build and `git diff --check`. Offline breakdown: 44 Node, 37 mission/grader, 82 Rust, 14 real Python/browser-service and 90 native desktop checks. No live-model requests or credits were used. Browser/capture settings and production backend source were not changed.

The new native case uses real recorded browser actions and real image reads/decoding. A controller delays delivery of the decoded image to reproduce a slow consumer without changing native validation or permissions. It checks retained pixels during manual/automatic advance, no removed/empty image between available frames, obsolete decode rejection after rapid seeks, truthful image gaps, stable viewport geometry across observe/press/navigate/fill/click and a long URL, fractional/invalid/custom rates, counter/icon centering, and image centering at all three zoom sizes. Large images remain scrollable from their origin. This is a software/UI check, not a live-model capability result.

Screenshots inspected at 1320×960 and 1000×760 include the real modern replay and its delayed-loading state. The earlier work inspected screenshots too, but its uniform-action display fixture did not cover the mixed-content jump reported by the user. The new coverage addresses that gap. Generated review artifacts stay ignored; no user screenshot is copied into the repository.

The 189-action display fixture was also inspected with action 126 centered, including the dark timeline scrollbar and space below each pill. Zoom geometry was verified at 100/150/200% in a large viewing area, and oversized images retained scroll access to their top-left. Expanded Details retained constant geometry across short/long records. Shared close-button click paths remain covered by settings/file/replay/runtime checks; the new replay case verifies SVG centering and title-bar icon placement directly.

The first optimized run exposed a test baseline measured during the modal's opening scale animation. The test now awaits the actual animation's `finished` promise before measuring; the subpixel position/height assertions were preserved. All 11 optimized cases then passed. This corrects test timing rather than disabling app animations or weakening layout checks. Local screenshots and the retained first-run failure are under `.zeus/evaluations/replay-ui-refinement/optimized` and `first-optimized`. Remote CI and live-model capability comparisons were not run for this UI-only patch.
