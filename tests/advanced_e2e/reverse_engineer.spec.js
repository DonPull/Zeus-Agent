import { test, expect } from '@playwright/test';
import { launchTauri, stopTauri, cleanupTasks } from '../e2e/testUtils.js';
import { setupAdvancedTask, submitPromptAndWait, captureArtifacts } from './advancedUtils.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sandboxDir = path.join(__dirname, '..', 'e2e', '.test_workspace', 'sandbox-reverse');

test.describe('Advanced E2E - Reverse Engineer', () => {
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
        
        // Write a CLI script
        const scriptPath = path.join(sandboxDir, 'mystery.js');
        fs.writeFileSync(scriptPath, `
const args = process.argv.slice(2);
if (args[0] === '--help') {
    console.log('Usage: mystery <command> [options]');
    console.log('Commands:');
    console.log('  encrypt <text>   Encrypts text');
    console.log('  decrypt <text>   Decrypts text');
} else {
    console.log('Unknown command. Use --help');
}
        `.trim());
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

    test('Agent can discover CLI tool behavior and document it', async () => {
        test.setTimeout(300000); // 5 minutes max

        await expect(page.locator('#app-container')).toBeVisible({ timeout: 15000 });

        await setupAdvancedTask(page, "Reverse Engineer Test", {
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

        const prompt = `There is an undocumented CLI tool at ${sandboxDir}/mystery.js (run it with node). Figure out what this CLI tool does and write a markdown file called 'documentation.md' in the same directory documenting its commands. When you have created the documentation file, output exactly "TEST COMPLETE".`;

        await submitPromptAndWait(page, prompt, 280000, 'TEST COMPLETE');

        const docPath = path.join(sandboxDir, 'documentation.md');
        expect(fs.existsSync(docPath)).toBeTruthy();
        const content = fs.readFileSync(docPath, 'utf8');
        expect(content.toLowerCase()).toContain('encrypt');
        expect(content.toLowerCase()).toContain('decrypt');
    });
});
