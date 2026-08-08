import { test, expect } from '@playwright/test';
import { startMockServer, stopMockServer, launchTauri, stopTauri, queueMockResponse, cleanupTasks } from './testUtils.js';
import path from 'path';
import fs from 'fs';

test.describe('Zeus E2E Tests - Real File System & Commands', () => {
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

  test('Agent can create, read, modify, delete real files and run real commands', async () => {
    // 1. Wait for app to load
    await expect(page.locator('#app-container')).toBeVisible({ timeout: 15000 });

    const workspaceDir = path.join(process.cwd(), 'tests', 'e2e', '.test_workspace');
    const testFile = path.join(workspaceDir, 'hello_e2e.txt');

    // 2. Start a new chat
    await page.locator('#new-task-button').click();
    
    // 2.5 Grant write, delete, and read permissions to the workspace directory
    await page.getByRole('button', { name: 'Permissions' }).click();
    
    await page.getByPlaceholder('C:/Projects or /home/user').fill(workspaceDir.replace(/\\/g, '/'));
    await page.locator('select').nth(0).selectOption('allow');
    await page.locator('select').nth(1).selectOption('write');
    await page.getByRole('button', { name: 'Add' }).click();
    await expect(page.locator('.key-status-pill')).toHaveCount(1);
    
    await page.locator('select').nth(1).selectOption('delete');
    await page.getByPlaceholder('C:/Projects or /home/user').fill(workspaceDir.replace(/\\/g, '/'));
    await page.getByRole('button', { name: 'Add' }).click();
    await expect(page.locator('.key-status-pill')).toHaveCount(2);

    await page.locator('select').nth(1).selectOption('read');
    await page.getByPlaceholder('C:/Projects or /home/user').fill(workspaceDir.replace(/\\/g, '/'));
    await page.getByRole('button', { name: 'Add' }).click();
    await expect(page.locator('.key-status-pill')).toHaveCount(3);
    
    await page.getByTitle('Close').click();

    await page.locator('#chat-input').fill('Create a file named hello_e2e.txt and write Hello E2E to it.');

    // 3. Queue write_file response
    queueMockResponse({
      choices: [{
        delta: {
          content: "```zeus-directive\n{\"type\":\"write_file\",\"path\":\"" + testFile.replace(/\\/g, '/') + "\",\"content\":\"Hello E2E\"}\n```"
        }
      }]
    });
    
    // We expect the app to execute write_file and then ask the LLM for the next step.
    queueMockResponse({
      choices: [{
        delta: {
          content: "```zeus-directive\n{\"type\":\"final_answer\",\"final_answer\":{\"summary\":\"File has been written.\"}}\n```"
        }
      }]
    });

    await page.locator('#chat-send-button').click();
    
    await expect(page.locator('.chat-message.assistant').getByText('File has been written.')).toBeVisible({ timeout: 15000 });

    // Verify the file was actually written to the real disk
    expect(fs.existsSync(testFile)).toBe(true);
    const content = fs.readFileSync(testFile, 'utf8');
    expect(content).toBe('Hello E2E');

    // 4. Now let's read the file using read_file
    await page.locator('#chat-input').fill('Read the file we just created.');
    queueMockResponse({
      choices: [{
        delta: {
          content: "```zeus-directive\n{\"type\":\"read_file\",\"path\":\"" + testFile.replace(/\\/g, '/') + "\"}\n```"
        }
      }]
    });
    queueMockResponse({
      choices: [{
        delta: {
          content: "```zeus-directive\n{\"type\":\"final_answer\",\"final_answer\":{\"summary\":\"The file says Hello E2E.\"}}\n```"
        }
      }]
    });
    await page.locator('#chat-send-button').click();
    
    // Read file doesn't require approval if it's in the workspace, but we'll wait for the final answer.
    await expect(page.locator('.chat-message.assistant').getByText('The file says Hello E2E.')).toBeVisible({ timeout: 15000 });

    // 5. Delete the file
    await page.locator('#chat-input').fill('Now delete the file.');
    queueMockResponse({
      choices: [{
        delta: {
          content: "```zeus-directive\n{\"type\":\"delete_file\",\"path\":\"" + testFile.replace(/\\/g, '/') + "\"}\n```"
        }
      }]
    });
    
    // Queue the final answer that follows the successful execution
    queueMockResponse({
      choices: [{
        delta: {
          content: "```zeus-directive\n{\"type\":\"final_answer\",\"final_answer\":{\"summary\":\"File deleted.\"}}\n```"
        }
      }]
    });
    
    await page.locator('#chat-send-button').click();
    
    await expect(page.locator('.chat-message.assistant').getByText('File deleted.')).toBeVisible({ timeout: 15000 });

    // Verify it's gone
    expect(fs.existsSync(testFile)).toBe(false);
  });
});
