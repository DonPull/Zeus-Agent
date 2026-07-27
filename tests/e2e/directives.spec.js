import { test, expect } from '@playwright/test';
import { startMockServer, stopMockServer, launchTauri, stopTauri, queueMockResponse } from './testUtils.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

test.describe('Zeus E2E Tests - Directives Execution', () => {
  let browser;
  let page;
  let tempDir;

  test.beforeAll(async () => {
    await startMockServer();
    const tauri = await launchTauri();
    browser = tauri.browser;
    page = tauri.page;
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-test-'));
  });

  test.afterAll(async () => {
    await stopTauri();
    await stopMockServer();
    // Cleanup
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('Agent can execute write_file, read_file, delete_file, and run_command natively', async () => {
    const testFile = path.join(tempDir, 'hello.txt');

    // 1. Wait for app
    await expect(page.locator('#app-container')).toBeVisible({ timeout: 15000 });

    // 2. Start chat
    await page.locator('#new-task-button').click();
    await page.locator('#chat-input').fill('Test file directives');
    queueMockResponse({
      choices: [{
        delta: {
          content: "```zeus-directive\n{\"type\":\"write_file\",\"path\":\"" + testFile.replace(/\\/g, '\\\\') + "\",\"content\":\"hello world\"}\n```"
        }
      }]
    });
    await page.locator('#chat-send-button').click();

    // 5. Agent receives success, queue read_file
    queueMockResponse({
      choices: [{
        delta: {
          content: `\`\`\`zeus-directive\n{"type":"read_file","path":"${testFile.replace(/\\/g, '\\\\')}"}\n\`\`\``
        }
      }]
    });
    
    // 4. Handle UI Approval for Write File (it should trigger Ask)
    const approvalCard1 = page.locator('.approval-card').first();
    await expect(approvalCard1).toBeVisible({ timeout: 10000 });
    await approvalCard1.getByRole('button', { name: 'Approve' }).click();

    // 7. Agent receives content, queue delete_file
    queueMockResponse({
      choices: [{
        delta: {
          content: `\`\`\`zeus-directive\n{"type":"delete_file","path":"${testFile.replace(/\\/g, '\\\\')}"}\n\`\`\``
        }
      }]
    });
    
    // 6. Handle UI Approval for Read File
    const approvalCard2 = page.locator('.approval-card').nth(1);
    await expect(approvalCard2).toBeVisible({ timeout: 10000 });
    await approvalCard2.getByRole('button', { name: 'Approve' }).click();

    // 9. Agent receives success, queue run_command
    queueMockResponse({
      choices: [{
        delta: {
          content: "```zeus-directive\n{\"type\":\"run_command\",\"command\":\"echo ZeusWorks\"}\n```"
        }
      }]
    });
    
    // 8. Handle UI Approval for Delete File
    const approvalCard3 = page.locator('.approval-card').nth(2);
    await expect(approvalCard3).toBeVisible({ timeout: 10000 });
    await approvalCard3.getByRole('button', { name: 'Approve' }).click();

    // 11. Final Answer
    queueMockResponse({
      choices: [{
        delta: {
          content: "```zeus-directive\n{\"type\":\"final_answer\",\"final_answer\":{\"summary\":\"All directives succeeded!\"}}\n```"
        }
      }]
    });
    
    // 10. Handle UI Approval for Run Command
    const approvalCard4 = page.locator('.approval-card').nth(3);
    await expect(approvalCard4).toBeVisible({ timeout: 10000 });
    await approvalCard4.getByRole('button', { name: 'Approve' }).click();

    await expect(page.getByText('All directives succeeded!')).toBeVisible({ timeout: 15000 });

    // Verify the file was indeed deleted (or doesn't exist)
    expect(fs.existsSync(testFile)).toBeFalsy();
  });
});
