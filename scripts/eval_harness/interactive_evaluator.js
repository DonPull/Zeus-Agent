import { chromium } from '@playwright/test';
import { spawn, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');
const ipcDir = path.join(rootDir, '.zeus', 'eval_ipc');
const sessionFile = path.join(ipcDir, 'active_session.json');

function ensureIpcDir() {
    if (!fs.existsSync(ipcDir)) {
        fs.mkdirSync(ipcDir, { recursive: true });
    }
}

function loadPrompts() {
    const promptsFile = path.join(__dirname, 'prompts', '10_agentic_prompts.json');
    if (!fs.existsSync(promptsFile)) {
        throw new Error(`Prompts file not found at ${promptsFile}`);
    }
    return JSON.parse(fs.readFileSync(promptsFile, 'utf8'));
}

async function connectToActiveSession() {
    if (!fs.existsSync(sessionFile)) {
        throw new Error("No active session found. Start one with: node scripts/eval_harness/interactive_evaluator.js start --prompt <name>");
    }
    const session = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${session.cdpPort}`);
    const defaultContext = browser.contexts()[0];
    while (defaultContext.pages().length === 0) {
        await new Promise(r => setTimeout(r, 100));
    }
    const page = defaultContext.pages()[0];
    return { browser, page, session };
}

async function ensureViteServer() {
    try {
        const res = await fetch('http://127.0.0.1:1420');
        if (res.ok || res.status < 500) return;
    } catch (_) {}

    console.log('[InteractiveEvaluator] Starting Vite dev server on http://127.0.0.1:1420...');
    const viteProcess = spawn('npm', ['run', 'dev'], {
        cwd: rootDir,
        shell: process.platform === 'win32',
        stdio: 'ignore'
    });
    viteProcess.unref();

    const startTime = Date.now();
    while (Date.now() - startTime < 30000) {
        try {
            const res = await fetch('http://127.0.0.1:1420');
            if (res.ok || res.status < 500) break;
        } catch (_) {}
        await new Promise(r => setTimeout(r, 500));
    }
}

async function startPrompt(promptKey, modelName = "Qwen3.8-27B", timeoutSec = 240) {
    ensureIpcDir();
    await ensureViteServer();

    // Kill any existing session first
    await stopSession();

    const prompts = loadPrompts();
    const promptSpec = prompts.find(p => p.name === promptKey || p.id.toString() === promptKey || p.name.includes(promptKey));
    if (!promptSpec) {
        throw new Error(`Prompt not found: "${promptKey}". Available: ${prompts.map(p => p.name).join(', ')}`);
    }

    const cdpPort = Math.floor(Math.random() * (9999 - 9222 + 1)) + 9222;
    const testWorkspaceDir = path.join(rootDir, 'tests', 'e2e', '.test_workspace');
    if (fs.existsSync(testWorkspaceDir)) {
        try { fs.rmSync(testWorkspaceDir, { recursive: true, force: true }); } catch (_) {}
    }
    fs.mkdirSync(testWorkspaceDir, { recursive: true });

    console.log(`[InteractiveEvaluator] Launching Tauri with CDP port ${cdpPort}...`);
    const env = {
        ...process.env,
        ZEUS_TEST_WORKSPACE_ROOT: testWorkspaceDir,
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${cdpPort}`,
        WEBVIEW2_USER_DATA_FOLDER: path.join(testWorkspaceDir, `wv2_${cdpPort}`)
    };

    const tauriProcess = spawn('cargo', ['run', '--', '--remote-debugging-port', cdpPort.toString()], {
        cwd: path.join(rootDir, 'src-tauri'),
        env,
        shell: process.platform === 'win32',
        detached: true
    });
    tauriProcess.unref();

    tauriProcess.stdout.on('data', d => console.log(`[Tauri] ${d.toString().trim()}`));
    tauriProcess.stderr.on('data', d => console.error(`[Tauri ERR] ${d.toString().trim()}`));

    // Poll for CDP readiness
    let browser, page;
    const startTime = Date.now();
    while (Date.now() - startTime < 60000) {
        try {
            browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
            const defaultContext = browser.contexts()[0];
            while (defaultContext.pages().length === 0) {
                await new Promise(r => setTimeout(r, 100));
            }
            page = defaultContext.pages()[0];
            break;
        } catch (_) {
            await new Promise(r => setTimeout(r, 500));
        }
    }

    if (!page) {
        throw new Error("Timeout connecting to Tauri WebView2 over CDP.");
    }

    // Wait for UI
    await page.waitForSelector('#app-container', { timeout: 15000 });

    // Click New Task
    await page.locator('#new-task-button, #empty-state-new-task-button').first().click();
    await page.waitForTimeout(1000);

    // Get taskId and configure task settings
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

    const taskWorkspace = taskId ? path.join(testWorkspaceDir, 'tasks', taskId, 'workspace') : null;
    if (taskWorkspace) {
        fs.mkdirSync(taskWorkspace, { recursive: true });
        const deployScript = path.join(__dirname, 'deploy_fixtures.js');
        if (fs.existsSync(deployScript)) {
            try {
                execSync(`node "${deployScript}" --dest "${taskWorkspace}"`, { stdio: 'pipe' });
            } catch (_) {}
        }
    }

    const sessionData = {
        cdpPort,
        pid: tauriProcess.pid,
        promptKey: promptSpec.name,
        promptId: promptSpec.id,
        promptTitle: promptSpec.title,
        taskId,
        taskWorkspace,
        currentTurnIndex: 0,
        turns: promptSpec.turns,
        startedAt: Date.now()
    };
    fs.writeFileSync(sessionFile, JSON.stringify(sessionData, null, 2), 'utf8');

    // Execute all turns for this prompt
    for (let i = 0; i < promptSpec.turns.length; i++) {
        const turn = promptSpec.turns[i];
        sessionData.currentTurnIndex = i;
        fs.writeFileSync(sessionFile, JSON.stringify(sessionData, null, 2), 'utf8');

        console.log(`\n======================================================`);
        console.log(`🚀 [Prompt ${promptSpec.id}] Starting Turn ${turn.turn}: ${promptSpec.title}`);
        console.log(`Prompt: "${turn.user_prompt}"`);
        console.log(`======================================================\n`);

        await page.fill('#chat-input', turn.user_prompt);
        await page.click('#chat-send-button');

        await monitorTurn(browser, page, sessionData, timeoutSec);
    }

    // When all turns complete, verify and capture
    console.log(`\n[InteractiveEvaluator] All turns completed. Running verification and capturing artifacts...`);
    const verifyResult = await verifyAndCapture(promptSpec.name);
    console.log(`\n======================================================`);
    console.log(`🏁 [Prompt ${promptSpec.id}] Evaluation Complete!`);
    console.log(`Python Check Passed: ${verifyResult.pythonCheckPassed ? "YES ✅" : "NO ❌"}`);
    console.log(`Artifacts Saved To: ${verifyResult.resultsDir}`);
    console.log(`======================================================\n`);
}

async function monitorTurn(browser, page, sessionData, timeoutSec = 240) {
    const timeoutMs = timeoutSec * 1000;
    let startTime = Date.now();
    let endTime = startTime + timeoutMs;

    while (Date.now() < endTime) {
        // 1. Check for pending approval cards
        const pendingCard = page.locator('.approval-card.pending').last();
        if (await pendingCard.count() > 0) {
            const cardTitle = await pendingCard.locator('.approval-card-title').innerText().catch(() => "Permission Required");
            const cardDetail = await pendingCard.locator('.approval-card-detail').innerText().catch(() => "");
            
            const cardMeta = await page.evaluate(async () => {
                if (!window.__ZEUS_BRIDGE__) return null;
                const tasks = await window.__ZEUS_BRIDGE__.listTasks();
                if (!tasks || tasks.length === 0) return null;
                const msgs = await window.__ZEUS_BRIDGE__.getTaskMessages(tasks[0].id, true);
                const approvalMsg = msgs.slice().reverse().find(m => m.kind === 'approval' && m.content.includes('"pending"'));
                if (!approvalMsg) return null;
                try {
                    const parsed = JSON.parse(approvalMsg.content);
                    return {
                        messageId: approvalMsg.id,
                        summary: parsed.summary,
                        detail: parsed.detail,
                        blocked_directive: parsed.blocked_directive
                    };
                } catch (_) {
                    return { messageId: approvalMsg.id };
                }
            });

            const cardInfo = {
                messageId: (cardMeta && cardMeta.messageId) || `card_${Date.now()}`,
                title: cardTitle,
                detail: cardDetail,
                blocked_directive: cardMeta ? cardMeta.blocked_directive : null,
                promptTitle: sessionData.promptTitle,
                promptKey: sessionData.promptKey,
                currentTurnIndex: sessionData.currentTurnIndex
            };

            const cardFile = path.join(ipcDir, 'active_card.json');
            const decisionFile = path.join(ipcDir, 'decision.json');
            if (fs.existsSync(decisionFile)) try { fs.unlinkSync(decisionFile); } catch (_) {}
            fs.writeFileSync(cardFile, JSON.stringify(cardInfo, null, 2), 'utf8');

            console.log(`\n======================================================`);
            console.log(`⚠️ [ANTIGRAVITY_CARD_DECISION_NEEDED]`);
            console.log(`Prompt: ${sessionData.promptTitle}`);
            console.log(`Card: "${cardTitle}"`);
            if (cardDetail) console.log(`Detail: ${cardDetail}`);
            if (cardInfo.blocked_directive) console.log(`Blocked Directive:`, JSON.stringify(cardInfo.blocked_directive, null, 2));
            console.log(`Waiting for decision in: ${decisionFile}`);
            console.log(`Decision JSON format: { "action": "approve" | "deny" | "deny_with_feedback", "feedback": "..." }`);
            console.log(`======================================================\n`);

            // Wait for decision file from Antigravity
            let decision = null;
            const waitLimit = Date.now() + 180000; // 3 minutes wait for decision
            while (Date.now() < waitLimit) {
                if (fs.existsSync(decisionFile)) {
                    try {
                        decision = JSON.parse(fs.readFileSync(decisionFile, 'utf8'));
                        break;
                    } catch (_) {}
                }
                await new Promise(r => setTimeout(r, 500));
            }

            if (!decision) {
                console.warn(`[InteractiveEvaluator] No decision written in 180s, defaulting to Deny.`);
                decision = { action: 'deny' };
            }

            console.log(`[InteractiveEvaluator] Applying decision: ${decision.action} ${decision.feedback ? `("${decision.feedback}")` : ''}`);

            if (decision.action === 'approve') {
                const approveBtn = pendingCard.locator('button:has-text("Approve")').first();
                await approveBtn.click({ force: true });
            } else if (decision.action === 'deny_with_feedback' && decision.feedback) {
                const feedbackBtn = pendingCard.locator('button:has-text("Deny with Feedback")').first();
                if (await feedbackBtn.count() > 0) {
                    await feedbackBtn.click({ force: true });
                    const feedbackInput = pendingCard.locator('.settings-input').first();
                    await feedbackInput.waitFor({ state: 'visible', timeout: 5000 });
                    await feedbackInput.fill(decision.feedback);
                    const submitBtn = pendingCard.locator('button:has-text("Submit Deny & Feedback")').first();
                    await submitBtn.click({ force: true });
                } else {
                    const denyBtn = pendingCard.locator('button:has-text("Deny")').first();
                    await denyBtn.click({ force: true });
                }
            } else {
                const denyBtn = pendingCard.locator('button:has-text("Deny")').first();
                await denyBtn.click({ force: true });
            }

            // Append to audit history
            const auditFile = path.join(ipcDir, 'audit_history.json');
            let auditList = [];
            if (fs.existsSync(auditFile)) {
                try { auditList = JSON.parse(fs.readFileSync(auditFile, 'utf8')); } catch (_) {}
            }
            auditList.push({
                card: cardInfo,
                decision: decision,
                timestamp: Date.now()
            });
            fs.writeFileSync(auditFile, JSON.stringify(auditList, null, 2), 'utf8');

            // Reset turn start time so agent gets fresh execution time after decision
            startTime = Date.now();
            endTime = startTime + timeoutMs;

            if (fs.existsSync(cardFile)) try { fs.unlinkSync(cardFile); } catch (_) {}
            if (fs.existsSync(decisionFile)) try { fs.unlinkSync(decisionFile); } catch (_) {}

            await new Promise(r => setTimeout(r, 2000));
            continue;
        }

        // 2. Check for browser handoff card
        const pendingHandoff = page.locator('.approval-card.pending button:has-text("Done, Resume Agent")').last();
        if (await pendingHandoff.count() > 0) {
            console.log("[InteractiveEvaluator] Detected Browser Handoff card. Resuming...");
            await pendingHandoff.click({ force: true });
            await page.waitForTimeout(1500);
            continue;
        }

        // 3. Check if turn finished (button returned to Send after at least 3s of prompt submission)
        if (Date.now() - startTime > 3000) {
            const sendBtn = page.locator('#chat-send-button');
            const btnText = await sendBtn.innerText().catch(() => "");
            if (btnText.includes('Send')) {
                const pendingCount = await page.locator('.approval-card.pending').count();
                if (pendingCount === 0) {
                    console.log(`\n✅ [InteractiveEvaluator] Turn completed in ${((Date.now() - startTime) / 1000).toFixed(1)}s.`);
                    
                    // Remove active card if any
                    const cardFile = path.join(ipcDir, 'active_card.json');
                    if (fs.existsSync(cardFile)) try { fs.unlinkSync(cardFile); } catch (_) {}

                    return { status: "TURN_COMPLETED", session: sessionData };
                }
            }
        }

        await new Promise(r => setTimeout(r, 1000));
    }

    console.error(`\n❌ [InteractiveEvaluator] Turn timed out after ${timeoutSec}s.`);
    process.exit(1);
}

async function decide(action, feedbackText = null, timeoutSec = 240) {
    const { browser, page, session } = await connectToActiveSession();
    const pendingCard = page.locator('.approval-card.pending').last();

    if (await pendingCard.count() === 0) {
        console.log("[InteractiveEvaluator] No pending approval card found in UI.");
        process.exit(0);
    }

    console.log(`[InteractiveEvaluator] Applying decision: ${action} ${feedbackText ? `("${feedbackText}")` : ''}`);

    if (action === 'approve') {
        const approveBtn = pendingCard.locator('button:has-text("Approve")').first();
        await approveBtn.click({ force: true });
    } else if (action === 'deny_with_feedback' && feedbackText) {
        const feedbackBtn = pendingCard.locator('button:has-text("Deny with Feedback")').first();
        if (await feedbackBtn.count() > 0) {
            await feedbackBtn.click({ force: true });
            const feedbackInput = pendingCard.locator('.settings-input').first();
            await feedbackInput.waitFor({ state: 'visible', timeout: 5000 });
            await feedbackInput.fill(feedbackText);
            const submitBtn = pendingCard.locator('button:has-text("Submit Deny & Feedback")').first();
            await submitBtn.click({ force: true });
        } else {
            const denyBtn = pendingCard.locator('button:has-text("Deny")').first();
            await denyBtn.click({ force: true });
        }
    } else {
        const denyBtn = pendingCard.locator('button:has-text("Deny")').first();
        await denyBtn.click({ force: true });
    }

    // Record decision in audit history
    const auditFile = path.join(ipcDir, 'audit_history.json');
    let auditList = [];
    if (fs.existsSync(auditFile)) {
        try { auditList = JSON.parse(fs.readFileSync(auditFile, 'utf8')); } catch (_) {}
    }
    const cardFile = path.join(ipcDir, 'active_card.json');
    let cardData = null;
    if (fs.existsSync(cardFile)) {
        try { cardData = JSON.parse(fs.readFileSync(cardFile, 'utf8')); } catch (_) {}
        try { fs.unlinkSync(cardFile); } catch (_) {}
    }
    auditList.push({
        card: cardData,
        decision: { action, feedback: feedbackText },
        timestamp: Date.now()
    });
    fs.writeFileSync(auditFile, JSON.stringify(auditList, null, 2), 'utf8');

    await page.waitForTimeout(1500);
    return await monitorTurn(browser, page, session, timeoutSec);
}

async function verifyAndCapture(promptKey) {
    const { browser, page, session } = await connectToActiveSession();
    const prompts = loadPrompts();
    const promptSpec = prompts.find(p => p.name === promptKey || p.id.toString() === promptKey || p.name.includes(promptKey));

    const resultsDir = path.join(rootDir, 'tests', 'advanced_e2e', 'results', `[Prompt_${promptSpec.id}]_${promptSpec.name}`);
    fs.mkdirSync(resultsDir, { recursive: true });

    // 1. Screenshot
    await page.screenshot({ path: path.join(resultsDir, 'screenshot.png'), fullPage: true });

    // 2. Chat Log
    try {
        await page.click('#chat-log-button', { timeout: 5000 });
        const modal = page.locator('.modal-content:has-text("Chat log")');
        await modal.waitFor({ state: 'visible', timeout: 5000 });
        const text = await page.locator('#chat-log-body').innerText();
        fs.writeFileSync(path.join(resultsDir, 'chat_log.txt'), text, 'utf8');
        await page.keyboard.press('Escape');
    } catch (_) {}

    // 3. Debug Log
    try {
        const debugLog = await page.evaluate(async (tid) => {
            if (!window.__ZEUS_BRIDGE__) return "No bridge";
            return await window.__ZEUS_BRIDGE__.getDebugLog(tid);
        }, session.taskId);
        fs.writeFileSync(path.join(resultsDir, 'debug_log.txt'), debugLog, 'utf8');
    } catch (_) {}

    // 4. Run python verification check
    let pythonCheckPassed = true;
    for (const turn of promptSpec.turns) {
        if (turn.python_check && session.taskWorkspace) {
            const checkFile = path.join(session.taskWorkspace, `__verify_turn_${turn.turn}.py`);
            fs.writeFileSync(checkFile, turn.python_check, 'utf8');
            try {
                execSync(`python "${checkFile}"`, { cwd: session.taskWorkspace, stdio: 'pipe' });
                console.log(`✅ [Prompt ${promptSpec.id} | Turn ${turn.turn}] Python verification check PASSED.`);
            } catch (e) {
                console.error(`❌ [Prompt ${promptSpec.id} | Turn ${turn.turn}] Python verification check FAILED: ${e.message}`);
                pythonCheckPassed = false;
            } finally {
                if (fs.existsSync(checkFile)) try { fs.unlinkSync(checkFile); } catch (_) {}
            }
        }
    }

    await stopSession();
    return { pythonCheckPassed, resultsDir };
}

async function stopSession() {
    if (fs.existsSync(sessionFile)) {
        try {
            const session = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
            if (session.pid) {
                if (process.platform === 'win32') {
                    try { execSync(`taskkill /pid ${session.pid} /f /t`, { stdio: 'ignore' }); } catch (_) {}
                    try { execSync(`taskkill /f /im zeus-agent.exe`, { stdio: 'ignore' }); } catch (_) {}
                } else {
                    process.kill(session.pid);
                }
            }
        } catch (_) {}
        try { fs.unlinkSync(sessionFile); } catch (_) {}
    }
}

// CLI Routing
const args = process.argv.slice(2);
const command = args[0];

function getArg(flag) {
    const idx = args.indexOf(flag);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
}

try {
    if (command === 'start') {
        const prompt = getArg('--prompt') || 'sofia_weather';
        const model = getArg('--model') || 'Qwen3.8-27B';
        const timeout = parseInt(getArg('--timeout') || '540', 10);
        await startPrompt(prompt, model, timeout);
    } else if (command === 'decide') {
        const action = getArg('--action') || 'approve';
        const feedback = getArg('--feedback') || null;
        const timeout = parseInt(getArg('--timeout') || '240', 10);
        await decide(action, feedback, timeout);
    } else if (command === 'verify') {
        const prompt = getArg('--prompt') || 'sofia_weather';
        await verifyAndCapture(prompt);
    } else if (command === 'stop') {
        await stopSession();
        console.log('[InteractiveEvaluator] Session stopped.');
    } else {
        console.log('Usage:');
        console.log('  node interactive_evaluator.js start --prompt <name> [--timeout <sec>]');
        console.log('  node interactive_evaluator.js decide --action <approve|deny|deny_with_feedback> [--feedback "<text>"]');
        console.log('  node interactive_evaluator.js verify --prompt <name>');
        console.log('  node interactive_evaluator.js stop');
    }
} catch (err) {
    console.error(`[InteractiveEvaluator Error] ${err.message}`);
    process.exit(1);
}
