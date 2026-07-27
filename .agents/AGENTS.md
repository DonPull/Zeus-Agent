# Zeus Agent — Project Rules & Architectural Invariants

This file preserves the core principles, vision, and implementation roadmap of the Zeus Agent project so that they are never forgotten across sessions. 

## 1. Product Vision
Zeus Agent is a desktop autonomous-agent runtime (not merely a chatbot) capable of handling open-ended user requests. It enforces controlled, recoverable, and observable agent behavior.
- **Master Agent**: Plans, delegates, and synthesizes.
- **Worker Agents**: Perform delegated, constrained sub-tasks autonomously.
- **Verifier**: Checks that worker output actually meets success criteria.

## 2. Core Architectural Invariants (DO NOT BREAK)
1. **SQLite is authoritative**: The database is the ultimate source of truth for message existence, ordering, and visibility.
2. **Persist before emit**: Every message must be inserted into SQLite to receive its authoritative `rowid` (`seq`) BEFORE being emitted to the frontend. 
3. **Backend owns visibility**: The frontend must not inspect content to decide if a message is hidden. Trust the `visible` flag (`1` or `0`).
4. **Stable sequence ordering**: The frontend upserts by ID and sorts by sequence (`seq`).
5. **No optimistic frontend messages**: The frontend must never invent durable-looking chat messages. It only renders what the backend provides.
6. **Task-scoped active runs**: `ActiveRunGuard` enforces a strict single-flight execution loop per task.
7. **Task-scoped cancellation**: Cancellation via `CancellationToken` must gracefully drop running models, tasks, and child processes (Python actions).
8. **No DB mutex over network I/O**: `AppState` uses `Mutex<Connection>`. The lock must ALWAYS be dropped before awaiting LLM streams or running external processes.
9. **Bridge boundary**: React components must not call Tauri commands directly; everything must route through `src/bridge/index.js`.

## 3. Tech Stack
- **Backend**: Rust, Tauri 2.0, Tokio (async), `reqwest` (LLM gateway), `rusqlite`.
- **Frontend**: React 18, Vite, `react-markdown`.
- **Security/Storage**: API keys are in Windows Credential Manager, not SQLite.

## 4. Implementation Roadmap
| Milestone | Name | Status |
|---|---|---|
| P0.1 | Single Flight & One Projection | **COMPLETED** |
| P0.2A | Durable Run Journal | **COMPLETED** |
| P0.2B | Run Control & Task UX | **COMPLETED** |
| P1 | Delegation & Verification | **COMPLETED** |
| **P2** | **Gatekeeper & Capability System** | **NEXT / PLANNED** |
| P3 | Resource Ledger & Model Strategy | PLANNED |
| P4 | System & Browser Tools | PLANNED |
| P5 | Production Hardening | PLANNED |

## 5. Development Guidelines
- Prioritize stability and automated testing (`cargo test`).
- Respect strict transaction boundaries.
- For new features, always include unit tests for state transitions and DB migrations.
- When creating schemas, define clear parent/child relationships (like `tasks` -> `runs` -> `workers`).
