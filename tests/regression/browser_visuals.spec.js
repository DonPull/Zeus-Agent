import {test,expect} from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import {startMockServer,stopMockServer,launchTauri,stopTauri,queueMockResponse,getMockRequests} from '../e2e/testUtils.js';
const reply=value=>({choices:[{delta:{content:typeof value==='string'?value:'```zeus-directive\n'+JSON.stringify(value)+'\n```'}}],usage:{prompt_tokens:5,completion_tokens:5,total_tokens:10}});
const final={type:'final_answer',final_answer:{summary:'Controlled browser visual response.'}};
const binding=(model,protocol='chat',connection='abacus')=>({connection,model_id:model,protocol,image_input:'supported',source:'explicit'});
let server,url;
test.beforeAll(async()=>{server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end('<body style="background:#5981c4"><h1>Distinct browser pixels</h1><p>Capture delivered to the requesting role.</p></body>');});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));url=`http://127.0.0.1:${server.address().port}/`;});
test.afterAll(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
test.afterEach(async()=>{await stopTauri();await stopMockServer();});
async function fixture(settings={},transport={}){
    await startMockServer(transport);const app=await launchTauri(false,{managedBrowser:true,buildProfile:process.env.ZEUS_TEST_RELEASE==='1'?'release':'debug'});await expect(app.page.locator('#app-container')).toBeVisible();
    const task=await app.page.evaluate(async settings=>{const defaults=await window.__ZEUS_BRIDGE__.getSettings();await window.__ZEUS_BRIDGE__.saveSettings({...defaults,watcher_model:'phase1-mock',model_bindings:{}});const task=await window.__ZEUS_BRIDGE__.createTask('Browser pixels');await window.__ZEUS_BRIDGE__.updateTaskSettings(task.id,{master_model:'pixel-actor',worker_model:'None',verifier_model:'None',watcher_model:'None',vision_model:'None',budget_credits:1000000,...settings});return task;},settings);
    return {...app,task,send:()=>app.page.evaluate(id=>window.__ZEUS_BRIDGE__.sendUserMessage(id,'Inspect this controlled browser image.',crypto.randomUUID()),task.id)};
}
function images(request){return [...(request.body.input||request.body.messages||[])].flatMap(message=>Array.isArray(message.content)?message.content:[]).filter(part=>['input_image','image_url'].includes(part.type)).map(part=>typeof part.image_url==='string'?part.image_url:part.image_url.url);}
async function artifact(app){
    const session=(await app.page.evaluate(id=>window.__ZEUS_BRIDGE__.getManagedBrowserSessions(id),app.task.id))[0];
    const actions=await app.page.evaluate(({task,session})=>window.__ZEUS_BRIDGE__.getManagedBrowserActions(task,session),{task:app.task.id,session:session.session_id});
    return JSON.parse(actions.find(action=>action.op==='observe'&&JSON.parse(action.response)?.result?.artifact).response).result.artifact;
}
for(const protocol of ['chat','responses'])test(`explicit master browser pixels reach the configured ${protocol} route once`,async()=>{
    const app=await fixture({model_bindings:{master:binding('pixel-actor',protocol,protocol==='chat'?'local':'abacus')}});
    queueMockResponse(reply({type:'browser_action',op:'navigate',params:{url}}));queueMockResponse(reply({type:'browser_action',op:'observe',params:{screenshot:true}}));queueMockResponse(reply(final));await app.send();
    const saved=await artifact(app),requests=getMockRequests();expect(requests).toHaveLength(3);expect(images(requests[0])).toEqual([]);expect(images(requests[1])).toEqual([]);
    expect(images(requests[2])).toEqual(['data:image/jpeg;base64,'+fs.readFileSync(saved.path).toString('base64')]);
    queueMockResponse(reply(final));await app.send();expect(images(getMockRequests()[3])).toEqual([]);
});
test('an explicit worker screenshot uses its configured helper and never the master as a substitute',async()=>{
    const app=await fixture({master_model:'master-text',worker_model:'worker-text',vision_model:'fixture-vision',model_bindings:{vision:binding('fixture-vision')}},{tls:true,freshConnections:true});
    queueMockResponse(reply({type:'delegate_task',delegate:{name:'Page inspector',objective:'Inspect the controlled page.',success_criteria:'Real screenshot observations returned.'}}));
    queueMockResponse(reply({type:'browser_action',op:'navigate',params:{url}}));queueMockResponse(reply({type:'browser_action',op:'observe',params:{screenshot:true}}));
    queueMockResponse(reply('Observed the distinct blue page and its heading.'));queueMockResponse(reply(final));queueMockResponse(reply(final));await app.send();
    const saved=await artifact(app),requests=getMockRequests();expect(requests.map(request=>request.body.model)).toEqual(['master-text','worker-text','worker-text','fixture-vision','worker-text','master-text']);
    expect(images(requests[3])).toEqual(['data:image/jpeg;base64,'+fs.readFileSync(saved.path).toString('base64')]);
    expect(images(requests[4])).toEqual([]);expect(images(requests[5])).toEqual([]);
    expect(JSON.stringify(requests[4].body)).toContain('Observed the distinct blue page');
    const usage=await app.page.evaluate(id=>window.__ZEUS_BRIDGE__.getTaskSpend(id),app.task.id);expect(usage.usage.requests_by_role).toEqual({master:2,worker:3,vision:1});
});

test('a supported worker receives its own direct pixels while a text-only master receives no images',async()=>{
    const app=await fixture({master_model:'master-text',worker_model:'worker-pixels',model_bindings:{worker:binding('worker-pixels','responses')}});
    queueMockResponse(reply({type:'delegate_task',delegate:{name:'Page inspector',objective:'Inspect the controlled page.',success_criteria:'Real screenshot observed.'}}));
    queueMockResponse(reply({type:'browser_action',op:'navigate',params:{url}}));queueMockResponse(reply({type:'browser_action',op:'observe',params:{screenshot:true}}));queueMockResponse(reply(final));queueMockResponse(reply(final));await app.send();
    const saved=await artifact(app),requests=getMockRequests();expect(requests.map(request=>request.body.model)).toEqual(['master-text','worker-pixels','worker-pixels','worker-pixels','master-text']);
    expect(images(requests[3])).toEqual(['data:image/jpeg;base64,'+fs.readFileSync(saved.path).toString('base64')]);expect(images(requests[4])).toEqual([]);
});

test('explicit Helper mode sends a master browser image to the selected helper even when the actor supports images',async()=>{
    const app=await fixture({vision_model:'selected-helper',image_delivery:'helper',model_bindings:{master:binding('pixel-actor','responses'),vision:binding('selected-helper')}});
    queueMockResponse(reply({type:'browser_action',op:'navigate',params:{url}}));queueMockResponse(reply({type:'browser_action',op:'observe',params:{screenshot:true}}));queueMockResponse(reply('Helper inspected the browser page.'));queueMockResponse(reply(final));await app.send();
    const saved=await artifact(app),requests=getMockRequests();expect(requests.map(request=>request.body.model)).toEqual(['pixel-actor','pixel-actor','selected-helper','pixel-actor']);
    expect(images(requests[2])).toEqual(['data:image/jpeg;base64,'+fs.readFileSync(saved.path).toString('base64')]);expect(images(requests[3])).toEqual([]);
});
