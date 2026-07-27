import { test, expect } from '@playwright/test';
import { startMockServer, stopMockServer, launchTauri, stopTauri, queueMockResponse } from './testUtils.js';

test.describe('Zeus E2E Tests - Basic Flow', () => {
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

  test('App loads successfully and can have a pure text conversation', async () => {
    // Basic verification that the app boots and renders the main container
    await expect(page.locator('#app-container')).toBeVisible({ timeout: 15000 });

    await page.locator('#new-task-button').click();
    await page.locator('#chat-input').fill('Hello Zeus');
    queueMockResponse({
      choices: [{
        delta: {
          content: "Hello human! How can I help you today?"
        }
      }]
    });
    await page.locator('#chat-send-button').click();

    await expect(page.getByText('Hello human! How can I help you today?')).toBeVisible({ timeout: 10000 });
  });

  test('Agent can update the task title', async () => {
    await page.locator('#chat-input').fill('Please update the task title to "E2E Test Chat"');
    queueMockResponse({
      choices: [{
        delta: {
          content: "```zeus-directive\n{\"type\":\"task_update\",\"update\":{\"title\":\"E2E Test Chat\"}}\n```"
        }
      }]
    });
    queueMockResponse({
      choices: [{
        delta: {
          content: "```zeus-directive\n{\"type\":\"final_answer\",\"final_answer\":{\"summary\":\"Title updated!\"}}\n```"
        }
      }]
    });
    await page.locator('#chat-send-button').click();

    await expect(page.locator('#chat-task-title')).toContainText('E2E Test Chat');
  });
});
