# Zeus-Agent Operational Memory

This file serves as a secondary persistent memory store for the Zeus-Agent project. While `AGENTS.md` contains the high-level architectural invariants and product vision, this file tracks implementation quirks, testing nuances, and development workflows.

## 1. Testing and E2E Quirks
- **Test Database & Workspace:** E2E tests run in a completely isolated `.test_workspace` folder. The Tauri backend is booted via `launchTauri` in `testUtils.js` which points the data directory to this temp folder. This prevents tests from polluting your manual `AppData` chats.
- **Task Cleanup:** Playwright tests share the same Tauri backend instance across a single test file. To prevent "history bloat" and test pollution, `cleanupTasks` evaluates a `delete_task` command between tests.
- **Background Cancellation:** For cleanup to work correctly, it is critical that `delete_task` strictly calls `token.cancel()` on any actively running tasks. If a task is not cancelled, it will continue to run in the background and consume mocked LLM responses meant for the next test.

## 2. API Interception & Sandboxing (Gatekeeper)
- The gatekeeper uses Python's `sys.addaudithook` to trap underlying syscalls (`urllib`, `requests`, `subprocess`, `open`).
- This allows the Worker Agent to write natural Python code without needing complex mocked directives, while still triggering our zero-knowledge permission UI synchronously via Tauri IPC.

## 3. UI Component Details
- **Settings Modal:** The Model dropdown uses a standard `<datalist>` rather than a custom select component. This is intentional to allow free-form text input (in case a specific model isn't yet in the auto-fetched list from RouteLLM). Company identifiers are added using Emojis directly into the `option` text.
