# Zeus Agent — Project Notes

## Core Philosophy
Zeus Agent is a desktop autonomous-agent runtime capable of handling open-ended user requests. It enforces controlled, recoverable, and observable agent behavior.
- **Master Agent**: Plans, delegates, and synthesizes.
- **Worker Agents**: Perform delegated, constrained sub-tasks autonomously.
- **Verifier**: Checks that worker output actually meets success criteria.
- **Watcher AI**: Cognitive safety layer inspecting DOM actions in real time.

## Architectural Invariants (DO NOT BREAK)
1. **SQLite is authoritative**: The database is the ultimate source of truth for message existence, ordering, and visibility.
2. **Persist before emit**: Every message must be inserted into SQLite to receive its authoritative `rowid` (`seq`) BEFORE being emitted to the frontend. 
3. **Backend owns visibility**: The frontend must not inspect content to decide if a message is hidden. Trust the `visible` flag (`1` or `0`).
4. **Stable sequence ordering**: The frontend upserts by ID and sorts by sequence (`seq`).
5. **No optimistic frontend messages**: The frontend must never invent durable-looking chat messages. It only renders what the backend provides.
6. **Task-scoped active runs**: `ActiveRunGuard` enforces a strict single-flight execution loop per task.
7. **Task-scoped cancellation**: Cancellation via `CancellationToken` must gracefully drop running models, tasks, and child processes (Python actions).
8. **No DB mutex over network I/O**: `AppState` uses `Mutex<Connection>`. The lock must ALWAYS be dropped before awaiting LLM streams or running external processes.
9. **Bridge boundary**: React components must not call Tauri commands directly; everything must route through `src/bridge/index.js`.
10. **Zero plaintext secrets**: External credentials are stored in Windows Credential Manager.

## Recent Implementation Progress & Milestones
- **Autonomous Benchmark Suite (10 / 10 Completed — 100% Pass Rate)**:
  - Validated across all 10 complex real-world prompts covering financial research, ETL pipeline migrations, bug repair, creative design, log diagnostics, and multi-turn workflows.
  - Hardened systemic engine fixes:
    - Fixed relative path handling across `orchestrator.rs` and `chat.rs` so all file directives target task workspaces reliably.
    - Added domain approval caching to eliminate redundant permission cards on repeated API endpoints.
    - Added multi-variant support (`result`, `summary`, `answer`) to `FinalAnswerSpec` to prevent unnecessary directive re-nudges.
    - Added auto-continuation loops in `chat.rs` for intermediate multi-step reasoning.
    - Truncated massive anti-bot block pages in raw HTTP responses to preserve model context windows.
    - Auto-whitelisted session files created by the agent in task workspaces.
- **Gatekeeper & Capabilities (P2)**:
  - Command pattern matching and composite command decomposition (`&&`, `;`, `|`).
  - Watcher AI DOM intent inspection and real-time Approval Cards in the chat UI.
- **Stealth Browser Tools (P4)**:
  - Profile cloning from `.zeus/parent_browser_profile` into task sandboxes.
  - Anti-bot stealth flags and on-disk Cookie Vault.

## Model Strategy & Reasoning Effort Level Governance (P3 Research)
- **Abacus AI RouteLLM Capability**:
  - The Abacus API supports `reasoning_effort` on its OpenAI-compatible `/v1/chat/completions` endpoint (`low`, `medium`, `high`).
  - On the `/v1/responses` endpoint (which Zeus Agent already uses in `gateway.rs` for OpenAI reasoning models like `o1`, `o3-mini`, `gpt-5`), reasoning effort is passed under `"reasoning": { "effort": "low" | "medium" | "high", "summary": "auto" }`.
  - Right now, `gateway.rs` hardcodes `"reasoning": { "summary": "auto" }` without specifying `effort`, meaning it defaults to upstream defaults (medium/high).
- **Token Economics & Latency**:
  - Reasoning tokens are billed as output tokens. For tasks like file searching, basic formatting, or executing fixed scripts, setting effort to `low` reduces token spend and latency by 50–80%.
  - High effort should be reserved for complex algorithmic debugging, deep refactorings, or extensive financial analysis.
- **UI & Gateway Architecture**:
  - Planned update: Add an Effort Level dropdown in `SettingsModal.jsx` (Global Default) and `TaskSettingsModal.jsx` (Task Override), and plumb `reasoning_effort` through `settings.rs` and `gateway.rs`.

## Thoughts on the "Actions/Skills" System
The concept of persistent, reusable "actions" or "skills" is extremely powerful for autonomous agents. Instead of rewriting boiler-plate code, the agent can index a library of known-good, trusted scripts or workflows.
- **Performance**: Skills drastically reduce token usage and time-to-first-action since the LLM doesn't have to invent and debug code from scratch.
- **Security**: Skills can be pre-approved or scoped to specific domains, reducing the need for aggressive sandbox restrictions if the script itself is verified.
- **Implementation Strategy**: Maintain a `.agents/skills` directory pattern where skills are markdown files with YAML frontmatter + instructions + helper scripts.
