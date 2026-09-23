import { test, expect } from '@playwright/test';
import { launchTauri, stopTauri, cleanupTasks } from '../e2e/testUtils.js';
import { setupAdvancedTask, submitPromptAndWait, captureArtifacts, pruneResults } from './advancedUtils.js';

test.describe('Advanced E2E - Model Reasoning Effort Level Verification', () => {
    test.setTimeout(5 * 60 * 1000); // 5 minutes timeout

    let browser;
    let page;

    test.beforeAll(async () => {
        pruneResults();
    });

    test.beforeEach(async () => {
        // Launch Tauri with real API
        const tauri = await launchTauri(true);
        browser = tauri.browser;
        page = tauri.page;
    });

    test.afterEach(async ({ }, testInfo) => {
        try {
            await captureArtifacts(page, testInfo, testInfo.status);
        } catch (e) {
            console.error('Failed to capture artifacts:', e);
        }
        await cleanupTasks(page);
        await stopTauri();
    });

    test('Agent runs with user-designated model stack and explicit reasoning effort', async ({ }, testInfo) => {
        await expect(page.locator('#app-container')).toBeVisible({ timeout: 15000 });

        // User's designated model stack with low reasoning effort for token efficiency
        const modelStack = {
            "Master": "zai-org/GLM-5.3-Flash",
            "Worker": "gpt-5.6-luna",
            "Verifier": "zai-org/GLM-5.3-Flash",
            "Watcher": "deepseek-ai/DeepSeek-V4-Flash-0731",
            "Master Effort": "low",
            "Worker Effort": "low",
            "Verifier Effort": "low",
            "Watcher Effort": "low",
            "Task Budget": 15000
        };

        await setupAdvancedTask(page, 'Reasoning Effort Verification', modelStack);

        // Verify task settings have updated effort levels
        await page.locator('#chat-task-settings-button').click();
        await expect(page.locator('#task-master-effort-select')).toBeVisible({ timeout: 5000 });
        expect(await page.locator('#task-master-effort-select').inputValue()).toBe('low');
        expect(await page.locator('#task-worker-effort-select').inputValue()).toBe('low');
        expect(await page.locator('#task-verifier-effort-select').inputValue()).toBe('low');
        expect(await page.locator('#task-watcher-effort-select').inputValue()).toBe('low');
        await page.locator('#task-settings-close-button').click();

        // Submit prompt that requires mathematical reasoning
        const prompt = 'Compute 47 multiplied by 89. State the exact numeric result clearly.';
        
        await submitPromptAndWait(page, prompt, testInfo, 3 * 60 * 1000);

        // Verify the response was produced and contains the mathematical result: 47 * 89 = 4183
        const chatMessages = page.locator('.chat-message.assistant, .chat-message.event, .chat-message-content');
        const textContent = (await chatMessages.allInnerTexts()).join(' ');
        expect(textContent.replace(/,/g, '')).toContain('4183');
        expect(textContent).toContain('zai-org/GLM-5.3-Flash');
    });
});
