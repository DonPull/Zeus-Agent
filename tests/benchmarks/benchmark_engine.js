import { test, expect } from '@playwright/test';
import { launchTauri, stopTauri, cleanupTasks } from '../e2e/testUtils.js';
import { submitPromptAndWait, captureArtifacts, pruneResults, cleanIpcDir } from '../advanced_e2e/advancedUtils.js';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import {
    buildScoreRecord,
    appendScore,
    writeDashboard,
    inferCategories,
} from './score_recorder.js';

/**
 * Recursively copies a directory to destination.
 */
function copyRecursive(src, dst) {
    if (!fs.existsSync(src)) return;
    if (!fs.existsSync(dst)) {
        fs.mkdirSync(dst, { recursive: true });
    }
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const dstPath = path.join(dst, entry.name);
        if (entry.isDirectory()) {
            copyRecursive(srcPath, dstPath);
        } else {
            fs.copyFileSync(srcPath, dstPath);
        }
    }
}

/**
 * Visual Evaluator: Opens Session Replay, steps through actions, captures visual artifacts, and toggles overlays.
 */
async function runVisualEvaluation(page, suiteDir, taskId) {
    const visualArtifactsDir = path.join(suiteDir, 'visual_artifacts');
    if (!fs.existsSync(visualArtifactsDir)) {
        fs.mkdirSync(visualArtifactsDir, { recursive: true });
    }

    try {
        const replayBtn = page.locator('#browser-session-replay-btn').last();
        if (await replayBtn.count() > 0 && await replayBtn.isVisible()) {
            console.log('\n[Visual Evaluator] Found completed browser session card. Opening Replay Modal...');
            await replayBtn.click();
            const replayModal = page.locator('.modal-container').filter({ hasText: 'Browser Session Replay' });
            await expect(replayModal).toBeVisible({ timeout: 5000 });

            // Capture Step 1
            const step1Img = path.join(visualArtifactsDir, 'replay_step_1.png');
            await page.screenshot({ path: step1Img });
            console.log(`[Visual Evaluator] Captured Step 1 screenshot: ${step1Img}`);

            // If next button is available, advance to Step 2
            const nextBtn = page.locator('#replay-next-button');
            if (await nextBtn.count() > 0 && !(await nextBtn.isDisabled())) {
                await nextBtn.click();
                await page.waitForTimeout(500);

                const step2Img = path.join(visualArtifactsDir, 'replay_step_2_highlight_on.png');
                await page.screenshot({ path: step2Img });
                console.log(`[Visual Evaluator] Captured Step 2 (Highlight ON): ${step2Img}`);

                // Toggle highlight OFF
                const toggleBtn = page.locator('#replay-highlight-toggle');
                if (await toggleBtn.count() > 0) {
                    await toggleBtn.click();
                    await page.waitForTimeout(300);
                    const step2OffImg = path.join(visualArtifactsDir, 'replay_step_2_highlight_off.png');
                    await page.screenshot({ path: step2OffImg });
                    console.log(`[Visual Evaluator] Captured Step 2 (Highlight OFF): ${step2OffImg}`);
                    // Toggle back ON
                    await toggleBtn.click();
                }
            }

            // Close Replay Modal
            await page.locator('#replay-modal-close-button').click();
            await expect(replayModal).not.toBeVisible();
            console.log('[Visual Evaluator] Session Replay modal verified and closed cleanly.\n');
        }
    } catch (err) {
        console.warn('[Visual Evaluator] Warning during visual evaluation:', err.message);
    }
}

/**
 * Registers an autonomous Playwright benchmark suite for a given suite folder.
 * 
 * @param {string} suiteTitle - Human-readable suite name (e.g. 'Wave 1: Foundation Benchmarks')
 * @param {string} suiteDir - Absolute path to the suite folder
 * @param {object} [customOptions] - Optional overrides for model configs and timeouts
 */
export function registerBenchmarkSuite(suiteTitle, suiteDir, customOptions = {}) {
    // 1. Locate prompts.json
    const promptsFile = path.join(suiteDir, 'prompts.json');
    if (!fs.existsSync(promptsFile)) {
        console.warn(`[Benchmark Engine] No prompts.json found in ${suiteDir}`);
        return;
    }
    const prompts = JSON.parse(fs.readFileSync(promptsFile, 'utf8'));

    // 2. Load optional suite_config.json
    const configFile = path.join(suiteDir, 'suite_config.json');
    const suiteConfig = fs.existsSync(configFile) ? JSON.parse(fs.readFileSync(configFile, 'utf8')) : {};
    const options = { ...suiteConfig, ...customOptions };

    const promptTimeoutMs = options.prompt_timeout_ms || (15 * 60 * 1000);
    const turnTimeoutMs = options.turn_timeout_ms || (10 * 60 * 1000);

    test.describe(suiteTitle, () => {
        test.setTimeout(promptTimeoutMs);

        let browser;
        let page;

        test.beforeAll(async () => {
            pruneResults();
            cleanIpcDir();
        });

        for (const promptSpec of prompts) {
            test(`[Prompt ${promptSpec.id}] ${promptSpec.title} (${promptSpec.name})`, async ({}, testInfo) => {
                test.setTimeout(Math.max(promptTimeoutMs, turnTimeoutMs * promptSpec.turns.length + 60000));
                console.log(`\n================================================================`);
                console.log(`🚀 [${suiteTitle}] PROMPT ${promptSpec.id}: ${promptSpec.title}`);
                console.log(`================================================================\n`);

                // 1. Launch Tauri in real mode
                const tauri = await launchTauri(true);
                browser = tauri.browser;
                page = tauri.page;

                let taskId = null;
                try {
                    // 2. Wait for UI to boot
                    await expect(page.locator('#app-container')).toBeVisible({ timeout: 15000 });

                    // 3. Create fresh task
                    await page.locator('#new-task-button, #empty-state-new-task-button').first().click();

                    // 4. Configure task models & budget
                    const defaultModel = process.env.ZEUS_BENCHMARK_MODEL || options.default_model || "Qwen3.8-27B";
                    const modelSettings = {
                        master_model: options.master_model || defaultModel,
                        worker_model: options.worker_model || defaultModel,
                        verifier_model: options.verifier_model || defaultModel,
                        watcher_model: options.watcher_model || defaultModel,
                        vision_model: options.vision_model || "gemini-3.8-flash",
                        budget_credits: options.budget_credits || options.budget_units || 500000,
                        browser_mode: options.browser_mode || "sandboxed"
                    };

                    taskId = await page.evaluate(async (settings) => {
                        if (!window.__ZEUS_BRIDGE__) return null;
                        const tasks = await window.__ZEUS_BRIDGE__.listTasks();
                        if (!tasks || tasks.length === 0) return null;
                        const id = tasks[0].id;
                        await window.__ZEUS_BRIDGE__.updateTaskSettings(id, settings);
                        return id;
                    }, modelSettings);

                    const testWorkspaceRoot = process.env.ZEUS_TEST_WORKSPACE_ROOT || path.join(os.homedir(), 'AppData', 'Roaming', 'zeus-agent');
                    const taskWorkspace = taskId ? path.join(testWorkspaceRoot, 'tasks', taskId, 'workspace') : null;

                    // 5. Automatic Fixture Deployment
                    if (taskWorkspace) {
                        if (!fs.existsSync(taskWorkspace)) {
                            fs.mkdirSync(taskWorkspace, { recursive: true });
                        }

                        // A. Check for custom deploy_fixtures.js script
                        const customDeployScript = path.join(suiteDir, 'deploy_fixtures.js');
                        const fixturesDir = path.join(suiteDir, 'fixtures');
                        if (fs.existsSync(customDeployScript)) {
                            try {
                                execSync(`node "${customDeployScript}" --dest "${taskWorkspace}"`, { stdio: 'pipe' });
                                console.log(`[Benchmark Engine] Executed custom deploy_fixtures.js into: ${taskWorkspace}`);
                            } catch (e) {
                                console.warn('[Benchmark Engine] Custom fixture deploy warning:', e.message);
                            }
                        } else if (fs.existsSync(fixturesDir)) {
                            // B. Default convention: auto-copy suiteDir/fixtures/ if present
                            copyRecursive(fixturesDir, taskWorkspace);
                            console.log(`[Benchmark Engine] Auto-deployed suite fixtures from ${fixturesDir} into: ${taskWorkspace}`);
                        }

                        // Ensure 'workspace' subdir exists within taskWorkspace if fixtures were deployed
                        const workspaceSubdir = path.join(taskWorkspace, 'workspace');
                        if (!fs.existsSync(workspaceSubdir) && fs.existsSync(fixturesDir)) {
                            copyRecursive(fixturesDir, workspaceSubdir);
                            console.log(`[Benchmark Engine] Mirrored fixtures into: ${workspaceSubdir}`);
                        }
                    }

                    // 6. Execute turns in order
                    const visualArtifactsDir = path.join(suiteDir, 'visual_artifacts');
                    if (fs.existsSync(visualArtifactsDir)) {
                        process.env.ZEUS_VISUAL_EVAL_DIR = visualArtifactsDir;
                    }

                    const promptStartTime = Date.now();
                    const pythonCheckDetails = [];
                    for (const turn of promptSpec.turns) {
                        console.log(`\n[Prompt ${promptSpec.id} | Turn ${turn.turn}] Sending prompt:\n"${turn.user_prompt}"\n`);
                        await submitPromptAndWait(page, turn.user_prompt, testInfo, turnTimeoutMs);

                        // 6.5 Visual Evaluator: Inspect completed session replay if available
                        await runVisualEvaluation(page, suiteDir, taskId);

                        // 7. Deterministic Python Verification Check
                        if (turn.python_check && taskWorkspace) {
                            const checkScriptPath = path.join(taskWorkspace, `__eval_check_turn_${turn.turn}.py`);
                            fs.writeFileSync(checkScriptPath, turn.python_check, 'utf8');
                            try {
                                execSync(`python "${checkScriptPath}"`, { cwd: taskWorkspace, stdio: 'pipe' });
                                console.log(`✅ [Prompt ${promptSpec.id} | Turn ${turn.turn}] Python verification check passed!`);
                                pythonCheckDetails.push({ turn: turn.turn, passed: true, error: null });
                            } catch (err) {
                                console.error(`❌ [Prompt ${promptSpec.id} | Turn ${turn.turn}] Python check failed:`, err.message);
                                pythonCheckDetails.push({ turn: turn.turn, passed: false, error: err.message });
                                // score-only mode records failure and continues; otherwise fail the test
                                if (process.env.ZEUS_SCORE_ONLY !== '1') {
                                    throw new Error(`Python check assertion failed for Prompt ${promptSpec.id} (Turn ${turn.turn}): ${err.message}`);
                                }
                            } finally {
                                if (fs.existsSync(checkScriptPath)) {
                                    fs.unlinkSync(checkScriptPath);
                                }
                            }
                        }
                    }
                } finally {
                    delete process.env.ZEUS_VISUAL_EVAL_DIR;
                    // 8. Track exact token units consumed
                    let promptUnits = 0;
                    let messageCount = 0;
                    let modelsUsed = [];
                    if (page && !page.isClosed()) {
                        try {
                            const usageData = await page.evaluate(async (tid) => {
                                if (!window.__ZEUS_BRIDGE__ || !tid) return null;
                                const msgs = await window.__ZEUS_BRIDGE__.getTaskMessages(tid, true).catch(() => []);
                                const totalFromMsgs = (msgs || []).reduce((acc, m) => acc + (m.units || m.credits_used || 0), 0);
                                const spend = await window.__ZEUS_BRIDGE__.getTaskSpend(tid).catch(() => null);
                                const finalUnits = (spend && typeof spend.spent_credits === 'number' && spend.spent_credits > 0)
                                    ? spend.spent_credits
                                    : totalFromMsgs;
                                const models = [...new Set((msgs || []).map(m => m.model).filter(Boolean))];
                                return { totalUnits: Math.round(finalUnits), count: (msgs || []).length, models };
                            }, taskId);
                            if (usageData) {
                                promptUnits = usageData.totalUnits;
                                messageCount = usageData.count;
                                modelsUsed = usageData.models || [];
                            }
                        } catch (e) {
                            console.warn('[Benchmark Engine] Could not query task units:', e.message);
                        }
                    }

                    // Record in suite's units_ledger.json
                    const ledgerFile = path.join(suiteDir, 'units_ledger.json');
                    let ledger = {};
                    if (fs.existsSync(ledgerFile)) {
                        try { ledger = JSON.parse(fs.readFileSync(ledgerFile, 'utf8')); } catch (_) {}
                    }
                    ledger[promptSpec.id] = {
                        id: promptSpec.id,
                        name: promptSpec.name,
                        title: promptSpec.title,
                        units_used: promptUnits,
                        message_count: messageCount,
                        models_used: modelsUsed,
                        duration_seconds: typeof promptStartTime === 'number' ? Math.round((Date.now() - promptStartTime) / 1000) : 0,
                        timestamp: new Date().toISOString(),
                        status: testInfo.status || 'unknown'
                    };
                    const totalSuiteUnits = Object.entries(ledger)
                        .filter(([k]) => k !== '__total_suite_units')
                        .reduce((acc, [_, entry]) => acc + (entry.units_used || 0), 0);
                    ledger.__total_suite_units = totalSuiteUnits;
                    try {
                        fs.writeFileSync(ledgerFile, JSON.stringify(ledger, null, 2), 'utf8');
                    } catch (e) {
                        console.warn('[Benchmark Engine] Failed to write units_ledger.json:', e.message);
                    }

                    console.log(`\n📊 [UNITS LEDGER] Prompt ${promptSpec.id} (${promptSpec.name}): ${promptUnits.toLocaleString()} units consumed (${messageCount} messages).`);
                    console.log(`📊 [UNITS LEDGER] Cumulative Total for Suite: ${totalSuiteUnits.toLocaleString()} units.\n`);

                    // 8.5 Record rubric score (score-only or score-and-fix)
                    try {
                        const pythonCheckPassed =
                            pythonCheckDetails.length === 0
                                ? true
                                : pythonCheckDetails.every((c) => c.passed);
                        const durationSeconds = Math.round((Date.now() - promptStartTime) / 1000);
                        const scoreRecord = buildScoreRecord({
                            suiteTitle,
                            suiteDir,
                            promptSpec: { ...promptSpec, categories: promptSpec.categories || inferCategories(promptSpec) },
                            runMeta: {
                                master_model: modelSettings.master_model,
                                worker_model: modelSettings.worker_model,
                                verifier_model: modelSettings.verifier_model,
                                watcher_model: modelSettings.watcher_model,
                                vision_model: modelSettings.vision_model,
                                status: testInfo.status || 'unknown',
                            },
                            pythonCheckPassed,
                            pythonCheckDetails,
                            unitsUsed: promptUnits,
                            messageCount,
                            modelsUsed,
                            durationSeconds,
                        });
                        appendScore(suiteDir, scoreRecord);
                        writeDashboard([suiteDir], path.join(suiteDir, 'scores_dashboard.html'));
                        console.log(
                            `🏁 [SCORE] Prompt ${promptSpec.id} (${promptSpec.name}): ${scoreRecord.total_score}/10 ` +
                            `(acc ${scoreRecord.scores.accuracy} tools ${scoreRecord.scores.tools} ` +
                            `safety ${scoreRecord.scores.safety} effic ${scoreRecord.scores.efficiency}) ` +
                            `→ ${scoreRecord.passed ? 'PASS' : 'FAIL'} [${scoreRecord.mode}]`
                        );
                    } catch (scoreErr) {
                        console.warn('[Benchmark Engine] Failed to record score:', scoreErr.message);
                    }

                    // 9. Capture test artifacts and clean up
                    try {
                        await captureArtifacts(page, testInfo, testInfo.status);
                    } catch (e) {
                        console.error('[Benchmark Engine] Failed to capture artifacts:', e);
                    }

                    await cleanupTasks(page);
                    await stopTauri();
                }
            });
        }
    });
}
