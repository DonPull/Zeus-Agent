import { test, expect } from '@playwright/test';
import { startMockServer, stopMockServer, launchTauri, stopTauri, queueMockResponse, cleanupTasks } from './testUtils.js';

test.describe('Zeus E2E Tests - Gatekeeper Approvals', () => {
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

  test('Approving a blocked command saves a rule and breaks the loop', async () => {
    // 1. Wait for app to load
    await expect(page.locator('#app-container')).toBeVisible({ timeout: 15000 });

    // 2. Start a new chat
    await page.locator('#new-task-button').click();
    await page.locator('#chat-input').fill('List directory contents');
    
    // First prompt returns a command that requires approval
    queueMockResponse({
      choices: [{
        delta: {
          content: "```zeus-directive\n{\"type\":\"run_command\",\"command\":\"ls -la\"}\n```"
        }
      }]
    });
    
    await page.locator('#chat-send-button').click();

    // 4. We should see the approval card appear in the chat
    const approvalCard = page.locator('.approval-card').first();
    await expect(approvalCard).toBeVisible({ timeout: 10000 });
    await expect(approvalCard.locator('.approval-card-status')).toHaveText('needs approval');
    
    // 5. Open dropdown and save rule: "Always Allow Exact 'ls -la'"
    // We queue the final answer model response that will be requested after the command runs.
    queueMockResponse({
        choices: [{
          delta: {
            content: "```zeus-directive\n{\"type\":\"final_answer\",\"final_answer\":{\"summary\":\"Command succeeded.\"}}\n```"
          }
        }]
    });

    // 6. Click dropdown and save rule
    await approvalCard.getByTitle('More options').click();
    await page.locator('.approval-dropdown').getByText('Always Allow Exact').click();

    // 7. Verify the toast appears indicating permission was saved
    const toast = page.locator('.toast-notification');
    await expect(toast).toContainText('Permission saved for: ls -la', { timeout: 10000 });
    
    // 8. Verify the final answer appears indicating the gatekeeper allowed and executed it
    await expect(page.getByText('Command succeeded.')).toBeVisible({ timeout: 15000 });
  });
});
