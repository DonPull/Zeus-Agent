# Zeus Agent — Product Vision & Core Invariants

## 1. High-Level Vision
Zeus Agent is a **desktop autonomous agent runtime** engineered to perform complex, open-ended real-world missions directly on the host computer without human babysitting.

Unlike traditional chatbots or simple script wrappers, Zeus Agent:
- **Plans & Executes Autonomously**: Decomposes ambiguous user goals into concrete actions, runs shell commands, writes code, manages files, drives real web browsers, and analyzes results.
- **Enforces Controlled Safety**: Operates within strict Gatekeeper permission boundaries, isolating file access and preventing unintended system modifications.
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
