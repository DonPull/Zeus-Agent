import { test, expect } from '@playwright/test';
import { launchTauri, stopTauri, cleanupTasks } from '../e2e/testUtils.js';
import { setupAdvancedTask, submitPromptAndWait, captureArtifacts, pruneResults } from './advancedUtils.js';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const promptsFile = path.resolve(__dirname, '../../scripts/eval_harness/prompts/10_agentic_prompts.json');
const prompts = fs.existsSync(promptsFile) ? JSON.parse(fs.readFileSync(promptsFile, 'utf8')) : [];

test.describe('Zeus Agent Autonomous Benchmark Suite (10 Real-World Prompts)', () => {
    test.setTimeout(15 * 60 * 1000); // 15 minutes max per prompt

    let browser;
    let page;

    test.beforeAll(async () => {
        pruneResults();
    });

    for (const promptSpec of prompts) {
        test(`[Prompt ${promptSpec.id}] ${promptSpec.title} (${promptSpec.name})`, async ({}, testInfo) => {
            console.log(`\n================================================================`);
            console.log(`🚀 RUNNING BENCHMARK PROMPT ${promptSpec.id}: ${promptSpec.title}`);
            console.log(`================================================================\n`);

            // 1. Launch Tauri in real mode
            const tauri = await launchTauri(true);
            browser = tauri.browser;
            page = tauri.page;

            try {
                // Wait for UI to boot
                await expect(page.locator('#app-container')).toBeVisible({ timeout: 15000 });

                // Setup task in UI
                await page.locator('#new-task-button, #empty-state-new-task-button').first().click();

                // Get task ID and configure local model directly on task settings
                const modelName = process.env.ZEUS_BENCHMARK_MODEL || "Qwen3.8-27B";
                const taskId = await page.evaluate(async (model) => {
                    if (!window.__ZEUS_BRIDGE__) return null;
                    const tasks = await window.__ZEUS_BRIDGE__.listTasks();
                    if (!tasks || tasks.length === 0) return null;
                    const id = tasks[0].id;
                    await window.__ZEUS_BRIDGE__.updateTaskSettings(id, {
                        master_model: model,
                        worker_model: model,
                        verifier_model: model,
                        watcher_model: model,
                        budget_credits: 50000,
                        browser_mode: "sandboxed"
                    });
                    return id;
                }, modelName);

                const testWorkspaceRoot = process.env.ZEUS_TEST_WORKSPACE_ROOT || path.join(os.homedir(), 'AppData', 'Roaming', 'zeus-agent');
                const taskWorkspace = taskId ? path.join(testWorkspaceRoot, 'tasks', taskId, 'workspace') : null;

                // Deploy fixtures if needed (Prompts 4, 7, 9)
                if (taskWorkspace) {
                    const deployScript = path.resolve(__dirname, '../../scripts/eval_harness/deploy_fixtures.js');
                    if (fs.existsSync(deployScript)) {
                        try {
                            if (!fs.existsSync(taskWorkspace)) {
                                fs.mkdirSync(taskWorkspace, { recursive: true });
                            }
                            execSync(`node "${deployScript}" --dest "${taskWorkspace}"`, { stdio: 'pipe' });
                            console.log(`[Benchmark] Deployed fixtures into task workspace: ${taskWorkspace}`);
                        } catch (e) {
                            console.warn('[Benchmark] Fixture deployment warning:', e.message);
                        }
                    }
                }

                // Execute each turn in order
                for (const turn of promptSpec.turns) {
                    console.log(`\n[Prompt ${promptSpec.id} | Turn ${turn.turn}] Sending prompt:\n"${turn.user_prompt}"\n`);
                    await submitPromptAndWait(page, turn.user_prompt, testInfo, 10 * 60 * 1000);

                    // If turn has python check, execute it in task workspace
                    if (turn.python_check && taskWorkspace) {
                        const checkScriptPath = path.join(taskWorkspace, `__eval_check_turn_${turn.turn}.py`);
                        fs.writeFileSync(checkScriptPath, turn.python_check, 'utf8');
                        try {
                            execSync(`python "${checkScriptPath}"`, { cwd: taskWorkspace, stdio: 'pipe' });
                            console.log(`✅ [Prompt ${promptSpec.id} | Turn ${turn.turn}] Python verification check passed!`);
                        } catch (err) {
                            console.error(`❌ [Prompt ${promptSpec.id} | Turn ${turn.turn}] Python verification check failed:`, err.message);
                            throw new Error(`Python check assertion failed for Prompt ${promptSpec.id} (Turn ${turn.turn}): ${err.message}`);
                        } finally {
                            if (fs.existsSync(checkScriptPath)) {
                                fs.unlinkSync(checkScriptPath);
                            }
                        }
                    }
                }
            } finally {
                // Capture artifacts
                try {
                    await captureArtifacts(page, testInfo, testInfo.status);
                } catch (e) {
                    console.error('Failed to capture artifacts:', e);
                }

                await cleanupTasks(page);
                await stopTauri();
            }
        });
    }
});
