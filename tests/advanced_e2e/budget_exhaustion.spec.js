import { test, expect } from '@playwright/test';
import { launchTauri, stopTauri, cleanupTasks } from '../e2e/testUtils.js';
import { setupAdvancedTask, submitPromptAndWait, captureArtifacts } from './advancedUtils.js';

test.describe('Advanced E2E - Budget Exhaustion', () => {
    let browser;
    let page;

    test.beforeEach(async () => {
        const tauri = await launchTauri(true);
        browser = tauri.browser;
        page = tauri.page;
    });

    test.afterEach(async ({}, testInfo) => {
        try {
            await captureArtifacts(page, testInfo, testInfo.status === 'passed' ? 'passed' : 'failed');
        } catch (e) {
            console.error('Failed to capture artifacts:', e);
        }
        await cleanupTasks(page);
        await stopTauri();
    });

    test('Agent halts gracefully when budget is reached', async () => {
        test.setTimeout(300000); 

        await expect(page.locator('#app-container')).toBeVisible({ timeout: 15000 });

        await setupAdvancedTask(page, "Budget Exhaustion Test", {
            "Master": "deepseek/deepseek-chat",
            "Task Budget": "100" // VERY small budget, around 1-2 API calls
        });

        const prompt = `Please run the 'node -v' command 10 times sequentially. You must wait for each command to finish before running the next one. Do not stop until you have run it 10 times.`;

        // We wait for the token limit reached modal or message
        // Actually, Zeus creates an Event message when limit is reached, and pauses the task
        await submitPromptAndWait(page, prompt, 120000, 'reached its unit budget');

        const chatLog = page.locator('.chat-message');
        const text = await chatLog.allInnerTexts();
        expect(text.join('\n').toLowerCase()).toContain('reached its unit budget');
    });
});
