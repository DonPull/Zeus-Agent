import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import {startMockServer,stopMockServer,launchTauri,stopTauri,queueMockResponse,getMockRequests} from '../e2e/testUtils.js';

const limits={max_requests:12,max_tokens:1000000,max_in_flight:2,max_output_tokens:4096,max_directives:12,wall_time_ms:90000};
const directive=value=>'```zeus-directive\n'+JSON.stringify(value)+'\n```';
const reply=(content,extra={})=>({model:'phase1-mock',choices:[{delta:{content}}],usage:{prompt_tokens:5,completion_tokens:5,total_tokens:10},...extra});
const action=(value,extra={})=>queueMockResponse(reply(directive(value),extra));
const finish=(summary,completion,extra={})=>action({type:'final_answer',final_answer:{summary,...completion?{completion}:{}}},extra);
const claimed=(checks,status='completed',extra={})=>({status,criteria:[{id:'report',description:'Requested report saved with the required currency',checks}],...extra});
const messages=(app,task)=>app.page.evaluate(id=>window.__ZEUS_BRIDGE__.getTaskDebugMessages(id),task.id);
const reports=async(app,task)=>(await messages(app,task)).filter(m=>m.kind==='completion_report');
const send=(app,task,text='Save the JSON report with currency EUR.')=>app.page.evaluate(({id,text})=>window.__ZEUS_BRIDGE__.sendUserMessage(id,text,crypto.randomUUID()),{id:task.id,text});
async function launch(settings={},runtime={}){
  await startMockServer();const app=await launchTauri(false,{evaluationLimits:limits,...runtime});
  await expect(app.page.locator('#app-container')).toBeVisible();
  const task=await app.page.evaluate(()=>window.__ZEUS_BRIDGE__.createTask('Completion fixture'));
  await app.page.evaluate(({id,settings})=>window.__ZEUS_BRIDGE__.updateTaskSettings(id,{master_model:'phase1-mock',worker_model:'None',verifier_model:'None',watcher_model:'None',vision_model:'None',budget_credits:1000000,...settings}),{id:task.id,settings});
  return {app,task};
}
async function select(app,task){
  await app.page.evaluate(()=>window.__ZEUS_REFRESH_TASKS__?.());
  await app.page.locator('.sidebar-task').filter({has:app.page.locator('.sidebar-task-title[title="Completion fixture"]')}).click();
}
test.afterEach(async()=>{await stopTauri();await stopMockServer();});

test('ordinary questions and legacy final answers do not create checks or extra model calls',async()=>{
  const {app,task}=await launch({verifier_model:'phase1-mock'});
  queueMockResponse(reply('4'));await send(app,task,'What is 2+2?');finish('You are welcome.');await send(app,task,'Thanks.');
  expect(await reports(app,task)).toHaveLength(0);expect(getMockRequests()).toHaveLength(2);
});

test('real artifact checks persist below one answer and remain narrowly labelled after reload',async({},info)=>{
  const {app,task}=await launch();const content='{"currency":"EUR","label":"Café"}';
  action({type:'write_file',path:'report.json',content});
  finish('Saved the report.',claimed([{kind:'file_exists',path:'report.json'},{kind:'json_value',path:'report.json',pointer:'/currency',expected:'EUR'},{kind:'file_sha256',path:'report.json',sha256:crypto.createHash('sha256').update(content).digest('hex')}]));
  await send(app,task);await select(app,task);
  const raw=await reports(app,task);expect(raw).toHaveLength(1);const report=JSON.parse(raw[0].content);
  expect(report.checks).toEqual({passed:3,failed:0,unknown:0});expect(report.goal_status).toBe('unknown');
  expect(fs.readFileSync(path.join(app.workspace,'tasks',task.id,'workspace/report.json'),'utf8')).toBe(content);
  const card=app.page.getByRole('region',{name:'Completion evidence'});await expect(card).toContainText('Checks passed');
  await expect(card).toContainText('The whole goal has not been independently verified.');
  await card.getByRole('button',{name:'Show evidence details'}).click();
  for(const width of [1250,540]){
    await app.page.setViewportSize({width,height:900});await expect(card).toBeVisible();
    await app.page.screenshot({path:info.outputPath('completion-'+width+'.png')});
    const box=await card.boundingBox();expect(box.x+box.width).toBeLessThanOrEqual(width);
  }
  await app.page.reload();await expect(app.page.locator('#app-container')).toBeVisible();await select(app,task);
  expect((await reports(app,task))[0].seq).toBe(raw[0].seq);
});

test('one definite failed check requests a correction without publishing the unsupported first answer',async()=>{
  const {app,task}=await launch();const completion=claimed([{kind:'file_exists',path:'report.json'}]);
  finish('Unsupported first answer.',completion);
  action({type:'write_file',path:'report.json',content:'{"currency":"EUR"}'});
  finish('Corrected report saved.',completion);await send(app,task);
  const raw=await messages(app,task);const cards=raw.filter(m=>m.kind==='completion_report').map(m=>JSON.parse(m.content));
  expect(cards).toHaveLength(2);expect(cards[0].checks.failed).toBe(1);expect(cards[0].correction_requested).toBe(true);
  expect(cards[1].checks.passed).toBe(1);
  expect(raw.filter(m=>m.role==='assistant'&&m.kind==='chat').map(m=>m.content)).toEqual(['Corrected report saved.']);
  expect(getMockRequests()).toHaveLength(3);expect(JSON.stringify(getMockRequests()[1].body)).toContain('COMPLETION_CHECK_FAILED');
});

test('repeated failure is bounded and partial or unknown claims do not create a repair loop',async()=>{
  const {app,task}=await launch();const completion=claimed([{kind:'file_exists',path:'missing.json'}]);
  finish('Still unable to finish.',completion);finish('Still unable to finish.',completion);
  await send(app,task);expect(getMockRequests()).toHaveLength(2);
  expect((await messages(app,task)).filter(m=>m.role==='assistant'&&m.kind==='chat')).toHaveLength(1);
  finish('The output is missing.',claimed([{kind:'file_exists',path:'missing.json'}],'partial'));await send(app,task,'Report the remaining limitation.');
  expect(getMockRequests()).toHaveLength(3);
  expect(JSON.parse((await reports(app,task)).at(-1).content).claim_status).toBe('partial');
});

async function startReviewed(settings={},response=null){
  const {app,task}=await launch({verifier_model:'phase1-mock',verifier_effort:'low',...settings});
  action({type:'write_file',path:'report.json',content:'{"currency":"EUR"}'},{_delay_ms:1000});
  const pending=send(app,task).then(value=>({value}),error=>({error:String(error)}));
  await expect.poll(()=>getMockRequests().length).toBe(1);
  const human=(await messages(app,task)).find(m=>m.role==='user'&&m.kind==='chat');
  const completion=claimed([{kind:'json_value',path:'report.json',pointer:'/currency',expected:'EUR'}],'completed',{review:true});
  completion.criteria[0].source_message_ids=[human.id];finish('Saved the requested report.',completion);
  queueMockResponse(response??reply(JSON.stringify({state:'supported',feedback:'The recorded currency matches the original request.',evidence:[human.id]})));
  return {app,task,pending};
}

test('optional model review cites original requirements and has a smaller output cap and stable report identity',async()=>{
  const {app,task,pending}=await startReviewed();
  expect((await pending).error).toBeUndefined();
  const [stored]=await reports(app,task);const report=JSON.parse(stored.content);
  expect(report.review.state).toBe('supported');expect(report.goal_status).toBe('model_supported');
  expect(stored.projection_version).toBe(2);expect(getMockRequests()).toHaveLength(3);
  expect(getMockRequests()[2].body.max_tokens).toBe(2048);
  const packet=JSON.parse(getMockRequests()[2].body.messages.at(-1).content);
  expect(packet.execution_receipt.coverage).toBe('all recorded dispatches in this run');
  expect(packet.execution_receipt.tool_attempts.map(a=>[a.operation,a.status])).toEqual([['write_file','returned']]);
  const usage=await app.page.evaluate(id=>window.__ZEUS_BRIDGE__.getTaskSpend(id),task.id);
  expect(usage.usage.requests_by_role).toEqual({master:2,verifier:1});
  await app.page.reload();await expect(app.page.locator('#app-container')).toBeVisible();
  expect((await reports(app,task))[0].seq).toBe(stored.seq);expect((await reports(app,task))[0].projection_version).toBe(2);
});

test('a failed optional review stays unknown and its provider request is never retried',async()=>{
  const {app,task,pending}=await startReviewed({},reply('not supported',{_http_status:400}));
  expect((await pending).error).toBeUndefined();
  const report=JSON.parse((await reports(app,task))[0].content);
  expect(report.review.state).toBe('unknown');expect(report.goal_status).toBe('unknown');
  expect(getMockRequests()).toHaveLength(3);
  const usage=await app.page.evaluate(id=>window.__ZEUS_BRIDGE__.getTaskSpend(id),task.id);
  expect(usage.usage.requests_by_role.verifier).toBe(1);expect(usage.usage.unknown_requests).toBe(1);
});

test('Stop during review preserves one stop notice and cannot publish the pending final answer',async()=>{
  const {app,task,pending}=await startReviewed({},reply('late review',{_delay_ms:20000}));
  await expect.poll(async()=>JSON.parse((await reports(app,task))[0]?.content??'{}').review?.state).toBe('checking');
  await expect.poll(()=>getMockRequests().length).toBe(3);
  await app.page.evaluate(id=>window.__ZEUS_BRIDGE__.cancelTaskRun(id),task.id);expect((await pending).error).toContain('RUN_CANCELLED');
  const raw=await messages(app,task);
  expect(raw.filter(m=>m.role==='assistant'&&m.kind==='chat')).toHaveLength(0);
  expect(raw.filter(m=>m.content==='Zeus stopped this run at your request.')).toHaveLength(1);
  expect(JSON.parse(raw.find(m=>m.kind==='completion_report').content).review.state).toBe('unknown');
});

test('restart during review preserves sources and changes checking to unknown without another request',async()=>{
  let {app,task,pending}=await startReviewed({},reply('late review',{_delay_ms:20000}));
  await expect.poll(()=>getMockRequests().length).toBe(3);
  const before=(await reports(app,task))[0];await stopTauri();await pending;
  app=await launchTauri(false,{reuseWorkspace:app.workspace,evaluationLimits:limits});await expect(app.page.locator('#app-container')).toBeVisible();
  const after=(await reports(app,task))[0];expect(after.id).toBe(before.id);expect(after.seq).toBe(before.seq);
  expect(JSON.parse(after.content).review.state).toBe('unknown');expect(getMockRequests()).toHaveLength(3);
});

test('unsupported evidence and malformed completion metadata remain unknown with no unrequested work',async()=>{
  const {app,task}=await launch();
  finish('No verified claim.',claimed([{kind:'execute_this_code',code:'print("passed")'}]));
  await send(app,task);expect(JSON.parse((await reports(app,task))[0].content).checks.unknown).toBe(1);
  finish('Malformed claim.',"invalid");await send(app,task,'Explain the limitation.');
  expect(getMockRequests()).toHaveLength(2);
  expect(JSON.parse((await reports(app,task)).at(-1).content).claim_status).toBe('unknown');
});

test('a requested review with no configured verifier stays unknown without falling back to the actor',async()=>{
  const {app,task}=await launch();
  finish('Unverified work.',claimed([],'completed',{review:true}));await send(app,task,'Explain the existing work.');
  const report=JSON.parse((await reports(app,task))[0].content);
  expect(report.review.state).toBe('unknown');expect(report.review.attempted).toBe(false);
  expect(report.review.reason).toBe('No verifier is configured');expect(getMockRequests()).toHaveLength(1);
});

test('worker evidence stays in its own scope and cannot independently certify the master goal',async()=>{
  const {app,task}=await launch({worker_model:'phase1-mock'});
  const completion=claimed([{kind:'file_exists',path:'worker-report.json'}]);
  action({type:'delegate_task',delegate:{name:'Report worker',objective:'Save worker-report.json with currency EUR.',success_criteria:'File saved with EUR.'}});
  finish('Unsupported worker answer.',completion);
  action({type:'write_file',path:'worker-report.json',content:'{"currency":"EUR"}'});
  finish('Worker report saved.',completion);finish('Report ready.');
  await send(app,task);
  const raw=await messages(app,task),cards=raw.filter(m=>m.kind==='completion_report');
  const worker=cards.filter(m=>m.conversation.startsWith('worker:')),master=cards.filter(m=>m.conversation==='master');
  expect(worker).toHaveLength(2);expect(worker.every(m=>m.visible===false)).toBe(true);
  expect(JSON.parse(worker[0].content).checks.failed).toBe(1);expect(JSON.parse(worker[1].content).checks.passed).toBe(1);
  expect(master).toHaveLength(1);expect(JSON.parse(master[0].content).goal_status).toBe('unknown');
  expect(JSON.stringify(getMockRequests().at(-1).body)).toContain('Runtime completion evidence; worker scope only');
  const usage=await app.page.evaluate(id=>window.__ZEUS_BRIDGE__.getTaskSpend(id),task.id);
  expect(usage.usage.requests_by_role).toEqual({master:2,worker:3});
});

test('actual browser expectation evidence supports the condition without verifying the whole goal',async()=>{
  const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<button onclick="document.querySelector(\'p\').textContent=\'Saved\'">Save</button><p>Not saved</p>');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const {app,task}=await launch({}, {managedBrowser:true});const id=crypto.randomUUID();
    action({type:'browser_action',op:'navigate',params:{url:'http://127.0.0.1:'+server.address().port}});
    action({type:'browser_action',action_id:id,op:'click',params:{target:{css:'button'},expect:{target:{css:'p'},condition:{kind:'text',value:'Saved',match:'equals'}}}});
    finish('Saved in the controlled fixture.',claimed([{kind:'browser_condition',action_id:id}]));
    await send(app,task,'Open the controlled fixture and save it.');
    const report=JSON.parse((await reports(app,task))[0].content);expect(report.checks.passed).toBe(1);expect(report.goal_status).toBe('unknown');
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
