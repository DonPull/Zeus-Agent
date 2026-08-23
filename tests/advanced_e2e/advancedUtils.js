import fs from 'fs';
import path from 'path';
import { expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Creates a new task in the UI and sets the specific models via Task Settings.
 */
async function setupAdvancedTask(page, taskName, modelConfig) {
    page.on('dialog', dialog => {
        console.log(`[Dialog] ${dialog.message()}`);
        dialog.dismiss();
    });

    // Click "New Task"
    await page.locator('#new-task-button, #empty-state-new-task-button').first().click();

    // Set models directly via bridge or Task Settings
    if (modelConfig) {
        await page.evaluate(async (cfg) => {
            if (!window.__ZEUS_BRIDGE__) return;
            const tasks = await window.__ZEUS_BRIDGE__.listTasks();
            if (!tasks || tasks.length === 0) return;
            const id = tasks[0].id;
            const updatePayload = {
                browser_mode: "sandboxed"
            };
            if (cfg["Master"]) updatePayload.master_model = cfg["Master"];
            if (cfg["Worker"]) updatePayload.worker_model = cfg["Worker"];
            if (cfg["Verifier"]) updatePayload.verifier_model = cfg["Verifier"];
            if (cfg["Watcher"]) updatePayload.watcher_model = cfg["Watcher"];
            if (cfg["Task Budget"]) updatePayload.budget_credits = parseInt(cfg["Task Budget"], 10) || 50000;
            await window.__ZEUS_BRIDGE__.updateTaskSettings(id, updatePayload);
        }, modelConfig);
    }
}

/**
 * Submits a prompt and waits for the agent to finish autonomously.
 */
const ipcDir = path.resolve(__dirname, '../../.zeus/eval_ipc');

function ensureIpcDir() {
    if (!fs.existsSync(ipcDir)) {
        fs.mkdirSync(ipcDir, { recursive: true });
    }
}

export function cleanIpcDir() {
    ensureIpcDir();
    const files = fs.readdirSync(ipcDir);
    for (const f of files) {
        if (f !== 'audit_history.json') {
            try { fs.unlinkSync(path.join(ipcDir, f)); } catch (_) {}
        }
    }
}

async function submitPromptAndWait(page, prompt, testInfo, timeoutMs = 600000, expectedText = null) {
    ensureIpcDir();

    // Fill prompt
    await page.fill('#chat-input', prompt);
    
    // Click send
    await page.click('#chat-send-button');

    // Wait for the button to change to "Stop" (meaning it started)
    await expect(page.locator('#chat-send-button')).toHaveText(/Stop/, { timeout: 10000 });

    const startTime = Date.now();
    const endTime = startTime + timeoutMs;

    while (Date.now() < endTime) {
        // 1. Check for credit/budget exhaustion
        const chatLog = page.locator('.chat-message.assistant, .chat-message.event, .chat-message.system');
        if (await chatLog.count() > 0) {
            const text = await chatLog.allInnerTexts();
            const joinedText = text.join('\n');
            if (joinedText.includes('BUDGET_EXCEEDED') || (joinedText.includes('credit') && joinedText.includes('run out')) || joinedText.includes('reached its unit budget')) {
                throw new Error("CREDIT_EXHAUSTED: The agent has run out of credits or budget.");
            }
            if (expectedText && joinedText.includes(expectedText)) {
                return; // Success!
            }
        }

        // 2. Check for pending approval card blocking the agent
        const pendingApproval = page.locator('.approval-card.pending').last();
        if (await pendingApproval.count() > 0) {
            const cardTitle = await pendingApproval.locator('.approval-card-title').innerText().catch(() => "Permission Required");
            const cardDetail = await pendingApproval.locator('.approval-card-detail').innerText().catch(() => "");
            
            // Extract message metadata via bridge
            const cardMeta = await page.evaluate(async () => {
                if (!window.__ZEUS_BRIDGE__) return null;
                const tasks = await window.__ZEUS_BRIDGE__.listTasks();
                if (!tasks || tasks.length === 0) return null;
                const msgs = await window.__ZEUS_BRIDGE__.getTaskMessages(tasks[0].id, true);
                const approvalMsg = msgs.slice().reverse().find(m => m.kind === 'approval');
                if (!approvalMsg) return null;
                try {
                    const parsed = JSON.parse(approvalMsg.content);
                    return {
                        messageId: approvalMsg.id,
                        taskId: tasks[0].id,
                        status: parsed.status,
                        summary: parsed.summary,
                        detail: parsed.detail,
                        blocked_directive: parsed.blocked_directive
                    };
                } catch (_) {
                    return { messageId: approvalMsg.id, taskId: tasks[0].id };
                }
            });

            const messageId = (cardMeta && cardMeta.messageId) || `card_${Date.now()}`;
            const pendingFile = path.join(ipcDir, 'pending_card.json');
            const decisionFileGeneral = path.join(ipcDir, 'decision.json');
            const decisionFileSpecific = path.join(ipcDir, `decision_${messageId}.json`);

            const pendingPayload = {
                status: 'pending',
                message_id: messageId,
                task_id: cardMeta ? cardMeta.taskId : null,
                title: cardTitle,
                detail: cardDetail,
                blocked_directive: cardMeta ? cardMeta.blocked_directive : null,
                prompt: prompt,
                test_title: testInfo ? testInfo.title : "Benchmark",
                timestamp: Date.now()
            };

            fs.writeFileSync(pendingFile, JSON.stringify(pendingPayload, null, 2), 'utf8');

            console.log(`\n======================================================`);
            console.log(`[ANTIGRAVITY_CARD_DECISION_NEEDED]`);
            console.log(`Card: "${cardTitle}"`);
            if (cardDetail) console.log(`Detail: ${cardDetail}`);
            if (cardMeta && cardMeta.blocked_directive) {
                console.log(`Blocked Directive:`, JSON.stringify(cardMeta.blocked_directive));
            }
            console.log(`Write decision to .zeus/eval_ipc/decision.json:`);
            console.log(`  { "decision": "approve" } | { "decision": "deny" } | { "decision": "deny_with_feedback", "feedback": "..." }`);
            console.log(`======================================================\n`);

            await takeMilestoneScreenshot(page, "Pending Card Awaiting Decision", testInfo);

            // Wait for decision file
            let decision = null;
            const waitDecisionTimeout = Date.now() + 180000; // 3 minutes wait for decision
            while (Date.now() < waitDecisionTimeout) {
                if (fs.existsSync(decisionFileSpecific)) {
                    try {
                        decision = JSON.parse(fs.readFileSync(decisionFileSpecific, 'utf8'));
                        break;
                    } catch (_) {}
                }
                if (fs.existsSync(decisionFileGeneral)) {
                    try {
                        decision = JSON.parse(fs.readFileSync(decisionFileGeneral, 'utf8'));
                        break;
                    } catch (_) {}
                }
                await page.waitForTimeout(500);
            }

            if (!decision) {
                console.warn(`[UserSimulator] No decision received within timeout, defaulting to Deny.`);
                decision = { decision: 'deny' };
            }

            console.log(`[UserSimulator] Applying decision: ${decision.decision}`);

            if (decision.decision === 'approve') {
                const approveBtn = pendingApproval.locator('button:has-text("Approve")').first();
                if (await approveBtn.count() > 0) {
                    await approveBtn.click({ force: true });
                }
            } else if (decision.decision === 'deny_with_feedback' && decision.feedback) {
                const feedbackBtn = pendingApproval.locator('button:has-text("Deny with Feedback")').first();
                if (await feedbackBtn.count() > 0) {
                    await feedbackBtn.click({ force: true });
                    const feedbackInput = pendingApproval.locator('.settings-input').first();
                    await expect(feedbackInput).toBeVisible({ timeout: 5000 });
                    await feedbackInput.fill(decision.feedback);
                    const submitBtn = pendingApproval.locator('button:has-text("Submit Deny & Feedback")').first();
                    await submitBtn.click({ force: true });
                } else {
                    const denyBtn = pendingApproval.locator('button:has-text("Deny")').first();
                    if (await denyBtn.count() > 0) await denyBtn.click({ force: true });
                }
            } else {
                const denyBtn = pendingApproval.locator('button:has-text("Deny")').first();
                if (await denyBtn.count() > 0) {
                    await denyBtn.click({ force: true });
                }
            }

            // Append to audit history
            const auditFile = path.join(ipcDir, 'audit_history.json');
            let auditList = [];
            if (fs.existsSync(auditFile)) {
                try { auditList = JSON.parse(fs.readFileSync(auditFile, 'utf8')); } catch (_) {}
            }
            auditList.push({
                card: pendingPayload,
                decision: decision,
                timestamp: Date.now()
            });
            fs.writeFileSync(auditFile, JSON.stringify(auditList, null, 2), 'utf8');

            // Clean up decision & pending files
            if (fs.existsSync(pendingFile)) try { fs.unlinkSync(pendingFile); } catch (_) {}
            if (fs.existsSync(decisionFileGeneral)) try { fs.unlinkSync(decisionFileGeneral); } catch (_) {}
            if (fs.existsSync(decisionFileSpecific)) try { fs.unlinkSync(decisionFileSpecific); } catch (_) {}

            await page.waitForTimeout(1500);
            continue;
        }

        // 3. Check for pending handoff card
        const pendingHandoff = page.locator('.approval-card.pending button:has-text("Done, Resume Agent")').last();
        if (await pendingHandoff.count() > 0) {
            await takeMilestoneScreenshot(page, "Browser Handoff Detected", testInfo);
            console.log("[UserSimulator] Detected Browser Handoff card. Setting up browser profile...");
            const taskId = await page.evaluate(async () => {
                if (!window.__ZEUS_BRIDGE__) return null;
                const tasks = await window.__ZEUS_BRIDGE__.listTasks();
                return tasks && tasks.length > 0 ? tasks[0].id : null;
            });
            
            if (taskId) {
                const testWorkspaceDir = process.env.ZEUS_TEST_WORKSPACE_ROOT || path.join(os.homedir(), 'AppData', 'Roaming', 'zeus-agent');
                const taskBrowserDir = path.join(testWorkspaceDir, 'tasks', taskId, 'browser', 'user_data');
                
                const goldenProfile = "D:\\Hristian projects\\browser_data";
                if (fs.existsSync(goldenProfile)) {
                    if (fs.existsSync(taskBrowserDir)) {
                        fs.rmSync(taskBrowserDir, { recursive: true, force: true });
                    }
                    fs.mkdirSync(taskBrowserDir, { recursive: true });
                    fs.cpSync(goldenProfile, taskBrowserDir, { recursive: true });
                    console.log("[UserSimulator] Golden profile swapped successfully.");
                }
            }
            
            await pendingHandoff.click({ force: true });
            await page.waitForTimeout(2000);
            continue;
        }

        // 4. Check if the button has returned to "Send" (agent finished turn)
        const sendBtn = page.locator('#chat-send-button');
        const btnText = await sendBtn.innerText().catch(() => "");
        if (btnText.includes('Send')) {
            // Verify there is no pending approval card before concluding
            const pendingCards = await page.locator('.approval-card.pending').count();
            if (pendingCards === 0) {
                console.log(`[UserSimulator] Turn completed in ${((Date.now() - startTime) / 1000).toFixed(1)}s.`);
                return;
            }
        }

        await page.waitForTimeout(2000);
    }

    throw new Error(`Timeout (${timeoutMs / 1000}s) waiting for agent turn to complete.`);
}

/**
 * Dumps the debug log and screenshots to the results directory.
 */
async function captureArtifacts(page, testInfo, suffix = '') {
    const safeTitle = testInfo.title.replace(/[^a-z0-9_-]/gi, '_');
    const resultsDir = path.join(__dirname, 'results', safeTitle);
    if (!fs.existsSync(resultsDir)) {
        fs.mkdirSync(resultsDir, { recursive: true });
    }

    // 1. Screenshot
    const screenshotPath = path.join(resultsDir, `screenshot${suffix ? '_' + suffix : ''}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });

    // 2. Open the Chat log modal
    try {
        await page.click('#chat-log-button', { timeout: 5000 });
        const chatLogModal = page.locator('.modal-content:has-text("Chat log")');
        await expect(chatLogModal).toBeVisible({ timeout: 5000 });
        
        // In playwright we can't easily read clipboard without permissions, 
        // but the text is inside the modal in #chat-log-body.
        const logContent = await page.locator('#chat-log-body').innerText();
        
        const logPath = path.join(resultsDir, `chat_log${suffix ? '_' + suffix : ''}.txt`);
        fs.writeFileSync(logPath, logContent);

        // Close log modal
        await page.keyboard.press('Escape');
        await expect(chatLogModal).not.toBeVisible({ timeout: 5000 });
    } catch (e) {
        console.log(`[captureArtifacts] Skipping chat log because it was not available (error: ${e.message})`);
    }

    // 3. Debug Log (Backend extraction via IPC)
    try {
        const taskId = await page.evaluate(async () => {
            if (!window.__ZEUS_BRIDGE__) return null;
            const tasks = await window.__ZEUS_BRIDGE__.listTasks();
            return tasks && tasks.length > 0 ? tasks[0].id : null;
        });

        if (taskId) {
            const backendLog = await page.evaluate(async (tid) => {
                if (!window.__ZEUS_BRIDGE__) return "No bridge exposed";
                return await window.__ZEUS_BRIDGE__.getDebugLog(tid);
            }, taskId);
            
            const dbMessages = await page.evaluate(async (tid) => {
                if (!window.__ZEUS_BRIDGE__) return [];
                return await window.__ZEUS_BRIDGE__.getTaskMessages(tid, true);
            }, taskId);
            
            const rawMessages = dbMessages
                .map((m) => `[${m.created_at}] seq=${m.seq} role=${m.role} kind=${m.kind} visible=${m.visible}\n${m.content}`)
                .join("\n----------------------------------------\n");

            const debugContent = `===== ZEUS DEBUG LOG (task ${taskId}) =====\n\n` +
                `--- BACKEND EVENTS ---\n${backendLog || "(empty)"}\n\n` +
                `--- RAW MESSAGES (incl. hidden) ---\n${rawMessages}`;

            const debugLogPath = path.join(resultsDir, `debug_log${suffix ? '_' + suffix : ''}.txt`);
            fs.writeFileSync(debugLogPath, debugContent);
        }
    } catch (e) {
        console.log(`Failed to extract debug log via IPC: ${e}`);
    }
}

/**
 * Takes a milestone screenshot during execution to provide visual observability
 * without relying on heavy video recording.
 */
async function takeMilestoneScreenshot(page, eventName, testInfo) {
    if (!testInfo) return;
    try {
        const safeTitle = testInfo.title.replace(/[^a-z0-9_-]/gi, '_');
        const resultsDir = path.join(__dirname, 'results', safeTitle);
        if (!fs.existsSync(resultsDir)) {
            fs.mkdirSync(resultsDir, { recursive: true });
        }
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const safeEventName = eventName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        const screenshotPath = path.join(resultsDir, `milestone_${timestamp}_${safeEventName}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true });
        console.log(`[Test] Captured milestone screenshot: ${screenshotPath}`);
    } catch (e) {
        console.log(`[Test] Failed to capture milestone screenshot: ${e.message}`);
    }
}

/**
 * Prunes old results directory to prevent unbounded growth.
 */
function pruneResults() {
    const resultsDir = path.join(__dirname, 'results');
    if (fs.existsSync(resultsDir)) {
        fs.rmSync(resultsDir, { recursive: true, force: true });
    }
}

/**
 * Cleans up the task browser directory to save disk space.
 */
async function cleanupTaskBrowserDir(page) {
    try {
        const taskId = await page.evaluate(async () => {
            if (!window.__ZEUS_BRIDGE__) return null;
            const tasks = await window.__ZEUS_BRIDGE__.listTasks();
            return tasks && tasks.length > 0 ? tasks[0].id : null;
        });
        if (taskId) {
            const testWorkspaceDir = process.env.ZEUS_TEST_WORKSPACE_ROOT || path.join(os.homedir(), 'AppData', 'Roaming', 'zeus-agent');
            const taskBrowserDir = path.join(testWorkspaceDir, 'tasks', taskId, 'browser');
            if (fs.existsSync(taskBrowserDir)) {
                fs.rmSync(taskBrowserDir, { recursive: true, force: true });
                console.log(`[cleanupTaskBrowserDir] Cleaned up browser dir for task ${taskId}`);
            }
        }
    } catch (e) {
        console.log(`[cleanupTaskBrowserDir] Error cleaning up: ${e}`);
    }
}

export {
    setupAdvancedTask,
    submitPromptAndWait,
    captureArtifacts,
    pruneResults,
    cleanupTaskBrowserDir,
    takeMilestoneScreenshot
};
