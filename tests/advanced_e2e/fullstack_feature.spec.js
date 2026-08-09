import { test, expect } from '@playwright/test';
import { launchTauri, stopTauri, cleanupTasks } from '../e2e/testUtils.js';
import { setupAdvancedTask, submitPromptAndWait, captureArtifacts } from './advancedUtils.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sandboxDir = path.join(__dirname, '..', 'e2e', '.test_workspace', 'sandbox-fullstack');

test.describe('Advanced E2E - Full-Stack Feature Addition', () => {
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
        
        if (fs.existsSync(sandboxDir)) {
            fs.rmSync(sandboxDir, { recursive: true, force: true });
        }
        fs.mkdirSync(sandboxDir, { recursive: true });
        
        fs.writeFileSync(path.join(sandboxDir, 'server.js'), `
const http = require('http');
const server = http.createServer((req, res) => {
    if (req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Hello World');
    } else {
        res.writeHead(404);
        res.end();
    }
});
server.listen(3000, () => console.log('Listening on 3000'));
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

    test('Agent can add a new API endpoint to an existing server', async () => {
        test.setTimeout(300000); // 5 minutes max

        await expect(page.locator('#app-container')).toBeVisible({ timeout: 15000 });

        await setupAdvancedTask(page, "Full-Stack Feature Test", {
            "Master": "deepseek/deepseek-chat"
        });

        const prompt = `I have a Node.js server at ${sandboxDir}/server.js. Modify the file to add a new API endpoint '/ping' that returns 'pong' (with a 200 status code and text/plain content type). Do not run the server, just modify the code. When you are done, output exactly "TEST COMPLETE".`;

        await submitPromptAndWait(page, prompt, 280000, 'TEST COMPLETE');

        const scriptPath = path.join(sandboxDir, 'server.js');
        const content = fs.readFileSync(scriptPath, 'utf8');
        expect(content).toContain('/ping');
        expect(content).toContain('pong');
    });
});
