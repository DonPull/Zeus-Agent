import { test, expect } from '@playwright/test';
import { launchTauri, stopTauri, cleanupTasks } from '../e2e/testUtils.js';
import { setupAdvancedTask, submitPromptAndWait, captureArtifacts } from './advancedUtils.js';

test.describe('Advanced E2E - Unresponsive Server', () => {
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

    test('Agent gracefully handles an unresponsive server timeout', async () => {
        test.setTimeout(300000); 

        await expect(page.locator('#app-container')).toBeVisible({ timeout: 15000 });

        await setupAdvancedTask(page, "Unresponsive Server Test", {
            "Master": "deepseek/deepseek-chat"
        });

        // 10.255.255.1 is typically unroutable and will hang curl until timeout
        // We instruct the agent to use a low timeout to speed up the test
        const prompt = `Use the 'curl' command to fetch data from http://10.255.255.1 with a maximum timeout of 3 seconds (e.g. curl -m 3 ...). If the server is unresponsive and it times out, report back exactly "SERVER UNRESPONSIVE".`;

        await submitPromptAndWait(page, prompt, 120000, 'SERVER UNRESPONSIVE');

        const lastMsg = await page.locator('.chat-bubble-content').last().innerText();
        expect(lastMsg).toContain('SERVER UNRESPONSIVE');
    });
});
