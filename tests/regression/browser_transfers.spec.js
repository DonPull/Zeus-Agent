import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {startMockServer,stopMockServer,launchTauri,stopTauri,queueMockResponse} from '../e2e/testUtils.js';
const reply=value=>({choices:[{delta:{content:'```zeus-directive\n'+JSON.stringify(value)+'\n```'}}],usage:{prompt_tokens:5,completion_tokens:5,total_tokens:10}});
test('managed transfers verify real bytes, reject outside-task uploads and retain downloads after cleanup',async()=>{
    let uploaded='';const csv='item,amount\nverified,42\n';
    const server=http.createServer(async(req,res)=>{
        if(req.url==='/download'){res.writeHead(200,{'Content-Type':'text/csv','Content-Disposition':'attachment; filename="report.csv"'});res.end(csv);return;}
        if(req.url==='/upload'){for await(const chunk of req)uploaded+=chunk;res.writeHead(204);res.end();return;}
        res.writeHead(200,{'Content-Type':'text/html'});res.end('<input id="file" type="file" onchange="this.files[0].text().then(text=>fetch(\'/upload\',{method:\'POST\',body:text})).then(()=>statusText.textContent=\'Uploaded\')"><p id="statusText">Waiting</p><a href="/download">Download report</a>');
    });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    try{
        await startMockServer();const app=await launchTauri(false,{managedBrowser:true}),page=app.page;
        await expect(page.locator('#app-container')).toBeVisible();
        const task=await page.evaluate(async()=>{const settings=await window.__ZEUS_BRIDGE__.getSettings();await window.__ZEUS_BRIDGE__.saveSettings({...settings,watcher_model:'phase1-mock',model_bindings:{}});const task=await window.__ZEUS_BRIDGE__.createTask('Browser file transfers');await window.__ZEUS_BRIDGE__.updateTaskSettings(task.id,{master_model:'phase1-mock',worker_model:'None',verifier_model:'None',watcher_model:'None',vision_model:'None',budget_credits:1000000,model_bindings:{}});return task;});
        await page.evaluate(id=>window.__ZEUS_BRIDGE__.addWatcherPolicy(id,'Evaluate these synthetic transfer operations using normal browser policy.'),task.id);
        const workspace=path.join(app.workspace,'tasks',task.id,'workspace');fs.mkdirSync(workspace,{recursive:true});fs.writeFileSync(path.join(workspace,'task.txt'),'frozen upload bytes');
        for(const {verdict,...command} of [
            {op:'navigate',params:{url:`http://127.0.0.1:${server.address().port}/`},verdict:'ALLOW'},
            {op:'upload_file',params:{path:'task.txt',target:{css:'#file'},expect:{target:{css:'#statusText'},condition:{kind:'text',value:'Uploaded',match:'equals'}}},verdict:'ALLOW'},
            {op:'upload_file',params:{path:'task.txt',target:{css:'#file'}},verdict:'DENY'},
            {op:'upload_file',params:{path:'../../outside.txt',target:{css:'#file'}}},
            {op:'download',params:{target:{text:'Download report'}},verdict:'ALLOW'}
        ]){queueMockResponse(reply({type:'browser_action',...command}));if(verdict)queueMockResponse({choices:[{message:{content:verdict}}],usage:{prompt_tokens:5,completion_tokens:5,total_tokens:10}});}
        queueMockResponse(reply({type:'final_answer',final_answer:{summary:'Browser transfer fixture complete.'}}));
        await page.evaluate(id=>window.__ZEUS_BRIDGE__.sendUserMessage(id,'Upload the task file and retrieve the synthetic report.',crypto.randomUUID()),task.id);
        const [session]=await page.evaluate(id=>window.__ZEUS_BRIDGE__.getManagedBrowserSessions(id),task.id),actions=await page.evaluate(({task,session})=>window.__ZEUS_BRIDGE__.getManagedBrowserActions(task,session),{task:task.id,session:session.session_id});
        expect(actions.map(action=>action.status)).toEqual(['succeeded','succeeded','denied','failed','succeeded']);expect(uploaded).toBe('frozen upload bytes');
        const file=JSON.parse(actions.at(-1).response).result.download;
        expect(file.status).toBe('completed');expect(path.resolve(file.path).startsWith(path.resolve(workspace)+path.sep)).toBe(true);expect(fs.readFileSync(file.path,'utf8')).toBe(csv);expect(file.bytes).toBe(Buffer.byteLength(csv));
        expect(session.runtime.cleanup.owned_processes_remaining).toBe(0);
        const records=await page.evaluate(({task,session})=>window.__ZEUS_BRIDGE__.getManagedBrowserTransfers(task,session),{task:task.id,session:session.session_id});
        expect(records.map(row=>row.status).sort()).toEqual(['completed','denied','selected']);
    }finally{await stopTauri();await stopMockServer();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
