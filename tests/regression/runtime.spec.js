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
  let page,appWorkspace;
  test.beforeAll(async () => {
    if (process.env.ZEUS_OFFLINE_TEST !== '1') throw new Error('Run with the offline regression command');
    await startMockServer();
    ({ page, workspace:appWorkspace } = await launchTauri());
    await expect(page.locator('#app-container')).toBeVisible();
    await page.evaluate(async () => {
      const bridge = window.__ZEUS_BRIDGE__, settings = await bridge.getSettings();
      await bridge.saveSettings({ ...settings, model_bindings:{},master_model: 'phase1-mock', worker_model: 'None',
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
      { ...task, ...overrides, model_bindings:overrides.model_bindings }), { task, overrides });
    return task.id;
  }

  test('real bridge, streaming, usage, message ordering, and reload reconciliation', async () => {
    // Native visibility is independent of DOM visibility: background tests
    // must still render and execute the real webview without occupying the desktop.
    const nativeWindow=await page.evaluate(async()=>({
      visible:await window.__TAURI_INTERNALS__.invoke('plugin:window|is_visible',{label:'main'}),
      focused:await window.__TAURI_INTERNALS__.invoke('plugin:window|is_focused',{label:'main'}),
    }));
    expect(nativeWindow).toEqual({visible:false,focused:false});
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
    const tid = await newTask({ master_model: 'gpt-5-nano' });
    queueMockResponse(reply('4', { model: 'gpt-5-nano', usage: { input_tokens: 75, output_tokens: 1186,
      output_tokens_details: { reasoning_tokens: 1024 }, total_tokens: 1261 } }));
    await page.evaluate(tid => window.__ZEUS_BRIDGE__.sendUserMessage(tid, 'What is 2+2? Answer only the numeral.', crypto.randomUUID()), tid);
    expect((await page.evaluate(tid => window.__ZEUS_BRIDGE__.getTaskSpend(tid), tid)).spent_credits).toBe(1261);
    expect(getMockRequests().at(-1).url).toContain('/responses');
  });

  test('debug export identifies the sole managed route even with no browser sessions',async()=>{
    await newTask();
    await page.evaluate(()=>{
      window.__ORIGINAL_CLIPBOARD_WRITE__=navigator.clipboard.writeText;
      navigator.clipboard.writeText=async text=>{window.__COPIED_DEBUG__=text;};
    });
    try {
      await page.locator('#chat-log-button').click();
      await page.locator('#chat-log-copy-debug').click();
      await expect.poll(()=>page.evaluate(()=>window.__COPIED_DEBUG__??'')).toContain('runtime_at_export');
      const report=await page.evaluate(()=>window.__COPIED_DEBUG__);
      const browser=JSON.parse(report.split('--- MANAGED BROWSER JOURNAL (coverage stated in snapshot) ---')[1].split('--- BACKEND EVENTS')[0]);
      expect(browser.runtime_at_export).toMatchObject({enabled:true,route:'managed-v1'});
      expect(browser.sessions).toEqual([]);
    } finally {
      await page.evaluate(()=>{navigator.clipboard.writeText=window.__ORIGINAL_CLIPBOARD_WRITE__;delete window.__ORIGINAL_CLIPBOARD_WRITE__;delete window.__COPIED_DEBUG__;});
      await page.reload();
      await expect(page.locator('#app-container')).toBeVisible();
    }
  });

  test('a completed conversational answer mentioning future work is not forced into another reply',async()=>{
    const tid=await newTask(),before=getMockRequests().length;
    const answer="I'm Zeus. I can help with writing and automation. Hand over a goal and I'll get to work.";
    queueMockResponse(reply(answer));
    await page.evaluate(({tid,prompt})=>window.__ZEUS_BRIDGE__.sendUserMessage(tid,prompt,crypto.randomUUID()),{tid,prompt:'Which assistant are you?'});
    const messages=await page.evaluate(tid=>window.__ZEUS_BRIDGE__.getTaskMessages(tid,true),tid);
    expect(messages.filter(message=>message.role==='assistant'&&message.visible).map(message=>message.content)).toEqual([answer]);
    expect(messages.some(message=>message.content.includes('SYSTEM AUTO-CONTINUATION'))).toBe(false);
    expect(getMockRequests().length-before).toBe(1);
  });

  test('a final-answer preamble and summary publish one result and preserve the raw directive',async()=>{
    const tid=await newTask(),answer='The two matching icons belong to the same game.';
    queueMockResponse(reply(answer+'\n'+directive({type:'final_answer',final_answer:{summary:answer}})));
    await page.evaluate(tid=>window.__ZEUS_BRIDGE__.sendUserMessage(tid,'Compare these example labels.',crypto.randomUUID()),tid);
    const messages=await page.evaluate(tid=>window.__ZEUS_BRIDGE__.getTaskMessages(tid,true),tid);
    expect(messages.filter(message=>message.role==='assistant'&&message.visible).map(message=>message.content)).toEqual([answer]);
    expect(messages.some(message=>message.kind==='directive'&&!message.visible&&message.content.includes('final_answer'))).toBe(true);
    await page.reload();
    const visible=await page.evaluate(tid=>window.__ZEUS_BRIDGE__.getTaskMessages(tid),tid);
    expect(visible.filter(message=>message.role==='assistant').map(message=>message.content)).toEqual([answer]);
  });

  test('rejected tool syntax requires a bounded explicit repair, not a narration-only completion',async()=>{
    const tid=await newTask();
    queueMockResponse(reply(directive({type:'write_file',path:'repaired.txt',content:'once'})+'\n'+directive({type:'final_answer',final_answer:{summary:'Not yet executed'}})));
    queueMockResponse(reply("I'll save the file now."));
    queueMockResponse(reply(directive({type:'write_file',path:'repaired.txt',content:'once'})));
    queueMockResponse(reply(directive({type:'final_answer',final_answer:{summary:'Saved once.'}})));
    await page.evaluate(tid=>window.__ZEUS_BRIDGE__.sendUserMessage(tid,'Save repaired.txt.',crypto.randomUUID()),tid);
    const messages=await page.evaluate(tid=>window.__ZEUS_BRIDGE__.getTaskMessages(tid,true),tid);
    expect(messages.filter(message=>message.role==='assistant'&&message.visible).map(message=>message.content)).toEqual(['Saved once.']);
    expect(fs.readFileSync(path.join(appWorkspace,'tasks',tid,'workspace','repaired.txt'),'utf8')).toBe('once');
  });

  test('a standalone future-action announcement stays interim until the file is actually written',async()=>{
    const tid=await newTask();
    queueMockResponse(reply('I’ll save the file and verify it now.'));
    queueMockResponse(reply(directive({type:'write_file',path:'announced.txt',content:'performed'})));
    queueMockResponse(reply(directive({type:'final_answer',final_answer:{summary:'The file is saved.'}})));
    await page.evaluate(tid=>window.__ZEUS_BRIDGE__.sendUserMessage(tid,'Write announced.txt.',crypto.randomUUID()),tid);
    expect(fs.readFileSync(path.join(appWorkspace,'tasks',tid,'workspace','announced.txt'),'utf8')).toBe('performed');
    const visible=await page.evaluate(tid=>window.__ZEUS_BRIDGE__.getTaskMessages(tid),tid);
    expect(visible.filter(message=>message.role==='assistant').map(message=>message.content)).toEqual(['The file is saved.']);
  });

  test('unrepaired model syntax returns a bounded error with every raw reply preserved',async()=>{
    const tid=await newTask(),before=getMockRequests().length;
    const malformed=directive({type:'list_dir',path:'.'})+'\n'+directive({type:'final_answer',final_answer:{summary:'No action ran'}});
    for(let index=0;index<4;index++)queueMockResponse(reply(malformed));
    await expect(page.evaluate(tid=>window.__ZEUS_BRIDGE__.sendUserMessage(tid,'Exercise the malformed protocol control.',crypto.randomUUID()),tid)).rejects.toThrow('MODEL_PROTOCOL_ERROR');
    const messages=await page.evaluate(tid=>window.__ZEUS_BRIDGE__.getTaskMessages(tid,true),tid);
    expect(messages.filter(message=>message.kind==='directive')).toHaveLength(4);
    expect(messages.filter(message=>message.role==='assistant'&&message.visible)).toHaveLength(0);
    expect(getMockRequests().length-before).toBe(4);
    expect((await page.evaluate(tid=>window.__ZEUS_BRIDGE__.getTaskRunState(tid),tid)).status).toBe('failed');
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
    const tid = await newTask({ master_model: 'gpt-5-nano' });
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
    expect(messages.every(message=>message.conversation==='master')).toBe(true);
    const debugMessages=await page.evaluate(tid=>window.__ZEUS_BRIDGE__.getTaskDebugMessages(tid),tid);
    expect(debugMessages.some(message=>message.conversation!=='master')).toBe(true);
    expect(debugMessages.filter(message=>message.conversation==='master')).toEqual(messages);
    expect(debugMessages.map(message=>message.seq)).toEqual([...debugMessages].map(message=>message.seq).sort((a,b)=>a-b));
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
    await expectSingleStopNotice(tid);
  });

  async function expectSingleStopNotice(tid) {
    const notice='Zeus stopped this run at your request.';
    const messages=await page.evaluate(tid=>window.__ZEUS_BRIDGE__.getTaskMessages(tid,true),tid);
    expect(messages.filter(message=>message.content===notice)).toHaveLength(1);
    await expect(page.locator('#chat-messages').getByText(notice,{exact:true})).toHaveCount(1);
    await page.reload();
    await expect(page.locator('#app-container')).toBeVisible();
    const reloaded=await page.evaluate(tid=>window.__ZEUS_BRIDGE__.getTaskMessages(tid,true),tid);
    expect(reloaded.filter(message=>message.content===notice)).toHaveLength(1);
  }

  for(const boundary of ['worker stream','worker permission','verifier stream']) {
    test(`Stop at ${boundary} publishes one durable root notice`,async()=>{
      const tid=await newTask({worker_model:'phase1-worker',verifier_model:boundary==='verifier stream'?'phase1-verifier':'None'});
      const before=getMockRequests().length;
      queueMockResponse(reply(directive({type:'delegate_task',delegate:{name:'Stop boundary',objective:'Wait for a controller cancellation.',success_criteria:'No external effects.'}})));
      if(boundary==='worker stream')queueMockResponse(reply('late worker result',{_delay_ms:20000}));
      else if(boundary==='worker permission')queueMockResponse(reply(directive({type:'run_command',command:'echo ZEUS_CANCELLED_PERMISSION'})));
      else {
        queueMockResponse(reply(directive({type:'final_answer',final_answer:{summary:'Ready for verification.'}})));
        queueMockResponse(reply(JSON.stringify({passed:true,feedback:'late verifier result',blockers:[]}),{_delay_ms:20000}));
      }
      await page.locator('#chat-input').fill('Start the synthetic worker and wait.');
      await page.locator('#chat-send-button').click();
      if(boundary==='worker permission')await expect(page.locator('.approval-card.pending')).toBeVisible();
      else await expect.poll(()=>getMockRequests().length).toBe(before+(boundary==='verifier stream'?3:2));
      await page.locator('#chat-send-button').click();
      await expect.poll(async()=>(await page.evaluate(tid=>window.__ZEUS_BRIDGE__.getTaskRunState(tid),tid)).status).toBe('cancelled');
      await expectSingleStopNotice(tid);
    });
  }

  test('a native command waits for a real approval card and the decision persists', async () => {
    const tid = await newTask();
    queueMockResponse(reply(directive({ type: 'run_command', command: 'echo ZEUS_OFFLINE_APPROVAL' })));
    queueMockResponse(reply(directive({ type: 'final_answer', final_answer: { summary: 'approval-complete' } })));
    await page.locator('#chat-input').fill('Run the harmless echo command and report its output.');
    await page.locator('#chat-send-button').click();
    const card = page.locator('.approval-card.pending');
    await expect(card).toBeVisible();
    const heading=card.locator('.approval-card-title');
    await expect(heading).toHaveCSS('user-select','text');
    const box=await heading.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box.x+2,box.y+box.height/2);
    await page.mouse.down();
    await page.mouse.move(box.x+box.width-2,box.y+box.height/2,{steps:10});
    await page.mouse.up();
    expect(await page.evaluate(()=>window.getSelection()?.toString())).toMatch(/run command/i);
    await card.getByRole('button', { name: 'Approve (Once)' }).click();
    await expect(page.locator('#chat-messages')).toContainText('approval-complete');
    const messages = await page.evaluate(tid => window.__ZEUS_BRIDGE__.getTaskMessages(tid, true), tid);
    expect(JSON.parse(messages.find(m => m.kind === 'approval').content).status).toBe('approved');
    expect(messages.some(m => m.kind === 'directive_result' && m.content.includes('ZEUS_OFFLINE_APPROVAL'))).toBe(true);
  });

  test('the attachment picker stores exact bytes with a durable message reference', async () => {
    const tid = await newTask({master_model:'gpt-5-nano'});
    const bytes=fs.readFileSync(path.resolve('tests/benchmarks/missions/v1/V01/inputs/7f91c2a0.png'));
    await page.locator('input[type=file]').setInputFiles({ name: 'fixture.png', mimeType: 'image/png', buffer: bytes });
    await expect(page.locator('#attachment-tray')).toContainText('fixture.png');
    queueMockResponse(reply(directive({type:'final_answer',final_answer:{summary:'attachment-received'}})));
    await page.locator('#chat-input').fill('Acknowledge the attachment receipt.');
    await page.locator('#chat-send-button').click();
    await expect(page.locator('#chat-messages')).toContainText('attachment-received');
    const messages = await page.evaluate(tid => window.__ZEUS_BRIDGE__.getTaskMessages(tid, true), tid);
    const user=messages.find(message=>message.role==='user'&&message.attachments?.length);
    expect(user.attachments).toHaveLength(1);
    const saved=path.join(process.env.ZEUS_TEST_WORKSPACE_ROOT,'tasks',tid,'workspace',user.attachments[0].storage_key);
    expect(fs.readFileSync(saved)).toEqual(bytes);
  });
});
