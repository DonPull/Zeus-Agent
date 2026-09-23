# Zeus Agent ⚡

> **An observable, recoverable, and secure desktop autonomous-agent runtime.**

Zeus Agent is a desktop autonomous-agent runtime engineered to execute open-ended, complex computer tasks autonomously on the host operating system. Unlike simple chatbots or script runners, Zeus Agent plans, delegates, compiles code, runs terminal commands, manipulates workspaces, and automates real web browsers while enforcing strict zero-trust permission boundaries.

---

## 🌟 Key Capabilities

- **Dual Execution Engine**:
  - **Cloud Multi-Agent Hierarchy**: A Master Agent orchestrates, Worker Agents execute constrained sub-tasks in parallel, and a Verifier Agent validates success criteria before completion.
  - **Local Model Single-Agent Mode**: When running against local endpoints (e.g. `llama.cpp` / `Ollama`), Zeus collapses planning, tool execution, and verification into a unified single-agent engine (`local_master.txt`) to maximize consumer VRAM and compute efficiency.
- **Authoritative SQLite Engine**:
  - Pure **Persist-Before-Emit** architecture: Every thought, directive, state change, and message is durably committed to SQLite before being emitted to the frontend.
  - Complete crash resilience: Tasks resume cleanly with full audit history and deterministic sequence ordering (`seq`).
- **Zero-Trust Gatekeeper & The Watcher AI**:
  - Hierarchical file permissions (`task:<id>` $\rightarrow$ `global`) across read, write, and delete operations.
  - Automated developer command whitelisting (`cargo`, `npm`, `npx playwright`, `git`, `python`, `node`, `pytest`, `dir`) with recursive composite command decomposition.
  - **The Watcher AI**: Cognitive security layer that inspects web browser DOM elements and intent in real time, auto-allowing benign actions while halting and emitting interactive **Approval Cards** for sensitive actions (payments, authentication, account deletion).
- **Stealth Browser Automation**:
  - Profile cloning from `.zeus/parent_browser_profile` into isolated task sandboxes.
  - Anti-bot stealth protections and an encrypted on-disk **Cookie Vault** for session re-use without credential exposure.
- **Model Selection & Reasoning Effort Control**:
  - Integrated with **Abacus AI RouteLLM**, **Google Gemini**, and local OpenAI-compatible endpoints.
  - Flexible per-role model assignments (Master, Worker, Verifier, Watcher).
  - Configurable **Reasoning Effort Levels** (`low`, `medium`, `high`) for reasoning models (e.g. OpenAI `o-series`, `gpt-5`, DeepSeek-R1, Qwen-Thinking) to balance task intelligence against latency and token budget consumption.
- **Autonomous Benchmark Verified**:
  - 100% pass rate (10 / 10) on the Zeus Agentic Benchmark suite covering complex multi-turn scenarios (data analysis, ETL pipelines, bug repair, creative design, financial reconciliation, and log diagnostics).

---

## 🏗️ System Architecture

```
┌────────────────────────────────────────────────────────┐
│             React 18 + Vite Frontend                   │
│ (Virtual Chat, Permission Cards, Task & Global Modals) │
└──────────────────────────┬─────────────────────────────┘
                           │ src/bridge/index.js (Tauri IPC)
┌──────────────────────────▼─────────────────────────────┐
│                 Rust Core Runtime                      │
│                                                        │
│  ┌────────────────┐  ┌────────────────┐  ┌──────────┐  │
│  │  Orchestrator  │  │   Gatekeeper   │  │ Watcher  │  │
│  │ (ActiveGuard)  │  │ (Permissions)  │  │   AI     │  │
│  └───────┬────────┘  └───────┬────────┘  └────┬─────┘  │
│          │                   │                │        │
│          ▼                   ▼                ▼        │
│  ┌──────────────────────────────────────────────────┐  │
│  │            Authoritative SQLite Journal          │  │
│  └──────────────────────────┬───────────────────────┘  │
│                             │                          │
│  ┌──────────────────────────▼───────────────────────┐  │
│  │              LLM Gateway (gateway.rs)            │  │
│  │ • Responses API (`/v1/responses` with reasoning) │  │
│  │ • Chat Completions (`/v1/chat/completions`)      │  │
│  │ • RouteLLM / Abacus AI / Gemini / Local Endpoints│  │
│  └──────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────┘
```

---

## 🚀 Getting Started

### Prerequisites
- **Node.js**: v18 or later
- **Rust**: 1.75+ (Cargo)
- **Python**: 3.10+ (for dynamic tool sandboxing)
- **OS**: Windows 10/11 (with Windows Credential Manager support)

### Installation & Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/DonPull/Zeus-Agent.git
   cd Zeus-Agent
   ```

2. **Install frontend dependencies**:
   ```bash
   npm install
   ```

3. **Run in development mode**:
   ```bash
   npm run tauri dev
   ```

4. **Configure API Keys / Endpoints**:
   - Open the **Settings Modal** (⚙️ icon in the UI).
   - Enter your **Abacus.AI RouteLLM API Key** or **Google Gemini API Key** (securely saved in Windows Credential Manager).
   - Alternatively, point **Local Base URL** to your local model server (e.g. `http://localhost:11434/v1`).

---

## 🧠 Model Selection & Reasoning Effort

Zeus Agent supports dynamic model routing and fine-grained computational effort:
- **Wire Protocols**:
  - Reasoning families (OpenAI `o1`, `o3`, `o3-mini`, `gpt-5`) communicate via the modern `/v1/responses` endpoint with structured reasoning summary streaming.
  - Standard chat models communicate via `/v1/chat/completions`.
- **Reasoning Effort Control**:
  - `low`: Minimal thinking budget; optimal for rapid scripting, formatting, and file retrieval. Reduces token costs by 50-80%.
  - `medium`: Balanced reasoning depth for general coding and analysis.
  - `high`: Maximum compute budget; unlocks extended hidden chain-of-thought for deep bug localization, complex refactoring, and multi-step logic.

---

## 📚 Documentation Index

| Document | Description |
|---|---|
| [**`docs/PRODUCT_VISION.md`**](file:///docs/PRODUCT_VISION.md) | High-level product vision, user autonomy model, and core invariants |
| [**`docs/SYSTEM_ARCHITECTURE.md`**](file:///docs/SYSTEM_ARCHITECTURE.md) | Deep technical architecture of all backend and frontend subsystems |
| [**`docs/ARCHITECTURE_AND_VISION.md`**](file:///docs/ARCHITECTURE_AND_VISION.md) | Master guide bridging vision, engineering pillars, and execution paradigms |
| [**`EVAL_STATUS.md`**](file:///EVAL_STATUS.md) | Complete prompt-by-prompt status of the 10/10 Agentic Benchmark Suite |
| [**`FINAL_EVAL_REPORT.md`**](file:///FINAL_EVAL_REPORT.md) | Executive evaluation benchmark summary and systemic hardening achievements |
| [**`.agents/AGENTS.md`**](file:///.agents/AGENTS.md) | Invariant architectural rules, tech stack boundaries, and implementation roadmap |
| [**`.agents/SELF_IMPROVEMENT_HARNESS.md`**](file:///.agents/SELF_IMPROVEMENT_HARNESS.md) | Autonomous benchmark harness specification and evaluation protocol |
| [**`BRIDGE.md`**](file:///BRIDGE.md) | Strict UI ↔ Rust Core IPC bridge contract |
| [**`zeus_project_handover.md`**](file:///zeus_project_handover.md) | Comprehensive engineering handover guide for incoming developers |

---

## 🛡️ Security Invariants

1. **SQLite is Authoritative**: The frontend never invents durable messages; it only projects SQLite state.
2. **Persist-Before-Emit**: No message event is emitted before obtaining a durable database sequence ID (`seq`).
3. **No Database Mutex Across Network I/O**: SQLite connection locks are strictly dropped before awaiting HTTP requests or LLM streams.
4. **Task-Scoped Active Runs**: Strict single-flight execution prevents race conditions and runaway concurrency.
5. **Zero Plaintext Secrets**: All API tokens reside in Windows Credential Manager.
