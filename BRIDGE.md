# Zeus Agent — UI ↔ Core Bridge Contract

The UI (React) talks to the Rust core **only** through `src/bridge/index.js`.
To replace the UI, reimplement against this contract. The core never changes.

All functions are async. Errors arrive as rejected promises carrying a
human-readable string (a `BUDGET_EXCEEDED` substring signals the budget stop).

## Tasks

- `createTask(title: string | null) → TaskDto`
  Creates a task. `null` uses the default title; the first user message
  auto-titles it (48 chars + …). Also creates the per-task workspace folder.
- `listTasks() → TaskDto[]` — ordered by `updated_at` descending.
- `getTaskMessages(taskId: string) → MessageDto[]` — master conversation, oldest first.
- `getTaskSpend(taskId: string) → { spent_credits: number, budget_credits: number }`
- `sendUserMessage(taskId: string, content: string) → SendResultDto`
  Persists the user message, calls the master model, persists the reply,
  logs a credit event, updates the task spend.

```json
TaskDto       { "id", "title", "status", "budget_credits", "spent_credits", "created_at", "updated_at" }
MessageDto    { "id", "task_id", "conversation", "role", "kind", "content", "credits_used", "model", "created_at" }
SendResultDto { "user_message": MessageDto, "assistant_message": MessageDto, "spent_credits", "budget_credits" }