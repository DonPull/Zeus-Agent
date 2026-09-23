---
name: continuous-improvement-routine
description: Runs the autonomous self-refining evaluation and test loop in Zeus Agent using benchmark_runner.spec.js, 10_agentic_prompts.json, and deploy_fixtures.js, inspecting outputs, diagnosing issues, and applying non-hacky code adjustments until passing.
---

# Continuous Improvement Routine Skill

This skill documents the exact workflow, file paths, architecture, and execution runbook for running the **Continuous Improvement Routine** in the Zeus Agent codebase. 

Even if your context window is cleared or compacted, reading this file provides the exact instructions to autonomously conduct the evaluation, diagnose failures, apply systemic code adjustments, and re-run tests until perfection.

---

## 1. Core Architecture & Roles

- **Single-Repo Architecture**:
  - All operations take place in this repository (`D:\Hristian projects\Zeus-Agent`).
  - There is **no separate evaluator repository** (no Repo A / Repo B). Zeus Agent is the self-contained desktop runtime under test.
- **Antigravity's Role (The Manager, Evaluator & Refiner)**:
  - You are the **autonomous evaluator, diagnostics engineer, and code refiner**.
  - You execute the Playwright benchmark runner (`benchmark_runner.spec.js`) or specific advanced E2E specs.
  - You inspect test stdout/stderr, generated workspace artifacts, SQLite message logs, and `python_check` assertions.
  - You score performance against the 4-part grading rubric ($> 8.5 / 10$).
  - If any mistake, assertion failure, or defect occurs, **you diagnose the root cause, apply general non-hacky code adjustments directly to Zeus Agent, rebuild, and re-run the prompt** until it passes.
- **User's Role**:
  - The user provides high-level guidance, reviews roadmap alignment, and prompts you to start the routine on specific prompts or test suites. You handle all execution, debugging, fixing, and re-testing autonomously.

---

## 2. Key Files & Harness Components

The continuous improvement routine is powered by three core files that were specifically crafted for this workflow:

1. **Prompt Dataset (`scripts/eval_harness/prompts/10_agentic_prompts.json`)**:
   - Contains the 10 real-world, multi-turn agentic engineering challenges:
     1. `sofia_weather_flyer_campaign` (Marketing flyer & weather integration, Bulgarian text, 1200x630 banner)
     2. `financial_stock_dossier` (Quantitative stock analysis, NVDA vs PLTR, CSV metrics table)
     3. `sqlite_pipeline_migration` (ETL pipeline scaffolding & SQLite schema evolution)
     4. `sample_project_bug_repair` (External codebase bug localization & pytest repair)
     5. `brand_guidelines_memory_recall` (Brand memory recall & HTML showcase generation)
     6. `resilient_data_scraper_heatmap` (Web scraping, open-source dataset, Pillow heatmap)
     7. `workspace_search_and_reconciliation` (File search, deduplication & fuzzy financial ledger reconciliation)
     8. `canva_design_to_code` (Canva creative research, visual layout mockup & audit checklist)
     9. `log_outage_diagnostic_script` (Server outage log clustering & automated incident remediation script)
     10. `autonomous_workflow_marathon` (Multi-stage data generation, transformation & test verification)
   - Each prompt entry defines:
     - `id`: Prompt ID (1 to 10).
     - `name`: Unique prompt identifier.
     - `title`: Descriptive title.
     - `turns`: Array of turns with `turn` number, `user_prompt`, optional `expected_artifacts`, and deterministic programmatic `python_check` assertion scripts.
     - `criteria`: Specific behavioral constraints (e.g. language requirements, no clobbering, zero-edit to host).

2. **Fixture Deployment Script (`scripts/eval_harness/deploy_fixtures.js`)**:
   - Deploys pre-built fixtures into the active task workspace so that prompts requiring existing files have them ready without manual setup:
     - `workspace/sample_validator/` (Prompt 4: Bug fixing & unit test repair)
     - `workspace/data_dumps/` (Prompt 7: Heterogeneous CSV/JSON financial transaction dumps)
     - `workspace/logs/` (Prompt 9: 566 KB production server outage logs)
   - Automatically executed by `benchmark_runner.spec.js` inside the task workspace before sending turns.
   - Can also be invoked manually:
     ```bash
     cmd.exe /c "node scripts/eval_harness/deploy_fixtures.js --dest \"<task_workspace_path>\""
     ```

3. **Master Playwright Benchmark Runner (`tests/advanced_e2e/benchmark_runner.spec.js`)**:
   - The original automated runner executing all or individual prompts against the real runtime.
   - Sets task models via `window.__ZEUS_BRIDGE__.updateTaskSettings()` and executes prompt turns sequentially.

4. **Modular Benchmark Suite Architecture (`tests/benchmarks/`)**:
   - For scaling benchmark evaluation across multiple waves of prompts without file or fixture collision, Zeus Agent employs a **Suite Bundle Architecture**:
     ```text
     tests/benchmarks/
     ├── benchmark_engine.js           # Shared reusable engine (CDP, lifecycle, fixtures, turns, python checks)
     └── suites/
         ├── wave_1_foundation/        # Wave 1: The 10 foundational benchmark challenges
         │   ├── prompts.json          # Prompt specifications & python_check assertions
         │   ├── fixtures/             # Isolated fixtures (sample_validator, data_dumps, logs)
         │   ├── suite_config.json     # Wave-specific defaults (models, budget, timeouts)
         │   └── wave_1.spec.js        # 5-line runner registering the suite
         └── wave_<N>_<name>/          # Future prompt waves authored by the user
             ├── prompts.json
             ├── fixtures/             # Auto-copied into task workspace by benchmark_engine
             ├── suite_config.json
             └── wave_<N>.spec.js
     ```
   - **Automatic Token Unit Accounting (Zero Custom Code Needed)**:
     - The benchmark engine (`benchmark_engine.js`) has **native unit accounting built into its core lifecycle**.
     - At the conclusion of every test (pass or fail), before task cleanup, the engine automatically:
       1. Invokes `window.__ZEUS_BRIDGE__.getTaskMessages(taskId)` over CDP.
       2. Sums the exact prompt + completion units consumed across all messages.
       3. Prints immediate bold console telemetry:
          ```text
          📊 [UNITS LEDGER] Prompt <ID> (<name>): <units> units consumed (<count> messages).
          📊 [UNITS LEDGER] Cumulative Total for Suite: <total> units.
          ```
       4. Appends/updates the persistent `<suite_dir>/units_ledger.json` file.
     - **Prompt authors never need to write any unit-counting code**. Every future wave automatically inherits full unit accounting out of the box.

   - **How to Author a New Prompt Wave (for AI Agents & Developers)**:
     To add a new wave (e.g. Wave 2: Complex Real-World Prompts), follow this exact structure:
     1. **Create Directory**: `tests/benchmarks/suites/wave_2_<name>/`.
     2. **Author `prompts.json`**: Use the standard benchmark prompt schema:
        ```json
        [
          {
            "id": 1,
            "name": "example_task_slug",
            "title": "Clear Human-Readable Title",
            "criteria": [
              "Specific behavioral constraint 1",
              "Specific behavioral constraint 2"
            ],
            "turns": [
              {
                "turn": 1,
                "user_prompt": "First instruction sent to Zeus Agent...",
                "expected_artifacts": ["result.csv"],
                "python_check": "import os\nassert os.path.exists('result.csv'), 'result.csv missing'\nwith open('result.csv') as f:\n    assert 'header' in f.read()"
              }
            ]
          }
        ]
        ```
     3. **Add Fixtures (Optional)**: If prompts require pre-existing files or codebase repositories, place them inside `tests/benchmarks/suites/wave_2_<name>/fixtures/`. The engine automatically copies all files and subdirectories into the task workspace before sending turn 1.
     4. **Add `suite_config.json` (Optional)**: Set wave-specific model defaults, timeouts, or budget:
        ```json
        {
          "default_model": "Qwen3.8-27B",
          "budget_credits": 50000,
          "browser_mode": "sandboxed",
          "prompt_timeout_ms": 900000,
          "turn_timeout_ms": 600000
        }
        ```
     5. **Create the Spec Runner**: Create `wave_2.spec.js`:
        ```javascript
        import { registerBenchmarkSuite } from '../../benchmark_engine.js';
        import path from 'path';
        import { fileURLToPath } from 'url';

        const __dirname = path.dirname(fileURLToPath(import.meta.url));
        registerBenchmarkSuite('Wave 2: Complex Real-World Prompts', __dirname);
        ```
   - **Unified Spec Runner**:
     - `tests/advanced_e2e/benchmark_runner.spec.js` is the canonical entry point that delegates directly to `benchmark_engine.js` using the Wave 1 Foundation suite.
   - **Execution Commands**:
     - Run entire Wave 1: `cmd.exe /c "npx playwright test tests/benchmarks/suites/wave_1_foundation/wave_1.spec.js"`
     - Run a single prompt: `cmd.exe /c "npx playwright test tests/benchmarks/suites/wave_1_foundation/wave_1.spec.js -g \"Prompt 1\""`
     - Run via canonical runner: `cmd.exe /c "npx playwright test tests/advanced_e2e/benchmark_runner.spec.js -g \"Prompt 1\""`
     - Run all benchmark suites: `cmd.exe /c "npx playwright test tests/benchmarks/"`

---

## 3. Model Configuration Environments

The runtime supports two execution modes for evaluation:

### Mode A: Local Unified Benchmark Mode (100% Milestone Environment)
- **Target Model**: `Qwen3.8-27B` via local OpenAI-compatible endpoint (`http://localhost:11434/v1`).
- **Engine**: Single-agent unified host tool execution (`local_master.txt`).
- **Use Case**: Running the 10-prompt benchmark suite without incurring remote API costs or latency.
- Set environment variable:
  ```powershell
  $env:ZEUS_BENCHMARK_MODEL = "Qwen3.8-27B"
  ```

### Mode B: Hybrid Cloud / Local Multi-Agent Mode (Active Verification Environment)
- **Master**: Cloud model (e.g. `zai-org/GLM-5.3-Flash` or `moonshotai/Kimi-K3`).
- **Worker**: Cloud model (e.g. `gpt-5.6-luna` or `deepseek-ai/DeepSeek-V4-Pro`).
- **Verifier**: Cloud model (e.g. `zai-org/GLM-5.3-Flash` or `grok-4.5`).
- **Watcher**: Local model (`Qwen3.8-27B` via `http://localhost:11434/v1`).
- **Vision**: Cloud model (`gemini-3.8-flash`).
- **Invariant**: At most **one** role (Watcher) is assigned to the local server to satisfy the Single Local Model concurrency constraint.

---

## 4. Execution Commands

Always execute commands using Windows syntax:

### A. Run a Specific Benchmark Prompt
To run a single prompt (e.g. Prompt 1 or Prompt 4):
```bash
cmd.exe /c "npx playwright test tests/advanced_e2e/benchmark_runner.spec.js -g \"Prompt 1\" --reporter=list"
```
Or by keyword:
```bash
cmd.exe /c "npx playwright test tests/advanced_e2e/benchmark_runner.spec.js -g \"sofia_weather\" --reporter=list"
cmd.exe /c "npx playwright test tests/advanced_e2e/benchmark_runner.spec.js -g \"sample_project\" --reporter=list"
```

### B. Run the Full 10-Prompt Benchmark Suite
```bash
cmd.exe /c "npx playwright test tests/advanced_e2e/benchmark_runner.spec.js --reporter=list"
```

### C. Run Existing Advanced E2E Test Specs
To verify core functionality and ensure zero regressions across recent features:
```bash
cmd.exe /c "npx playwright test tests/advanced_e2e/bug_hunter.spec.js --reporter=list"
cmd.exe /c "npx playwright test tests/advanced_e2e/self_healing_code.spec.js --reporter=list"
cmd.exe /c "npx playwright test tests/advanced_e2e/agent_capability.spec.js --reporter=list"
cmd.exe /c "npx playwright test tests/advanced_e2e/code_refactor.spec.js --reporter=list"
cmd.exe /c "npx playwright test tests/advanced_e2e/grand_combination.spec.js --reporter=list"
```

---

## 5. Scoring Rubric (Passing Threshold: $> 8.5 / 10$)

| Dimension | Weight | Success Criteria |
|---|---|---|
| **1. Accuracy & Completeness** | 35% | All required files/artifacts created, calculations exact, and `python_check` assertion scripts exit 0. |
| **2. Tool Proficiency & Directives** | 25% | Directives (`run_command`, `read_file`, `write_file`, `analyze_visual`) format valid JSON, resolve paths correctly in workspace, and execute without repeated parse failures. |
| **3. Safety & Policy Adherence** | 20% | Operations strictly respect task workspace sandbox; Gatekeeper permissions handled cleanly without infinite loops; session files auto-authorized. |
| **4. Efficiency & Economy** | 20% | Output compressor prevents runaway terminal bloat; line-range reader used for targeted reads; zero circular reasoning loops. |

**Passing Criteria**: Total weighted score **$\ge 8.5 / 10$** and all programmatic Python assertions pass.

---

## 6. Diagnosis, Code Refinement & Iteration Cycle

When a test fails, times out, or produces an assertion failure:

1. **Step 1: Inspect Error Logs & Evidence**:
   - Read the Playwright stdout/stderr error snippet.
   - Inspect `<task_workspace>/__eval_check_turn_<N>.py` output to see the exact assertion failure.
   - Read `debug-log.txt` or query SQLite messages to examine the agent's internal thought chain and directive responses.
2. **Step 2: Diagnose the Root Cause**:
   - *Example Failure Modes Encountered & Solved*:
     - Path resolution error: agent wrote to `./file` instead of `<workspace>/file` (fixed in `orchestrator.rs` and `chat.rs`).
     - Domain approval spam: repeated network calls prompted repeated UI cards (fixed via domain approval caching in `gatekeeper.rs`).
     - Directive response deserialization: model emitted `{"type":"final_answer","result":...}` instead of `"answer"` (fixed via multi-variant deserializer in `chat.rs`).
     - Context window overflow: massive anti-bot HTML responses bloated the prompt (fixed via payload capping in `orchestrator.rs` and `output_compressor.rs`).
3. **Step 3: Apply Clean, Non-Hacky Engine Adjustments**:
   - **CRITICAL RULE**: **NEVER hardcode test-specific hacks** (e.g. `if prompt.contains(...)`).
   - Fix the underlying engine logic in `src-tauri/src/` (e.g. `orchestrator.rs`, `chat.rs`, `gateway.rs`, `worker.rs`, `gatekeeper.rs`) or UI bridge in `src/`.
   - If prompt instructions were ambiguous, improve the system prompt template in `src-tauri/src/prompts/`.
4. **Step 4: Recompile & Validate**:
   ```bash
   cargo check --lib
   cmd.exe /c "npm run build"
   ```
5. **Step 5: Re-Run Failed Prompt**:
   ```bash
   cmd.exe /c "npx playwright test tests/advanced_e2e/benchmark_runner.spec.js -g \"Prompt <ID>\""
   ```
6. **Step 6: Update `EVAL_STATUS.md`**:
   - Record trial count, key issues resolved, and verified deliverables.
