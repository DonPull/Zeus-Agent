import { test, expect } from '@playwright/test';
import { launchTauri, stopTauri, cleanupTasks } from '../e2e/testUtils.js';
import { setupAdvancedTask, submitPromptAndWait, captureArtifacts } from './advancedUtils.js';

test.describe('Advanced E2E - Ambiguous Instruction', () => {
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

    test('Agent asks for clarification instead of guessing blindly', async () => {
        test.setTimeout(300000); 

        await expect(page.locator('#app-container')).toBeVisible({ timeout: 15000 });

        await setupAdvancedTask(page, "Ambiguous Instruction Test", {
            "Master": "deepseek/deepseek-chat"
        });

        // The exact prompt says "Do the thing with the file." and asks the agent to use a specific string if it needs clarification.
        // But since this is a LLM, we can just look for a question mark.
        const prompt = `I need you to do the thing with the file. If you are not sure what I mean, ask me to clarify by saying exactly "CLARIFICATION NEEDED:". Do not guess what I mean.`;

        await submitPromptAndWait(page, prompt, 120000, 'CLARIFICATION NEEDED');

        const lastMsg = await page.locator('.chat-bubble-content').last().innerText();
        expect(lastMsg).toContain('CLARIFICATION NEEDED');
    });
});
