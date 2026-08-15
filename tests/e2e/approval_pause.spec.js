import { test, expect } from '@playwright/test';
import { startMockServer, stopMockServer, launchTauri, stopTauri, queueMockResponse, cleanupTasks } from './testUtils.js';

test.describe('Approval pause — no stacked cards', () => {
  test.setTimeout(180000);
  let page;

  test.beforeAll(async () => {
    await startMockServer();
    const tauri = await launchTauri();
    page = tauri.page;
  });

  test.afterEach(async () => {
    await cleanupTasks(page);
  });

  test.afterAll(async () => {
    await stopTauri();
    await stopMockServer();
  });

  test('while a permission card is pending, the run stays active and a second card is not created', async () => {
    await expect(page.locator('#app-container')).toBeVisible({ timeout: 15000 });
    await page.locator('#new-task-button').click();
    await page.locator('#chat-input').fill('Run a risky command');

    // Only one model reply is needed: the run must wait on the card, not call the model again.
    queueMockResponse({
      choices: [{
        delta: {
          content: '```zeus-directive\n{"type":"run_command","command":"whoami"}\n```'
        }
      }]
    });

    await page.locator('#chat-send-button').click();

    const cards = page.locator('.approval-card.pending');
    await expect(cards).toHaveCount(1, { timeout: 20000 });
    await expect(cards.first().locator('.approval-card-status')).toHaveText('needs approval');

    // Send button becomes Stop while the run is held open.
    await expect(page.locator('#chat-send-button')).toContainText('Stop');

    // Give the agent time to misbehave if the pause is broken.
    await page.waitForTimeout(4000);
    await expect(cards).toHaveCount(1);
    await expect(page.locator('.approval-card')).toHaveCount(1);
  });
});
