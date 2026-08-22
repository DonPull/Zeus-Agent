# Autonomous Self-Improvement & Benchmark Evaluation Harness

This document records the complete architecture, execution lifecycle, safety mechanisms, and runbook for the **Autonomous Self-Improvement Benchmark Experiment** in Zeus Agent.

---

## 1. Overview & Vision
The Self-Improvement Harness is an autonomous evaluation and repair system that runs locally with zero API costs using a locally hosted LLM (e.g. `Qwen3.8-27B` via `ik_llama.cpp` at `http://localhost:11434/v1`).

The goal is to let the agent run continuously for hours or days, executing 10 complex, real-world benchmark tasks against a separate target repository instance, scoring executions based on log evidence, diagnosing failure points, and patching code until all tasks achieve $\ge 8.5/10$.

---

## 2. Two-Repository Architecture
The experiment uses **two separate repository instances** on the same machine to prevent self-mutation collisions:

```
[ Repo A: Evaluator Instance ] (Active Desktop UI - npm run tauri dev)
  │
  ├─► Reads 10_agentic_prompts.json & eval_evaluator_prompt.txt
  ├─► Crafts Playwright tests in Repo B (tests/advanced_e2e/<prompt>.spec.js)
  ├─► Deploys fixtures to Repo B (node scripts/eval_harness/deploy_fixtures.js)
  ├─► Executes tests on Repo B via terminal commands
  ├─► Parses Repo B's debug-log.txt & runs programmatic python_check assertions
  ├─► Applies negative deduction scoring (Base 10.0)
  ├─► Diagnoses root causes & patches Repo B's engine (src-tauri/src/, src/)
  ├─► Compiles Repo B (cargo check --lib, npm run build) & re-tests failed prompts
  └─► Maintains live dashboard in EVAL_STATUS.md

[ Repo B: Target Instance Under Test ] (Inactive File Directory)
  │
  ├─► Receives advanced E2E tests from Repo A
  ├─► Spawns test tasks & runs standard user domain prompts
  ├─► Generates output artifacts (images, CSVs, JSON, databases) & debug-log.txt
  └─► Receives code patches from Repo A when scores are < 8.5/10
```

---

## 3. Engine Modifications & Invariants for Local Execution

### A. Unified Single-Agent System Prompt (`local_master.txt`)
- **File**: `src-tauri/src/prompts/local_master.txt`
- Loaded automatically via `settings::load_master_prompt_for_model(model)`.
- Eliminates multi-agent worker serialization overhead for local models (cutting token consumption by ~70%).
- Equips the Master with direct access to all host tools: `run_command`, `read_file`, `write_file`, `delete_file`, `list_dir`, `search_files`, `http_request`, `run_action` (Python), `update_action_plan`, `update_memory`, `final_answer`.
- Mandates self-verification before concluding.

### B. Unbounded Iterations & Budget Bypass
- **Orchestration Loop**: `orchestrator::max_orchestration_iterations()` returns `usize::MAX` (unbounded) when `ZEUS_UNLIMITED_ITERATIONS=1` or `ZEUS_MAX_ITERATIONS=0`.
- **Budget Bypass**: `chat.rs` checks `is_unlimited_budget` which evaluates to `true` whenever `is_local_model(&master_model)` is true or `ZEUS_UNLIMITED_BUDGET=1`, removing token/credit pauses.

### C. Automatic Local Model Recognition on Startup
- `gateway::is_local_model(model)` in `src-tauri/src/gateway.rs` automatically identifies `qwen`, `llama`, `mistral`, `gemma`, `.gguf`, etc.
- `lib.rs` loads `local_base_url` (`http://localhost:11434/v1`) from SQLite on boot into memory cache.
- The user does **not** need to open Settings or click "Test" every time the app opens.

### D. Dynamic `EVAL_STATUS.md` Injected Reminder
- `chat.rs` tracks `steps_since_status_update`.
- If the agent performs 5 consecutive tool actions in eval mode without updating `EVAL_STATUS.md`, the engine injects a reminder to keep the live dashboard current.

---

## 4. Defensive Filesystem Policy & Command Pre-Authorization

In [`src-tauri/src/gatekeeper.rs`](file:///d:/Hristian%20projects/Zeus-Agent/src-tauri/src/gatekeeper.rs):

1. **Open Reads Across Drives**: Open read/search access across user drives (`D:\`, `E:\`, etc.), with sensitive OS directories (`C:\Windows`, `C:\Program Files`) protected.
2. **Session-Aware Path Tracking (`SESSION_CREATED_PATHS`)**:
   - Any brand-new file created during the session is auto-allowed and recorded.
   - The agent is permitted to freely edit and delete files created within the current session.
   - Pre-existing personal and system files outside the session are strictly protected from modification or deletion.
3. **Pre-Authorized Developer Commands**:
   - In eval mode (or for local models), safe development prefixes are pre-authorized without blocking UI confirmation cards:
     `cargo check`, `cargo test`, `cargo build`, `cargo run`, `cargo clippy`, `cargo fmt`, `npm run`, `npm test`, `npm build`, `npm exec`, `npx playwright test`, `git status`, `git diff`, `git checkout`, `git stash`, `git commit`, `git add`, `git branch`, `git log`, `git reset`, `git revert`, `python`, `python3`, `node`, `pytest`, `where`, `dir`, `echo`, `type`, `cat`.

---

## 5. Browser Stealth, Profile Cloning & Captcha Extensions

In [`src-tauri/src/browser_manager.rs`](file:///d:/Hristian%20projects/Zeus-Agent/src-tauri/src/browser_manager.rs):

1. **Parent Profile Cloning**:
   - When a task requires a browser, `ensure_browser` checks for `.zeus/parent_browser_profile/` (in project or AppData root).
   - If present, it recursively clones the parent profile (cookies, sessions, local storage) into `tasks/<task_id>/workspace/.zeus/browser_profiles/<task_id>`.
   - All pre-authenticated services (Canva, Motley Fool, etc.) are immediately logged in.
2. **Auto-Loading Extensions**:
   - `get_installed_extensions()` scans `.zeus/extensions/` and `Default/Extensions/*/*` for directories containing `manifest.json`.
   - Passes `--load-extension=<paths>` so all extensions (e.g. Captcha Solvers, uBlock Origin) are loaded active on startup.
3. **Stealth & Anti-Bot Protections**:
   - Passes `--disable-blink-features=AutomationControlled` (strips `navigator.webdriver = true`).
   - Passes `--disable-infobars` (removes the automation banner).
   - Python Playwright runner (`python_runner.rs`) injects `human_type` (randomized inter-key delays 40-120ms) and `human_click` (randomized bounding-box target offsets and multi-step mouse movement paths).

---

## 6. Benchmark Test Suite & Fixtures

### A. 10 Real-World Benchmark Prompts
Located in [`scripts/eval_harness/prompts/10_agentic_prompts.json`](file:///d:/Hristian%20projects/Zeus-Agent/scripts/eval_harness/prompts/10_agentic_prompts.json):
1. `sofia_weather_flyer_campaign` (Multi-Turn): API weather lookup + Bulgarian Pillow banner + localized social posts & JSON manifest.
2. `financial_stock_dossier`: Motley Fool / Yahoo Finance stock research + Python quantitative risk metrics + markdown memo & CSV.
3. `sqlite_pipeline_migration` (Multi-Turn): Scaffold SQLite feedback ETL pipeline + non-destructive schema migration.
4. `sample_project_bug_repair`: Debug and fix bugs in `sample_validator/` without altering comments or Zeus code.
5. `brand_guidelines_memory_recall` (Multi-Turn): Memorize 'Vitosha Gear' brand rules + generate pricing catalog & styled HTML page from recall.
6. `resilient_data_scraper_heatmap`: Scrape public tech benchmarks + auto-install Python packages + plot heatmap & JSON dump.
7. `workspace_search_and_reconciliation`: Deep search across nested `data_dumps/` subfolders + reconcile 2026 transactions into a clean ledger.
8. `canva_design_to_code` (Multi-Turn): Research design layouts on Canva + programmatically render high-res mockup.
9. `log_outage_diagnostic_script`: Parse 5,000+ line server error log + cluster root causes + generate automated remediation script.
10. `multi_source_battery_report`: Multi-source research on solid-state batteries + resolve conflicting claims into benchmark JSON & report.

### B. Pre-Packaged Fixtures
Located in [`scripts/eval_harness/fixtures/`](file:///d:/Hristian%20projects/Zeus-Agent/scripts/eval_harness/fixtures/):
- `sample_validator/` (Prompt 4 buggy validator project).
- `data_dumps/` (Prompt 7 nested CSV/JSON dumps from 2025/2026).
- `logs/server_outage.log` (Prompt 9 realistic server incident log).
- **Deployment Script**: `node scripts/eval_harness/deploy_fixtures.js --dest <TASK_WORKSPACE>`.

---

## 7. Execution Runbook

### To Start the Experiment:
1. Ensure your local LLM server (`ik_llama.cpp`) is active at `http://localhost:11434/v1`.
2. Ensure Repo B exists on disk (e.g. `D:\Hristian projects\Zeus-Agent-Target`).
3. Start the main Zeus Agent app in Repo A:
   ```bash
   npm run tauri dev
   ```
4. Create a new task titled *"Autonomous Benchmark & Self-Refine"* and send:
   ```markdown
   Please execute the autonomous benchmark and self-refinement mission against the target repository located at:
   "D:\Hristian projects\Zeus-Agent-Target"

   Follow the evaluator guidelines and benchmark prompts in:
   "D:\Hristian projects\Zeus-Agent\scripts\eval_harness\prompts\10_agentic_prompts.json"

   Maintain live progress in "EVAL_STATUS.md" after every trial. Run all 10 prompts through test creation, execution, artifact inspection, and code self-refinement until each prompt scores >= 8.5/10. Compile the final summary in "FINAL_EVAL_REPORT.md".
   ```

### To Monitor:
- Open [`EVAL_STATUS.md`](file:///d:/Hristian%20projects/Zeus-Agent/EVAL_STATUS.md) at any time to see trial histories, scores, and applied patches.
- Use the **Stop / Cancel** button in the chat UI at any point to pause the run.
