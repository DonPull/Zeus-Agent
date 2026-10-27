import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { startMockServer, stopMockServer, launchTauri, stopTauri, cleanupTasks,
  queueMockResponse, getMockRequests } from '../e2e/testUtils.js';

const usage = { prompt_tokens: 75, completion_tokens: 1186, total_tokens: 1261,
  completion_tokens_details: { reasoning_tokens: 1024 }, prompt_tokens_details: { cached_tokens: 50 } };
const reply = (content, extra = {}) => ({ id: crypto.randomUUID(), model: 'phase1-mock',
  choices: [{ delta: { content } }], usage, ...extra });
const directive = value => `\`\`\`zeus-directive\n${JSON.stringify(value)}\n\`\`\``;

test.describe('Offline desktop runtime regression', () => {
  let page;
  test.beforeAll(async () => {
    if (process.env.ZEUS_OFFLINE_TEST !== '1') throw new Error('Run with the offline regression command');
    await startMockServer();
    ({ page } = await launchTauri());
    await expect(page.locator('#app-container')).toBeVisible();
    await page.evaluate(async () => {
      const bridge = window.__ZEUS_BRIDGE__, settings = await bridge.getSettings();
      await bridge.saveSettings({ ...settings, master_model: 'phase1-mock', worker_model: 'None',
        verifier_model: 'None', watcher_model: 'None', vision_model: 'None', default_budget_credits: 50000 });
    });
  });
  test.afterEach(async () => cleanupTasks(page));
  test.afterAll(async () => { await stopTauri(); await stopMockServer(); });

  async function newTask(overrides = {}) {
    await page.locator('#new-task-button').click();
    const tasks = await page.evaluate(() => window.__ZEUS_BRIDGE__.listTasks());
    const task = tasks[0];
    await page.evaluate(({ task, overrides }) => window.__ZEUS_BRIDGE__.updateTaskSettings(task.id,
      { ...task, ...overrides }), { task, overrides });
    return task.id;
  }

  test('real bridge, streaming, usage, message ordering, and reload reconciliation', async () => {
    const tid = await newTask();
    queueMockResponse(reply('4'));
    await page.locator('#chat-input').fill('What is 2+2? Answer only the numeral.');
    await page.locator('#chat-send-button').click();
    await expect(page.locator('#chat-messages')).toContainText('4');
    await expect.poll(async () => (await page.evaluate(tid => window.__ZEUS_BRIDGE__.getTaskSpend(tid), tid)).spent_credits).toBe(1261);
    const before = await page.evaluate(tid => window.__ZEUS_BRIDGE__.getTaskMessages(tid, true), tid);
    expect(before.filter(m => m.role === 'user' && m.visible)).toHaveLength(1);
    expect(new Set(before.map(m => m.id)).size).toBe(before.length);
    expect(before.map(m => m.seq)).toEqual([...before].map(m => m.seq).sort((a, b) => a - b));
    await page.reload();
    await expect(page.locator('#app-container')).toBeVisible();
    expect(await page.evaluate(tid => window.__ZEUS_BRIDGE__.getTaskMessages(tid, true), tid)).toEqual(before);
    const spend = await page.evaluate(tid => window.__ZEUS_BRIDGE__.getTaskSpend(tid), tid);
    expect(spend.usage.unknown_requests).toBe(0);
    expect(spend.usage.cached_tokens).toBe(50);
    expect(spend.usage.provider_credits).toBeNull();
  });

  test('Responses SSE usage follows the same accounting contract', async () => {
    const tid = await newTask({ master_model: 'gpt-5-mock' });
    queueMockResponse(reply('4', { model: 'gpt-5-mock', usage: { input_tokens: 75, output_tokens: 1186,
      output_tokens_details: { reasoning_tokens: 1024 }, total_tokens: 1261 } }));
    await page.evaluate(tid => window.__ZEUS_BRIDGE__.sendUserMessage(tid, 'What is 2+2? Answer only the numeral.', crypto.randomUUID()), tid);
    expect((await page.evaluate(tid => window.__ZEUS_BRIDGE__.getTaskSpend(tid), tid)).spent_credits).toBe(1261);
    expect(getMockRequests().at(-1).url).toContain('/responses');
  });

  test('successful output without usage remains one unknown request', async () => {
    const tid = await newTask();
    queueMockResponse({ model: 'phase1-mock', choices: [{ delta: { content: '4' } }] });
    await page.evaluate(tid => window.__ZEUS_BRIDGE__.sendUserMessage(tid, 'What is 2+2? Answer only the numeral.', crypto.randomUUID()), tid);
    const spend = await page.evaluate(tid => window.__ZEUS_BRIDGE__.getTaskSpend(tid), tid);
    expect(spend.usage.requests).toBe(1);
    expect(spend.usage.unknown_requests).toBe(1);
  });

  test('an empty provider reply fails the run but retains reported billed usage', async () => {
    const tid = await newTask();
    queueMockResponse(reply(''));
    const error = await page.evaluate(async tid => {
      try { await window.__ZEUS_BRIDGE__.sendUserMessage(tid, 'Hello', crypto.randomUUID()); }
      catch (error) { return String(error); }
    }, tid);
    expect(error).toContain('without any content');
    const spend = await page.evaluate(tid => window.__ZEUS_BRIDGE__.getTaskSpend(tid), tid);
    expect(spend.spent_credits).toBe(1261);
    expect(spend.usage.requests).toBe(1);
    expect((await page.evaluate(tid => window.__ZEUS_BRIDGE__.getTaskRunState(tid), tid)).status).toBe('failed');
  });

  test('an empty Responses reply also fails without losing usage', async () => {
    const tid = await newTask({ master_model: 'gpt-5-mock' });
    queueMockResponse(reply('', { usage: { input_tokens: 75, output_tokens: 1186,
      output_tokens_details: { reasoning_tokens: 1024 }, total_tokens: 1261 } }));
    const error = await page.evaluate(async tid => {
      try { await window.__ZEUS_BRIDGE__.sendUserMessage(tid, 'Hello', crypto.randomUUID()); }
      catch (error) { return String(error); }
    }, tid);
    expect(error).toContain('without any content');
    const spend = await page.evaluate(tid => window.__ZEUS_BRIDGE__.getTaskSpend(tid), tid);
    expect(spend.spent_credits).toBe(1261);
    expect(spend.usage.requests).toBe(1);
  });

  test('delegated work and verification are included once in the shared budget', async () => {
    const tid = await newTask({ worker_model: 'phase1-mock', verifier_model: 'phase1-mock', budget_credits: 25 });
    const small = { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 };
    const previousRequests = getMockRequests().length;
    queueMockResponse(reply(directive({ type: 'delegate_task', delegate: { name: 'helper',
      objective: 'Return the token ready', success_criteria: 'The answer is exactly ready' } }), { usage: small }));
    queueMockResponse(reply('ready', { usage: small }));
    queueMockResponse({ id: crypto.randomUUID(), model: 'phase1-mock', usage: small,
      choices: [{ message: { content: JSON.stringify({ passed: true, feedback: 'The requested token matches.' }) } }] });
    await page.evaluate(tid => window.__ZEUS_BRIDGE__.sendUserMessage(tid, 'Ask a helper for the token ready.', crypto.randomUUID()), tid);
    const spend = await page.evaluate(tid => window.__ZEUS_BRIDGE__.getTaskSpend(tid), tid);
    expect(spend.spent_credits).toBe(30);
    expect(spend.usage.requests).toBe(3);
    expect(spend.usage.requests_by_role).toEqual({ master: 1, verifier: 1, worker: 1 });
    expect(getMockRequests().length - previousRequests).toBe(3);
    const messages = await page.evaluate(tid => window.__ZEUS_BRIDGE__.getTaskMessages(tid, true), tid);
    expect(messages.some(m => m.content.includes('reached its unit budget'))).toBe(true);
  });

  test('Stop cancels an in-flight model and preserves unknown usage', async () => {
    const tid = await newTask();
    queueMockResponse(reply('late', { _delay_ms: 20000 }));
    const before = getMockRequests().length;
    await page.locator('#chat-input').fill('Hello');
    await page.locator('#chat-send-button').click();
    await expect.poll(() => getMockRequests().length).toBe(before + 1);
    await page.locator('#chat-send-button').click();
    await expect.poll(async () => (await page.evaluate(tid => window.__ZEUS_BRIDGE__.getTaskRunState(tid), tid)).status).toBe('cancelled');
    const spend = await page.evaluate(tid => window.__ZEUS_BRIDGE__.getTaskSpend(tid), tid);
    expect(spend.usage.unknown_requests).toBe(1);
    expect(spend.usage.provider_credits).toBeNull();
  });

  test('a native command waits for a real approval card and the decision persists', async () => {
    const tid = await newTask();
    queueMockResponse(reply(directive({ type: 'run_command', command: 'echo ZEUS_OFFLINE_APPROVAL' })));
    queueMockResponse(reply(directive({ type: 'final_answer', final_answer: { summary: 'approval-complete' } })));
    await page.locator('#chat-input').fill('Run the harmless echo command and report its output.');
    await page.locator('#chat-send-button').click();
    const card = page.locator('.approval-card.pending');
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: 'Approve (Once)' }).click();
    await expect(page.locator('#chat-messages')).toContainText('approval-complete');
    const messages = await page.evaluate(tid => window.__ZEUS_BRIDGE__.getTaskMessages(tid, true), tid);
    expect(JSON.parse(messages.find(m => m.kind === 'approval').content).status).toBe('approved');
    expect(messages.some(m => m.kind === 'directive_result' && m.content.includes('ZEUS_OFFLINE_APPROVAL'))).toBe(true);
  });

  test('the attachment picker persists the supplied bytes and references the saved file', async () => {
    const tid = await newTask();
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2S8AAAAASUVORK5CYII=', 'base64');
    await page.locator('input[type=file]').setInputFiles({ name: 'fixture.png', mimeType: 'image/png', buffer: bytes });
    await expect(page.locator('#attachment-tray')).toContainText('fixture.png');
    queueMockResponse(reply('attachment-received'));
    await page.locator('#chat-input').fill('Acknowledge the attachment receipt.');
    await page.locator('#chat-send-button').click();
    await expect(page.locator('#chat-messages')).toContainText('attachment-received');
    const saved = path.join(process.env.ZEUS_TEST_WORKSPACE_ROOT, 'tasks', tid, 'workspace/attachments/fixture.png');
    expect(fs.readFileSync(saved)).toEqual(bytes);
    const messages = await page.evaluate(tid => window.__ZEUS_BRIDGE__.getTaskMessages(tid, true), tid);
    expect(messages.some(m => m.role === 'user' && m.content.includes(saved))).toBe(true);
  });
});
