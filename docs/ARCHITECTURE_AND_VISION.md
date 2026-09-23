# Zeus Agent — Architecture & Vision Master Guide

This master reference outlines the philosophy, design invariants, and technical subsystems of the Zeus Agent runtime.

---

## 1. Primary Documentation References
- **Product Vision & Core Invariants**: [`docs/PRODUCT_VISION.md`](file:///docs/PRODUCT_VISION.md)
- **Technical Subsystem Architecture**: [`docs/SYSTEM_ARCHITECTURE.md`](file:///docs/SYSTEM_ARCHITECTURE.md)
- **Evaluation Status & Benchmark History**: [`EVAL_STATUS.md`](file:///EVAL_STATUS.md)
- **Executive Benchmark Report**: [`FINAL_EVAL_REPORT.md`](file:///FINAL_EVAL_REPORT.md)
- **Self-Improvement Harness Specification**: [`.agents/SELF_IMPROVEMENT_HARNESS.md`](file:///.agents/SELF_IMPROVEMENT_HARNESS.md)
- **Project Rules & Invariants**: [`.agents/AGENTS.md`](file:///.agents/AGENTS.md)

---

## 2. Core Architectural Pillars

### 1. Authoritative SQLite & Durability
- SQLite is the authoritative source of truth for message existence, ordering, and task lifecycle.
- **Persist-Before-Emit**: Every message receives its immutable `seq` rowid in SQLite before frontend event emission.
- **Backend Owns Visibility**: The frontend renders what the backend commits using the `visible` flag.
- **No Optimistic Frontend Messages**: State cannot diverge because the frontend never fabricates transient bubbles.

### 2. Dual Execution Engine (Cloud vs. Local)
- **Cloud API Mode**: Multi-agent hierarchy (Master plans, Worker executes in parallel sandboxes, Verifier validates output against success criteria).
- **Local Model Mode**: Unified Single-Agent (`local_master.txt`) directly executing host directives (`read_file`, `write_file`, `run_command`, etc.) for maximum VRAM and compute efficiency on consumer PCs.

### 3. Model Strategy & Reasoning Effort Governance
- Supports **Abacus AI RouteLLM**, **Google Gemini**, and local OpenAI-compatible endpoints.
- **Reasoning Effort Levels** (`low`, `medium`, `high`):
  - Injects `reasoning_effort` (Chat Completions) or `reasoning: { "effort": "..." }` (Responses API).
  - Gives users granular control over the intelligence vs. cost trade-off. Low effort reduces hidden reasoning token spend and latency by 50–80% for simple tasks; high effort unlocks deep chain-of-thought exploration for complex algorithmic problems and debugging.

### 4. Browser Automation & The Watcher AI
- Profile cloning from `.zeus/parent_browser_profile` into task workspaces with stealth anti-bot protections.
- **Watcher AI**: Cognitive safety layer inspecting DOM intent to auto-allow benign interactions while intercepting high-risk actions (purchases, account changes, credential updates) as interactive Permission Cards.
- Encrypted **Cookie Vault** enables authenticated sessions without hardcoded secrets.

### 5. Gatekeeper Security & Least Privilege
- Hierarchical file permissions (`task:<task_id>` over `global`) with exact, prefix, and regex matches.
- Automated developer command whitelisting (`cargo`, `npm`, `npx playwright`, `git`, `python`, `node`, `pytest`, `dir`) with composite command parsing.
- Auto-authorization of workspace session files created by the agent during task execution.

### 6. Settings Isolation (Global vs. Task-Scoped)
- **True Global Settings**: API keys (Windows Credential Manager) and service endpoints.
- **Chat Defaults**: Default models, reasoning effort levels, and credit budgets inherited upon task creation.
- **Task-Scoped Settings**: Independent task-level model selection, effort level overrides, budget limits, and file/command permission overrides.

---

## 3. Engineering & Self-Refinement Mindset
When diagnosing benchmark failures or expanding runtime capabilities:
1. **Analyze the Root Cause**: Ask why the deficiency occurred (directive format, capability gap, Gatekeeper policy, context clutter, or timeout).
2. **Design Systemic Solutions**: Implement general improvements in `src-tauri/src/` or `src-tauri/src/prompts/` that benefit all tasks.
3. **Never Hardcode Hacks**: Never write prompt-specific conditional logic or mock answers. Keep the engine general, robust, and autonomous.
