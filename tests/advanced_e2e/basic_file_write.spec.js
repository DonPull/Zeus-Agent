import { test, expect } from '@playwright/test';
import { launchTauri, stopTauri, cleanupTasks } from '../e2e/testUtils.js';
import { setupAdvancedTask, submitPromptAndWait, captureArtifacts, pruneResults } from './advancedUtils.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test.describe('Advanced E2E - Non-Mocked Autonomous Behavior', () => {
    // 5 minutes timeout for the entire test
    test.setTimeout(5 * 60 * 1000);

    let browser;
    let page;
    let testFilePath;

    test.beforeAll(async () => {
        // Prune old results
        pruneResults();
        testFilePath = path.join(__dirname, '..', '..', 'e2e_test_output.txt');
    });

    test.beforeEach(async () => {
        // Launch with useRealApi = true
        const tauri = await launchTauri(true);
        browser = tauri.browser;
        page = tauri.page;
        
        // Ensure test file is gone before test starts
        if (fs.existsSync(testFilePath)) {
            fs.unlinkSync(testFilePath);
        }
    });

    test.afterEach(async ({ }, testInfo) => {
        // Capture artifacts regardless of success/failure
        try {
            await captureArtifacts(page, testInfo, testInfo.status);
        } catch (e) {
            console.error('Failed to capture artifacts:', e);
        }
        
        // Cleanup UI tasks
        await cleanupTasks(page);

        // Stop Tauri
        await stopTauri();

        // Cleanup the file if it was created
        if (fs.existsSync(testFilePath)) {
            fs.unlinkSync(testFilePath);
        }
    });

    test('Agent autonomously creates a text file on the local filesystem', async () => {
        // Wait for app to boot
        await expect(page.locator('#app-container')).toBeVisible({ timeout: 15000 });

        // Setup the task and configure models (using open-router or any available default)
        // Note: we'll leave models default for now, assuming the local env has valid default models selected.
        // Or we can explicitly set it to a fast/cheap model if we know the user has it configured.
        await setupAdvancedTask(page, 'E2E File Write Test');

        // We need to set a permission first! Or ask the agent to ask for permission.
        // We'll give it the absolute path and ask it to write to it. It will ask for permission,
        // but wait, this is an E2E test without a human. So we must set the permission globally,
        // or set it for the task.
        // Let's grant the permission for the task.
        await page.click('.settings-button:has-text("Permissions")');
        const permsModal = page.locator('.modal-content:has-text("Permissions for:")');
        await expect(permsModal).toBeVisible();

        await permsModal.locator('input[placeholder="C:/Projects or /home/user"]').fill(testFilePath);
        // Action is "Allow" by default, type is "Write". Let's select type "write".
        await permsModal.locator('select').nth(1).selectOption('write'); // Second select is type
        await permsModal.locator('.settings-button:has-text("Add")').click();
        
        // Close perms modal
        await permsModal.locator('button[title="Close"]').click();
        await expect(permsModal).not.toBeVisible();

        const prompt = `Please create a text file at the exact path: ${testFilePath}. Inside the file, write the exact text "Hello from Advanced E2E Test!". Stop when you are done.`;
        
        // Submit prompt and wait for the "Stop" button to become "Send" again
        await submitPromptAndWait(page, prompt, 4 * 60 * 1000);

        // Verify the file was created and contains the correct content
        expect(fs.existsSync(testFilePath)).toBe(true);
        const content = fs.readFileSync(testFilePath, 'utf8');
        expect(content.trim()).toBe('Hello from Advanced E2E Test!');
    });
});
