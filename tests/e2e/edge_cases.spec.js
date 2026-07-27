import { test, expect } from '@playwright/test';
import { startMockServer, stopMockServer, launchTauri, stopTauri, queueMockResponse } from './testUtils.js';

test.describe('Zeus E2E Tests - Edge Cases', () => {
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

  test('Gracefully handles malformed JSON from the LLM', async () => {
    await expect(page.locator('#app-container')).toBeVisible({ timeout: 15000 });

    await page.locator('#new-task-button').click();
    await page.locator('#chat-input').fill('Send me bad json');
    queueMockResponse({
      choices: [{
        delta: {
          content: "```zeus-directive\n{\"type\":\"run_command\",\"command\":\"echo hello\", BAD_JSON }\n```"
        }
      }]
    });
    // The backend should intercept the error and reply with [DIRECTIVE_ERROR].
    // We queue the fallback response where the agent fixes its JSON.
    queueMockResponse({
      choices: [{
        delta: {
          content: "```zeus-directive\n{\"type\":\"final_answer\",\"final_answer\":{\"summary\":\"I fixed the JSON!\"}}\n```"
        }
      }]
    });
    
    await page.locator('#chat-send-button').click();

    await expect(page.getByText('I fixed the JSON!')).toBeVisible({ timeout: 15000 });
  });
});
