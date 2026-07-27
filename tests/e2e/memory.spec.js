import { test, expect } from '@playwright/test';
import { startMockServer, stopMockServer, launchTauri, stopTauri, queueMockResponse } from './testUtils.js';

test.describe('Zeus E2E Tests - Master Context Memory', () => {
  let browser;
  let page;

  test.beforeAll(async () => {
    await startMockServer();
    const tauri = await launchTauri();
    browser = tauri.browser;
    page = tauri.page;
  });

  test.afterAll(async () => {
    await stopTauri();
    await stopMockServer();
  });

  test('Agent can update memory and recall it', async () => {
    // 1. Wait for app to load
    await expect(page.locator('#app-container')).toBeVisible({ timeout: 15000 });

    // 2. Start a new chat
    await page.locator('#new-task-button').click();
    await page.locator('#chat-input').fill('Remember that the secret word is Apple.');
    // 3. Setup the first request (update_memory) and second request (final_answer)
    queueMockResponse({
      choices: [{
        delta: {
          content: "```zeus-directive\n{\"type\":\"update_memory\",\"memory\":\"The secret word is Apple.\"}\n```"
        }
      }]
    });
    queueMockResponse({
      choices: [{
        delta: {
          content: "```zeus-directive\n{\"type\":\"final_answer\",\"final_answer\":{\"summary\":\"I have remembered the secret word.\"}}\n```"
        }
      }]
    });
    
    // 4. Send the message
    await page.locator('#chat-send-button').click();

    // 5. Verify the AI replies with the final answer
    await expect(page.locator('.chat-message.assistant').getByText('I have remembered the secret word.')).toBeVisible({ timeout: 10000 });

    // 6. Send a second message asking for the secret word.
    await page.locator('#chat-input').fill('What was the secret word?');
    queueMockResponse({
      choices: [{
        delta: {
          content: "```zeus-directive\n{\"type\":\"final_answer\",\"final_answer\":{\"summary\":\"The secret word is Apple.\"}}\n```"
        }
      }]
    });
    await page.locator('#chat-send-button').click();

    // 8. Verify
    await expect(page.locator('.chat-message.assistant').getByText('The secret word is Apple.')).toBeVisible({ timeout: 10000 });
  });
});
