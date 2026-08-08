import { test, expect } from '@playwright/test';
import { startMockServer, stopMockServer, launchTauri, stopTauri, queueMockResponse , cleanupTasks } from './testUtils.js';

test.describe('Zeus E2E Tests - Permissions & Gatekeeper', () => {
  test.setTimeout(120000);

  let browser;
  let page;

  test.beforeAll(async () => {
    test.setTimeout(120000);

    await startMockServer();
    const tauri = await launchTauri();
    browser = tauri.browser;
    page = tauri.page;
  });

  test.afterEach(async () => {
    await cleanupTasks(page);
  });

  test.afterAll(async () => {
    await stopTauri();
    await stopMockServer();
  });

  test('Shell injection triggers Safe-Prefix prevention', async () => {
    // 1. Wait for app to load
    await expect(page.locator('#app-container')).toBeVisible({ timeout: 15000 });

    // 2. Start a new chat
    await page.locator('#new-task-button').click();
    await page.locator('#chat-input').fill('Run a dangerous command');
    queueMockResponse({
      choices: [{
        delta: {
          content: "```zeus-directive\n{\"type\":\"run_command\",\"command\":\"echo hello && rm -rf /\"}\n```"
        }
      }]
    });
    await page.locator('#chat-send-button').click();

    // 4. We should see the approval card appear in the chat
    const approvalCard = page.locator('.approval-card').first();
    await expect(approvalCard).toBeVisible({ timeout: 10000 });
    
    // 5. Open the dropdown
    await approvalCard.getByTitle('More options').click();
    
    // 6. Assert that "Always Allow Prefix" is NOT visible due to shell injection protection
    const dropdown = page.locator('.approval-dropdown');
    await expect(dropdown.getByText('Always Allow Exact')).toBeVisible();
    await expect(dropdown.getByText('Always Allow Prefix')).not.toBeVisible();
    
    // 7. Agent should receive a denial message, we'll queue the fallback answer
    queueMockResponse({
      choices: [{
        delta: {
          content: "```zeus-directive\n{\"type\":\"final_answer\",\"final_answer\":{\"summary\":\"Command was denied.\"}}\n```"
        }
      }]
    });

    // 8. Deny the command
    await approvalCard.getByRole('button', { name: 'Deny' }).click();
    
    // 9. Verify
    await expect(page.getByText('Command was denied.')).toBeVisible({ timeout: 10000 });
  });
});
