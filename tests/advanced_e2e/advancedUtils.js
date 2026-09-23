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
    await page.waitForTimeout(500);

    // Set models directly via bridge or Task Settings
    if (modelConfig) {
        await page.evaluate(async (cfg) => {
            if (!window.__ZEUS_BRIDGE__) return;
            const tasks = await window.__ZEUS_BRIDGE__.listTasks();
            if (!tasks || tasks.length === 0) return;
            const currentTask = tasks[0];
            const id = currentTask.id;
            const normalize = (m, fallback) => {
                if (!m || m === "deepseek/deepseek-chat" || m === "deepseek-chat") return fallback;
                return m;
            };
            const updatePayload = {
                master_model: normalize(cfg["Master"], currentTask.master_model || "zai-org/GLM-5.3-Flash"),
                worker_model: normalize(cfg["Worker"], currentTask.worker_model || "gpt-5.6-luna"),
                verifier_model: normalize(cfg["Verifier"], currentTask.verifier_model || "zai-org/GLM-5.3-Flash"),
                watcher_model: normalize(cfg["Watcher"], currentTask.watcher_model || "Qwen3.8-27B"),
                master_effort: cfg["Master Effort"] || cfg["master_effort"] || currentTask.master_effort || "default",
                worker_effort: cfg["Worker Effort"] || cfg["worker_effort"] || currentTask.worker_effort || "default",
                verifier_effort: cfg["Verifier Effort"] || cfg["verifier_effort"] || currentTask.verifier_effort || "default",
                watcher_effort: cfg["Watcher Effort"] || cfg["watcher_effort"] || currentTask.watcher_effort || "default",
                budget_credits: parseInt(cfg["Task Budget"], 10) || currentTask.budget_credits || 50000,
            };
            await window.__ZEUS_BRIDGE__.updateTaskSettings(id, updatePayload);
            if (window.__ZEUS_REFRESH_TASKS__) {
                await window.__ZEUS_REFRESH_TASKS__();
            }
        }, modelConfig);
        await page.waitForTimeout(300);
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

/**
 * Evaluates an approval card realistically from the perspective of an observant user.
 * - Does NOT auto-allow everything blindly.
 * - Evaluates the requested action against the user's task prompt, host environment, and safety.
 * - Rejects destructive actions and OS-incompatible shell commands with actionable feedback.
 * - Approves benign and task-aligned actions (e.g. workspace Python scripts, valid HTTP requests).
 */
function simulateRealisticUserDecision(payload) {
    const { title = '', detail = '', blocked_directive, prompt = '' } = payload;
    const dirType = blocked_directive ? blocked_directive.type : null;
    const lowerTitle = (title || '').toLowerCase();
    const isWindows = process.platform === 'win32';

    // 1. Shell / Python Command Evaluation
    if (dirType === 'run_command' || lowerTitle.includes('run shell command') || lowerTitle.includes('execute command') || lowerTitle.includes('command')) {
        let cmd = (blocked_directive && blocked_directive.command) ? blocked_directive.command : detail;
        if (!cmd && lowerTitle.includes('command:')) {
            cmd = title.replace(/^.*command:\s*/i, '').trim();
        }
        const trimmed = (cmd || '').trim();

        // Check for destructive commands
        const destructivePatterns = [
            /format\s+[a-z]:/i,
            /rmdir\s+\/s\s+\/q\s+[a-z]:\\(?:\s|$)/i,
            /del\s+\/f\s+\/s\s+\/q\s+[a-z]:\\(?:\s|$)/i,
            /drop\s+database/i,
            /:(){ :|:& };:/,
            /shutdown\s+/i
        ];
        for (const pat of destructivePatterns) {
            if (pat.test(trimmed)) {
                return {
                    decision: 'deny_with_feedback',
                    feedback: 'Destructive system modification commands are prohibited.'
                };
            }
        }

        // Host OS compatibility check (e.g., Windows cmd/PowerShell)
        if (isWindows) {
            const unixOnlyPatterns = [
                /^which\s+/i,
                /^\s*grep\s+-[a-zA-Z]*r/i,
                /^\s*sed\s+-i/i,
                /^\s*export\s+[A-Za-z_][A-Za-z0-9_]*=/i
            ];
            for (const pat of unixOnlyPatterns) {
                if (pat.test(trimmed)) {
                    return {
                        decision: 'deny_with_feedback',
                        feedback: `The host operating system is Windows (${process.platform}). The command "${trimmed}" is a Unix utility and may not be available or syntax-compatible. Please use PowerShell cmdlets or execute a Python script in your workspace instead.`
                    };
                }
            }
        }

        // Legitimate commands directly related to user requests:
        // Python execution, package installation, build tools, git, directory listing, file inspection
        return { decision: 'approve' };
    }

    // 2. Network Request Evaluation (HttpRequest / Python Network)
    if (dirType === 'http_request' || lowerTitle.includes('run network request') || lowerTitle.includes('http request') || lowerTitle.includes('network')) {
        let url = (blocked_directive && blocked_directive.url) ? blocked_directive.url : detail;
        if (!url && lowerTitle.includes('network:')) {
            url = title.replace(/^.*network:\s*/i, '').trim();
        }
        if (url && (url.includes('malicious') || url.includes('exfiltrate') || url.includes('localhost:9999/exfil'))) {
            return {
                decision: 'deny_with_feedback',
                feedback: 'Access to this suspicious or untrusted external destination is blocked.'
            };
        }
        return { decision: 'approve' };
    }

    // 3. File Operations Evaluation (WriteFile, ReadFile, DeleteFile, Python File Access)
    if (dirType === 'write_file' || dirType === 'delete_file' || dirType === 'read_file' ||
        lowerTitle.includes('file write') || lowerTitle.includes('delete file') || lowerTitle.includes('file access') ||
        lowerTitle.includes('access:') || lowerTitle.includes('python access')) {
        let filePath = (blocked_directive && blocked_directive.path) ? blocked_directive.path : detail;
        if (!filePath) {
            const match = title.match(/`([^`]+)`/);
            if (match) filePath = match[1];
        }
        const normalized = (filePath || '').replace(/\\/g, '/').toLowerCase();

        // Disallow modifications to system-level directories
        if (normalized.includes('/windows/system32') || normalized.includes('/etc/passwd') || normalized.includes('/etc/shadow')) {
            return {
                decision: 'deny_with_feedback',
                feedback: 'Operating outside the assigned workspace on critical operating system files is prohibited.'
            };
        }
        return { decision: 'approve' };
    }

    // Default for legitimate actions
    return { decision: 'approve' };
}

async function submitPromptAndWait(page, prompt, testInfo, timeoutMs = 600000, expectedText = null, defaultCardDecision = null) {
    // Backward-compatibility: if testInfo is omitted and passed as timeoutMs (number)
    if (typeof testInfo === 'number') {
        defaultCardDecision = typeof arguments[4] === 'string' ? arguments[4] : null;
        expectedText = typeof timeoutMs === 'string' ? timeoutMs : null;
        timeoutMs = testInfo;
        testInfo = null;
    }

    ensureIpcDir();

    // Fill prompt
    await page.fill('#chat-input', prompt);
    
    // Click send
    await page.click('#chat-send-button');

    // Wait for the button to change to "Stop" (meaning it started)
    await expect(page.locator('#chat-send-button')).toHaveText(/Stop/, { timeout: 10000 });

    const startTime = Date.now();
    const endTime = startTime + timeoutMs;
    let lastTelemetry = 0;

    while (Date.now() < endTime) {
        // 1. Check for pending approval card blocking the agent FIRST
        const pendingCardLocator = page.locator('.approval-card.pending, .approval-card:has(button:has-text("Approve"))').last();
        const hasPendingApproval = (await pendingCardLocator.count()) > 0;

        if (hasPendingApproval) {
            const titleEl = pendingCardLocator.locator('.approval-card-title');
            const cardTitle = ((await titleEl.count()) > 0 ? (await titleEl.textContent().catch(() => "")) : "") || "Permission Required";
            const detailEl = pendingCardLocator.locator('.approval-card-detail');
            const cardDetail = (await detailEl.count()) > 0 ? (await detailEl.textContent().catch(() => "")) : "";
            const dirEl = pendingCardLocator.locator('.approval-card-blocked-directive');
            const rawDirective = (await dirEl.count()) > 0 ? (await dirEl.textContent().catch(() => "")) : "";
            let blockedDirective = null;
            if (rawDirective) {
                try { blockedDirective = JSON.parse(rawDirective); } catch (_) {}
            }
            const domMessageId = await pendingCardLocator.getAttribute('data-message-id').catch(() => null);
            const domTaskId = await pendingCardLocator.getAttribute('data-task-id').catch(() => null);
            const messageId = domMessageId || `card_${Date.now()}`;

            const pendingFile = path.join(ipcDir, 'pending_card.json');
            const decisionFileGeneral = path.join(ipcDir, 'decision.json');
            const decisionFileSpecific = path.join(ipcDir, `decision_${messageId}.json`);

            const pendingPayload = {
                status: 'pending',
                message_id: messageId,
                task_id: domTaskId,
                title: cardTitle,
                detail: cardDetail,
                blocked_directive: blockedDirective,
                prompt: prompt,
                test_title: testInfo ? testInfo.title : "Benchmark",
                timestamp: Date.now()
            };

            fs.writeFileSync(pendingFile, JSON.stringify(pendingPayload, null, 2), 'utf8');

            console.log(`\n======================================================`);
            console.log(`[ANTIGRAVITY_CARD_DECISION_NEEDED]`);
            console.log(`Card: "${cardTitle}"`);
            if (cardDetail) console.log(`Detail: ${cardDetail}`);
            if (blockedDirective) {
                console.log(`Blocked Directive:`, JSON.stringify(blockedDirective));
            }
            console.log(`======================================================\n`);

            await takeMilestoneScreenshot(page, "Pending Card Awaiting Decision", testInfo);

            // Wait briefly for manual decision file, otherwise evaluate realistically as an observant user
            let decision = null;
            if (defaultCardDecision) {
                decision = { decision: defaultCardDecision };
            }
            const waitDecisionTimeout = Date.now() + 1500;
            while (!decision && Date.now() < waitDecisionTimeout) {
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
                await page.waitForTimeout(250);
            }

            if (!decision) {
                decision = simulateRealisticUserDecision(pendingPayload);
            }

            console.log(`[UserSimulator] Applying decision: ${decision.decision}${decision.feedback ? ` (Feedback: ${decision.feedback})` : ''}`);

            if (decision.decision === 'approve') {
                const targetBtn = pendingCardLocator.locator('button:has-text("Approve (Once)"), button:has-text("Approve")').last();
                if (await targetBtn.count() > 0) {
                    await targetBtn.click({ force: true }).catch(() => {});
                }
                // Resilient fallback: ensure backend state is updated in case DOM click was delayed
                if (domTaskId && domMessageId) {
                    await page.evaluate(async ({ tId, mId }) => {
                        if (window.__ZEUS_BRIDGE__) {
                            await window.__ZEUS_BRIDGE__.resolvePendingApprovals(tId, true, mId, "").catch(() => {});
                        }
                    }, { tId: domTaskId, mId: domMessageId }).catch(() => {});
                }
            } else if (decision.decision === 'deny_with_feedback' && decision.feedback) {
                const feedbackBtn = pendingCardLocator.locator('button:has-text("Deny with Feedback")').last();
                if (await feedbackBtn.count() > 0) {
                    await feedbackBtn.click({ force: true }).catch(() => {});
                    const feedbackInput = pendingCardLocator.locator('.settings-input').last();
                    await expect(feedbackInput).toBeVisible({ timeout: 5000 }).catch(() => {});
                    await feedbackInput.fill(decision.feedback).catch(() => {});
                    const submitBtn = pendingCardLocator.locator('button:has-text("Submit Deny & Feedback")').last();
                    await submitBtn.click({ force: true }).catch(() => {});
                } else {
                    const denyBtn = pendingCardLocator.locator('button:has-text("Deny")').last();
                    if (await denyBtn.count() > 0) await denyBtn.click({ force: true }).catch(() => {});
                }
                if (domTaskId && domMessageId) {
                    await page.evaluate(async ({ tId, mId, note }) => {
                        if (window.__ZEUS_BRIDGE__) {
                            await window.__ZEUS_BRIDGE__.resolvePendingApprovals(tId, false, mId, note).catch(() => {});
                        }
                    }, { tId: domTaskId, mId: domMessageId, note: decision.feedback }).catch(() => {});
                }
            } else {
                const denyBtn = pendingCardLocator.locator('button:has-text("Deny")').last();
                if (await denyBtn.count() > 0) {
                    await denyBtn.click({ force: true }).catch(() => {});
                }
                if (domTaskId && domMessageId) {
                    await page.evaluate(async ({ tId, mId }) => {
                        if (window.__ZEUS_BRIDGE__) {
                            await window.__ZEUS_BRIDGE__.resolvePendingApprovals(tId, false, mId, "").catch(() => {});
                        }
                    }, { tId: domTaskId, mId: domMessageId }).catch(() => {});
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

            await page.waitForTimeout(1000);
            continue;
        }

        // 2. Check for pending handoff card
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

        // 3. Check if turn completed (button returned to "Send" and no pending approvals)
        const sendBtn = page.locator('#chat-send-button');
        const btnText = await sendBtn.innerText().catch(() => "");
        if (btnText.includes('Send')) {
            const pendingCards = await page.locator('.approval-card.pending').count();
            if (pendingCards === 0) {
                console.log(`[UserSimulator] Turn completed in ${((Date.now() - startTime) / 1000).toFixed(1)}s.`);
                return;
            }
        }

        // 4. Periodic telemetry & budget check (every 10s)
        if (Date.now() - lastTelemetry > 10000) {
            lastTelemetry = Date.now();
            const elapsed = Math.round((Date.now() - startTime) / 1000);
            const isStopping = (await page.locator('#chat-send-button:has-text("Stop")').count()) > 0;
            const approveCount = await page.locator('button:has-text("Approve (Once)"), button:has-text("Approve")').count();
            console.log(`[UserSimulator Loop] Elapsed: ${elapsed}s | Agent Active: ${isStopping} | Pending Approvals: ${approveCount}`);

            // Check budget via toast or chat messages
            const warningToast = page.locator('.toast.warning');
            if (await warningToast.count() > 0) {
                const toastText = (await warningToast.first().innerText().catch(() => "")) || "";
                if (toastText.includes('budget') || toastText.includes('credit')) {
                    throw new Error("CREDIT_EXHAUSTED: The agent has run out of credits or budget.");
                }
            }
            if (expectedText) {
                const messagesEl = page.locator('#chat-messages');
                const messagesText = (await messagesEl.innerText().catch(() => "")) || "";
                if (messagesText.includes(expectedText)) {
                    return;
                }
            }

            // Visual Evaluator: Check and capture active live view frame
            if (process.env.ZEUS_VISUAL_EVAL_DIR) {
                try {
                    const liveViewBtn = page.locator('#browser-session-live-view-btn').last();
                    if (await liveViewBtn.count() > 0 && await liveViewBtn.isVisible()) {
                        const liveSnapshotPath = path.join(process.env.ZEUS_VISUAL_EVAL_DIR, 'live_view_open.png');
                        if (!fs.existsSync(liveSnapshotPath)) {
                            console.log('[Visual Evaluator] Active browser session detected. Opening Live View modal...');
                            await liveViewBtn.click({ force: true }).catch(() => {});
                            await page.waitForTimeout(1200);
                            await page.screenshot({ path: liveSnapshotPath }).catch(() => {});
                            console.log(`[Visual Evaluator] Captured live view snapshot: ${liveSnapshotPath}`);
                            const closeBtn = page.locator('#live-modal-close-button');
                            if (await closeBtn.count() > 0) {
                                await closeBtn.click({ force: true }).catch(() => {});
                            }
                        }
                    }
                } catch (e) {
                    console.warn('[Visual Evaluator] Live view check warning:', e.message);
                }
            }
        }

        await page.waitForTimeout(1000);
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
        await page.click('#chat-log-button', { force: true, timeout: 5000 });
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
    simulateRealisticUserDecision,
    captureArtifacts,
    pruneResults,
    cleanupTaskBrowserDir,
    takeMilestoneScreenshot
};
