import { test, expect } from '@playwright/test';
import { startMockServer, stopMockServer, launchTauri, stopTauri, queueMockResponse, cleanupTasks } from './testUtils.js';

test.describe('Zeus E2E Tests - Python API Interception', () => {
  let browser, page;

  test.beforeAll(async () => {
    await startMockServer();
    const tauri = await launchTauri();
    browser = tauri.browser;
    page = tauri.page;
  });

  test.afterAll(async () => {
    await stopMockServer();
    await stopTauri();
  });

  test.afterEach(async () => {
    await cleanupTasks(page);
  });

  test('Python sandbox intercepts network and file writes, allowing user approval', async () => {
    test.setTimeout(120000); // 2 minutes for slow execution

    // 1. Wait for app to load
    await expect(page.locator('#app-container')).toBeVisible({ timeout: 15000 });

    await page.locator('#new-task-button').click();

    await page.locator('#chat-input').fill('Run a python script that fetches example.com and writes to C:/Windows/Temp/test.txt');
    
    // Mock the LLM to emit a Python action
    queueMockResponse({
      choices: [{
        delta: {
          content: "```zeus-directive\n{\"type\":\"run_action\",\"action\":{\"language\":\"python\",\"code\":\"import urllib.request\\nimport os\\n\\nreq = urllib.request.Request('http://example.com')\\nres = urllib.request.urlopen(req)\\nhtml = res.read().decode('utf-8')\\n\\nwith open('C:/Windows/Temp/test_zeus_e2e.txt', 'w') as f:\\n    f.write(html[:10])\\nprint('success')\",\"timeout_secs\":60},\"success_criteria\":\"Script executes successfully\"}\n```"
        }
      }]
    });

    // Mock LLM parsing the success of the script
    queueMockResponse({
      choices: [{ delta: { content: "```zeus-directive\n{\"type\":\"final_answer\",\"final_answer\":{\"summary\":\"Python script finished\"}}\n```" } }]
    });

    await page.locator('#chat-send-button').click();

    // 1. Wait for the network approval card
    await expect(page.locator('.approval-card').filter({ hasText: 'Python Network: example.com' })).toBeVisible({ timeout: 15000 });
    
    // Approve it
    await page.getByRole('button', { name: 'Approve' }).click();

    // 2. Wait for the file write approval card (which comes next after the python script continues)
    await expect(page.locator('.approval-card').filter({ hasText: 'test_zeus_e2e.txt' })).toBeVisible({ timeout: 15000 });

    // Approve it
    await page.getByRole('button', { name: 'Approve' }).click();

    // 3. The python script should now finish, outputting "success", and the LLM should reply with "Python script finished"
    await expect(page.locator('.chat-message.assistant').filter({ hasText: 'Python script finished' })).toBeVisible({ timeout: 15000 });
  });
});
