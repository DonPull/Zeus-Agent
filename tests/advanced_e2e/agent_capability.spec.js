import { test, expect } from '@playwright/test';
import { launchTauri, stopTauri, cleanupTasks } from '../e2e/testUtils.js';
import { setupAdvancedTask, submitPromptAndWait, captureArtifacts } from './advancedUtils.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sandboxDir = path.join(__dirname, '..', 'e2e', '.test_workspace', 'sandbox-project-cap');

test.describe('Advanced E2E - Agent Capability', () => {
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

    test('Agent can combine files and commands to solve a complex task', async () => {
        test.setTimeout(600000); // 10 minutes max

        await expect(page.locator('#app-container')).toBeVisible({ timeout: 15000 });

        await setupAdvancedTask(page, "Agent Capability Test", {
            "Master": "deepseek/deepseek-chat"
        });

        // Add global permission to the sandbox dir so it can run commands
        await page.click('#sidebar-settings-button');
        const settingsModal = page.locator('.modal-content:has-text("Settings")').first();
        await expect(settingsModal).toBeVisible();

        const permInput = settingsModal.locator('input[placeholder="C:/Projects or /home/user"]');

        await permInput.focus();
        await permInput.fill(sandboxDir);
        await settingsModal.locator('select').nth(0).selectOption('allow');
        await settingsModal.locator('select').nth(1).selectOption('write');
        await settingsModal.locator('button:has-text("Add")').click();
        await page.waitForTimeout(300);

        await permInput.focus();
        await permInput.fill('node');
        await settingsModal.locator('select').nth(0).selectOption('allow');
        await settingsModal.locator('select').nth(1).selectOption('command');
        await settingsModal.locator('button:has-text("Add")').click();
        await page.waitForTimeout(300);

        await page.locator('#settings-close-button').click();
        await expect(settingsModal).not.toBeVisible();

        // Write initial data file
        const dataPath = path.join(sandboxDir, 'data.csv');
        fs.writeFileSync(dataPath, 'name,age\nAlice,30\nBob,25\nCharlie,35');

        const prompt = `There is a file at ${dataPath}. Write a Node.js script in the same directory called 'process.js' that reads this CSV, calculates the average age, and writes the average to a file called 'average.txt' in the same directory. Then run your script using Node.js to produce the output file. When the 'average.txt' file is successfully created and contains the correct number, output exactly "TEST COMPLETE".`;

        await submitPromptAndWait(page, prompt, 280000, 'TEST COMPLETE');

        // Check if average.txt exists and contains "30"
        const avgPath = path.join(sandboxDir, 'average.txt');
        expect(fs.existsSync(avgPath)).toBeTruthy();
        const avgText = fs.readFileSync(avgPath, 'utf8');
        expect(avgText.trim()).toBe('30');
    });
});
