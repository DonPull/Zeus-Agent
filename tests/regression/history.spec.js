import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {historyFixture,memoryPrompt,imagePrompt,gradeMemory,gradeImage,verifyPreserved} from '../benchmarks/history_missions.js';
import {startMockServer,stopMockServer,launchTauri,stopTauri,queueMockResponse,getMockRequests} from '../e2e/testUtils.js';

const limits={max_requests:20,max_tokens:1000000,max_in_flight:1,max_output_tokens:4096,max_directives:18,wall_time_ms:120000};
const directive=value=>'```zeus-directive\n'+JSON.stringify(value)+'\n```';
const response=content=>({choices:[{delta:{content}}],usage:{prompt_tokens:5,completion_tokens:5,total_tokens:10}});
const action=value=>queueMockResponse(response(directive(value)));
const finish=text=>action({type:'final_answer',final_answer:{summary:text}});
const send=(app,task,prompt,attachments=[])=>app.page.evaluate(({id,prompt,attachments})=>window.__ZEUS_BRIDGE__.sendUserMessage(id,prompt,crypto.randomUUID(),attachments),{id:task.id,prompt,attachments});
const messages=(app,task)=>app.page.evaluate(id=>window.__ZEUS_BRIDGE__.getTaskDebugMessages(id),task.id);
async function launch(){
  await startMockServer();const app=await launchTauri(false,{evaluationLimits:limits});
  await expect(app.page.locator('#app-container')).toBeVisible();
  const task=await app.page.evaluate(()=>window.__ZEUS_BRIDGE__.createTask('History recovery control'));
  await app.page.evaluate(id=>window.__ZEUS_BRIDGE__.updateTaskSettings(id,{master_model:'gpt-5-nano',worker_model:'None',verifier_model:'None',watcher_model:'None',vision_model:'None',budget_credits:1000000}),task.id);
  return {app,task};
}
async function compactTwiceAndRestart(app,task){
  finish('Controlled warm-up.');await send(app,task,'Keep working on the correspondence; no new personal facts.');
  historyFixture(app,task,'append');
  await stopTauri();
  const restarted=await launchTauri(false,{evaluationLimits:limits,reuseWorkspace:app.workspace});
  await expect(restarted.page.locator('#app-container')).toBeVisible();
  return restarted;
}
test.afterEach(async()=>{await stopTauri();await stopMockServer();});

test('H01 original personal fact absent from working context is recovered after compaction and restart',async({},info)=>{
  let {app,task}=await launch();
  const seeded=historyFixture(app,task,'seed');
  app=await compactTwiceAndRestart(app,task);
  action({type:'find_history',query:'childhood',role:'user',kind:'chat'});
  action({type:'read_history',message_id:seeded.correction,neighbors:1});
  finish('Happy birthday, Niko! I still smile when I remember the kites we built together.');
  const start=getMockRequests().length;await send(app,task,memoryPrompt);
  const first=JSON.stringify(getMockRequests()[start].body);
  expect(first).not.toContain('Niko');expect(first).not.toContain('Mira');expect(first).not.toContain('kites');
  expect(first).toContain('find_history');expect(first).not.toContain('UNTRUSTED WEB PAGE');
  const raw=await messages(app,task);const answer=raw.filter(m=>m.role==='assistant'&&m.kind==='chat').at(-1).content;
  expect(gradeMemory(answer).passed).toBe(true);
  expect(getMockRequests().slice(start).some(r=>JSON.stringify(r.body).includes('source-linked-model-note'))).toBe(true);
  const after=historyFixture(app,task,'inspect');
  expect(after.compactions.length).toBeGreaterThanOrEqual(2);expect(verifyPreserved(seeded,after)).toBe(true);
  fs.writeFileSync(info.outputPath('H01-retention.json'),JSON.stringify({kind:'scripted_runtime_control',seeded,after,grade:gradeMemory(answer)},null,2));
});

test('H02 same-name old image is found and its exact pixels inspected after compaction and restart',async({},info)=>{
  let {app,task}=await launch();
  const bytes=['7f91c2a0.png','a42d6e83.png'].map(name=>fs.readFileSync(path.resolve('tests/benchmarks/missions/v1/V01/inputs',name)));
  const files=[];
  for(const image of bytes)files.push(await app.page.evaluate(({id,data})=>window.__ZEUS_BRIDGE__.saveTaskAttachment(id,'sketch.png',data),{id:task.id,data:image.toString('base64')}));
  const seeded=historyFixture(app,task,'seed',{attachments:files.map(f=>f.id)});
  app=await compactTwiceAndRestart(app,task);
  action({type:'find_history',attachment:'sketch.png',oldest_first:true,role:'user'});
  action({type:'read_history',message_id:seeded.image_messages[0]});
  action({type:'analyze_visual',image_path:'attachment:'+files[0].id,query:'Inspect original order ID, currency and total.'});
  queueMockResponse(response('Order ZA-7419, currency EUR, total 118.00.'));
  finish('The first sketch shows order ZA-7419, EUR, total 118.00.');
  const start=getMockRequests().length;await send(app,task,imagePrompt);
  const inspection=getMockRequests().slice(start).flatMap(r=>r.body.input??r.body.messages??[])
    .flatMap(m=>Array.isArray(m.content)?m.content:[]).filter(part=>part.type==='input_image'||part.type==='image_url');
  expect(inspection.map(x=>x.image_url?.url??x.image_url)).toEqual(['data:image/png;base64,'+bytes[0].toString('base64')]);
  const truth=JSON.parse(fs.readFileSync('tests/benchmarks/missions/v1/V01/reference/comparison.json'));
  const answer=(await messages(app,task)).filter(m=>m.role==='assistant'&&m.kind==='chat').at(-1).content;
  expect(gradeImage(answer,truth).passed).toBe(true);
  const after=historyFixture(app,task,'inspect');expect(after.compactions.length).toBeGreaterThanOrEqual(2);
  expect(verifyPreserved(seeded,after)).toBe(true);
  for(let i=0;i<2;i++)expect(fs.readFileSync(path.join(app.workspace,'tasks',task.id,'workspace',files[i].storage_key))).toEqual(bytes[i]);
  fs.writeFileSync(info.outputPath('H02-retention.json'),JSON.stringify({kind:'scripted_runtime_control',after,grade:gradeImage(answer,truth)},null,2));
});

test('validated document text is searchable and unavailable bytes cannot be resurrected from extraction',async()=>{
  const {app,task}=await launch();
  const file=await app.page.evaluate(({id,data})=>window.__ZEUS_BRIDGE__.saveTaskAttachment(id,'brief.md',data),{id:task.id,data:Buffer.from('# Source\nThe delivery code is marigold.').toString('base64')});
  finish('Document accepted.');await send(app,task,'Keep the attached brief.',[file.id]);
  const source=(await messages(app,task)).find(m=>m.role==='user'&&m.kind==='chat');
  action({type:'find_history',query:'marigold',attachment:'brief.md'});
  action({type:'read_history',message_id:source.id,attachment_id:file.id});
  finish('The source says marigold.');await send(app,task,'Find the delivery code in the earlier document.');
  expect(JSON.stringify(getMockRequests().at(-1).body)).toContain('delivery code is marigold');
  const target=path.join(app.workspace,'tasks',task.id,'workspace',file.storage_key);
  fs.writeFileSync(target,'changed bytes');
  action({type:'find_history',query:'marigold',attachment:'brief.md'});
  action({type:'read_history',message_id:source.id,attachment_id:file.id});
  finish('The original document is unavailable.');const start=getMockRequests().length;
  await send(app,task,'Read the original document again.');
  const results=(await messages(app,task)).filter(m=>m.kind==='directive_result').slice(-2).map(m=>m.content).join('\n');
  expect(results).toContain('unavailable or changed');expect(results).toContain('ATTACHMENT_');
  expect(results).not.toContain('delivery code is marigold');
  expect(getMockRequests().length-start).toBe(3);
});

test('task workers use shared history tools under ordinary execution and accounting',async()=>{
  const {app,task}=await launch();const seeded=historyFixture(app,task,'seed');
  await app.page.evaluate(id=>window.__ZEUS_BRIDGE__.updateTaskSettings(id,{master_model:'gpt-5-nano',worker_model:'gpt-5-nano',verifier_model:'None',watcher_model:'None',vision_model:'None',budget_credits:1000000}),task.id);
  action({type:'delegate_task',delegate:{name:'Correspondence helper',objective:'Recover the corrected personal facts and compose the greeting.',success_criteria:'Use the real corrected name and shared activity.'}});
  action({type:'find_history',query:'childhood',role:'user',kind:'chat'});
  action({type:'read_history',message_id:seeded.correction});
  finish('Happy birthday, Niko! Remember our kites?');finish('Happy birthday, Niko! Remember our kites?');
  await send(app,task,memoryPrompt);
  const raw=await messages(app,task);
  expect(raw.some(m=>m.conversation.startsWith('worker:')&&m.kind==='directive_result'&&m.content.includes(seeded.correction))).toBe(true);
  const spend=await app.page.evaluate(id=>window.__ZEUS_BRIDGE__.getTaskSpend(id),task.id);
  expect(spend.usage.requests_by_role.worker).toBe(3);expect(spend.usage.requests_by_role.master).toBe(2);
});
