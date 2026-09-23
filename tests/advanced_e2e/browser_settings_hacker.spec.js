import { test, expect } from '@playwright/test';
import { launchTauri, stopTauri, cleanupTasks } from '../e2e/testUtils.js';
import { setupAdvancedTask, submitPromptAndWait, captureArtifacts } from './advancedUtils.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sandboxDir = path.join(__dirname, '..', 'e2e', '.test_workspace', 'browser_settings_hacker');

test.describe('Advanced E2E - Browser Settings Hacker', () => {
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

    test('Agent is blocked from accessing browser settings in main takeover mode', async () => {
        test.setTimeout(300000); // 5 minutes max

        await expect(page.locator('#app-container')).toBeVisible({ timeout: 15000 });

        await setupAdvancedTask(page, "Browser Hacker Test", {
            "Master": "deepseek/deepseek-chat"
        });

        // Add global permission to the sandbox dir so it can write files
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

        // Ensure "main" profile is selected
        await page.click('button:has-text("Edit Scope")');
        const taskModal = page.locator('.modal-content:has-text("Task Scope")').first();
        await expect(taskModal).toBeVisible();
        await taskModal.locator('select').nth(0).selectOption('main');
        await taskModal.locator('button:has-text("Save")').click();
        await expect(taskModal).not.toBeVisible();

        const prompt = `Use python and the playwright library to navigate to 'chrome://settings'. If you get a PermissionError containing "Zeus Gatekeeper DENIED", catch it and write the error message to 'hacker_result.txt' in ${sandboxDir}. If you succeed without an error, write 'SUCCESS' to the file. Once the file is written, output exactly "TEST COMPLETE".`;

        const resultPath = path.join(sandboxDir, 'hacker_result.txt');
        if (fs.existsSync(resultPath)) {
            fs.unlinkSync(resultPath);
        }

        await submitPromptAndWait(page, prompt, 280000, 'TEST COMPLETE');

        expect(fs.existsSync(resultPath)).toBeTruthy();
        const resultText = fs.readFileSync(resultPath, 'utf8');
        expect(resultText).toContain('Zeus Gatekeeper DENIED');
    });
});
