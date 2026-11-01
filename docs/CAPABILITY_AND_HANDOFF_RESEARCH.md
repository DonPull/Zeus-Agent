# Browser handoff, capability discovery, skills and permission research

Status: **Pre-implementation research snapshot, 2026-11-01.** The baseline findings below describe the app before Phase 3D. That research step changed no application code, made no MCP connection/classifier call and performed no headed-browser experiment or desktop switch. The user subsequently approved [Phase 3D execution](PHASE_3D_EXECUTION_DESIGN.md), which supersedes the baseline's unsupported-handoff/transfer descriptions and adds measured Windows experiments. MCP, skills and Smart-permissions proposals still require their own implementation packets.

## 1. Clarified product requirements

- The agent requests human intervention when it cannot complete a necessary step, ideally limited to authentication/account steps that require the human. A permanent on-demand Take control feature is not required. A button accepting an existing intervention request can expose the browser without unexpectedly taking focus.
- Preserve the running browser process/context/tabs through normal human intervention. Human activity remains in the same replay. Restarting with copied cookies/restored tabs does not satisfy this requirement.
- An interactive input-forwarding preview is not the chosen approach. The user wants a real browser during intervention.
- Zeus should discover/configure/connect suitable MCP integrations itself, and launch required local apps, within the user's authorized scope. Users should not need to maintain JSON server configurations. Necessary account authentication/consent remains a distinct operation.
- Zeus should discover, use and create reusable skills, with an up-to-date curated collection rather than reinventing complex workflows.
- Smart mode may allow uncertain-alignment actions when their impact is genuinely low and bounded. Frequent uncertainty must trigger review rather than permit indefinite drift. Worker explanations are useful evidence and may resolve uncertainty, but do not themselves grant authority.

## 2. Browser findings

### Installed Zeus runtime

`service.py` pins Playwright **1.62.0**, launches `headless=True`, and specifies no browser channel. The installed SDK's `getExecutableName` selects **chromium-headless-shell** for those options. Its manifest records Chromium **151.0.7922.34**, revision **1234**, for both the full and headless-shell distributions. These are inspection findings, not a running-process trace.

This matters because the current default is a separate headless executable, not a minimized full browser waiting to be restored. [Playwright's browser documentation](https://playwright.dev/python/docs/browsers#chromium-headless-shell) explains the distinction and the separate full-Chromium/new-headless option.

### Headless-to-headed conversion

Chrome's unified headless implementation creates platform windows without showing them ([Chrome documentation](https://developer.chrome.com/docs/automation-and-testing/headless)). That does not establish a supported runtime conversion to an ordinary interactive window. Current [Chromium mode detection](https://raw.githubusercontent.com/chromium/chromium/main/chrome/browser/headless/headless_mode_util.cc) reads process launch configuration. The [CDP Browser domain](https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/pdl/domains/Browser.pdl) exposes window bounds/states, not a headless/headed conversion command.

Windows headless handling also treats focus and geometry specially ([native window code](https://raw.githubusercontent.com/chromium/chromium/main/ui/views/win/hwnd_message_handler.cc)). Forcing a hidden HWND visible would be an unsupported experiment, not proof of a complete normal browser or a maintainable product mechanism. No supported reliable hot conversion was found. This is a statement about documented/inspected mechanisms, not a claim that all native hacks are mathematically impossible.

Recommendation: do not base normal handoff on changing headless mode or switching automation libraries. Start with full, window-capable Chromium and validate an unobtrusive/restorable window policy. Keep Playwright as the shared automation service unless concrete evidence justifies a broader change.

### Window/background alternatives

| Approach | Findings and assessment |
|---|---|
| Headed, minimized | Protocol-based DOM actions do not require the physical desktop pointer. Minimizing is not equivalent to stopping the process, but frame production, animation and visibility behavior need validation. Candidate to test, not an assumed failure or guaranteed solution. |
| Headed, hidden without minimizing | Preserves an actual native window that could be exposed for intervention. Startup visibility, focus, popups and capture must be proved. First candidate alongside minimized operation. |
| Headed, offscreen | Possible window placement strategy, but offscreen windows can enter background/occluded behavior and monitor/DPI changes complicate restoration. Fallback candidate. |
| Another Task View desktop | Window moving is supported, but Chrome treats windows on another virtual desktop as occluded. Additional desktops do not automatically guarantee continued painting. Desktop creation/switching and focus policy add complexity. |
| Separate Win32 desktop object | Different mechanism from Task View. Only the active input desktop receives normal user input; cross-desktop windows/hooks have restrictions. Switching the user's whole input desktop would be intrusive. Not the initial solution. |
| Separate VM/session | Stronger isolation can help future desktop workloads, but introduces provisioning and access costs. This belongs to the separately designed execution environment, not a small handoff shortcut. |

[Chromium's occlusion explanation](https://blog.chromium.org/2021/12/chrome-windows-performance-improvements-native-window-occlusion.html) documents painting/background behavior for covered, minimized, offscreen and other-virtual-desktop windows. [Microsoft's Task View interface](https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nn-shobjidl_core-ivirtualdesktopmanager) describes window grouping/moving; [Win32 desktops](https://learn.microsoft.com/en-us/windows/win32/winstation/desktops) describes the distinct input-desktop mechanism. These sources support the constraints, not empirical success for Zeus.

The installed Playwright driver already supplies switches disabling background timer throttling, backgrounding of occluded windows and renderer backgrounding. [Upstream launcher source](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/chromium/chromiumSwitches.ts) also contains these. Do not prescribe a pile of duplicate flags as an untested cure. Browser painting, OS window capture and Playwright page screenshots are distinct paths.

### Required feasibility experiment, after alignment

Compare normal headed operation with covered, minimized, hidden and offscreen states; test a second Task View desktop only if simpler candidates are inadequate. Use owned synthetic pages and a separate test browser/profile. The experiment must show:

- Same process, browser context, tab IDs, unsaved form values and page-local JavaScript state before/during/after intervention.
- Working click/fill/keyboard/navigation and correct state observations while backgrounded.
- Fresh images of changing DOM, animation, canvas/WebGL and frames, including idle periods; preserve the agreed 8 FPS viewed-capture target and report actual cadence/stalls.
- No unwanted foreground activation, startup flashes, physical-pointer/keyboard interference or unexpected popups.
- Agent-requested intervention exposes a normal browser; resuming reconciles the human's effects, then returns to background operation without restart.
- Correct behavior on cancellation, window closure, renderer failure, tab/pop-up creation and ordinary display/DPI changes. Distinguish interrupted recovery from seamless handoff.

Until this experiment is approved and run, the background-window recommendation remains source-informed, not validated on this Windows installation. No result should be claimed merely because commands return success.

## 3. Autonomous MCP and desktop capabilities

### Current code versus requested capability

Zeus currently exposes commands, Python actions, file/network operations and the managed browser. There is no first-class MCP client/discovery registry, skill activation manager, or general desktop observe/act/verify toolkit in the runtime. Developer `.agents/skills` files are not an implemented Zeus skill runtime.

Commands can locate and launch installed applications and invoke application scripting APIs. This is enough for some application workflows; it is not dependable arbitrary GUI control by itself. Python actions explicitly block `ctypes.dlopen`, so assuming that native desktop-automation libraries will work unchanged in the current Python runner would be wrong. A controlled desktop service/adapter should provide app/window discovery, UI Automation inspection/invocation, scoped input and screenshots, with ownership, cancellation, verification and the same permission boundary.

[Microsoft's UI Automation tooling](https://learn.microsoft.com/en-us/windows/apps/dev-tools/winapp-cli/ui-automation) distinguishes semantic UIA operations from input injection. The latter needs a usable interactive foreground desktop; screenshots have additional constraints. Reuse supported automation tools/APIs where practical instead of implementing every control from raw mouse coordinates. Ordinary host tools cannot promise unrestricted access to protected OS UI.

### Proposed managed capability manager

The desired flow is: understand the required capability, discover a trustworthy integration, check prerequisites/permissions, start or connect it, discover its real tools, perform the task, verify results and retain reusable configuration. Support remote MCP/OAuth and managed local servers, with per-account credentials, scoped tool visibility and process cleanup. Integrate tool invocation at the harness layer so Abacus/local model choice remains independent of MCP transport.

Use a curated capability catalog backed by publisher metadata/registries. The [MCP Registry](https://modelcontextprotocol.io/registry/about) authenticates namespaces and hosts metadata; it delegates code security assessment to the ecosystem. A listing or convincing tool description is not a safety certificate. Pin reviewed releases, detect meaningful tool/permission changes, and apply existing authorization to installation, credential scope and each consequential operation. Registry/website/tool text cannot grant permissions. Discovery and already-authorized setup should be automatic; new consequential grants use the normal permission flow.

Examples verified from primary sources:

- [Canva](https://www.canva.dev/blog/developers/canva-mcp-ga/) offers a remote MCP integration with developer-client setup and per-user OAuth. Zeus can manage connection details; a user's first account authentication/consent cannot be assumed away. This is a Canva capability, not proof that all websites expose MCP.
- [MCP for Blender](https://github.com/ahujasid/mcp-for-blender) is a community integration, explicitly unaffiliated with the Blender Foundation. Its documented path installs/enables an add-on and runs it inside Blender. Opening/configuring Blender is part of that connector's prerequisites. Do not describe it as Blender's built-in official MCP. Direct Blender scripting/background execution is another candidate; measure which route suits the task rather than forcing every app through MCP.

OAuth tokens and connector configuration belong in managed storage, not prompts or skill text. Local-server code execution and broad tools such as execute-Python need their real consequences assessed; an innocent MCP tool name is not enough. Follow the [MCP security guidance](https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices) for authorization, token handling and endpoint validation.

## 4. Reusable and self-created skills

Use the open [Agent Skills format](https://agentskills.io/specification), with `SKILL.md`, optional scripts/references/assets and on-demand loading. [The integration guide](https://agentskills.io/client-implementation/adding-skills-support) describes discovery, activation and context retention. This is compatible with the project's Abacus-first model architecture; it does not require an Anthropic model subscription.

Proposed lifecycle: discover a relevant skill, load only its necessary content, execute through existing tools, verify the result, and retain a versioned reusable workflow. Zeus can create local draft skills from successful work and test/refine them. A draft should not silently replace global instructions or become trusted cross-task guidance solely because its author model claims success. Include prerequisites, expected outputs, checks and recovery behavior, with environment-specific details and credentials handled appropriately.

Start with a small curated, licensed, version-pinned collection; [Anthropic's public skills](https://github.com/anthropics/skills) is one source to assess. No collection is automatically current, secure and proven for Zeus just because it is popular or first-party. Evaluate imported updates and self-created skills on relevant success/negative cases. Skills may contain scripts and are subject to normal authorization; their metadata cannot expand permissions. A skill can guide Canva/Blender work through MCP, native APIs or the browser. Skills are reusable method; connectors provide executable capabilities.

## 5. Smart permission clarification

### Concrete decision pipeline

1. Build an action record from the actual proposed operation/arguments, resolved targets, current trusted goal/revision/delegation, existing approvals and relevant observed evidence. Record worker rationale separately as a claim.
2. Ordinary policy code handles exact explicit grants/denials and genuinely pre-authorized typed operations. This is narrow deterministic enforcement, not a gigantic rule list that guesses arbitrary script meaning. Unknown scripts/commands do not inherit harmlessness from a name or worker explanation.
3. A decision model or suitable LLM evaluates the remaining semantic questions. A single request can produce separate alignment and consequence assessments, plus uncertainty and other bounded dimensions if useful.
4. Code validates the response and applies the agreed matrix, scope, budgets and context version. The judge advises; it does not itself execute or grant unrestricted powers. Reassess when the relevant target/state changes.

The user clarified TypeSafe Jev. The supplied `jevtypesafeai.com` [terms](https://jevtypesafeai.com/terms) identify it as an unaffiliated developer gateway; primary vendor documentation is at `docs.typesafe.ai`, linked by `typesafe.ai`.

[TypeSafe's documentation](https://docs.typesafe.ai/introduction) describes independent typed questions in one request. [Abacus documents Jev](https://api.abacus.ai/help/route-llm/systemone) at `/v1/systemone` under RouteLLM, with up to ten questions and text/JSON input. It lists 20 requests/minute for self-serve organizations, which may constrain per-action assessment. Its [Decisions endpoint](https://api.abacus.ai/help/route-llm/decisions) also documents `jev-latest`, and a separate `gpt-6-luna` decision route supporting images. These are published capabilities, not an account-specific inference test. Jev through that route is text-only. Do not assume typed outputs prove correct judgments, accept arbitrary screenshots, or avoid prompt injection.

No classifier winner, threshold or new provider subscription is chosen. Public benchmark data can inform a shortlist, but permission-specific accuracy/calibration, latency, rate limits, privacy and actual Abacus usage must decide. An Artificial Analysis ranking for these decision models was not independently confirmed in this research; no best/cheapest ranking claim is made.

### Revised uncertainty and worker-rationale policy

- Aligned + low impact: allow within authorized scope. Aligned + consequential: ask if not already authorized. Clearly off-goal: hold/reject and redirect; do not ask the user to approve irrelevant actions.
- Uncertain alignment + verified bounded low impact: may proceed with a limited exploration allowance. Track repeated uncertainty, no-progress and cumulative consequences; thresholds belong to calibration. An unavailable judge, unknown impact or stale authorization is not evidence of low impact.
- Uncertain alignment + consequential/unknown impact: seek evidence/explanation/coordinator review before action, then request user approval if appropriate.
- Hear the worker's short explanation and check it against the actual user goal and independent observations. It may resolve a misunderstanding. It cannot change the goal, approve itself, fabricate evidence or overturn a denial. Bound repeated appeals; preserve rationale and verdict for diagnosis.
- Read-only does not always mean low impact: reading secrets or placing private data in an outbound request can be consequential. Several individually small steps can also form a consequential chain.

### Meaning of measure before enabling automatic approval

First build labelled allowed/ask/deny/uncertain cases with benign alternatives, normal exploratory work, misleading rationales and adversarial page/tool/image content. Check the actual operation and outcome rather than the model's own assessment. Measure dangerous false allows, unnecessary blocks/prompts, uncertainty frequency, rationale-induced changes, latency and cost. Keep held-out cases and test relevant model/version changes.

Then run **shadow mode**: normal enforcement still decides execution; the candidate Smart judge records what it would have allowed/asked/blocked. Dangerous proposals can be graded without actually executing their harmful effect. Review disagreements and calibrate thresholds. Only promote bounded scopes after the agreed tests pass, retaining an immediate rollback. This is calibration of an imperfect decision mechanism, not delaying the feature until all risk disappears.

## 6. Prompt-injection threat and defenses

Yes, visual content can contain injection. [Anthropic's computer-use documentation](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool#security-considerations) explicitly covers both webpage text and images; [its browser-defense research](https://www.anthropic.com/research/prompt-injection-defenses) treats robustness as ongoing work. There is no evidence here for a universally injection-proof browser agent, classifier or self-authored skill system.

Proposed defense separates trusted user intent/policy from external evidence, retains provenance through worker messages/memory/compaction, and enforces actual tool/file/network/credential authority outside model text. Treat webpage instructions, screenshots, OCR, MCP descriptions/results and imported skill content as separate trust inputs; a convincing instruction cannot elevate its source. Judge the actual proposed target/arguments and permitted data destination, not just whether a model promises a good purpose.

Use scoped credentials/capabilities, restricted data flows and independently checked consequential actions. Keep necessary secrets outside model context where possible. Detection and stronger judging help, but do not replace those boundaries. [CaMeL](https://arxiv.org/abs/2503.18813) is relevant research on separating control/data flow and enforcing capabilities; its guarantees apply to its defined model and scope, not arbitrary unrestricted Windows/Python execution. OS isolation remains separate Phase 10 work. Add text/visual/tool/skill injection and multi-step/rationale attacks to the security suite alongside ordinary task success, so stronger defenses do not merely make Zeus unable to work.

## 7. Proposed roadmap placement

Keep 3D focused on agent-requested same-browser intervention, human recording, action overlays and transfers. Establish the repeated benchmark checkpoint before major architecture comparisons. Phase 4 supplies durable goals, provenance, memory and the local skill/context foundation; Phase 5 supplies calibrated authorization for browser/native/MCP/skill operations.

Add explicit **5B: managed capability discovery/MCP and desktop adapters** and **5C: curated/imported/self-created skills** as proposed workstreams before broader Team/routing optimization. Small foundational skill support may start with Phase 4. These proposed labels preserve the existing Phase 6–10 numbering and do not silently authorize their implementation or a complete marketplace. Each needs its own tangible-impact summary, decisions, acceptance checks and bounded plan.

Required new benchmark areas: automatic connector discovery/configuration, authorized OAuth/local app setup, actual Canva/Blender-like artifact outcomes, recovery from missing/changed tools, skill reuse and skill creation on a different follow-up task, malicious connectors/skills, false approvals and cumulative low-impact drift. Preserve matched Solo/Team and old/new-build configurations and include classifier/connector/skill overhead in agent cost.
