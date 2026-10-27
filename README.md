# Zeus Agent ⚡

> **An observable, recoverable, and secure desktop autonomous-agent runtime.**

Zeus Agent is a desktop autonomous-agent runtime for open-ended computer tasks. It plans, delegates, compiles code, runs terminal commands, manages workspaces, and automates browsers, with permission checks and a durable SQLite execution journal. The current development priority is stabilizing those capabilities and measuring reliability.

---

## 🛠️ Technology Stack

- **Backend Runtime**: Rust, [Tauri 2.0](https://tauri.app/), Tokio (asynchronous orchestration and process management).
- **Frontend Interface**: React 18, Vite, Lucide Icons, `react-markdown`.
- **Database & State**: SQLite (`rusqlite`) — serves as the authoritative, durable source of truth for message existence, deterministic sequence ordering, and task recovery.
- **LLM Gateway**: Multi-provider client (`reqwest`) supporting OpenAI Responses API (`/v1/responses`), Chat Completions (`/v1/chat/completions`), Abacus AI RouteLLM, Google Gemini, Xiaomi MiMo, and local endpoints (Ollama / `llama.cpp`).
- **Browser Automation**: Playwright with profile cloning, anti-bot stealth flags, and an encrypted on-disk Cookie Vault.
- **Security & Secrets**: Windows Credential Manager for API tokens (zero plaintext secrets in SQLite or git).

---

## 🚀 Getting Started

### Prerequisites

- **Node.js**: v22 (used by CI)
- **Rust**: 1.94.1 (CI toolchain), with Cargo and the Windows MSVC build tools
- **Python**: 3.10+ (for dynamic script execution sandboxes)
- **OS**: Windows 10/11 (with Windows Credential Manager support)

### Installation & Development

1. **Clone the repository**:
   ```bash
   git clone https://github.com/DonPull/Zeus-Agent.git
   cd Zeus-Agent
   ```

2. **Install frontend dependencies**:
   ```bash
   npm install
   ```

3. **Run the desktop app in development mode**:
   ```bash
   npm run tauri dev
   ```

4. **Run offline regression checks**:
   ```bash
   npm run build
   npm run test:regression
   # Validate reporting with controlled passes and failures, without model calls
   npm run eval:demo
   # Inspect a capability evaluation configuration without running it
   npm run bench:smoke -- --dry-run
   ```

   Offline checks use isolated workspaces and a loopback mock provider. Live evaluations require explicit opt-in and can consume hosted credits. See the [evaluation guide](scripts/eval_harness/README.md) for commands, coverage, and limitations.

5. **Configure API Keys / Endpoints**:
   - Click the **Settings** (⚙️) icon in the UI.
   - Enter your API keys (RouteLLM, Gemini, or Xiaomi MiMo) or point **Local Base URL** to your local model server (e.g. `http://localhost:11434/v1`).
   - All credentials are automatically encrypted in Windows Credential Manager.

---

## 📚 Documentation

For in-depth architecture, design invariants, implementation roadmaps, and evaluation history, refer to:

- [**`docs/IMPLEMENTATION_PLAN.md`**](docs/IMPLEMENTATION_PLAN.md): Current agreed stabilization plan and delivery order; takes precedence over historical milestone claims.

- [**`docs/PRODUCT_VISION.md`**](docs/PRODUCT_VISION.md): Core vision, user autonomy model, non-negotiable architectural invariants, and engineering principles.
- [**`docs/SYSTEM_ARCHITECTURE.md`**](docs/SYSTEM_ARCHITECTURE.md): Comprehensive technical specification covering the Dual Execution Engine, LLM Gateway, Watcher AI, Gatekeeper, Python Sandbox, and IPC Bridge contract.
- [**`ROADMAP.md`**](ROADMAP.md): Completed milestone registry, active implementation phases, and complete backlog of planned features and workstreams.
- [**`FINAL_EVAL_REPORT.md`**](FINAL_EVAL_REPORT.md): Executive summary and results matrix for the 10/10 Agentic Benchmark Suite.
- [**`scripts/eval_harness/README.md`**](scripts/eval_harness/README.md): Guide to the automated evaluation harness, scoring rubrics, and dashboard telemetry.
