import {test,expect} from '@playwright/test';
import path from 'node:path';
import {sendWithApprovals} from '../benchmarks/mission_runtime.js';
import {startMockServer,stopMockServer,launchTauri,stopTauri,queueMockResponse,getMockRequests} from '../e2e/testUtils.js';

const base={max_requests:8,max_tokens:1000000,max_in_flight:2,max_output_tokens:4096,max_directives:8,wall_time_ms:60000};
test.setTimeout(45000);
const directive=value=>'```zeus-directive\n'+JSON.stringify(value)+'\n```';
const reply=(content,extra={})=>({model:'phase1-mock',choices:[{delta:{content}}],usage:{prompt_tokens:5,completion_tokens:5,total_tokens:10},...extra});
async function launch(overrides={},taskSettings={}){
  await startMockServer();const app=await launchTauri(false,{evaluationLimits:{...base,...overrides}});
  await expect(app.page.locator('#app-container')).toBeVisible();
  const task=await app.page.evaluate(()=>window.__ZEUS_BRIDGE__.createTask('Limits fixture'));
  await app.page.evaluate(({id,settings})=>window.__ZEUS_BRIDGE__.updateTaskSettings(id,{master_model:'phase1-mock',worker_model:'None',verifier_model:'None',watcher_model:'None',vision_model:'None',budget_credits:1000000,...settings}),{id:task.id,settings:taskSettings});
  const send=async content=>{
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(new Error('Controlled send deadline')),15000);
    try{await sendWithApprovals(app.page,task.id,content,{signal:controller.signal,decide:async card=>{
      const action=card.body.blocked_directive;
      for(const [name,value] of [['first.txt','first'],['one.txt','one.txt'],['two.txt','two.txt']]){
        if(action?.type==='write_file'&&action.path===path.join(app.workspace,'tasks',task.id,'workspace',name)&&action.content===value)
          return {approved:true,source:'exact-scripted-control',note:'Exact controlled workspace write'};
      }
      return null;
    }});return null;}catch(error){return error.message;}finally{clearTimeout(timer);}
  };
  const spend=()=>app.page.evaluate(id=>window.__ZEUS_BRIDGE__.getTaskSpend(id),task.id);
  return {...app,task,send,spend};
}
test.afterEach(async()=>{await stopTauri();await stopMockServer();});

test('request ceiling prevents an extra master HTTP request',async()=>{
  const app=await launch({max_requests:1,max_in_flight:1});
  queueMockResponse(reply(directive({type:'write_file',path:path.join(app.workspace,'tasks',app.task.id,'workspace','first.txt'),content:'first'})));
  expect(await app.send('Create first.txt and report completion.')).toContain('EVAL_LIMIT: requests');
  expect(getMockRequests()).toHaveLength(1);expect((await app.spend()).evaluation.request_slots_used).toBe(1);
});
test('Responses requests receive max_output_tokens rather than the Chat cap field',async()=>{
  const app=await launch({}, {master_model:'gpt-5-nano'});queueMockResponse(reply('4'));
  expect(await app.send('What is 2+2? Answer only the numeral.')).toBeNull();
  const request=getMockRequests()[0];expect(request.url).toContain('/responses');expect(request.body.max_output_tokens).toBe(4096);expect(request.body.max_tokens).toBeUndefined();
});

test('Responses follow-up preserves assistant and user history in a provider-valid format',async()=>{
  const app=await launch({}, {master_model:'gpt-5-nano'});
  queueMockResponse(reply('4'));expect(await app.send('What is 2+2? Answer only the numeral.')).toBeNull();
  queueMockResponse(reply('4'));expect(await app.send('Repeat the answer, only the numeral.')).toBeNull();
  const requests=getMockRequests();expect(requests).toHaveLength(2);
  expect(requests.every(request=>request.url.endsWith('/responses'))).toBe(true);
  const history=requests[1].body.input;
  expect(history).toContainEqual({role:'assistant',content:'4'});
  expect(history).toContainEqual({role:'user',content:'Repeat the answer, only the numeral.'});
  expect((await app.spend()).usage.unknown_requests).toBe(0);
});
test('unknown usage stops later dispatch rather than treating it as free',async()=>{
  const app=await launch();queueMockResponse(reply('4',{usage:undefined}));
  expect(await app.send('What is 2+2? Answer only the numeral.')).toBeNull();
  expect(await app.send('Repeat the answer.')).toContain('EVAL_LIMIT: unknown_usage');
  expect(getMockRequests()).toHaveLength(1);expect((await app.spend()).evaluation.unknown_requests).toBe(1);
});

for(const model of ['phase1-mock','gpt-5-nano'])test(`${model}: HTTP error survives effort retry and protocol fallback guards`,async()=>{
  const app=await launch({}, {master_model:model,master_effort:'low'});
  queueMockResponse({_http_status:400,error:{message:'Invalid conversation item; credential test_key'}});
  const error=await app.send('Say hello.');
  expect(error).toContain('LLM Provider Error (400): Invalid conversation item; credential [redacted]');
  expect(error).not.toContain('EVAL_LIMIT');expect(error).not.toContain('test_key');
  expect(getMockRequests()).toHaveLength(1);
  const body=getMockRequests()[0].body;
  expect(model==='gpt-5-nano'?body.reasoning.effort:body.reasoning_effort).toBe('low');
  const spend=await app.spend();expect(spend.usage.unknown_requests).toBe(1);
  const debug=await app.page.evaluate(id=>window.__ZEUS_BRIDGE__.getDebugLog(id),app.task.id);
  expect(debug).toContain('[gateway_error]');expect(debug).toContain('Invalid conversation item');
  expect(debug).not.toContain('test_key');
});
test('incomplete Responses retain billed usage and do not trigger a fallback request',async()=>{
  const app=await launch({}, {master_model:'gpt-5-nano'});
  queueMockResponse(reply('partial',{_responses_event:'response.incomplete',usage:{input_tokens:5,output_tokens:10,total_tokens:15}}));
  expect(await app.send('Say hello.')).toContain('response.incomplete');
  expect(getMockRequests()).toHaveLength(1);
  const spend=await app.spend();expect(spend.usage.known_tokens).toBe(15);expect(spend.usage.unknown_requests).toBe(0);
  expect(spend.evaluation.known_tokens).toBe(15);
});
test('deadline drops an in-flight request and retains unknown usage',async()=>{
  const app=await launch({wall_time_ms:150});queueMockResponse(reply('late',{_delay_ms:3000}));
  expect(await app.send('Say hello.')).toContain('EVAL_LIMIT: deadline');
  expect((await app.spend()).usage.unknown_requests).toBe(1);
});
test('directive ceiling stops an extra tool effect after charging its model reply',async()=>{
  const app=await launch({max_directives:1});
  for(const name of ['one.txt','two.txt'])queueMockResponse(reply(directive({type:'write_file',path:path.join(app.workspace,'tasks',app.task.id,'workspace',name),content:name})));
  expect(await app.send('Create one.txt and two.txt.')).toContain('EVAL_LIMIT: directives');
  expect(getMockRequests()).toHaveLength(2);expect((await app.spend()).evaluation.directives).toBe(1);
  const messages=await app.page.evaluate(id=>window.__ZEUS_BRIDGE__.getTaskMessages(id,true),app.task.id);
  expect(messages.filter(message=>message.kind==='directive_result')).toHaveLength(1);
});
test('master, worker, and verifier share the same request ceiling',async()=>{
  const app=await launch({max_requests:3},{worker_model:'phase1-mock',verifier_model:'phase1-mock'});
  queueMockResponse(reply(directive({type:'delegate_task',delegate:{name:'helper',objective:'Return ready',success_criteria:'The answer is ready'}})));
  queueMockResponse(reply('ready'));
  queueMockResponse({model:'phase1-mock',usage:{prompt_tokens:5,completion_tokens:5,total_tokens:10},choices:[{message:{content:'{"passed":true,"feedback":"Matches."}'}}]});
  expect(await app.send('Ask a helper for ready and summarize.')).toContain('EVAL_LIMIT: requests');
  expect(getMockRequests()).toHaveLength(3);expect((await app.spend()).usage.requests_by_role).toEqual({master:1,worker:1,verifier:1});
  expect(getMockRequests().every(request=>request.body.max_tokens===4096)).toBe(true);
});
