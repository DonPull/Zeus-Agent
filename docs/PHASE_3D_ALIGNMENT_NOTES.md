# Phase 3D: alignment notes before implementation

Status: **Implementation authorized, 2026-11-01.** The user approved the aligned product direction and Windows feasibility experiments. See [the execution design](PHASE_3D_EXECUTION_DESIGN.md) for the concrete delivery contract and experimental gate. Earlier wording below preserves the planning discussion, not an ongoing prohibition on implementation.

Further user clarifications and primary-source findings are in [capability and handoff research](CAPABILITY_AND_HANDOFF_RESEARCH.md): intervention is requested by the agent, an interactive passthrough preview is not selected, uncertain low-impact actions may proceed within limits, worker explanations are considered, and autonomous MCP/desktop/skills work is explicitly tracked.

## Current implementation findings

- `src-tauri/browser_service/service.py` launches a persistent Chromium context with `headless=True` and `accept_downloads=False`.
- Master and worker `ask_user_for_login` branches return `BROWSER_UNSUPPORTED` on the ordinary managed route. `start_browser_handoff` and `finish_browser_handoff` also return unsupported. There is no functioning native human handoff, second login browser or active cookie-copy workflow.
- Worker code retains old stop/restart comments behind the retired route. Those comments are not evidence of current behavior.
- Modern interactions journal automation requests/outcomes and boundary images. There is no equivalent complete observer for human page actions. Existing live capture alone does not establish an action-by-action retained human recording.
- The viewer only draws historical bounding boxes from older recording data. The modern executor has no complete optional click/keyboard/text annotation feature. `inspect` can return a frame-relative rectangle; this alone is not proof of the point actually clicked or its position in another screenshot.
- Managed upload/download operations are currently unsupported. Uploading an attachment to Zeus's conversation is distinct from submitting that file to a website.

## Tangible goals and proposed decisions

### Optional action annotations

Add a **Show actions** toggle to Live View and Replay. Show actual click points/target outlines and a compact corner indicator for keys, shortcuts and entered text. The presentation must support recorded human actions as well as agent actions, with the actor identified.

Keep annotations as structured metadata drawn by the viewer, rather than modifying original screenshot pixels or page DOM. Toggling them off restores the plain image without additional image copies. Associate geometry, time, viewport/scroll/scale and frame identity with the interaction. A target on the before image cannot be drawn on a different after image as if its location were still verified. Old recordings with insufficient geometry must remain honest about unavailable annotations. Use bounded text presentation without changing viewport layout; exact retention/display defaults belong in the implementation design.

### Same-process human handoff

The user does not want normal handoff to close/relaunch the browser or copy cookies between separate browsers. Preserve the running process/context/tabs, including unsaved form state and in-memory application state.

Proposed workflow: the agent requests necessary human intervention and persists a waiting/handoff state. The runtime stops all agent browser mutations, lets the human accept the request to expose the owned browser, records their activity, then offers **Resume** or an explicit **Stop run**. A permanent on-demand takeover button is not required. Resume observes the actual current page and reconciles human actions before releasing control back to the agent; it must not automatically repeat a submission performed by the human. Waiting should not consume repeated model calls. Navigation, capture and the website's own scripts may continue; pausing the agent does not freeze the website.

Recommended approach to validate: start one window-capable browser from the beginning and manage its Windows visibility/focus. Expose that same window during handoff, then return it to background operation. Acceptance must prove no flashing/focus stealing, preserved pages/form state, continued capture and normal cleanup. This is a proposal, not an already-proven Windows mechanism.

The user does not select input forwarding through an interactive Zeus viewer. Research the real-browser alternatives first; background window feasibility must cover rendering as well as command execution. A normal restart with saved cookies is not an acceptable substitute for preserving a live page. A crash-recovery restart must be explicitly identified as recovery with possible state loss.

Playwright documents `headless` as a launch option, not a documented live conversion API: [BrowserType](https://playwright.dev/python/docs/api/class-browsertype#browser-type-launch-persistent-context). A Windows feasibility prototype is required before committing the visibility policy. Access to the user's unrelated daily browser remains undecided and outside this proposal.

### Human activity remains in the same replay

The user's preference is continuous recording through handoff, including sensitive on-screen content, with the same kinds of page actions/inputs recorded for humans and agents. This supersedes the earlier suggestion to blanket-pause/redact the human segment. Do not silently omit human activity solely because it may contain personal information.

Record page clicks, scrolling, text entry, keys, navigation and relevant before/after evidence in the same session, labelled **Human** or **Agent**. Group text-entry events sensibly rather than making every character a separate replay step. Password fields retain their actual visible browser presentation (masked unless the user reveals them); this preference does not itself require extracting hidden cookie values, authorization headers or the underlying plaintext of masked fields. Those are distinct from visible-page replay. An exact raw-credential event-retention policy, if wanted, needs explicit alignment rather than an inferred requirement.

Human interaction capture requires new instrumentation; tool-call journaling does not automatically observe it. Page-originated observations must not become authorization grants or pretend to be verified agent tool results. Browser chrome, native dialogs and unsupported surfaces need explicit coverage limitations, not fabricated complete records. This is browser-session recording, not a system-wide input logger.

### Uploads/downloads and transfer outcomes

Both phrases refer to browser file transfers. Examples: submit a provided PDF to a website's file input, or export a CSV/PDF from a web application into the task's workspace. This is unrelated to exporting browser replay or transferring a conversation to another PC.

The transfer lifecycle must identify the file, destination/source, pending/completed/failed/cancelled state and final owned artifact. Preserve name/size/type/hash where available. A successful click is not evidence that a download completed or a server accepted an upload; verify the relevant outcome. Closing a session must not discard a completed downloaded artifact. [Playwright downloads](https://playwright.dev/python/docs/downloads) use temporary storage whose files disappear on context close unless preserved; [upload controls](https://playwright.dev/python/docs/input#upload-files) support native file-input/chooser workflows.

Transfer authorization belongs to the same policy boundary as other tools: selecting a file is not a blanket grant to disclose arbitrary local data to a site. Phase 3D must work with current approvals; Phase 5 will improve their intelligence and UX.

## Cross-phase requirements to retain

The user also authorizes considering separately paid classifier providers in Phase 5, including direct Jev access and alternatives such as Liquid AI's proposed d1-ultra. Abacus remains the ordinary hosted actor source. Do not infer that a paid account removes all quotas, that the named model is already integrated, or permission to purchase credits/create accounts. Verify the current vendor/model, API schema, context limit, price and quotas before an actual comparison. Report measured classifier cost separately from unobservable Abacus credits.

### Phase 5: alignment and consequence are separate decisions

Smart permissions must cover files, commands, Python/other scripts, HTTP and semantic browser interactions, including a consequential button click. Evaluate an action's relationship to the current user goal separately from its consequences and authorization scope. Two logical assessments do not require two paid model requests for every operation; compare a combined structured classifier, separate checks and deterministic fast paths during calibration.

Proposed default matrix, after explicit user rules/approvals and hard boundaries:

| Goal alignment | Consequence | Default response |
|---|---|---|
| Aligned | Low impact | Allow within authorized scope |
| Aligned | Consequential | Ask for specific approval if it is not already granted |
| Clearly off-goal | Low impact | Hold/reject the action and return a correction signal |
| Clearly off-goal | Consequential | Reject and escalate to the coordinator |
| Uncertain | Verified bounded low impact | May allow with a limited exploration allowance and monitoring of repeated uncertainty/no progress |
| Uncertain | Consequential or unknown impact | Seek evidence/rationale/coordinator review before execution; ask if authorization is still required |

An off-goal worker should pause before the action executes and return the evidence/reason to the master for redirection, avoiding an irrelevant user permission card. Do not destroy its browser/work merely to request redirection. Legitimate preparation, exploration and recovery can be aligned; a weak relevance guess must not cause endless worker cancellations. Single-agent mode needs the equivalent self-replanning path and bounded escalation.

Judge against trusted user requirements, current revisions and the authorized delegation contract, while considering the worker's explanation as a claim to check against independent evidence. A bounded clarification/appeal can resolve a misunderstanding; it cannot rewrite the goal, grant consent or override a denial. Bind browser decisions to the actual origin/tab/target, relevant state and proposed operation; reassess after meaningful context changes. A purchase/delete action can be relevant yet still need confirmation. Start with adversarial/off-goal/uncertain shadow cases and measure both false allows and false blocks, including excessive uncertainty and persuasive false rationales. [Anthropic's computer-use guidance](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool#security-considerations) illustrates confirmation for consequential actions and prompt-injection defenses; it does not establish a universal mandatory two-classifier design.

### Phase 2: canonical Zeus Benchmark v1

The user explicitly requires an official project benchmark for both **Solo versus Team** and **the same configuration on an older versus newer Zeus build**. Six graded missions and native diagnostics already exist; the complete repeated suite is not delivered. The proposed 12 core plus four stretch portfolio remains a design target, not a current feature or frozen count.

Freeze/version missions, fixtures, graders and named model/effort/role/policy configurations; identify exact source builds and shared task budgets. Reset environments and retain all trials, failures and interventions. Repeat comparisons and, where appropriate, interleave builds to help expose provider drift. Keep an independent validation/held-out portion.

Report verified success and quality by category, consistency, latency, human intervention, all acting-role/verification/routing/retry usage, and cost per successful task. Show quality-versus-cost tradeoffs rather than declaring Team intrinsically cheaper or smarter. Product verifier usage counts toward agent cost; external benchmark-grader expense should be reported separately. Use actual provider credits when observable, otherwise explicit token totals and labelled estimates/unknown cost; do not relabel token units as Abacus credits.

Establish a bounded repeated baseline after 3D and before larger Phase 4/6 architecture comparisons. Complete the execution/grading boundary needed for the chosen missions; native diagnostics must remain labelled as native when isolation/authorization coverage is incomplete. One aggregate score or the historical experimental 10/10 does not replace this contract.

## Next checkpoint

The alignment checkpoint is complete. The user authorized implementation and scheduled the foreground experiments. [The execution/delivery packet](PHASE_3D_EXECUTION_DESIGN.md) is now authoritative for delivered scope, measurements and limits. These notes preserve the preceding discussion; their proposed wording is not a prohibition on the approved work.
