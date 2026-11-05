import {test,expect} from '@playwright/test';
import {startMockServer,stopMockServer,launchTauri,stopTauri,queueMockResponse,getMockRequests} from '../e2e/testUtils.js';

const directive=value=>'```zeus-directive\n'+JSON.stringify(value)+'\n```';
const reply=(content,extra={})=>({model:'phase1-mock',choices:[{delta:{content}}],usage:{prompt_tokens:5,completion_tokens:5,total_tokens:10},...extra});
const checkpoint=page=>page.evaluate(async()=>{
  const tasks=await window.__ZEUS_BRIDGE__.listTasks();
  const messages=await window.__ZEUS_BRIDGE__.getTaskMessages(tasks[0].id,true);
  return JSON.parse(messages.find(message=>message.kind==='task_checkpoint').content);
});
async function openPlan(page){
  const button=page.locator('#chat-top-bar').getByRole('button',{name:'Action Plan',exact:true});
  if(await button.isVisible())await button.click();
  else {await page.getByRole('button',{name:'More chat actions'}).click();await page.getByRole('menuitem',{name:'Action Plan',exact:true}).click();}
}
async function launch(){
  await startMockServer();const app=await launchTauri();const {page}=app;
  await expect(page.locator('#app-container')).toBeVisible();
  await page.evaluate(async()=>{
    const bridge=window.__ZEUS_BRIDGE__,settings=await bridge.getSettings();
    await bridge.saveSettings({...settings,master_model:'phase1-mock',worker_model:'None',verifier_model:'None',watcher_model:'None',vision_model:'None',model_bindings:{}});
  });
  await page.locator('#new-task-button').click();
  return app;
}
test.afterEach(async()=>{await stopTauri();await stopMockServer();});

test('plan execution follows approval, resume and finish without inventing milestone success',async({},info)=>{
  const {page}=await launch();
  queueMockResponse(reply(directive({type:'update_action_plan',action_plan:'- [/] Inspect the fixture\n- [ ] Deliver the report'})));
  queueMockResponse(reply(directive({type:'run_command',command:'echo ZEUS_CHECKPOINT_FIXTURE'})));
  queueMockResponse(reply(directive({type:'final_answer',final_answer:{summary:'The command returned its output; report delivery is not verified.'}})));
  await page.locator('#chat-input').fill('Run the controlled echo command. Keep delivery as a separate pending milestone.');
  await page.locator('#chat-send-button').click();
  const card=page.locator('.approval-card.pending');await expect(card).toBeVisible();
  await openPlan(page);
  await expect(page.getByLabel('Execution status')).toContainText('Waiting for you');
  await expect(page.locator('#thinking-indicator')).toHaveCount(0);
  await expect(page.locator('.action-plan-progress-info')).toContainText('0%');
  await expect(page.locator('.action-plan-status-badge').first()).toHaveText('paused');
  const waiting=await checkpoint(page);
  expect(waiting.checkpoint.user_input_revision).toBe(1);
  expect(waiting.checkpoint.pending_human_requests).toBe(1);
  const statusRow=await page.locator('.action-plan-execution-row').boundingBox();
  const resultsRow=await page.locator('.action-plan-execution-detail').boundingBox();
  expect(resultsRow.y).toBeGreaterThanOrEqual(statusRow.y+statusRow.height);
  await page.screenshot({path:info.outputPath('plan-awaiting-approval.png')});
  await card.getByRole('button',{name:'Approve (Once)'}).click();
  await expect(page.getByLabel('Execution status')).toContainText('Run finished');
  await expect(page.locator('.action-plan-status-badge').first()).toHaveText('not confirmed');
  await expect(page.locator('.action-plan-progress-info')).toContainText('0%');
  const finished=await checkpoint(page);
  expect(finished.checkpoint.actions).toEqual({attempted:1,returned:1,uncertain:0});
  expect(finished.checkpoint.user_input_revision).toBe(1);
  expect(getMockRequests()).toHaveLength(3);
  expect(JSON.stringify(getMockRequests().map(value=>value.body))).not.toContain('4 consecutive actions');
  await page.screenshot({path:info.outputPath('plan-run-finished.png')});
  await page.reload();await expect(page.locator('#app-container')).toBeVisible();
  await page.locator('.sidebar-task-title').first().click();await openPlan(page);
  const after=await checkpoint(page);expect(after.checkpoint).toEqual(finished.checkpoint);
  await expect(page.getByLabel('Execution status')).toContainText('Run finished');
});

test('Stop updates one stable projection and preserves the original plan proposal',async({},info)=>{
  const {page}=await launch();
  queueMockResponse(reply(directive({type:'update_action_plan',action_plan:'- [Done] Inspect inputs\n- [/] Prepare report'})));
  queueMockResponse(reply('Late answer',{_delay_ms:20000}));
  await page.locator('#chat-input').fill('Start the controlled workflow and wait.');
  await page.locator('#chat-send-button').click();
  await expect.poll(()=>getMockRequests().length).toBe(2);
  await openPlan(page);
  await expect(page.getByLabel('Execution status')).toContainText('Working');
  const task=(await page.evaluate(()=>window.__ZEUS_BRIDGE__.listTasks()))[0];
  const before=await page.evaluate(id=>window.__ZEUS_BRIDGE__.getTaskMessages(id,true),task.id);
  const projection=before.find(message=>message.kind==='task_checkpoint');
  const original=before.find(message=>message.kind==='action_plan');
  await page.locator('#chat-send-button').click();
  await expect(page.getByLabel('Execution status')).toContainText('Stopped');
  await expect(page.locator('.action-plan-status-badge').nth(1)).toHaveText('interrupted');
  const after=await page.evaluate(id=>window.__ZEUS_BRIDGE__.getTaskMessages(id,true),task.id);
  expect(after.find(message=>message.id===original.id).content).toBe(original.content);
  const current=after.find(message=>message.kind==='task_checkpoint');
  expect(current.id).toBe(projection.id);expect(current.seq).toBe(projection.seq);
  expect(current.projection_version).toBeGreaterThan(projection.projection_version);
  expect(after.filter(message=>message.content==='Zeus stopped this run at your request.')).toHaveLength(1);
  await page.screenshot({path:info.outputPath('plan-stopped.png')});
});

test('a rejected stale proposal stays historical while a corrected proposal and ordinary work can proceed',async()=>{
  const {page}=await launch();
  const currentPlan='- [ ] Current task\n\n'+'Detailed planning context. '.repeat(200)+'Final constraint: preserve the original inputs.';
  queueMockResponse(reply(directive({type:'update_action_plan',base_input_revision:0,action_plan:'- [Done] Obsolete plan'})));
  queueMockResponse(reply(directive({type:'update_action_plan',base_input_revision:1,action_plan:currentPlan})));
  queueMockResponse(reply('A completed conversational answer.'));
  await page.locator('#chat-input').fill('Use my current request.');
  await page.locator('#chat-send-button').click();
  await expect.poll(async()=>(await checkpoint(page)).checkpoint.state).toBe('completed');
  const current=await checkpoint(page);expect(current.markdown).toBe(currentPlan);
  expect(current.checkpoint.plan_input_revision).toBe(1);
  const task=(await page.evaluate(()=>window.__ZEUS_BRIDGE__.listTasks()))[0];
  const plans=await page.evaluate(async id=>(await window.__ZEUS_BRIDGE__.getTaskMessages(id,true)).filter(message=>message.kind==='action_plan').map(message=>JSON.parse(message.content)),task.id);
  expect(plans.map(plan=>plan.proposal_state)).toEqual(['stale','accepted']);
  expect(getMockRequests()).toHaveLength(3);
  const context=getMockRequests()[2].body.messages;
  expect(context.some(message=>message.role==='user'&&message.content.includes('[Model-authored plan]\n'+currentPlan))).toBe(true);
  expect(context.some(message=>message.role==='system'&&message.content.includes('source of truth for remaining work'))).toBe(false);
});
