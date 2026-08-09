import { test, expect } from '@playwright/test';
import { launchTauri, stopTauri, cleanupTasks } from '../e2e/testUtils.js';
import { setupAdvancedTask, submitPromptAndWait, captureArtifacts } from './advancedUtils.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sandboxDir = path.join(__dirname, '..', 'e2e', '.test_workspace', 'sandbox-bughunter');

test.describe('Advanced E2E - Autonomous Bug Hunter', () => {
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
        
        fs.mkdirSync(path.join(sandboxDir, 'utils'), { recursive: true });
        const scriptPath = path.join(sandboxDir, 'utils', 'db.js');
        fs.writeFileSync(scriptPath, `
function getUser(db, username) {
    const query = "SELECT * FROM users WHERE username = '" + username + "'";
    return db.execute(query);
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

    test('Agent can find and patch a SQL injection vulnerability', async () => {
        test.setTimeout(300000); // 5 minutes max

        await expect(page.locator('#app-container')).toBeVisible({ timeout: 15000 });

        await setupAdvancedTask(page, "Bug Hunter Test", {
            "Master": "deepseek/deepseek-chat"
        });

        const prompt = `Search the directory ${path.join(sandboxDir, 'utils')} for potential SQL injection vulnerabilities. If you find any, patch them by editing the files to use parameterized queries (e.g., using '?' and passing the parameter separately). When you have patched the vulnerabilities, output exactly "TEST COMPLETE".`;

        await submitPromptAndWait(page, prompt, 280000, 'TEST COMPLETE');

        const scriptPath = path.join(sandboxDir, 'utils', 'db.js');
        const content = fs.readFileSync(scriptPath, 'utf8');
        expect(content).toContain('?'); // should use parameter placeholder
        expect(content).not.toContain("'" + '" + username + "'); // should have removed the concat injection
    });
});
