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

    // Open Settings
    await page.click('.settings-button:has-text("Settings")');

    // Wait for modal to be visible
    const modal = page.locator('.modal-content:has-text("Task Settings"), .modal:has-text("Task Settings")').first();
    await expect(modal).toBeVisible();

    // Click "Load available models" to force load and wait for it to finish
    const loadButton = modal.locator('button:has-text("Load available models")');
    await loadButton.click();
    await page.waitForTimeout(2000); // Wait for Tauri IPC to return models
    await expect(loadButton).toBeEnabled({ timeout: 15000 });
    
    // Set models if provided
    if (modelConfig) {
        for (const [role, modelName] of Object.entries(modelConfig)) {
            if (role === "Task Budget") {
                const row = modal.locator('.settings-model-row:has-text("Task Budget")');
                await row.locator('input[type="number"]').fill(modelName);
                continue;
            }
            
            // role could be "Master", "Worker", "Verifier", "Watcher"
            const row = modal.locator(`.settings-model-row:has-text("${role}")`);
            await row.locator('.settings-input').first().click(); // open dropdown
            
            // Type into the search input which appears
            const searchInput = row.locator('input[placeholder="Search model..."]');
            await expect(searchInput).toBeVisible({ timeout: 10000 });
            await searchInput.fill(modelName);

            const option = row.locator(`.align-center.gap-10:has-text("${modelName}")`).first();
            await expect(option).toBeVisible({ timeout: 10000 });
            await option.click();
            await expect(searchInput).not.toBeVisible({ timeout: 10000 });
            
            // Give it a tiny bit of time to settle React state
            await page.waitForTimeout(100);
        }
    }

    // Save Settings
    await page.click('.settings-button.primary:has-text("Save settings"), .settings-button:has-text("Save settings")');
    await expect(modal).not.toBeVisible();
}

/**
 * Submits a prompt and waits for the agent to finish autonomously.
 */
async function submitPromptAndWait(page, prompt, testInfo, timeoutMs = 480000, expectedText = null, actionOnApprovalCard = 'approve') {
    // Fill prompt
    await page.fill('#chat-input', prompt);
    
    // Click send
    await page.click('#chat-send-button');

    // Wait for the button to change to "Stop" (meaning it started)
    await expect(page.locator('#chat-send-button')).toHaveText(/Stop/, { timeout: 10000 });

    if (expectedText) {
        const endTime = Date.now() + timeoutMs;
        while (Date.now() < endTime) {
            // Check for credit exhaustion
            const chatLog = page.locator('.chat-message.assistant, .chat-message.event, .chat-message.system');
            if (await chatLog.count() > 0) {
                const text = await chatLog.allInnerTexts();
                const joinedText = text.join('\n');
                if (joinedText.includes('BUDGET_EXCEEDED') || (joinedText.includes('credit') && joinedText.includes('run out')) || joinedText.includes('reached its unit budget')) {
                    throw new Error("CREDIT_EXHAUSTED: The agent has run out of credits or budget.");
                }
                if (joinedText.includes(expectedText)) {
                    return; // Success!
                }
            }

            let handledCard = false;

            // Check if there's a pending approval card blocking the agent (could happen while button is Stop for python scripts)
            const pendingApproval = page.locator('.approval-card.pending button:has-text("Approve")').last();
            if (await pendingApproval.count() > 0) {
                await takeMilestoneScreenshot(page, "Pending Card Detected", null);
                if (actionOnApprovalCard === 'approve') {
                    console.log("[Test] Auto-approving pending approval card...");
                    await pendingApproval.click({ force: true });
                } else if (actionOnApprovalCard === 'deny') {
                    console.log("[Test] Auto-denying pending approval card...");
                    const denyButton = page.locator('.approval-card.pending button:has-text("Deny")').last();
                    await denyButton.click({ force: true });
                }
                handledCard = true;
                // Wait a bit after clicking
                await page.waitForTimeout(1000);
            }

            // Check if there's a pending handoff card
            const pendingHandoff = page.locator('.approval-card.pending button:has-text("Done, Resume Agent")').last();
            if (await pendingHandoff.count() > 0) {
                await takeMilestoneScreenshot(page, "Browser Handoff Detected", null);
                console.log("[Test] Detected Browser Handoff card. Copying golden profile...");
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
                        // Remove existing user_data
                        if (fs.existsSync(taskBrowserDir)) {
                            fs.rmSync(taskBrowserDir, { recursive: true, force: true });
                        }
                        fs.mkdirSync(taskBrowserDir, { recursive: true });
                        fs.cpSync(goldenProfile, taskBrowserDir, { recursive: true });
                        console.log("[Test] Golden profile swapped successfully.");
                    } else {
                        console.log("[Test] WARNING: Golden profile not found at " + goldenProfile);
                    }
                }
                
                await pendingHandoff.click({ force: true });
                handledCard = true;
                await page.waitForTimeout(2000);
            }

            if (!handledCard) {
                // If the button is back to "Send", it means the agent yielded prematurely
                const btnText = await page.locator('#chat-send-button').innerText();
                if (btnText.includes('Send')) {
                    const pendingAfterYield = page.locator('.approval-card.pending button:has-text("Approve")').last();
                    if (await pendingAfterYield.count() === 0) {
                        // Only kick if there's no pending approval card we just handled
                        const text = await page.locator('.chat-message.assistant, .chat-message.event, .chat-message.system').allInnerTexts();
                        console.log("[Test] Agent yielded, kicking to continue...");
                        console.log("[Test] Agent's last chat log text:", text.join('\\n'));
                        await takeMilestoneScreenshot(page, "Agent Yielded - Kicking", testInfo);
                        await page.fill('#chat-input', "Please continue working on the task using your tools autonomously. You must output the phrase exactly to finish.");
                        await expect(page.locator('#chat-send-button')).toBeEnabled();
                        await page.click('#chat-send-button');
                        await expect(page.locator('#chat-send-button')).toHaveText(/Stop/, { timeout: 10000 });
                    }
                }
            }

            await page.waitForTimeout(2000);
        }
        throw new Error(`Timeout waiting for expected text: ${expectedText}`);
    } else {
        // Wait for the button to return to "Send" (meaning it finished autonomously)
        // Real LLM calls can take a long time, so we give it a large timeout
        await expect(page.locator('#chat-send-button')).toHaveText(/Send/, { timeout: timeoutMs });
    }
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
