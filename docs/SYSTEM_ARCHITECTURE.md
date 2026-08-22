# Zeus Agent — Technical Subsystem Architecture

This document provides detailed specifications of the core subsystems in the Zeus Agent desktop runtime.

---

## 1. Dual Execution Paradigm: Cloud API vs. Local Model

Zeus dynamically adapts its agent architecture depending on the execution environment:

### A. Cloud API Mode (Multi-Agent Hierarchy)
When powered by cloud LLMs (via RouteLLM / Gemini API):
- **Master Agent**: Analyzes user prompts, creates dynamic Action Plans, and delegates constrained sub-tasks to Workers.
- **Worker Agents**: Specialized single-purpose sub-agents that run isolated Python scripts, file operations, or web searches without seeing full orchestrator clutter.
- **Verifier Agent**: Automatically inspects the worker's outputs and code execution results against explicit success criteria before marking the sub-task complete.

### B. Local Model Mode (Unified Single-Agent Master)
Running 3 to 4 distinct 27B+ parameter models concurrently on a single PC is impractical due to consumer VRAM and compute constraints.
- **Unified Master (`src-tauri/src/prompts/local_master.txt`)**: All planning, directive execution, verification, and code synthesis collapse into a single, high-efficiency autonomous agent.
- The Local Master has direct access to host directives (`read_file`, `write_file`, `delete_file`, `list_dir`, `search_files`, `run_command`, `run_action`) and executes them directly in sequence without multi-agent IPC overhead.

---

## 2. Browser Automation, Cookie Vault & The Watcher AI

### A. Stealth Browser & Profile Isolation
- **Profile Cloning**: Clones the user's base Chrome/Brave profile from `.zeus/parent_browser_profile` into task-isolated workspaces (`tasks/<task_id>/browser_profile`).
- **Stealth & Anti-Bot Protection**: Launches with anti-detection flags, custom window fingerprints, and pre-loaded extensions so automated browsing does not get blocked by Cloudflare or bot guards.
- **Cookie Vault**: Encrypted on-disk credential store that allows Zeus to securely authenticate against pre-logged sessions without exposing plain-text passwords.

### B. The Watcher AI (Non-Deterministic Safety Interceptor)
Standard static URL allowlists are insufficient for modern dynamic web applications. The **Watcher AI** acts as a cognitive security layer:
- **Real-Time DOM & Intent Inspection**: Before the agent clicks a button, submits a form, or executes a web automation step, the Watcher AI inspects the DOM element, context, and intent.
- **Non-Deterministic Policy Enforcement**:
  - *Safe Actions (Auto-Allowed)*: Scrolling, searching, reading articles, navigating public documentation.
  - *High-Risk Actions (Intercepted)*: Financial transactions, account deletions, password changes, sensitive data uploads, or making public social media posts.
- **Interactive Permission Cards**: When a high-risk action is detected, the Watcher halts execution and presents an interactive **Approval Card** in the chat UI, requiring the user to explicitly approve or deny the action before the browser proceeds.

---

## 3. Gatekeeper Security & Capability System

The Gatekeeper enforces the principle of least privilege across the host computer:

### A. File Permissions Hierarchy
- **Scopes**: Evaluated hierarchically: `task:<task_id>` (highest priority) $\rightarrow$ `global` (fallback).
- **Actions**: `allow` or `deny`.
- **Operations**: `read`, `write`, `delete`.
- **Match Types**:
  - `exact`: Precise file path match.
  - `prefix`: Applies recursively to directories and all sub-files.
  - `regex`: Custom regex path patterns.

### B. Command Execution & Safe Developer Whitelist
- Commands are evaluated against pre-approved safe prefixes (`cargo`, `npm`, `npx playwright`, `git`, `python`, `node`, `pytest`, `dir`, etc.).
- **Composite & Chained Commands**: Commands containing chaining operators (`&&`, `;`, `|`, `>`) are automatically decomposed and validated against safe tools.
- **Evaluation & Local Mode Auto-Allow**: In benchmark evaluation mode (`ZEUS_EVAL_MODE=1` or local model mode), standard developer tooling is auto-allowed to facilitate autonomous test execution and code self-refinement without prompting permission cards.

---

## 4. Settings Architecture: Global vs. Chat-Scoped

Settings are cleanly partitioned between system-level configuration and task-specific overrides:

```
┌────────────────────────────────────────────────────────┐
│ Global Settings Modal (src/components/SettingsModal.jsx)│
├──────────────────────────┬─────────────────────────────┤
│   True Global Settings   │        Chat Defaults        │
│ • RouteLLM API Key       │ • Default Master Model      │
│ • Gemini API Key         │ • Default Worker Model      │
│ • Local Model Base URL   │ • Default Verifier Model    │
│ • Windows Credential Mgr │ • Default Credit Budget     │
│ • Browser Executable Path│ • Default Browser Mode      │
└──────────────────────────┴──────────────┬──────────────┘
                                          │ Inherited on task creation
                                          ▼
┌────────────────────────────────────────────────────────┐
│ Task-Scoped Settings Modal (TaskSettingsModal.jsx)     │
├────────────────────────────────────────────────────────┤
│ • Task Master Model Override                           │
│ • Task Credit Budget Limit Override                    │
│ • Task Browser Mode (Sandboxed vs. System)             │
│ • Task-Scoped File & Command Permissions               │
└────────────────────────────────────────────────────────┘
```

1. **True Global Settings**: Stored securely in Windows Credential Manager and system tables (API keys, backend URLs, browser binary paths).
2. **Chat Defaults**: Configured in Global Settings to define initial values for new tasks.
3. **Chat-Scoped Settings & Permissions**: Every individual chat/task can independently override models, budgets, and security permissions without altering global system defaults.

---

## 5. Architectural Self-Refinement Protocol

When benchmarking or self-improving the runtime:
- **Diagnose Root Causes**: Analyze whether failures stem from directive parsing, missing host capabilities, Gatekeeper rules, context clutter, or timeouts.
- **Design Systemic Solutions**: Update `src-tauri/src/` or `src-tauri/src/prompts/` to permanently fix the underlying deficiency for all future tasks.
- **Zero Test-Specific Hacks**: Never hardcode test prompt names or mock answers. Keep the runtime general and autonomous.
