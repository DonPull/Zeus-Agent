import {test,expect} from '@playwright/test';
import http from 'node:http';
import path from 'node:path';
import {startMockServer,stopMockServer,launchTauri,stopTauri,queueMockResponse,getMockRequests} from '../e2e/testUtils.js';

const reply=value=>({choices:[{delta:{content:'```zeus-directive\n'+JSON.stringify(value)+'\n```'}}],usage:{prompt_tokens:5,completion_tokens:5,total_tokens:10}});
let server,url;
test.beforeAll(async()=>{
    server=http.createServer((request,response)=>{response.writeHead(200,{'Content-Type':'text/html'});response.end('<body style="margin:0;background:rgb(30,80,180)"><h1>Capture acceptance</h1><script>setInterval(()=>{document.body.style.backgroundColor=Date.now()%1000<500?"rgb(30,80,180)":"rgb(180,80,30)"},100)</script></body>');});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));url=`http://127.0.0.1:${server.address().port}/`;
});

test('an ordinary fresh launch uses saved setup without runtime flags and freezes it for the root run',async()=>{
    await startMockServer();const app=await launchTauri(false,{managedBrowser:false});await expect(app.page.locator('#app-container')).toBeVisible();
    const python=path.resolve('.zeus/browser-runtime/venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
    const missing=path.resolve('.zeus/missing-runtime/python.exe');
    const task=await app.page.evaluate(async python=>{
        const settings=await window.__ZEUS_BRIDGE__.getSettings();await window.__ZEUS_BRIDGE__.saveSettings({...settings,browser_python_path:python,watcher_model:'phase1-mock',model_bindings:{}});
        const task=await window.__ZEUS_BRIDGE__.createTask('Normal browser setup');await window.__ZEUS_BRIDGE__.updateTaskSettings(task.id,{master_model:'phase1-mock',worker_model:'None',verifier_model:'None',watcher_model:'None',vision_model:'None',budget_credits:1000000,model_bindings:{}});return task;
    },python);
    const setup=await app.page.evaluate(()=>window.__ZEUS_BRIDGE__.getManagedBrowserStatus());expect(setup).toMatchObject({enabled:true,route:'managed-v1',executable_found:true,setup:{source:'persisted',python}});
    queueMockResponse({...reply({type:'browser_action',op:'navigate',params:{url}}),_delay_ms:1500});queueMockResponse(reply({type:'final_answer',final_answer:{summary:'The normal-launch browser check completed.'}}));
    const sending=app.page.evaluate(id=>window.__ZEUS_BRIDGE__.sendUserMessage(id,'Exercise the normal saved runtime.',crypto.randomUUID()),task.id);
    await expect.poll(async()=>{const run=await app.page.evaluate(id=>window.__ZEUS_BRIDGE__.getTaskRunState(id),task.id);return run?.status;}).toBe('running');
    await app.page.evaluate(async missing=>{const settings=await window.__ZEUS_BRIDGE__.getSettings();await window.__ZEUS_BRIDGE__.saveSettings({...settings,browser_python_path:missing});},missing);
    await sending;
    const sessions=await app.page.evaluate(id=>window.__ZEUS_BRIDGE__.getManagedBrowserSessions(id),task.id);expect(sessions).toHaveLength(1);expect(sessions[0].status).toBe('completed');expect(sessions[0].runtime.setup).toMatchObject({python,source:'persisted'});
    queueMockResponse(reply({type:'browser_action',op:'navigate',params:{url}}));queueMockResponse(reply({type:'final_answer',final_answer:{summary:'The configured runtime is missing; no browser fallback was used.'}}));
    await app.page.evaluate(id=>window.__ZEUS_BRIDGE__.sendUserMessage(id,'Try the explicitly missing setup.',crypto.randomUUID()),task.id);
    const after=await app.page.evaluate(id=>window.__ZEUS_BRIDGE__.getManagedBrowserSessions(id),task.id);expect(after).toHaveLength(2);expect(after[1].status).toBe('failed');expect(after[1].terminal_reason).toContain('BROWSER_RUNTIME_MISSING');
});
test.afterAll(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
test.afterEach(async()=>{await stopTauri();await stopMockServer();});

test('production collector and live viewer recover changing pixels across close and reload during a long action',async({},testInfo)=>{
    await startMockServer();const app=await launchTauri(false,{managedBrowser:true});
    await expect(app.page.locator('#app-container')).toBeVisible();
    const task=await app.page.evaluate(async()=>{
        const settings=await window.__ZEUS_BRIDGE__.getSettings();await window.__ZEUS_BRIDGE__.saveSettings({...settings,watcher_model:'phase1-mock',model_bindings:{}});
        const task=await window.__ZEUS_BRIDGE__.createTask('Independent capture');
        await window.__ZEUS_BRIDGE__.updateTaskSettings(task.id,{master_model:'phase1-mock',worker_model:'None',verifier_model:'None',watcher_model:'None',vision_model:'None',budget_credits:1000000,model_bindings:{}});return task;
    });
    queueMockResponse(reply({type:'browser_action',op:'navigate',params:{url}}));
    queueMockResponse(reply({type:'browser_action',op:'wait',params:{target:{css:'#absent'},timeout_ms:15000}}));
    queueMockResponse(reply({type:'final_answer',final_answer:{summary:'The deliberate wait failed; independent capture was tested.'}}));
    await app.page.evaluate(id=>{window.__CAPTURE_SEND__=window.__ZEUS_BRIDGE__.sendUserMessage(id,'Run the controlled capture check.',crypto.randomUUID());window.__CAPTURE_SEND__.catch(()=>{});},task.id);
    let session;
    await expect.poll(async()=>{
        const sessions=await app.page.evaluate(id=>window.__ZEUS_BRIDGE__.getManagedBrowserSessions(id),task.id);session=sessions[0];
        if(!session)return false;
        const actions=await app.page.evaluate(({task,session})=>window.__ZEUS_BRIDGE__.getManagedBrowserActions(task,session),{task:task.id,session:session.session_id});
        return actions.at(-1)?.op==='wait'&&actions.at(-1)?.status==='dispatched';
    }).toBe(true);
    const identity={task:task.id,session:session.session_id};
    const capture=()=>app.page.evaluate(({task,session})=>window.__ZEUS_BRIDGE__.getBrowserCapture(task,session),identity);
    await expect.poll(async()=>{const state=await capture();return state.capture.state==='live'&&state.capture.frame?.url===url;}).toBe(true);
    const first=await capture(),requestCount=getMockRequests().length;
    await app.page.evaluate(({task,session})=>window.__ZEUS_BRIDGE__.heartbeatBrowserViewer(task,session),identity);
    await expect.poll(async()=>{const state=await capture();return state.capture.frame?.sha256!==first.capture.frame.sha256&&state.capture.frame?.seq>first.capture.frame.seq;}).toBe(true);
    const pixels=await app.page.evaluate(async({task,session})=>{
        const state=await window.__ZEUS_BRIDGE__.getBrowserCapture(task,session);
        const bytes=await window.__ZEUS_BRIDGE__.readBrowserLiveImage(task,session,state.capture.frame.seq);
        const data=bytes instanceof ArrayBuffer?new Uint8Array(bytes):new Uint8Array(bytes);
        const image=await createImageBitmap(new Blob([data],{type:'image/jpeg'}));
        const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
        const context=canvas.getContext('2d');context.drawImage(image,0,0);image.close();
        return {pixel:Array.from(context.getImageData(1000,600,1,1).data),width:canvas.width,height:canvas.height};
    },identity);
    expect([pixels.width,pixels.height]).toEqual([1280,720]);
    expect(Math.abs(pixels.pixel[0]-pixels.pixel[2])).toBeGreaterThan(100);
    expect(pixels.pixel[1]).toBeGreaterThan(70);expect(pixels.pixel[1]).toBeLessThan(90);
    expect(getMockRequests()).toHaveLength(requestCount);
    const openViewer=async()=>{
        await app.page.evaluate(()=>window.__ZEUS_REFRESH_TASKS__?.());
        await app.page.locator('.sidebar-task').filter({has:app.page.locator('.sidebar-task-title[title="Independent capture"]')}).click();
        await app.page.getByRole('status',{name:'Managed browser session'}).getByRole('button',{name:'Watch',exact:true}).click();
        await expect.poll(()=>app.page.locator('#live-viewport-img').evaluate(img=>img.naturalWidth)).toBe(1280);
    };
    await app.page.setViewportSize({width:1320,height:840});await openViewer();
    const source=await app.page.locator('#live-viewport-img').getAttribute('src');
    await expect.poll(()=>app.page.locator('#live-viewport-img').getAttribute('src')).not.toBe(source);
    await app.page.screenshot({path:testInfo.outputPath('managed-live-view.png')});
    await app.page.locator('#live-modal-close-button').click();await app.page.reload();await expect(app.page.locator('#app-container')).toBeVisible();
    await openViewer();expect(getMockRequests()).toHaveLength(requestCount);await app.page.locator('#live-modal-close-button').click();
    const foreign=await app.page.evaluate(()=>window.__ZEUS_BRIDGE__.createTask('Foreign capture reader'));
    await expect(app.page.evaluate(({task,session})=>window.__ZEUS_BRIDGE__.getBrowserCapture(task,session),{task:foreign.id,session:session.session_id})).rejects.toThrow('BROWSER_OWNERSHIP');
    await expect.poll(async()=>{const run=await app.page.evaluate(id=>window.__ZEUS_BRIDGE__.getTaskRunState(id),task.id);return run?.status;}).toBe('completed');
    const ended=await capture();expect(ended.session.status).toBe('completed');expect(ended.session.runtime.cleanup.owned_processes_remaining).toBe(0);
    expect(await app.page.evaluate(id=>window.__ZEUS_BRIDGE__.getManagedBrowserSessions(id),task.id)).toHaveLength(1);
    await expect(app.page.evaluate(({task,session,seq})=>window.__ZEUS_BRIDGE__.readBrowserLiveImage(task,session,seq),{...identity,seq:ended.capture.frame.seq})).rejects.toThrow('BROWSER_FRAME_EXPIRED');
});
