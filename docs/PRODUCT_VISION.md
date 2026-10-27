# Zeus Agent — Product Vision & Core Invariants

## 1. High-Level Vision
Zeus Agent is a **desktop autonomous agent runtime** engineered to perform complex, open-ended real-world missions directly on the host computer without human babysitting.

Unlike traditional chatbots or simple script wrappers, Zeus Agent:
- **Plans & Executes Autonomously**: Decomposes ambiguous user goals into concrete actions, runs shell commands, writes code, manages files, drives real web browsers, and analyzes results.
- **Adapts to Available Compute**: Seamlessly shifts between a cloud-powered multi-agent hierarchy (Master $\rightarrow$ Workers $\rightarrow$ Verifier) and a lightweight, unified single-agent engine (`local_master.txt`) for local model execution on consumer hardware.
- **Controls Intelligence vs. Cost (Reasoning Effort)**: Empowers the user to govern model compute intensity (`low`, `medium`, `high` reasoning effort) across modern reasoning models, matching the model's cognitive budget to the complexity of the mission.
- **Enforces Controlled Safety**: Operates within strict Gatekeeper permission boundaries and the Watcher AI, isolating file access and preventing unintended system modifications or sensitive web actions.
- **Guarantees Observability & Recovery**: Durably logs every state transition, thought, tool execution, and output to SQLite before rendering to the UI. If a crash or power cut occurs, the entire state is immediately recoverable.

---

## 2. Core Architectural Invariants (DO NOT BREAK)

1. **SQLite is Authoritative**: SQLite is the single source of truth for message existence, sequence ordering, visibility, and task state.
2. **Persist Before Emit**: Every message must be inserted into SQLite to receive its authoritative `rowid` (`seq`) BEFORE emitting events to the frontend.
3. **Backend Owns Visibility**: The frontend never parses content to hide messages. It strictly trusts the backend's `visible` flag (`1` or `0`).
4. **Stable Sequence Ordering**: The frontend upserts messages by `id` and sorts deterministically by `seq`.
5. **No Optimistic Frontend Messages**: The frontend never invents chat bubbles. It only renders what the backend durably commits.
6. **Task-Scoped Active Runs**: `ActiveRunGuard` enforces a strict single-flight execution loop per task.
7. **Task-Scoped Cancellation**: `CancellationToken` gracefully drops running models, HTTP streams, and child processes immediately upon user cancellation.
8. **No DB Mutex Across I/O**: The SQLite connection lock (`state.db.lock()`) must ALWAYS be dropped before awaiting LLM HTTP streams, network requests, or external processes.
9. **Bridge Boundary Isolation**: React components never call Tauri commands directly; all communication routes through `src/bridge/index.js`.
10. **Secret Security Invariant**: API keys and external credentials must reside in the Windows Credential Manager or local keychain—never in plaintext SQLite tables or source repositories.

---

## 3. Historical Benchmark Exercises

Zeus Agent is validated against an intensive 10-prompt agentic benchmark suite covering real-world workflows:
- Localized marketing asset generation & image rendering
- Institutional financial equity due diligence
- Dynamic SQLite database schema migrations & ETL pipelines
- External project bug localization & off-by-one test repair
- Multi-turn brand guidelines memory anchoring
- Resilient web scraping, data aggregation, and visualization
- Recursive filesystem traversal & fuzzy financial reconciliation
- Creative UI layout specification & programmatic asset synthesis
- High-volume incident server log diagnostics & automated remediation
- Long-running autonomous multi-stage workflow execution

An earlier development report claimed a **100% pass rate (10 / 10)** on these exercises. That result does not establish production reliability or comparable performance across local and cloud models. The current [development plan](IMPLEMENTATION_PLAN.md) replaces that assumption with offline regression checks and a separately designed, reproducible capability benchmark. See the [evaluation guide](../scripts/eval_harness/README.md) for current measurement contracts and limits.

---

## 4. Engineering & Self-Refinement Principles

When diagnosing benchmark failures, resolving bugs, or expanding runtime capabilities:
1. **Analyze the Root Cause**: Determine why the deficiency occurred (directive deserialization, relative workspace path error, Gatekeeper permission scope, context clutter, or timeout).
2. **Design Systemic Solutions**: Implement general improvements in `src-tauri/src/` or `src-tauri/src/prompts/` that benefit all tasks and workflows.
3. **Never Hardcode Hacks**: Never write prompt-specific conditional logic or mock answers. Keep the engine general, robust, and autonomous.

---

## 5. Documentation Navigation

- **Technical Subsystems & Implementations**: [`docs/SYSTEM_ARCHITECTURE.md`](file:///docs/SYSTEM_ARCHITECTURE.md)
- **Roadmap, Milestones & Feature Backlog**: [`ROADMAP.md`](file:///ROADMAP.md)
- **Agent Rules & Invariants**: [`.agents/AGENTS.md`](file:///.agents/AGENTS.md)
- **Evaluation Status Ledger**: [`EVAL_STATUS.md`](file:///EVAL_STATUS.md)
- **Benchmark Milestone Report**: [`FINAL_EVAL_REPORT.md`](file:///FINAL_EVAL_REPORT.md)

