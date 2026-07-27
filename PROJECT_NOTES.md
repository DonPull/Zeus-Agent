# Zeus Agent — Project Notes

## Core Philosophy
Zeus Agent is a desktop autonomous-agent runtime capable of handling open-ended user requests. It enforces controlled, recoverable, and observable agent behavior.
- **Master Agent**: Plans, delegates, and synthesizes.
- **Worker Agents**: Perform delegated, constrained sub-tasks autonomously.
- **Verifier**: Checks that worker output actually meets success criteria.

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

## Recent Implementation Progress
- **Gatekeeper & Capabilities (P2)**:
  - We have integrated the "Command pattern matching" for explicit terminal command approvals in the UI (`ChatMessage.jsx`, `ApprovalCard.jsx`).
  - We have built the "Watcher AI" settings UI in both `SettingsModal.jsx` (Global) and `TaskPermissionsModal.jsx` (Task-scoped).
  - The Gatekeeper Rust backend (`gatekeeper.rs`) implements `negotiate_watcher_policy` (to summarize rules via the LLM) and `evaluate_network_action` (to evaluate real-time actions).
  - `HttpRequest` directives are actively routed through the Gatekeeper to produce `ALLOW`, `DENY`, or `ASK` (which emits an approval card).

## Thoughts on the "Actions/Skills" System
The concept of persistent, reusable "actions" or "skills" is extremely powerful for autonomous agents. Instead of rewriting boiler-plate code, the agent can index a library of known-good, trusted scripts or workflows (like an "android-cli" skill, a "github-repo-analyzer" skill, etc.).
- **Performance**: Skills drastically reduce token usage and time-to-first-action since the LLM doesn't have to invent and debug code from scratch.
- **Security**: Skills can be pre-approved or scoped to specific domains, reducing the need for aggressive sandbox restrictions if the script itself is verified.
- **Implementation Strategy**: We can introduce a `.agents/skills` directory pattern (similar to my own architecture!) where skills are just markdown files with YAML frontmatter + instructions + helper scripts.

*Note: This file will be updated organically as the project evolves.*
