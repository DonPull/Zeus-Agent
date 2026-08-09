import { test, expect } from '@playwright/test';
import { launchTauri, stopTauri, cleanupTasks } from '../e2e/testUtils.js';
import { setupAdvancedTask, submitPromptAndWait, captureArtifacts } from './advancedUtils.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sandboxDir = path.join(__dirname, '..', 'e2e', '.test_workspace', 'sandbox-refactor');

test.describe('Advanced E2E - Code Refactorer', () => {
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
        
        // Write a messy python script
        const scriptPath = path.join(sandboxDir, 'messy.py');
        fs.writeFileSync(scriptPath, `
def foo(x):
  y=x*2
  return y

def BAr (   ):
    a = 1
    b =2
    return foo(a+b)
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

    test('Agent can refactor messy python code and add docstrings', async () => {
        test.setTimeout(300000); // 5 minutes max

        await expect(page.locator('#app-container')).toBeVisible({ timeout: 15000 });

        await setupAdvancedTask(page, "Code Refactor Test", {
            "Master": "deepseek/deepseek-chat"
        });

        const prompt = `There is a messy python script at ${sandboxDir}/messy.py. Refactor this script to use standard PEP8 conventions and add docstrings to the functions. Modify the file using your tools. When you are done, output exactly "TEST COMPLETE".`;

        await submitPromptAndWait(page, prompt, 280000, 'TEST COMPLETE');

        const scriptPath = path.join(sandboxDir, 'messy.py');
        const content = fs.readFileSync(scriptPath, 'utf8');
        expect(content).toContain('"""'); // should contain docstrings
        expect(content).not.toContain('BAr (   )'); // should have fixed spacing/naming
    });
});
