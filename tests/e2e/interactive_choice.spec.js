import { test, expect } from '@playwright/test';
import { startMockServer, stopMockServer, launchTauri, stopTauri, queueMockResponse, cleanupTasks } from './testUtils.js';

test.describe('Interactive Choice & Multi-Account Selection', () => {
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

  test('ask_user_choice displays options and submits selected option to resume active run', async () => {
    await expect(page.locator('#app-container')).toBeVisible({ timeout: 15000 });
    await page.locator('#new-task-button').click();
    await page.locator('#chat-input').fill('Post a photo to Instagram');

    // 1st turn: Master outputs ask_user_choice
    queueMockResponse({
      choices: [{
        delta: {
          content: '```zeus-directive\n{"type":"ask_user_choice","prompt":"Which Instagram account should I use?","options":[{"id":"acc_personal","label":"@personal_profile","description":"Personal account"},{"id":"acc_business","label":"@brand_official","description":"Business account"}],"allow_custom_input":true}\n```'
        }
      }]
    });

    // 2nd turn: After user selects business account, Master outputs final answer
    queueMockResponse({
      choices: [{
        delta: {
          content: '```zeus-directive\n{"type":"final_answer","final_answer":{"summary":"Ready to post using @brand_official."}}\n```'
        }
      }]
    });

    await page.locator('#chat-send-button').click();

    // Verify choice card is displayed
    const choiceCard = page.locator('.approval-card.pending');
    await expect(choiceCard).toBeVisible({ timeout: 20000 });
    await expect(choiceCard.locator('.approval-card-title')).toHaveText('Decision Required');
    await expect(page.getByText('Which Instagram account should I use?')).toBeVisible();

    // Select the second option
    const businessOption = page.locator('.choice-option-item').filter({ hasText: '@brand_official' });
    await businessOption.click();

    // Submit choice
    const submitBtn = choiceCard.getByRole('button', { name: 'Submit Choice' });
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();

    // Verify final answer arrives
    await expect(page.getByText('Ready to post using @brand_official.')).toBeVisible({ timeout: 20000 });
  });
});
