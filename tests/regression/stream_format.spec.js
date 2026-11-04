import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import {startMockServer,stopMockServer,launchTauri,stopTauri,queueMockResponse,getMockRequests} from '../e2e/testUtils.js';

test.afterEach(async()=>{await stopTauri();await stopMockServer();});

for(const protocol of ['chat','responses'])test(`${protocol} preserves fragmented Unicode without appending final payload twice`,async({},info)=>{
  await startMockServer();const {page}=await launchTauri();await expect(page.locator('#app-container')).toBeVisible();
  const model=protocol==='chat'?'phase1-mock':'gpt-5-nano';
  const task=await page.evaluate(async model=>{
    const bridge=window.__ZEUS_BRIDGE__,settings=await bridge.getSettings();
    await bridge.saveSettings({...settings,master_model:model,worker_model:'None',verifier_model:'None',watcher_model:'None',vision_model:'None',model_bindings:{}});
    return bridge.createTask('Synthetic stream boundary diagnostic');
  },model);
  const text='Зевс remembered: café 🎂 — once.';
  const usage={prompt_tokens:5,completion_tokens:5,total_tokens:10};
  const packet=protocol==='chat'?`data: ${JSON.stringify({model,choices:[{delta:{content:text},message:{content:text}}],usage})}\n\n`:
    `event: response.output_text.delta\ndata: ${JSON.stringify({type:'response.output_text.delta',delta:text})}\n\n`+
    `event: response.completed\ndata: ${JSON.stringify({type:'response.completed',response:{model,usage,output:[{type:'message',content:[{type:'output_text',text}]}]}})}\n\n`;
  const wire=Buffer.from(packet+'data: [DONE]'); // Also exercise EOF without a final newline.
  const boundary=wire.indexOf(Buffer.from('З'))+1;
  fs.writeFileSync(info.outputPath('synthetic-response.sse'),wire);
  queueMockResponse({_wire_chunks:[Array.from(wire.subarray(0,boundary)),Array.from(wire.subarray(boundary))]});
  await page.evaluate(id=>window.__ZEUS_BRIDGE__.sendUserMessage(id,'Return the synthetic text once.',crypto.randomUUID()),task.id);
  const messages=await page.evaluate(id=>window.__ZEUS_BRIDGE__.getTaskMessages(id,true),task.id);
  const answers=messages.filter(message=>message.role==='assistant'&&message.kind==='chat'&&message.visible);
  expect(answers.map(message=>message.content)).toEqual([text]);
  expect(getMockRequests()).toHaveLength(1);
  expect(getMockRequests()[0].url).toContain(protocol==='chat'?'/chat/completions':'/responses');
  fs.writeFileSync(info.outputPath('decoded-response.json'),JSON.stringify({protocol,text:answers[0].content,requests:getMockRequests().length},null,2));
});
