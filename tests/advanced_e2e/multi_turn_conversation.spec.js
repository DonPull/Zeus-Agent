import { test, expect } from '@playwright/test';
import { launchTauri, stopTauri, cleanupTasks } from '../e2e/testUtils.js';
import { setupAdvancedTask, submitPromptAndWait, captureArtifacts } from './advancedUtils.js';
import path from 'path';

test.describe('Advanced E2E - Multi-Turn Conversation', () => {
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

    test('Agent remembers context across multiple turns', async () => {
        test.setTimeout(180000); // 3 minutes max

        await expect(page.locator('#app-container')).toBeVisible({ timeout: 15000 });

        await setupAdvancedTask(page, "Multi-Turn Test", {
            "Master": "deepseek/deepseek-chat"
        });

        // Turn 1
        let prompt = `I am going to give you a secret code. The code is "ZEUS-E2E-9941". Just acknowledge you received it by replying with exactly "RECEIVED".`;
        await submitPromptAndWait(page, prompt, 60000, 'RECEIVED');

        const firstMsg = await page.locator('.chat-bubble-content').last().innerText();
        expect(firstMsg).toContain('RECEIVED');

        // Turn 2
        prompt = `What was the secret code I gave you earlier? Reply with exactly "CODE: " followed by the code, and nothing else.`;
        await submitPromptAndWait(page, prompt, 60000, 'CODE: ZEUS-E2E-9941');

        const secondMsg = await page.locator('.chat-bubble-content').last().innerText();
        expect(secondMsg).toContain('CODE: ZEUS-E2E-9941');
    });
});
