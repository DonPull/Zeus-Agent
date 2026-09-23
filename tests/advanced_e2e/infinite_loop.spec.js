import { test, expect } from '@playwright/test';
import { launchTauri, stopTauri, cleanupTasks } from '../e2e/testUtils.js';
import { setupAdvancedTask, submitPromptAndWait, captureArtifacts } from './advancedUtils.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sandboxDir = path.join(__dirname, '..', 'e2e', '.test_workspace', 'sandbox-infinite');

test.describe('Advanced E2E - Infinite Loop Trap', () => {
    test.beforeAll(() => {
        if (!fs.existsSync(sandboxDir)) {
            fs.mkdirSync(sandboxDir, { recursive: true });
        }
    });

    let browser;
    let page;

    test.beforeEach(async () => {
        const tauri = await launchTauri(true);
        browser = tauri.browser;
        page = tauri.page;
        fs.mkdirSync(sandboxDir, { recursive: true });
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

    test('Agent can detect and exit from an impossible task', async () => {
        test.setTimeout(300000); // 5 minutes max

        await expect(page.locator('#app-container')).toBeVisible({ timeout: 15000 });

        await setupAdvancedTask(page, "Infinite Loop Trap Test", {
            "Master": "deepseek/deepseek-chat"
        });

        // Add global permission to the sandbox dir so it can run commands
        await page.click('#sidebar-settings-button');
        const settingsModal = page.locator('.modal-content:has-text("Settings")').first();
        await expect(settingsModal).toBeVisible();

        const permInput = settingsModal.locator('input[placeholder="C:/Projects or /home/user"]');

        await permInput.focus();
        await permInput.fill(sandboxDir);
        await settingsModal.locator('#permission-action-select').selectOption('allow');
        await settingsModal.locator('#permission-type-select').selectOption('write');
        await settingsModal.locator('button:has-text("Add")').click();
        await page.waitForTimeout(300);

        await page.locator('#settings-close-button').click();
        await expect(settingsModal).not.toBeVisible();

        // Prompt that sets up an impossible situation
        const prompt = `I have a math problem. Write a Node.js script in ${sandboxDir}/collatz.js that finds a starting integer for the Collatz conjecture where the sequence does NOT reach 1. Run it, and keep modifying the code to search larger numbers until you find one. When you find it, output "TEST COMPLETE". If you realize this is an unprovable mathematical trap that cannot be brute-forced, stop immediately and output "TASK IMPOSSIBLE".`;

        await submitPromptAndWait(page, prompt, 280000, 'TASK IMPOSSIBLE');

        // Check that the assistant output "TASK IMPOSSIBLE"
        const chatLog = page.locator('.chat-message.assistant');
        const text = await chatLog.allInnerTexts();
        expect(text.join('\n')).toContain('TASK IMPOSSIBLE');
    });
});
