import fs from 'fs';
import path from 'path';
import { expect } from '@playwright/test';
import { fileURLToPath } from 'url';

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
    await page.click('#new-task-button, #empty-state-new-task-button');

    // Open Settings
    await page.click('.settings-button:has-text("Settings")');

    // Wait for modal to be visible
    const modal = page.locator('.modal-content:has-text("Task Settings"), .modal:has-text("Task Settings")').first();
    await expect(modal).toBeVisible();

    // Wait for models to finish loading
    await expect(modal.locator('button:has-text("Load available models")')).toBeEnabled({ timeout: 15000 });

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
            await expect(searchInput).toBeVisible();
            await searchInput.fill(modelName);

            const option = page.locator(`.align-center.gap-10:has-text("${modelName}")`).first();
            await expect(option).toBeVisible();
            await option.click();
        }
    }

    // Save Settings
    await page.click('.settings-button.primary:has-text("Save settings"), .settings-button:has-text("Save settings")');
    await expect(modal).not.toBeVisible();
}

/**
 * Submits a prompt and waits for the agent to finish autonomously.
 */
async function submitPromptAndWait(page, prompt, timeoutMs = 480000, expectedText = null, actionOnApprovalCard = 'approve') {
    // Fill prompt
    await page.fill('#chat-input', prompt);
    
    // Click send
    await page.click('#chat-send-button');

    // Wait for the button to change to "Stop" (meaning it started)
    await expect(page.locator('#chat-send-button')).toHaveText(/Stop/, { timeout: 10000 });

    if (expectedText) {
        const endTime = Date.now() + timeoutMs;
        while (Date.now() < endTime) {
            // Check if expectedText is present anywhere in the assistant or event messages
            const chatLog = page.locator('.chat-message.assistant, .chat-message.event');
            if (await chatLog.count() > 0) {
                const text = await chatLog.allInnerTexts();
                if (text.join('\n').includes(expectedText)) {
                    return; // Success!
                }
            }

            // Check if there's a pending approval card blocking the agent (could happen while button is Stop for python scripts)
            const pendingApproval = page.locator('.approval-card.pending button:has-text("Approve")').last();
            if (await pendingApproval.count() > 0) {
                if (actionOnApprovalCard === 'approve') {
                    console.log("[Test] Auto-approving pending approval card...");
                    await pendingApproval.click({ force: true });
                } else if (actionOnApprovalCard === 'deny') {
                    console.log("[Test] Auto-denying pending approval card...");
                    const denyButton = page.locator('.approval-card.pending button:has-text("Deny")').last();
                    await denyButton.click({ force: true });
                }
                // Wait a bit after clicking
                await page.waitForTimeout(1000);
            }

            // If the button is back to "Send", it means the agent yielded prematurely
            const btnText = await page.locator('#chat-send-button').innerText();
            if (btnText.includes('Send')) {
                const pendingAfterYield = page.locator('.approval-card.pending button:has-text("Approve")').last();
                if (await pendingAfterYield.count() === 0) {
                    // Only kick if there's no pending approval card we just handled
                    console.log("[Test] Agent yielded, kicking to continue...");
                    await page.fill('#chat-input', "Please continue working on the task using your tools autonomously. You must output the phrase exactly to finish.");
                    await page.click('#chat-send-button', { force: true });
                    await expect(page.locator('#chat-send-button')).toHaveText(/Stop/, { timeout: 10000 });
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
    const resultsDir = path.join(__dirname, 'results', testInfo.title.replace(/\s+/g, '_'));
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
 * Prunes old results directory to prevent unbounded growth.
 */
function pruneResults() {
    const resultsDir = path.join(__dirname, 'results');
    if (fs.existsSync(resultsDir)) {
        fs.rmSync(resultsDir, { recursive: true, force: true });
    }
}

export {
    setupAdvancedTask,
    submitPromptAndWait,
    captureArtifacts,
    pruneResults
};
