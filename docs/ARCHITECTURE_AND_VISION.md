# Zeus Agent — Architecture & Vision Master Guide

This master reference outlines the philosophy, design invariants, and technical subsystems of the Zeus Agent runtime.

---

## 1. Primary Documentation References
- **Product Vision & Core Invariants**: [`docs/PRODUCT_VISION.md`](file:///d:/Hristian%20projects/Zeus-Agent/docs/PRODUCT_VISION.md)
- **Technical Subsystem Architecture**: [`docs/SYSTEM_ARCHITECTURE.md`](file:///d:/Hristian%20projects/Zeus-Agent/docs/SYSTEM_ARCHITECTURE.md)
- **Self-Improvement Harness Specification**: [`.agents/SELF_IMPROVEMENT_HARNESS.md`](file:///d:/Hristian%20projects/Zeus-Agent/.agents/SELF_IMPROVEMENT_HARNESS.md)

---

## 2. Core Architectural Pillars

### 1. Authoritative SQLite & Durability
- SQLite is the authoritative source of truth.
- **Persist-Before-Emit**: Every message receives its immutable `seq` rowid in SQLite before frontend event emission.
- **Backend Owns Visibility**: The frontend renders what the backend commits using the `visible` flag.

### 2. Dual Execution Engine (Cloud vs. Local)
- **Cloud API Mode**: Multi-agent hierarchy (Master plans, Worker executes, Verifier validates).
- **Local Model Mode**: Unified Single-Agent (`local_master.txt`) directly executing host directives for maximum VRAM/compute efficiency on consumer PCs.

### 3. Browser Automation & The Watcher AI
- Profile cloning from `.zeus/parent_browser_profile` with stealth anti-bot protections.
- **Watcher AI**: Cognitive safety layer inspecting DOM intent to auto-allow benign interactions while intercepting high-risk actions (purchases, account changes) as interactive Permission Cards.

### 4. Gatekeeper Security & Least Privilege
- Hierarchical file permissions (`task:<task_id>` over `global`) with exact, prefix, and regex matches.
- Automated developer command whitelisting (`cargo`, `npm`, `npx playwright`, `git`, `python`, `node`, `pytest`, `dir`) with composite command parsing.

### 5. Settings Isolation (Global vs. Task-Scoped)
- **True Global Settings**: API keys (Windows Credential Manager) and service endpoints.
- **Chat Defaults**: Default models and credit budgets inherited upon task creation.
- **Task-Scoped Settings**: Independent task-level model selection, budget limits, and file/command permission overrides.

---

## 3. Engineering & Self-Refinement Mindset
When diagnosing benchmark failures:
1. **Analyze the Root Cause**: Ask why the failure occurred (directive format, capability gap, Gatekeeper policy, context clutter, or timeout).
2. **Design Systemic Solutions**: Implement general improvements in `src-tauri/src/` or `src-tauri/src/prompts/` that benefit all tasks.
3. **Never Hardcode Hacks**: Never write prompt-specific conditional logic. Keep the engine general, robust, and autonomous.
