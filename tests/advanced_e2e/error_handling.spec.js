import { test, expect } from '@playwright/test';
import { launchTauri, stopTauri, cleanupTasks } from '../e2e/testUtils.js';
import { setupAdvancedTask, submitPromptAndWait, captureArtifacts } from './advancedUtils.js';
import path from 'path';

test.describe('Advanced E2E - Error Handling', () => {
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

    test('Agent can gracefully handle an invalid tool call', async () => {
        test.setTimeout(240000); // 4 minutes max

        await expect(page.locator('#app-container')).toBeVisible({ timeout: 15000 });

        await setupAdvancedTask(page, "Error Handling Test", {
            "Master": "deepseek/deepseek-chat"
        });

        // Prompt the agent to do something it shouldn't, or to do something with a non-existent tool.
        // We will tell it to "Use the `photoshop` tool to make this image black and white."
        // We expect it to realize it doesn't have the tool and report back.
        const prompt = `Use your \`photoshop\` tool to edit an image. If you realize you do not have this tool, tell me exactly "I DO NOT HAVE THIS TOOL". Do not use any python scripts to do it. Just report the lack of the tool.`;

        await submitPromptAndWait(page, prompt, 120000, 'I DO NOT HAVE THIS TOOL');

        const lastMsg = await page.locator('.chat-bubble-content').last().innerText();
        expect(lastMsg).toContain('I DO NOT HAVE THIS TOOL');
    });
});
