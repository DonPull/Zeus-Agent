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
| P2 | Gatekeeper & Capability System | **COMPLETED** |
| P3 | Resource Ledger & Model Strategy (Reasoning Effort Levels) | IN PROGRESS |
| P4 | System & Browser Tools (Stealth & Cookie Vault) | **COMPLETED** |
| P5 | Production Hardening | PLANNED |

## 5. Development Guidelines
- Prioritize stability and automated testing (`cargo test`).
- Respect strict transaction boundaries.
- For new features, always include unit tests for state transitions and DB migrations.
- When creating schemas, define clear parent/child relationships (like `tasks` -> `runs` -> `workers`).

## 6. Autonomous Benchmark & Continuous Improvement Routine
- Complete specification is documented in [`ROADMAP.md`](file:///d:/Hristian%20projects/Zeus-Agent/ROADMAP.md) and [`.agents/skills/continuous_improvement_routine/SKILL.md`](file:///d:/Hristian%20projects/Zeus-Agent/.agents/skills/continuous_improvement_routine/SKILL.md).
- Detailed prompt status & execution logs in [`EVAL_STATUS.md`](file:///d:/Hristian%20projects/Zeus-Agent/EVAL_STATUS.md) and [`FINAL_EVAL_REPORT.md`](file:///d:/Hristian%20projects/Zeus-Agent/FINAL_EVAL_REPORT.md).
- **Benchmark Milestone**: 100% pass rate (10 / 10 prompts completed) with zero test-specific conditional hacks.
- **Single-Repo Architecture**: Zeus Agent operates as a self-contained runtime; Antigravity runs advanced E2E tests, grades outputs, diagnoses issues, and refines the codebase directly.
- **Single-Agent Local System Prompt**: `src-tauri/src/prompts/local_master.txt` provides direct host tool execution for local models without worker overhead.
- **Pre-Authorized Commands & Session Files**: Developer commands (`node`, `npx playwright test`, `cargo`, `npm`, `git`, `python`) and newly created session files are auto-allowed in eval and local mode.
- **Parent Profile Cloning**: Clones `.zeus/parent_browser_profile` into task workspaces with extension auto-loading and anti-bot stealth.
- **Reasoning Effort Governance**: Support for `low`, `medium`, and `high` effort parameter injection on Abacus RouteLLM, Gemini, and OpenAI-compatible endpoints.

