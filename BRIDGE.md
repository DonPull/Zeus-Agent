# Zeus Agent — UI ↔ Core Bridge Contract

The UI (React) talks to the Rust core **only** through `src/bridge/index.js`.
To replace the UI, reimplement against this contract. The core never changes.

All functions are async. Errors arrive as rejected promises carrying a
human-readable string (a `BUDGET_EXCEEDED` substring signals the budget stop).

## Tasks

- `getTaskMessages(taskId: string, includeHidden?: boolean) → MessageDto[]`
  Master conversation, oldest first (ordered by `seq`). By default returns
  only `visible` messages — the backend owns visibility; the UI never filters
  by content. `includeHidden: true` is for debug tooling only.
- `getTaskSpend(taskId: string) → { spent_credits: number, budget_credits: number }`
- `sendUserMessage(taskId: string, content: string) → SendResultDto`
  Persists the user message, runs the orchestration loop, returns ONLY spend
  totals. ALL messages (the user echo included) are delivered exclusively via
  `task-message` events carrying their DB `seq`. The UI must upsert by `id`
  and sort by `seq`; on send completion it should re-fetch `getTaskMessages`
  to reconcile with the DB.

```json
TaskDto       { "id", "title", "status", "budget_credits", "spent_credits", "created_at", "updated_at" }
MessageDto    { "id", "task_id", "conversation", "role", "kind", "content", "credits_used", "model", "created_at", "seq", "visible" }
SendResultDto { "spent_credits", "budget_credits" }