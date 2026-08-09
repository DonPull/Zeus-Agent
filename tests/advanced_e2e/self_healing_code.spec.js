import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { launchTauri, stopTauri, cleanupTasks } from '../e2e/testUtils.js';
import { setupAdvancedTask, submitPromptAndWait, captureArtifacts, pruneResults } from './advancedUtils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testWorkspaceDir = path.join(__dirname, '..', 'e2e', '.test_workspace');
const mathProjectDir = path.join(testWorkspaceDir, 'math-project');

test.describe('Advanced E2E - Self-Healing Codebase', () => {
    let browser;
    let page;

    test.beforeAll(() => {
        pruneResults();
    });

    test.beforeEach(async () => {
        const tauri = await launchTauri(true);
        browser = tauri.browser;
        page = tauri.page;

        // Create the buggy project AFTER launchTauri since launchTauri clears the workspace
        if (fs.existsSync(mathProjectDir)) {
            fs.rmSync(mathProjectDir, { recursive: true, force: true });
        }
        // Create MathProject dummy files
        fs.mkdirSync(mathProjectDir, { recursive: true });
        
        fs.writeFileSync(path.join(mathProjectDir, 'package.json'), JSON.stringify({ type: "commonjs" }));

        fs.writeFileSync(path.join(mathProjectDir, 'math.js'), `
function add(a, b) {
    return a - b; // BUG!
}
module.exports = { add };
        `.trim());

        fs.writeFileSync(path.join(mathProjectDir, 'test.js'), `
const assert = require('assert');
const { add } = require('./math');

try {
    assert.strictEqual(add(2, 3), 5);
    console.log("Test passed!");
    process.exit(0);
} catch (e) {
    console.error("Test failed!");
    process.exit(1);
}
        `.trim());
    });

    test.afterEach(async ({ }, testInfo) => {
        // ALWAYS capture artifacts regardless of pass/fail
        try {
            await captureArtifacts(page, testInfo, testInfo.status === 'passed' ? 'passed' : 'failed');
        } catch (e) {
            console.error('Failed to capture artifacts:', e);
        }
        await cleanupTasks(page);
        await stopTauri();
    });

    test('Agent autonomously fixes a failing unit test', async () => {
        test.setTimeout(300000); // 5 minutes max

        // Wait for app to be fully loaded
        await expect(page.locator('#app-container')).toBeVisible({ timeout: 15000 });

        // Setup Task with Models
        await setupAdvancedTask(page, "Self-Healing Test", {
            "Master": "deepseek/deepseek-chat",
            "Worker": "deepseek/deepseek-chat",
            "Verifier": "deepseek/deepseek-chat"
        });

        // Setup Global Permission for mathProjectDir
        await page.click('#sidebar-settings-button');
        const settingsModal = page.locator('.modal-content:has-text("Settings"), .modal:has-text("Settings")').first();
        await expect(settingsModal).toBeVisible();

        const permInput = settingsModal.locator('input[placeholder="C:/Projects or /home/user"]');

        await permInput.focus();
        await permInput.fill('node');
        await settingsModal.locator('select').nth(0).selectOption('allow');
        await settingsModal.locator('select').nth(1).selectOption('command');
        await expect(settingsModal.locator('button:has-text("Add")')).toBeEnabled();
        await settingsModal.locator('button:has-text("Add")').click();
        await page.waitForTimeout(300);

        // Also add Write permission
        await permInput.focus();
        await permInput.fill('');
        await permInput.fill(mathProjectDir);
        await settingsModal.locator('select').nth(0).selectOption('allow');
        await settingsModal.locator('select').nth(1).selectOption('write');
        await expect(settingsModal.locator('button:has-text("Add")')).toBeEnabled();
        await settingsModal.locator('button:has-text("Add")').click();
        await page.waitForTimeout(300);

        // Also add Read permission
        await permInput.focus();
        await permInput.fill('');
        await permInput.fill(mathProjectDir);
        await settingsModal.locator('select').nth(0).selectOption('allow');
        await settingsModal.locator('select').nth(1).selectOption('read');
        await expect(settingsModal.locator('button:has-text("Add")')).toBeEnabled();
        await settingsModal.locator('button:has-text("Add")').click();
        await page.waitForTimeout(300);

        await page.keyboard.press('Escape');
        await expect(settingsModal).not.toBeVisible();

        // Provide the Prompt
        const prompt = `
I have a buggy Node.js project.
File 1: ${mathProjectDir}/math.js
File 2: ${mathProjectDir}/test.js

Run the test file using its absolute path (i.e. run 'node "${mathProjectDir}/test.js"'). Do NOT use 'cd' or '&&'.
It will fail.
Analyze the failure, modify 'math.js' (using its absolute path) to fix the bug, and run the test file again.
Keep fixing it until the test passes (exits with code 0). Then output EXACTLY the phrase: "TEST COMPLETE".

CRITICAL: You are an autonomous agent. Do NOT just chat or ask for permission. You MUST use your run_command and file editing tools IMMEDIATELY to complete the task.
        `.trim();
        await submitPromptAndWait(page, prompt, 280000, "TEST COMPLETE");

        // Verification phase (Running outside the agent, to assert actual result)
        try {
            execSync('node test.js', { cwd: mathProjectDir, stdio: 'pipe' });
            // If we reach here, exit code was 0, meaning it's fixed!
        } catch (error) {
            throw new Error(`Test failed! The agent did not fix the code. Exit code: ${error.status}, Output: ${error.stdout?.toString()}, Error: ${error.stderr?.toString()}`);
        }
    });
});
