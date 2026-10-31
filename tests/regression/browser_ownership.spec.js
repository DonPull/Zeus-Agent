import {test,expect} from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {startMockServer,stopMockServer,launchTauri,stopTauri,queueMockResponse} from '../e2e/testUtils.js';

const response=value=>({choices:[{delta:{content:'```zeus-directive\n'+JSON.stringify(value)+'\n```'}}],usage:{prompt_tokens:5,completion_tokens:5,total_tokens:10}});
const action=(op,params={},action_id)=>({type:'browser_action',op,params,...(action_id?{action_id}:{})});
const script=code=>({type:'run_action',action:{code,timeout_secs:30}});
const finish={type:'final_answer',final_answer:{summary:'Browser test complete.'}};
let server,url,updates,slowRequests;
test.beforeAll(async()=>{
    updates=0;slowRequests=0;
    server=http.createServer((request,result)=>{
        if(request.url==='/slow'){slowRequests++;return;}
        if(request.method==='POST'){updates++;result.writeHead(204);result.end();return;}
        result.writeHead(200,{'Content-Type':'text/html'});
        result.end(`<!doctype html><label>Task note<input id="note"></label><button id="save" onclick="localStorage.note=note.value;document.cookie='continuity=present';statusText.textContent=note.value;fetch('/append',{method:'POST'})">Save note</button><p id="statusText"></p><script>statusText.textContent=localStorage.note||''</script>`);
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));url=`http://127.0.0.1:${server.address().port}/`;
});
test.afterAll(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
let activeApp;
test.afterEach(async({},testInfo)=>{
    if(activeApp){
        try{
            const sessions=await activeApp.sessions();
            const actions=[];for(const session of sessions)actions.push(...await activeApp.page.evaluate(({task,session})=>window.__ZEUS_BRIDGE__.getManagedBrowserActions(task,session),{task:activeApp.task.id,session:session.session_id}));
            await testInfo.attach('browser-journal',{body:JSON.stringify({sessions,actions,process:activeApp.processEvidence()},null,2),contentType:'application/json'});
        }finally{activeApp=null;}
    }
    await stopTauri();await stopMockServer();
});
async function fixture(overrides={}){
    const {mockTransport,...appOptions}=overrides;
    await startMockServer(mockTransport);const app=await launchTauri(false,{managedBrowser:true,buildProfile:process.env.ZEUS_TEST_RELEASE==='1'?'release':'debug',...appOptions});
    await expect(app.page.locator('#app-container')).toBeVisible();
    await app.page.evaluate(async()=>{const settings=await window.__ZEUS_BRIDGE__.getSettings();await window.__ZEUS_BRIDGE__.saveSettings({...settings,watcher_model:'phase1-mock',model_bindings:{}});});
    const task=await app.page.evaluate(async()=>{
        const task=await window.__ZEUS_BRIDGE__.createTask('Owned browser regression');
        await window.__ZEUS_BRIDGE__.updateTaskSettings(task.id,{master_model:'phase1-mock',worker_model:'None',verifier_model:'None',watcher_model:'None',vision_model:'None',budget_credits:1000000,model_bindings:{}});return task;
    });
    activeApp={...app,task,send:()=>app.page.evaluate(id=>window.__ZEUS_BRIDGE__.sendUserMessage(id,'Perform the synthetic browser test.',crypto.randomUUID()),task.id),
        sessions:()=>app.page.evaluate(id=>window.__ZEUS_BRIDGE__.getManagedBrowserSessions(id),task.id)};
    return activeApp;
}
async function enableTeam(app){await app.page.evaluate(async id=>{
    const task=(await window.__ZEUS_BRIDGE__.listTasks()).find(task=>task.id===id);
    await window.__ZEUS_BRIDGE__.updateTaskSettings(id,{...task,worker_model:'phase1-mock',verifier_model:'phase1-mock',model_bindings:{}});
},app.task.id);}

test('one root-owned browser survives separate Python clients, records effects, and closes once',async({},testInfo)=>{
    const app=await fixture();const before=updates;
    queueMockResponse(response(action('navigate',{url})));
    queueMockResponse(response(script("from zeus_browser import call\ncall('fill', target={'css':'#note'}, value='retained across scripts')\ncall('click', target={'role':'button','name':'Save note'})")));
    queueMockResponse(response(script("from zeus_browser import call\nseen=call('observe')\nassert 'retained across scripts' in seen['text'], seen\nassert len(call('tabs')['tabs'])==1\nprint('Actual DOM state survived a different script process')")));
    queueMockResponse(response(action('observe',{screenshot:true})));
    queueMockResponse(response(finish));
    await app.send();
    const sessions=await app.sessions();expect(sessions).toHaveLength(1);expect(sessions[0].status).toBe('completed');expect(sessions[0].generation).toBe(1);
    expect(sessions[0].version).toBeGreaterThan(2);
    expect(sessions[0].runtime.sdk).toBe('1.62.0');expect(updates).toBe(before+1);
    expect(sessions[0].runtime.cleanup.owned_processes_remaining).toBe(0);expect(sessions[0].runtime.cleanup.stderr).toBe('');
    const actions=await app.page.evaluate(({task,session})=>window.__ZEUS_BRIDGE__.getManagedBrowserActions(task,session),{task:app.task.id,session:sessions[0].session_id});
    expect(actions).toHaveLength(6);expect(actions.every(value=>value.status==='succeeded')).toBe(true);
    expect(actions.some(value=>value.caller.startsWith('master/script:'))).toBe(true);
    const observation=JSON.parse(actions.at(-1).response);expect(observation.result.artifact.mime).toBe('image/jpeg');
    await app.page.evaluate(async id=>{await window.__ZEUS_REFRESH_TASKS__?.();},app.task.id);
    await app.page.locator('.sidebar-task').filter({has:app.page.locator('.sidebar-task-title[title="Owned browser regression"]')}).click();
    await expect(app.page.getByRole('status',{name:'Managed browser session'})).toHaveCount(1);
    await expect(app.page.getByRole('status',{name:'Managed browser session'})).toContainText('Finished');
    await app.page.setViewportSize({width:1000,height:760});await app.page.screenshot({path:testInfo.outputPath('owned-browser-card.png')});
    await app.page.reload();
    await app.page.locator('.sidebar-task').filter({has:app.page.locator('.sidebar-task-title[title="Owned browser regression"]')}).click();
    await expect(app.page.getByRole('status',{name:'Managed browser session'})).toHaveCount(1);
    const history=await app.page.evaluate(id=>window.__ZEUS_BRIDGE__.getTaskMessages(id,true),app.task.id);
    expect(history.filter(message=>message.kind==='managed_browser_session')).toHaveLength(1);
    expect(history.find(message=>message.kind==='managed_browser_session').projection_version).toBe(sessions[0].version);
});

test('deleting an active task joins browser cleanup and removes its durable ownership rows',async()=>{
    const app=await fixture();queueMockResponse(response(action('navigate',{url})));queueMockResponse(response(action('navigate',{url:url+'slow',timeout_ms:60000})));
    const pending=app.send().then(()=>null,error=>String(error));
    await expect.poll(async()=>{const sessions=await app.sessions();return sessions[0]?.status;}).toBe('active');
    await app.page.evaluate(id=>window.__ZEUS_BRIDGE__.deleteTask(id),app.task.id);await pending;
    expect(await app.sessions()).toEqual([]);
    expect((await app.page.evaluate(()=>window.__ZEUS_BRIDGE__.listTasks())).some(task=>task.id===app.task.id)).toBe(false);
});

test('app restart retains uncertain actions and hydrates interrupted browser status',async()=>{
    const app=await fixture();queueMockResponse(response(action('navigate',{url})));queueMockResponse(response(action('navigate',{url:url+'slow',timeout_ms:60000})));
    const pending=app.send().catch(()=>null);
    await expect.poll(async()=>{const sessions=await app.sessions();if(!sessions.length)return '';const actions=await app.page.evaluate(({task,session})=>window.__ZEUS_BRIDGE__.getManagedBrowserActions(task,session),{task:app.task.id,session:sessions[0].session_id});return actions.length>1?actions.at(-1).status:'';}).toBe('dispatched');
    const original=(await app.sessions())[0];await stopTauri();await pending;
    const restarted=await launchTauri(false,{managedBrowser:true,reuseWorkspace:app.workspace});
    await expect(restarted.page.locator('#app-container')).toBeVisible();
    activeApp={...restarted,task:app.task,sessions:()=>restarted.page.evaluate(id=>window.__ZEUS_BRIDGE__.getManagedBrowserSessions(id),app.task.id)};
    const session=(await activeApp.sessions())[0];expect(session.session_id).toBe(original.session_id);expect(session.status).toBe('interrupted');
    const actions=await restarted.page.evaluate(({task,session})=>window.__ZEUS_BRIDGE__.getManagedBrowserActions(task,session),{task:app.task.id,session:session.session_id});expect(actions.at(-1).status).toBe('uncertain');
    const messages=await restarted.page.evaluate(id=>window.__ZEUS_BRIDGE__.getTaskMessages(id),app.task.id);
    expect(JSON.parse(messages.find(message=>message.kind==='managed_browser_session').content).status).toBe('interrupted');
    await restarted.page.locator('.sidebar-task').filter({has:restarted.page.locator('.sidebar-task-title[title="Owned browser regression"]')}).click();
    const card=restarted.page.getByRole('status',{name:'Managed browser session'});
    await expect(card).toContainText('Browser session');await expect(card.locator('.browser-card-status')).toHaveText('Interrupted');
});

test('data-only scripts never acquire a browser',async()=>{
    const app=await fixture();queueMockResponse(response(script("import json\nwith open('result.json','w') as f: json.dump({'ok':True},f)")));queueMockResponse(response(finish));
    await app.send();expect(await app.sessions()).toEqual([]);
});

test('worker scripts retain the coordinator browser and release control without closing it',async()=>{
    const app=await fixture();await enableTeam(app);
    queueMockResponse(response(action('navigate',{url})));
    queueMockResponse(response(action('fill',{target:{css:'#note'},value:'coordinator state'})));
    queueMockResponse(response(action('click',{target:{css:'#save'}})));
    queueMockResponse(response({type:'delegate_task',delegate:{name:'Browser continuation',objective:'Inspect the same browser and preserve its state.',success_criteria:'Original note remains visible.'}}));
    queueMockResponse(response(script("from zeus_browser import call\nassert 'coordinator state' in call('observe')['text']\nassert len(call('tabs')['tabs'])==1")));
    queueMockResponse(response({type:'final_answer',final_answer:{summary:'The original browser state was independently inspected.'}}));
    queueMockResponse({choices:[{message:{content:JSON.stringify({passed:true,feedback:'The worker inspected the retained note.',blockers:[],evidence:['actual DOM observation']})}}],usage:{prompt_tokens:5,completion_tokens:5,total_tokens:10}});
    queueMockResponse(response(action('observe')));queueMockResponse(response(finish));
    await app.send();const sessions=await app.sessions();expect(sessions).toHaveLength(1);expect(sessions[0].status).toBe('completed');
    const rows=await app.page.evaluate(({task,session})=>window.__ZEUS_BRIDGE__.getManagedBrowserActions(task,session),{task:app.task.id,session:sessions[0].session_id});
    expect(rows.some(row=>row.caller.startsWith('worker:'))).toBe(true);expect(rows.every(row=>row.status==='succeeded')).toBe(true);
});

test('data-only worker scripts also start zero browsers',async()=>{
    const app=await fixture();await enableTeam(app);
    queueMockResponse(response({type:'delegate_task',delegate:{name:'Local data',objective:'Write a synthetic JSON file.',success_criteria:'data.json exists.'}}));
    queueMockResponse(response(script("with open('data.json','w') as f: f.write('{}')")));
    queueMockResponse(response({type:'final_answer',final_answer:{summary:'data.json was saved.'}}));
    queueMockResponse({choices:[{message:{content:JSON.stringify({passed:true,feedback:'File exists.',blockers:[]})}}],usage:{prompt_tokens:5,completion_tokens:5,total_tokens:10}});
    queueMockResponse(response(finish));await app.send();expect(await app.sessions()).toEqual([]);
});

test('missing managed runtime is a typed startup failure without a browser fallback',async()=>{
    const app=await fixture({browserPython:path.resolve('.zeus/missing-browser-runtime/python.exe'),allowMissingBrowserRuntime:true});
    queueMockResponse(response(action('navigate',{url})));queueMockResponse(response(finish));await app.send();
    const sessions=await app.sessions();expect(sessions).toHaveLength(1);expect(sessions[0].status).toBe('failed');expect(sessions[0].runtime).toBeNull();
    expect(sessions[0].terminal_reason).toContain('BROWSER_RUNTIME_MISSING');
});

test('duplicate IDs never repeat a mutation and failed locators stay failed',async()=>{
    const app=await fixture(),id=crypto.randomUUID(),before=updates;
    queueMockResponse(response(action('navigate',{url})));
    queueMockResponse(response(action('click',{target:{css:'#save'}},id)));
    queueMockResponse(response(action('click',{target:{css:'#save'}},id)));
    queueMockResponse(response(action('fill',{target:{css:'#note'},value:'changed arguments'},id)));
    queueMockResponse(response(action('click',{target:{css:'#missing'},timeout_ms:200})));
    queueMockResponse(response(finish));await app.send();expect(updates).toBe(before+1);
    const session=(await app.sessions())[0];const rows=await app.page.evaluate(({task,session})=>window.__ZEUS_BRIDGE__.getManagedBrowserActions(task,session),{task:app.task.id,session:session.session_id});
    expect(rows).toHaveLength(3);expect(rows.map(row=>row.status)).toEqual(['succeeded','succeeded','failed']);
    const foreign=await app.page.evaluate(()=>window.__ZEUS_BRIDGE__.createTask('Unrelated task'));
    await expect(app.page.evaluate(({task,session})=>window.__ZEUS_BRIDGE__.getManagedBrowserActions(task,session),{task:foreign.id,session:session.session_id})).rejects.toThrow('BROWSER_OWNERSHIP');
});

test('Stop during navigation reaps the owner and retains uncertainty without replay',async()=>{
    const app=await fixture(),beforeSlow=slowRequests;queueMockResponse(response(action('navigate',{url})));queueMockResponse(response(action('navigate',{url:url+'slow',timeout_ms:60000})));
    const pending=app.send().then(()=>null,error=>String(error));
    await expect.poll(()=>slowRequests).toBe(beforeSlow+1);
    await app.page.evaluate(id=>window.__ZEUS_BRIDGE__.cancelTaskRun(id),app.task.id);expect(await pending).toContain('RUN_CANCELLED');
    const session=(await app.sessions())[0];expect(session.status).toBe('cancelled');expect(session.runtime.cleanup.owned_processes_remaining).toBe(0);
    const rows=await app.page.evaluate(({task,session})=>window.__ZEUS_BRIDGE__.getManagedBrowserActions(task,session),{task:app.task.id,session:session.session_id});
    expect(rows.at(-1).status).toBe('uncertain');
});

test('script IPC rejects wrong tokens and fabricated browser-session events',async()=>{
    const app=await fixture();
    queueMockResponse(response(script("import socket,os,json\ns=socket.create_connection(('127.0.0.1',int(os.environ['ZEUS_IPC_PORT'])))\ns.sendall((json.dumps({'type':'managed_browser','ipc_token':'wrong','command':{'op':'tabs','params':{}}})+'\\n').encode())\nassert json.loads(s.makefile().readline())['error']['code']=='BROWSER_AUTH'\ns.close()\nassert _zeus_ipc_send({'type':'browser_session_started','session_id':'forged'})['error']['code']=='BROWSER_UNTRUSTED_EVENT'")));
    queueMockResponse(response(finish));await app.send();expect(await app.sessions()).toEqual([]);
});

test('linked browser artifact roots fail before startup',async()=>{
    const app=await fixture();const workspace=path.join(app.workspace,'tasks',app.task.id,'workspace');
    const outside=path.join(app.workspace,'outside');fs.mkdirSync(outside);fs.mkdirSync(path.join(workspace,'.zeus'),{recursive:true});
    fs.symlinkSync(outside,path.join(workspace,'.zeus/managed-browser'),process.platform==='win32'?'junction':'dir');
    queueMockResponse(response(action('navigate',{url})));queueMockResponse(response(finish));await app.send();
    const session=(await app.sessions())[0];expect(session.status).toBe('failed');expect(session.runtime).toBeNull();expect(session.terminal_reason).toContain('BROWSER_RUNTIME_PATH');
    expect(fs.readdirSync(outside)).toEqual([]);
});

test('concurrent script clients acquire one service without inventing sessions',async()=>{
    const app=await fixture();
    queueMockResponse(response(script("import socket,os,json,uuid,concurrent.futures\ndef inspect():\n s=socket.create_connection(('127.0.0.1',int(os.environ['ZEUS_IPC_PORT'])))\n request={'type':'managed_browser','ipc_token':os.environ['ZEUS_IPC_TOKEN'],'command':{'op':'tabs','params':{},'action_id':str(uuid.uuid4())}}\n s.sendall((json.dumps(request)+'\\n').encode()); value=json.loads(s.makefile().readline());s.close();return value\nwith concurrent.futures.ThreadPoolExecutor(2) as pool:\n results=list(pool.map(lambda _:inspect(),range(2)))\nassert all(value['ok'] for value in results), results\nassert results[0]['session_id']==results[1]['session_id']\nassert results[0]['result']['tabs'][0]['tab_id']==results[1]['result']['tabs'][0]['tab_id']")));
    queueMockResponse(response(finish));await app.send();const sessions=await app.sessions();expect(sessions).toHaveLength(1);expect(sessions[0].runtime.cleanup.owned_processes_remaining).toBe(0);
});

test('a script timeout cannot leave a browser action running or replay its uncertain effect',async()=>{
    const app=await fixture();queueMockResponse(response(action('navigate',{url})));
    const timed=script("from zeus_browser import call\ncall('navigate',url="+JSON.stringify(url+'slow')+",timeout_ms=60000)");timed.action.timeout_secs=1;
    queueMockResponse(response(timed));queueMockResponse(response(finish));await app.send();
    const session=(await app.sessions())[0];expect(session.status).toBe('failed');expect(session.runtime.cleanup.owned_processes_remaining).toBe(0);
    const actions=await app.page.evaluate(({task,session})=>window.__ZEUS_BRIDGE__.getManagedBrowserActions(task,session),{task:app.task.id,session:session.session_id});
    expect(actions.at(-1).status).toBe('uncertain');
});

const policy=value=>({choices:[{message:{content:value}}],usage:{prompt_tokens:5,completion_tokens:5,total_tokens:10}});
async function pendingBrowserApproval(app){
    await app.page.evaluate(id=>window.__ZEUS_BRIDGE__.addWatcherPolicy(id,'Ask before modifying a form; allow navigation.'),app.task.id);
    queueMockResponse(response(action('navigate',{url})));queueMockResponse(policy('ALLOW'));
    queueMockResponse(response(action('fill',{target:{css:'#note'},value:'requires explicit approval'})));queueMockResponse(policy('ASK'));
    const pending=app.send().then(()=>null,error=>String(error));
    let card;
    await expect.poll(async()=>{const messages=await app.page.evaluate(id=>window.__ZEUS_BRIDGE__.getTaskMessages(id,true),app.task.id);card=messages.find(message=>message.kind==='approval'&&JSON.parse(message.content).status==='pending');return !!card;}).toBe(true);
    return {pending,card};
}

test('a denied normal approval preserves the session and prevents the browser effect',async()=>{
    const app=await fixture({mockTransport:{tls:true,freshConnections:true}});const {pending,card}=await pendingBrowserApproval(app);
    expect((await app.sessions())[0].status).toBe('active');
    queueMockResponse(response(finish));await app.page.evaluate(({task,card})=>window.__ZEUS_BRIDGE__.resolvePendingApprovals(task,false,card,'Deny this synthetic mutation'),{task:app.task.id,card:card.id});
    expect(await pending).toBeNull();const session=(await app.sessions())[0];expect(session.status).toBe('completed');
    const actions=await app.page.evaluate(({task,session})=>window.__ZEUS_BRIDGE__.getManagedBrowserActions(task,session),{task:app.task.id,session:session.session_id});
    expect(actions.at(-1).status).toBe('denied');
});

test('Stop expires a pending browser approval and a late approval cannot execute it',async()=>{
    const app=await fixture();const {pending,card}=await pendingBrowserApproval(app);
    await app.page.evaluate(id=>window.__ZEUS_BRIDGE__.cancelTaskRun(id),app.task.id);expect(await pending).toContain('RUN_CANCELLED');
    const session=(await app.sessions())[0];expect(session.status).toBe('cancelled');expect(session.runtime.cleanup.owned_processes_remaining).toBe(0);
    const messages=await app.page.evaluate(id=>window.__ZEUS_BRIDGE__.getTaskMessages(id,true),app.task.id);expect(JSON.parse(messages.find(message=>message.id===card.id).content).status).toBe('cancelled');
    await app.page.evaluate(({task,card})=>window.__ZEUS_BRIDGE__.resolvePendingApprovals(task,true,card),{task:app.task.id,card:card.id});
    const actions=await app.page.evaluate(({task,session})=>window.__ZEUS_BRIDGE__.getManagedBrowserActions(task,session),{task:app.task.id,session:session.session_id});
    expect(actions.at(-1).status).toBe('cancelled');
});
