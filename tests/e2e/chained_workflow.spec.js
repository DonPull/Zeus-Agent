import { test, expect } from '@playwright/test';
import { startMockServer, stopMockServer, launchTauri, stopTauri, queueMockResponse, cleanupTasks } from './testUtils.js';

test.describe('Zeus E2E Tests - Complex Chained Workflow', () => {
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

  test('Agent can plan, delegate, use a tool, and report the final answer', async () => {
    test.setTimeout(120000); // 2 minutes

    // 1. Wait for app to load
    await expect(page.locator('#app-container')).toBeVisible({ timeout: 15000 });

    await page.locator('#new-task-button').click();

    await page.locator('#chat-input').fill('Research quantum computing and save a summary to quantum.txt');

    // 1. Master Agent creates an Action Plan
    queueMockResponse({
      choices: [{
        delta: {
          content: "```zeus-directive\n{\"type\":\"update_action_plan\",\"action_plan\":\"1. Delegate research\\n2. Save to file\"}\n```"
        }
      }]
    });

    // 2. Master Agent delegates to a worker
    queueMockResponse({
        choices: [{
          delta: {
            content: "```zeus-directive\n{\"type\":\"delegate_task\",\"delegate\":{\"name\":\"Researcher\",\"objective\":\"Research quantum computing\",\"success_criteria\":\"A summary is provided\"}}\n```"
          }
        }]
    });

    // 3. Worker Agent uses run_action for python script
    queueMockResponse({
        choices: [{
          delta: {
            content: "```zeus-directive\n{\"type\":\"run_action\",\"action\":{\"language\":\"python\",\"code\":\"import urllib.request\\nres = urllib.request.urlopen('http://example.com')\\nprint('success quantum')\",\"timeout_secs\":60},\"success_criteria\":\"Prints quantum computing info\"}\n```"
          }
        }]
    });
    
    // 4. Worker Agent returns final answer
    queueMockResponse({
        choices: [{
          delta: {
            content: "```zeus-directive\n{\"type\":\"final_answer\",\"final_answer\":{\"summary\":\"Quantum computing uses qubits.\"}}\n```"
          }
        }]
    });

    // 5. Verifier approves Worker output
    queueMockResponse({
        choices: [{
          delta: {
            content: "{\n  \"passed\": true,\n  \"feedback\": \"The summary includes quantum computing info.\"\n}"
          }
        }]
    });

    // 5. Master Agent writes the file
    queueMockResponse({
        choices: [{
          delta: {
            content: "```zeus-directive\n{\"type\":\"write_file\",\"path\":\"C:/Projects/quantum.txt\",\"content\":\"Quantum computing uses qubits.\"}\n```"
          }
        }]
    });

    // 6. Master Agent returns final answer
    queueMockResponse({
        choices: [{
          delta: {
            content: "```zeus-directive\n{\"type\":\"final_answer\",\"final_answer\":{\"summary\":\"The research is complete and saved.\"}}\n```"
          }
        }]
    });

    await page.locator('#chat-send-button').click();

    // The Action Plan should be visible in the sidebar panel
    await expect(page.locator('#action-plan-content').filter({ hasText: 'Delegate research' })).toBeVisible({ timeout: 15000 });
    
    // The Master paused for alignment. Tell it to proceed.
    await page.locator('#chat-input').fill('Looks good, proceed.');
    await page.locator('#chat-send-button').click();

    // We should see the delegation
    await expect(page.locator('.worker-card-title').filter({ hasText: 'Worker: Researcher' })).toBeVisible({ timeout: 20000 });

    // The HTTP request requires permission. We should see the Approval Card
    await expect(page.locator('.approval-card').filter({ hasText: 'Python Network: example.com' })).toBeVisible({ timeout: 20000 });
    await page.getByRole('button', { name: 'Approve' }).click();

    // The file write requires permission.
    await expect(page.locator('.approval-card').filter({ hasText: 'Write File: `C:/Projects/quantum.txt`' })).toBeVisible({ timeout: 20000 });
    await page.getByRole('button', { name: 'Approve' }).click();

    // Final answer from the Master
    await expect(page.locator('.chat-message.assistant').filter({ hasText: 'The research is complete and saved.' })).toBeVisible({ timeout: 20000 });
  });
});
