import {test,expect} from '@playwright/test';
import http from 'node:http';
import {startMockServer,stopMockServer,launchTauri,stopTauri,queueMockResponse} from '../e2e/testUtils.js';
const reply=value=>({choices:[{delta:{content:'```zeus-directive\n'+JSON.stringify(value)+'\n```'}}],usage:{prompt_tokens:5,completion_tokens:5,total_tokens:10}});
test('readiness checks preserve delayed hydration and journal uncertain submissions without repeating effects',async()=>{
    let effects=0;const server=http.createServer((req,res)=>{
        if(req.url==='/effect'){effects++;res.writeHead(204);res.end();return;}
        res.writeHead(200,{'Content-Type':'text/html'});res.end(`<body><input id="note" data-ready="false"><button id="save">Save</button><button id="submit" onclick="fetch('/effect',{method:'POST'})">Submit</button><p id="status">Loading</p><script>setTimeout(()=>{const note=document.querySelector('#note');note.value='';note.dataset.ready='true';document.querySelector('#save').onclick=()=>{fetch('/effect',{method:'POST'});setTimeout(()=>document.querySelector('#status').textContent='Saved',350)}},600)</script></body>`);
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    try{
        await startMockServer();const app=await launchTauri(false,{managedBrowser:true});await expect(app.page.locator('#app-container')).toBeVisible();
        const task=await app.page.evaluate(async()=>{const s=await window.__ZEUS_BRIDGE__.getSettings();await window.__ZEUS_BRIDGE__.saveSettings({...s,watcher_model:'phase1-mock',model_bindings:{}});const t=await window.__ZEUS_BRIDGE__.createTask('Browser readiness');await window.__ZEUS_BRIDGE__.updateTaskSettings(t.id,{master_model:'phase1-mock',worker_model:'None',verifier_model:'None',watcher_model:'None',vision_model:'None',budget_credits:1000000,model_bindings:{}});return t;});
        for(const command of [
            {op:'navigate',params:{url:`http://127.0.0.1:${server.address().port}/`}},
            {op:'type_text',params:{target:{css:'#note'},value:'Retained value',timeout_ms:3000,ready:{target:{css:'#note'},condition:{kind:'attribute',name:'data-ready',value:'true'}},expect:{target:{css:'#note'},condition:{kind:'value',value:'Retained value'},settle_ms:100}}},
            {op:'click',params:{target:{css:'#save'},timeout_ms:2000,expect:{target:{css:'#status'},condition:{kind:'text',value:'Saved',match:'equals'}}}},
            {op:'click',params:{target:{css:'#submit'},timeout_ms:250,expect:{target:{css:'#status'},condition:{kind:'text',value:'Never confirmed'}}}},
        ])queueMockResponse(reply({type:'browser_action',...command}));
        queueMockResponse(reply({type:'final_answer',final_answer:{summary:'The note survived hydration and Save was confirmed. The second submission remains uncertain and was not repeated.'}}));
        await app.page.evaluate(id=>window.__ZEUS_BRIDGE__.sendUserMessage(id,'Run the controlled readiness workflow.',crypto.randomUUID()),task.id);
        const sessions=await app.page.evaluate(id=>window.__ZEUS_BRIDGE__.getManagedBrowserSessions(id),task.id);expect(sessions).toHaveLength(1);
        const actions=await app.page.evaluate(({task,session})=>window.__ZEUS_BRIDGE__.getManagedBrowserActions(task,session),{task:task.id,session:sessions[0].session_id});
        expect(actions.map(row=>row.status),JSON.stringify(actions.map(row=>({op:row.op,response:row.response})))).toEqual(['succeeded','succeeded','succeeded','uncertain']);
        expect(JSON.parse(actions[3].response).error.code).toBe('BROWSER_OUTCOME_UNCONFIRMED');
        expect(effects).toBe(2);expect(sessions[0].runtime.cleanup.owned_processes_remaining).toBe(0);
    }finally{await stopTauri();await stopMockServer();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
