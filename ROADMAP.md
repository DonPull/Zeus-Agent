# Zeus Agent — Project Roadmap & Implementation Source of Truth

This document serves as the authoritative, persistent source of truth for the Zeus Agent project roadmap, architecture, completed capabilities, active evaluation phases, and deferred future features.

---

## 1. Architectural Foundation & Invariants

Zeus Agent is a desktop autonomous-agent runtime engineered to execute complex, open-ended missions autonomously on the host computer.

- **Single-Repo Architecture**: All runtime logic, evaluation harnesses, and tests reside in a single repository (`D:\Hristian projects\Zeus-Agent`). There is no separate evaluator repository.
- **Agent Roles**:
  - **Master Agent**: Decomposes user goals, devises action plans, delegates subtasks, and synthesizes results. In local mode, operates as a unified autonomous problem solver (`local_master.txt`).
  - **Worker Agents**: Execute focused, delegated subtasks in parallel sandboxed environments.
  - **Verifier Agent**: Independently assesses whether worker outputs fulfill the user's success criteria.
  - **Watcher AI**: Cognitive safety sentinel inspecting DOM actions and tool execution in real time.
  - **Zeus Eyes (Vision)**: Multimodal spatial inspection of UI screenshots and images (`analyze_visual`).
- **Multi-Platform Vision (Windows, macOS, Linux, Mobile Android/iOS)**:
  - Zeus Agent is architected as a cross-platform desktop & mobile autonomous runtime. While Windows is the initial deployment environment, the core runtime deterministically detects `host_os` (`std::env::consts::OS`) and `host_family` (`std::env::consts::FAMILY`) at runtime, dynamically injecting the host environment into Master and Worker system prompts without hardcoding.
  - Long-term milestones extend platform-native capabilities to macOS (Apple Keychain, Zsh sandboxing), Linux (Secret Service API), and mobile targets (Android/iOS).
- **Antigravity's Role in the Continuous Improvement Routine**:
  - Antigravity acts as the autonomous manager, evaluator, diagnostics specialist, and code refiner.
  - Runs the Playwright benchmark runner (`tests/advanced_e2e/benchmark_runner.spec.js`) or specific advanced E2E specs.
  - Monitors execution logs, task workspace artifacts, SQLite message logs, and `python_check` assertions.
  - Evaluates performance against standard rubrics (Accuracy, Tool Proficiency, Safety, Efficiency).
  - Automatically identifies bugs or failure steps, implements clean non-hacky engine fixes, and re-runs the task until it achieves **$> 8.5 / 10$** with 100% assertion pass rate.

### Core Invariants (Non-Negotiable)
1. **SQLite is Authoritative**: Source of truth for message existence, sequence ordering, and task state.
2. **Persist Before Emit**: Every message receives its immutable `seq` rowid in SQLite before frontend event emission.
3. **Backend Owns Visibility**: The frontend renders what the backend commits using the `visible` flag (`1` or `0`).
4. **Stable Sequence Ordering**: Deterministic sorting by sequence (`seq`).
5. **No Optimistic Frontend Messages**: The frontend never fabricates chat bubbles.
6. **Task-Scoped Active Runs**: `ActiveRunGuard` enforces a single-flight execution loop per task.
7. **Task-Scoped Cancellation**: `CancellationToken` drops running models, HTTP streams, and processes immediately.
8. **No DB Mutex Across I/O**: The SQLite lock must ALWAYS be dropped before awaiting LLM streams or external processes.
9. **Bridge Boundary Isolation**: React components never invoke Tauri commands directly; all IPC routes through `src/bridge/index.js`.
10. **Secret Security**: API credentials reside in Windows Credential Manager—never in plaintext SQLite or git.

---

## 2. Completed Milestones & Capabilities

| Milestone | Capability | Status | Details |
|---|---|---|---|
| **P0.1** | Single Flight & One Projection | **COMPLETED** | Single-flight execution lock, SQLite sequence ordering, unified message projection. |
| **P0.2A** | Durable Run Journal | **COMPLETED** | Run state transitions (`active`, `completed`, `failed`, `cancelled`), crash recovery. |
| **P0.2B** | Run Control & Task UX | **COMPLETED** | User cancellation, task renaming, task settings modal, responsive dark UI. |
| **P1** | Delegation & Verification | **COMPLETED** | Master-Worker-Verifier multi-agent architecture with structured handoffs. |
| **P2** | Gatekeeper & Capability System | **COMPLETED** | Command pattern decomposition, Watcher AI DOM intent inspection, interactive Approval Cards. |
| **P3** | Multi-Model Effort Governance | **COMPLETED** | Granular reasoning effort levels (`low`, `medium`, `high`, `default`) across RouteLLM, Gemini, and OpenAI-compatible endpoints. |
| **P4** | Stealth Browser Tools & Cookies | **COMPLETED** | Parent profile cloning (`.zeus/parent_browser_profile`), anti-bot stealth, encrypted Cookie Vault. |
| **Native Compressor** | Output Compressor (`output_compressor.rs`) | **COMPLETED** | ANSI stripping, head/tail preservation, artifact file dumping for terminal outputs. |
| **Action Plan Stepper** | Live Plan Stepper (`ActionPlanPanel.jsx`) | **COMPLETED** | Real-time progress bar, status nodes (`completed`, `in_progress`, `interrupted`, `pending`), markdown plan viewer. |
| **Zeus Eyes (Vision)** | Multimodal Image Inspection | **COMPLETED** | `Directive::AnalyzeVisual`, `analyze_visual` gateway, vision reasoning effort selector, vision model configuration. |
| **Line-Range Reader** | Targeted File Slicing | **COMPLETED** | `Directive::ReadFile` with `start_line`, `end_line`, and `limit` options, 500-line safety cap, full system prompt documentation. |
| **Attachment System** | Clipboard Paste & File Uploader | **COMPLETED** | Ctrl+V image pasting, `+` picker button, interactive attachment tray, `<workspace>/attachments/` persistence. |
| **Local Model Registry** | Accurate Model Identification | **COMPLETED** | `LOCAL_MODELS` registry in `gateway.rs`, `bridge.getLocalModelIds()`, distinct `[Local]` badges in settings and task modals. |
| **Token Accounting** | Preamble Token Propagation | **COMPLETED** | Fixed conversational preambles to receive `Some(units)` so chat bubbles never display `units n/a`. |
| **Autonomous Benchmark Suite** | 10/10 Prompts Benchmark (100% Pass) | **COMPLETED** | 10 real-world engineering prompts validated via `benchmark_runner.spec.js` on `Qwen3.8-27B`. |
| **Session Replay UI** | Step-by-Step Browser Replay Modal | **COMPLETED** | Replay modal with step history, syntax-highlighted Playwright actions, and DOM highlight toggles. |
| **Xiaomi MiMo Integration** | High-Performance Gateway Wire | **COMPLETED** | Native support for `mimo-v2.6-pro` via dedicated endpoints (`https://token-plan-ams.xiaomimimo.com/v1`). |
| **Interactive Budget Control** | Mid-Run Budget Pause & Extension | **COMPLETED** | Asynchronous budget notice and decision IPC (`budget_notice.json` / `budget_decision.json`) preventing runaway token spend. |

---

## 3. Active Phase: Continuous Improvement & Benchmark Hardening

### Objective
Execute automated benchmark evaluations across modular suite bundles (`wave_1_foundation`, `wave_2_browser_agentics`, `official_gaia_mini`, `official_swe_mini`) using our hybrid cloud/local multi-agent runtime:
- **Master**: Cloud model (e.g. `zai-org/GLM-5.3-Flash` / `moonshotai/Kimi-K3`)
- **Worker**: Cloud model (e.g. `gpt-5.6-luna` / `deepseek-ai/DeepSeek-V4-Pro` / `mimo-v2.6-pro`)
- **Verifier**: Cloud model (e.g. `zai-org/GLM-5.3-Flash` / `grok-4.5`)
- **Watcher**: Local model (`Qwen3.8-27B` via `http://localhost:11434/v1`)
- **Vision**: Cloud model (`gemini-3.8-flash`)

### Harness Infrastructure
1. `tests/benchmarks/benchmark_engine.js`: Reusable engine handling lifecycle, CDP connections, task initialization, fixture copying, turns, and Python assertion verification.
2. `scripts/eval_harness/run_benchmark.js`: Multi-tier CLI (`--smoke`, `--standard`, `--full`) supporting score-only benchmark execution.
3. `scripts/eval_harness/dashboard/`: Visual HTML/JSON dashboard reading `scores.json` and `units_ledger.json` across categories and architectures.

---

## 4. Upcoming Architecture Workstreams (Priority Backlog)

### Workstream 1: Tool-Grounded Adversarial Verifier & Master Escalation (P1)
- **Problem**: In the current implementation (`src-tauri/src/worker.rs:109-127`), the Verifier performs a single blind text completion on the worker's self-reported `{result}`. It lacks read-only tools, inspection capability, or independent verification.
- **Tool-Grounded Loop**: Equip the Verifier with its own read-only tool loop (`read_file`, `list_dir`, `search_files`, `run_command` [tests/lint], `analyze_visual`).
- **Evidence-Before-Opinion**: Require the Verifier to gather physical evidence (file existence, test exit codes, visual state) before outputting structured evaluation JSON:
  ```json
  { "passed": false, "scores": { "accuracy": 7, "tools": 9, "safety": 10, "efficiency": 8 }, "blockers": ["Unit test 3 failed: off-by-one in date parser"], "evidence": ["pytest exit code 1"] }
  ```
- **Adversarial Posture**: Success is measured by discovering genuine defects and edge-case flaws rather than rubber-stamping.
- **Bounded Worker Repair & Master Escalation**: The Worker receives a structured list of blockers and is granted a bounded number of repair attempts (max 2–3). If the Worker fails to resolve blockers, execution escalates back to the Master Agent to re-plan the approach, preventing infinite worker retry thrashing.

### Workstream 2: Dynamic Mode Gate (Solo Agent vs. Multi-Agent Team)
- **Problem**: Multi-agent delegation (Master $\rightarrow$ Worker $\rightarrow$ Verifier) introduces latency and burns ~10-15× token compute. For tightly coupled tasks (e.g. multi-file refactoring or quick script fixes), a single unified agent outperforms a fragmented team.
- **Dynamic Mode Gate**: The Master Agent analyzes the prompt complexity and chooses between:
  - `solo`: Unified single-agent execution (`local_master.txt` pattern with host tools) for sequential, coupled, or lightweight tasks.
  - `team`: Hierarchical multi-agent delegation for broad, parallel, research-heavy, or high-risk tasks requiring independent verification.

### Workstream 3: Three Permission Modes & Fast Triage AI Sentinel (P2)
- **Three Core Modes**:
  | Mode | Behavior |
  |---|---|
  | **Strict** | Interactive UI Approval Card required for all filesystem writes, shell commands, and browser mutations. |
  | **Unrestricted** | Zero approval cards; fully autonomous execution (used in headless eval runs or trusted sandboxes). |
  | **Smart** | Hard deny/always-ask rules for dangerous operations + fast triage AI for routine actions. |
- **Smart Triage Sentinel (TypeSafe Jev / Llama Guard 3)**:
  - Fast, low-latency classifier (~70–500ms) evaluating tool actions against safety policy.
  - Calibrated confidence routing:
    - *High-confidence safe* $\rightarrow$ auto-allow without card.
    - *Suspect / intermediate confidence* $\rightarrow$ render interactive Permission Card.
    - *Forbidden* $\rightarrow$ halt action immediately and return structured failure feedback explaining policy violation.

### Workstream 4: Native Image Generation & Editing Directives (P3)
- **Directives**: Add `Directive::GenerateImage` and `Directive::EditImage` to `orchestrator.rs` and `chat.rs`.
- **Wire Integration**: Wire to OpenAI-compatible image endpoints (`POST /v1/images/generations` and `/v1/images/edits`) via ChatLLM / user-configured models.
- **Output & Inspection**: Generated artifacts save directly into `<task_workspace>/artifacts/` or `attachments/`, with optional follow-up inspection via `Directive::AnalyzeVisual`.

### Workstream 5: Hybrid Credit Accounting System
- **Real-Time Unit-to-Credit Estimation**: Map token units to ChatLLM credits using the discovered $100:1$ internal points per credit ratio (`2,000,000 points = 20,000 credits`). Display instant estimates per message and task.
- **Authoritative Account Balance Sync**: Implement an authenticated background request to ChatLLM's `_getUserInfo` endpoint to fetch authoritative monthly spend and remaining balance, periodically recalibrating the local ledger.

---

## 6. Deferred Capabilities & Future Enhancements

The following features and architectures were evaluated, aligned on, and **explicitly deferred** to subsequent milestones to prioritize core execution stability and benchmark verification:

### Subsystem A: Context, Memory & Compaction
1. **Deferred: Active Chat Compactor / Rolling Summarizer**
   - **Description**: Automated rolling summarization of older conversation turns in long multi-turn sessions (>50k tokens) into a durable compressed memory anchor in SQLite and prompt context.
   - **Reason Deferred**: Current tasks are scoped cleanly to isolated task workspaces. Context safety caps and the 500-line safety cap on `read_file` prevent context bloat for current workloads.

2. **Deferred: Automatic Large-Prompt Chunking & Summarization Pipeline**
   - **Description**: Automatically breaking massive user prompts into multiple chunks and summarizing them before sending to the model.
   - **Reason Deferred**: Modern model context windows (32k+ tokens) comfortably accommodate long user inputs. A prompt length counter (`chars`) in `App.jsx` was implemented instead to inform users without blocking them.

3. **Deferred: Massive Chat Virtualization & SQLite Compaction**
   - **Description**: Virtualized message rendering (`react-window`) for 1,000+ message histories, along with background SQLite `VACUUM` compaction and archival export.
   - **Reason Deferred**: Active chat sessions remain highly responsive under normal workloads (<300 messages).

### Subsystem B: Multi-Agent Architecture & Concurrency
4. **Deferred: Dynamic Sub-Worker Spawning & Multi-Worker Concurrency (Parallel Swarms)**
   - **Description**: Spawning multiple isolated worker sandboxes simultaneously for concurrent subtask execution (e.g., 3 parallel web research workers or concurrent code generators).
   - **Reason Deferred**: Sequential Master-Worker delegation guarantees deterministic SQLite sequence ordering (`seq`) and prevents resource contention. Parallel swarms will be introduced once worker state isolation is hardened.

5. **Deferred: Dedicated Worker Live Chat Tab & Inspector UI**
   - **Description**: A dedicated collapsible drawer or tab in the UI allowing users to view live worker-verifier sub-conversations, directive streams, and feedback loops in real time.
   - **Reason Deferred**: Worker cards and execution status updates in the main chat already convey active progress without cluttering the UI with multi-pane complexity.

### Subsystem C: Security, Gatekeeper & Approvals
6. **Deferred: Semantic Caching Engine for Network & Gatekeeper Permissions**
   - **Description**: Caching user approval verdicts in a dedicated SQLite table (`watcher_cache`) based on request semantics (Domain + HTTP Method + Path similarity score), automatically allowing repeated safe API calls across tasks without user friction.
   - **Reason Deferred**: Domain-level approval caching in `gatekeeper.rs` was implemented and verified during the benchmark run, which cleanly eliminates repeated approval cards for active sessions without requiring complex similarity scoring.

7. **Deferred: Encrypted Cookie Vault Management UI**
   - **Description**: A dedicated tab in Settings to view, search, export, delete, or import stored domain session cookies from SQLite `cookie_vault`.
   - **Reason Deferred**: Cookie persistence is currently handled via direct browser profile cloning (`.zeus/parent_browser_profile`), which works seamlessly without requiring extra UI.

8. **Deferred: Watcher AI Infinite Loop Circuit Breaker & Strategy Pivoting**
   - **Description**: Proactive heuristic detection of circular reasoning or repetitive tool loops (e.g. repeated Cloudflare blocks) to force a strategy pivot before burning tokens.
   - **Reason Deferred**: Step caps (300 steps), run timeouts, and budget limits already protect against runaway execution. Advanced circular heuristic detection will be added in P5.

### Subsystem D: Budget, Accounting & Model Strategy
9. **Deferred: Dynamic Multi-Tier Model Switching by Remaining Budget**
   - **Description**: Dynamically escalating or demoting model tiers (e.g. falling back to a cheaper model when budget drops below 20%) based on budget yield curves.
   - **Reason Deferred**: Dynamically changing model tiers mid-task introduces behavioral unpredictability into multi-agent task execution. Calibration will occur post-hybrid-ledger.

10. **Deferred: ChatLLM Playwright Headless Web Scraping for Credits**
    - **Description**: Scraping the ChatLLM web dashboard using headless Playwright sessions to check account point balances.
    - **Reason Deferred**: Scraping web dashboards via headless browsers is fragile, resource-heavy, and slow.
    - **Alternative Adopted**: Clean hybrid strategy: real-time $100:1$ ratio for immediate UI feedback + direct authenticated background request to `_getUserInfo` endpoint for authoritative Settings display.

### Subsystem E: UI Organization & Developer Tooling
11. **Deferred: Sidebar Task Grouping & Sub-Task Hierarchy (Projects & Epics)**
    - **Description**: Organizing tasks in the left sidebar into hierarchical folders/projects (e.g. "E-commerce Redesign" containing subtasks "Backend ETL", "Frontend UI", "API Verification").
    - **Reason Deferred**: The flat task list with quick search, renaming, and deletion is fast, stable, and sufficient for current usage patterns.

12. **Deferred: User Workflow Skill Distillation System**
    - **Description**: One-click automated UI action to convert completed multi-turn tasks into reusable, versioned agent skills (`.agents/skills/<name>/SKILL.md`).
    - **Reason Deferred**: Manual skill authoring is currently established. Automated distillation requires robust multi-turn workflow serialization.

13. **Deferred: Multi-Window & Deep Desktop OS Automation Hooks**
    - **Description**: Native OS window targeting, window focus management, and multi-display screenshot capture.
    - **Reason Deferred**: Web and file tasks represent 95%+ of user workflows. Native window management will be addressed in P4 desktop extensions.
