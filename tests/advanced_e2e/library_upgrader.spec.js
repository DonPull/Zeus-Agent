import { test, expect } from '@playwright/test';
import { launchTauri, stopTauri, cleanupTasks } from '../e2e/testUtils.js';
import { setupAdvancedTask, submitPromptAndWait, captureArtifacts } from './advancedUtils.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sandboxDir = path.join(__dirname, '..', 'e2e', '.test_workspace', 'sandbox-library');

test.describe('Advanced E2E - Library Upgrader', () => {
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
        fs.writeFileSync(path.join(sandboxDir, 'fetcher.py'), `
import requests

def get_data(url):
    response = requests.get(url)
    return response.json()
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

    test('Agent can upgrade a python file from requests to httpx', async () => {
        test.setTimeout(300000); 

        await expect(page.locator('#app-container')).toBeVisible({ timeout: 15000 });

        await setupAdvancedTask(page, "Library Upgrader Test", {
            "Master": "deepseek/deepseek-chat"
        });

        const prompt = `There is a python file at ${sandboxDir}/fetcher.py that uses 'requests'. Upgrade it to use 'httpx' asynchronously. Change the imports, and make the function async. Do not run it. When you are done editing the file, output exactly "TEST COMPLETE".`;

        await submitPromptAndWait(page, prompt, 280000, 'TEST COMPLETE');

        const scriptPath = path.join(sandboxDir, 'fetcher.py');
        const content = fs.readFileSync(scriptPath, 'utf8');
        expect(content).toContain('import httpx');
        expect(content).toContain('async def');
        expect(content).toContain('await');
        expect(content).not.toContain('import requests');
    });
});
