import { test, expect } from '@playwright/test';
import { startMockServer, stopMockServer, launchTauri, stopTauri, queueMockResponse, cleanupTasks } from './testUtils.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

test.describe('Worker native directives', () => {
  test.setTimeout(180000);
  let page;
  let tempDir;

  test.beforeAll(async () => {
    await startMockServer();
    const tauri = await launchTauri();
    page = tauri.page;
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-worker-'));
  });

  test.afterEach(async () => {
    await cleanupTasks(page);
  });

  test.afterAll(async () => {
    await stopTauri();
    await stopMockServer();
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('worker can write_file natively (not only via Python)', async () => {
    const testFile = path.join(tempDir, 'from_worker.txt').replace(/\\/g, '/');
    await expect(page.locator('#app-container')).toBeVisible({ timeout: 15000 });
    await page.locator('#new-task-button').click();
    await page.locator('#chat-input').fill('Delegate writing a file');

    // Master delegates.
    queueMockResponse({
      choices: [{
        delta: {
          content: '```zeus-directive\n{"type":"delegate_task","delegate":{"name":"Writer","objective":"Write hello to the given file","success_criteria":"file contains hello"}}\n```'
        }
      }]
    });

    // Worker uses native write_file.
    const writeJson = JSON.stringify({ type: 'write_file', path: testFile, content: 'hello' });
    queueMockResponse({
      choices: [{ delta: { content: '```zeus-directive\n' + writeJson + '\n```' } }]
    });

    // After write result, worker final_answer. Then verifier JSON.
    queueMockResponse({
      choices: [{ delta: { content: '```zeus-directive\n{"type":"final_answer","final_answer":{"summary":"Wrote hello"}}\n```' } }]
    });
    // Verifier uses chat_completion (same mock stream).
    queueMockResponse({
      choices: [{ delta: { content: '{"passed":true,"feedback":"ok"}' } }]
    });

    // Master after worker returns.
    queueMockResponse({
      choices: [{ delta: { content: '```zeus-directive\n{"type":"final_answer","final_answer":{"summary":"Worker finished writing."}}\n```' } }]
    });

    await page.locator('#chat-send-button').click();

    const approval = page.locator('.approval-card').filter({ hasText: 'Write File' });
    await expect(approval).toBeVisible({ timeout: 30000 });
    await approval.getByRole('button', { name: /Approve/ }).click();

    await expect(page.getByText('Worker finished writing.')).toBeVisible({ timeout: 30000 });
    expect(fs.readFileSync(testFile, 'utf8')).toBe('hello');
  });
});
