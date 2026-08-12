import { test, expect } from '@playwright/test';
import { launchTauri, stopTauri, cleanupTasks } from '../e2e/testUtils.js';
import { setupAdvancedTask, submitPromptAndWait, captureArtifacts, pruneResults, cleanupTaskBrowserDir } from './advancedUtils.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

test.describe('Grand Combination Advanced E2E Scenarios', () => {
    let browser;
    let page;

    test.beforeAll(() => {
        // Do not prune results here, as Playwright might spawn a new worker 
        // after a timeout, causing it to delete the results of previous tests.
        // pruneResults();
    });

    test.beforeEach(async () => {
        process.env.ZEUS_HEADLESS_HANDOFF = '1';
        
        const tauri = await launchTauri(true);
        browser = tauri.browser;
        page = tauri.page;

        // Wait for app to be fully loaded
        await expect(page.locator('#app-container')).toBeVisible({ timeout: 15000 });
        
        // Accept legal disclaimer if it appears
        try {
            const agreeButton = page.locator('button:has-text("I Agree")');
            await expect(agreeButton).toBeVisible({ timeout: 2000 });
            await agreeButton.click();
            await expect(agreeButton).toBeHidden({ timeout: 2000 });
        } catch (e) {
            // Not visible, ignore
        }
    });

    test.afterEach(async ({}, testInfo) => {
        try {
            await captureArtifacts(page, testInfo, testInfo.status === 'passed' ? 'passed' : 'failed');
        } catch (e) {
            console.log(`Failed to capture artifacts: ${e}`);
        }
        await cleanupTaskBrowserDir(page);
        await stopTauri();
    });

    test('Test A - The Researcher & Reporter (Web -> Python w/ Dependencies -> CLI)', async ({}, testInfo) => {
        // High budget because it installs pip packages, browses, and writes scripts.
        await setupAdvancedTask(page, 'Test A Task', {
            'Task Budget': '500000',
            'Master': 'deepseek-v4-flash',
            'Worker': 'deepseek-v4-flash',
            'Watcher': 'grok-4.5',
            'Verifier': 'grok-4.5'
        });

        const prompt = `Please achieve the following goal:
1. Search Wikipedia for "History of Computing" using the browser. Extract the summary paragraph (the first paragraph before the table of contents). Save the extracted text to a file named 'history.txt' in your workspace.
2. Use Python to read 'history.txt'. You must install the 'reportlab' package using pip, and then use it in your Python script to generate a PDF file named 'history_report.pdf' containing the extracted text.
3. Use a standard CLI command to zip the 'history_report.pdf' file into 'history_archive.zip'.

When you have completely verified that 'history_archive.zip' exists and is a valid zip file containing the PDF, output the exact phrase 'TEST_A_COMPLETE'.`;

        await submitPromptAndWait(page, prompt, testInfo, 900000, 'TEST_A_COMPLETE');
    });

    test('Test B - The Local Configurator (SearchFiles -> ReadFile -> Web -> Python)', async ({}, testInfo) => {
        await setupAdvancedTask(page, 'Test B Task', {
            'Task Budget': '500000',
            'Master': 'deepseek-v4-flash',
            'Worker': 'deepseek-v4-flash',
            'Watcher': 'grok-4.5',
            'Verifier': 'grok-4.5'
        });

        // Setup a messy directory with a hidden config file for the agent to find.
        const testWorkspaceDir = process.env.ZEUS_TEST_WORKSPACE_ROOT || path.join(os.homedir(), 'AppData', 'Roaming', 'zeus-agent');
        const hiddenDir = path.join(testWorkspaceDir, 'messy_dir', 'subdir1', 'subdir2');
        fs.mkdirSync(hiddenDir, { recursive: true });
        fs.writeFileSync(path.join(hiddenDir, 'target_config.json'), JSON.stringify({
            targetUrl: 'https://example.com',
            extractionGoal: 'Extract the main heading text.'
        }));

        const prompt = `Please achieve the following goal:
1. Find a file named 'target_config.json' somewhere in the 'messy_dir' directory inside your workspace.
2. Read the file to get the target URL and extraction goal.
3. Spawn a worker or use tools to navigate to that URL and extract the requested data.
4. Write a Python script to format the extracted text to uppercase and append it to 'final_output.txt'.

When the file 'final_output.txt' is correctly written, output the text 'TEST_B_COMPLETE'.`;

        await submitPromptAndWait(page, prompt, testInfo, 500000, 'TEST_B_COMPLETE');
    });

    test('Test C - The System Administrator (HTTP -> Python Server -> CLI)', async ({}, testInfo) => {
        await setupAdvancedTask(page, 'Test C Task', {
            'Task Budget': '500000',
            'Master': 'deepseek-v4-flash',
            'Worker': 'deepseek-v4-flash',
            'Watcher': 'grok-4.5',
            'Verifier': 'grok-4.5'
        });

        const prompt = `Please achieve the following goal:
1. Make a native HTTP GET request to 'https://httpbin.org/get'.
2. Parse the JSON response and write a Python script that starts a local HTTP server on port 8085 that serves this JSON data. The server should run in the background.
3. Use the 'run_command' tool to execute 'curl http://localhost:8085' to verify the server is running and returns the JSON.
4. Shut down the Python server process.

When you have successfully verified the local server output and shut it down, output the text 'TEST_C_COMPLETE'.`;

        await submitPromptAndWait(page, prompt, testInfo, 500000, 'TEST_C_COMPLETE');
    });
    test('Test D - The Iterative Builder (Multi-turn Web -> Python -> Verify)', async ({}, testInfo) => {
        await setupAdvancedTask(page, 'Test D Task', {
            'Task Budget': '300000',
            'Master': 'deepseek-v4-flash',
            'Worker': 'deepseek-v4-flash',
            'Watcher': 'grok-4.5',
            'Verifier': 'grok-4.5'
        });

        const prompt1 = `Please achieve the following goal:
1. Search the web for "Current population of Tokyo".
2. Write the population number to a file named 'tokyo.txt' in the workspace.
3. Output 'TURN_1_COMPLETE' when done.`;

        await submitPromptAndWait(page, prompt1, testInfo, 400000, 'TURN_1_COMPLETE');

        const testWorkspaceDir = process.env.ZEUS_TEST_WORKSPACE_ROOT || path.join(os.homedir(), 'AppData', 'Roaming', 'zeus-agent');
        const outputFile1 = path.join(testWorkspaceDir, 'workspace', 'tokyo.txt');
        await expect(async () => {
            expect(fs.existsSync(outputFile1)).toBe(true);
            const content = fs.readFileSync(outputFile1, 'utf8');
            expect(content.length).toBeGreaterThan(5);
        }).toPass({ timeout: 10000 });

        const prompt2 = `Now, read 'tokyo.txt'. Write a Python script to extract the numbers from the text, calculate 10% of that population, and save the calculated number to 'tokyo_10_percent.txt'. Output 'TURN_2_COMPLETE' when done.`;
        await submitPromptAndWait(page, prompt2, testInfo, 400000, 'TURN_2_COMPLETE');

        const outputFile2 = path.join(testWorkspaceDir, 'workspace', 'tokyo_10_percent.txt');
        await expect(async () => {
            expect(fs.existsSync(outputFile2)).toBe(true);
            const content = fs.readFileSync(outputFile2, 'utf8');
            expect(content.length).toBeGreaterThan(0);
            expect(content).toMatch(/\d/);
        }).toPass({ timeout: 10000 });
    });
});
