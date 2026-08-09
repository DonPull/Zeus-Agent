import { test, expect } from '@playwright/test';
import { launchTauri, stopTauri, cleanupTasks } from '../e2e/testUtils.js';
import { setupAdvancedTask, submitPromptAndWait, captureArtifacts } from './advancedUtils.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sandboxDir = path.join(__dirname, '..', 'e2e', '.test_workspace', 'sandbox-scaffold');

test.describe('Advanced E2E - Project Scaffolder', () => {
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
        
        // Ensure clean scaffold dir
        if (fs.existsSync(sandboxDir)) {
            fs.rmSync(sandboxDir, { recursive: true, force: true });
        }
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

    test('Agent can scaffold a project using npx', async () => {
        test.setTimeout(600000); // 10 minutes max

        await expect(page.locator('#app-container')).toBeVisible({ timeout: 15000 });

        await setupAdvancedTask(page, "Project Scaffolder Test", {
            "Master": "deepseek/deepseek-chat"
        });

        // Add global permissions
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
        await permInput.fill('npx');
        await settingsModal.locator('select').nth(0).selectOption('allow');
        await settingsModal.locator('select').nth(1).selectOption('command');
        await settingsModal.locator('button:has-text("Add")').click();
        await page.waitForTimeout(300);

        await page.locator('#settings-close-button').click();
        await expect(settingsModal).not.toBeVisible();

        const prompt = `Create a basic React Vite project named 'test-app' inside ${sandboxDir}. You should use 'npx' (e.g. npx -y create-vite@latest test-app --template react). When the project is successfully scaffolded, output exactly "TEST COMPLETE".`;

        await submitPromptAndWait(page, prompt, 280000, 'TEST COMPLETE');

        const pkgPath = path.join(sandboxDir, 'test-app', 'package.json');
        const appPath = path.join(sandboxDir, 'test-app', 'src', 'App.jsx');
        expect(fs.existsSync(pkgPath)).toBeTruthy();
        expect(fs.existsSync(appPath)).toBeTruthy();
    });
});
