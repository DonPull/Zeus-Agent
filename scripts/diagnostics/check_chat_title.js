#!/usr/bin/env node
// One explicitly requested live smoke check; dry-run unless --live is passed.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {launchTauri,stopTauri} from '../../tests/e2e/testUtils.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const limits={max_requests:2,max_tokens:16000,max_in_flight:1,max_output_tokens:2048,max_directives:2,wall_time_ms:60000};
const config={model:'gpt-6-luna',connection:'abacus',protocol:'responses',effort:'low',limits,attempts:1};
if(!process.argv.includes('--live')){console.log(JSON.stringify({dry_run:true,...config}));process.exit(0);}
if(process.env.ZEUS_OFFLINE_TEST==='1')throw Error('Live diagnostic is not allowed in offline mode');
const directory=path.join(root,'.zeus/evaluations',`chat-title-${crypto.randomUUID()}`);fs.mkdirSync(directory,{recursive:true});
fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify(config,null,2));
let frontend,app,result={...config,passed:false};
try{
    let ready=await fetch('http://127.0.0.1:1420').then(r=>r.ok).catch(()=>false);
    if(!ready){frontend=spawn(process.execPath,[path.join(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1'],{cwd:root,windowsHide:true,stdio:'ignore',shell:false});for(let i=0;i<80&&!ready;i++){await new Promise(r=>setTimeout(r,250));ready=await fetch('http://127.0.0.1:1420').then(r=>r.ok).catch(()=>false);}}
    if(!ready)throw Error('Frontend did not become ready');
    app=await launchTauri(true,{evaluationLimits:limits});
    await app.page.waitForFunction(()=>window.__ZEUS_BRIDGE__?.fetchModelCatalogue);
    const catalogue=await app.page.evaluate(()=>window.__ZEUS_BRIDGE__.fetchModelCatalogue());
    if(!JSON.stringify(catalogue).includes('gpt-6-luna'))throw Error('Configured economical model is absent from current catalogue');
    const task=await app.page.evaluate(async()=>{
        const task=await window.__ZEUS_BRIDGE__.createTask('New agent task');
        await window.__ZEUS_BRIDGE__.updateTaskSettings(task.id,{master_model:'gpt-6-luna',master_effort:'low',worker_model:'None',verifier_model:'None',watcher_model:'None',vision_model:'None',budget_credits:100000,model_bindings:{master:{connection:'abacus',model_id:'gpt-6-luna',protocol:'responses',image_input:'unsupported',source:'explicit'}}});return task;
    });
    result.task_id=task.id;
    await app.page.evaluate(id=>window.__ZEUS_BRIDGE__.sendUserMessage(id,'Answer directly in one sentence, with no tools: I am planning a small vegetable garden. Summarize what this conversation is about.',crypto.randomUUID()),task.id);
    const snapshot=await app.page.evaluate(async id=>({task:(await window.__ZEUS_BRIDGE__.listTasks()).find(t=>t.id===id),messages:await window.__ZEUS_BRIDGE__.getTaskDebugMessages(id),run:await window.__ZEUS_BRIDGE__.getTaskRunState(id),usage:await window.__ZEUS_BRIDGE__.getTaskSpend(id)}),task.id);
    result={...result,...snapshot,passed:snapshot.task.title!=='New agent task'&&snapshot.run?.status==='completed'&&snapshot.messages.some(m=>m.role==='assistant'&&m.kind==='chat'&&!m.content.includes('[[chat_title:'))};
}catch(error){result.error=String(error);}
finally{await stopTauri().catch(()=>{});frontend?.kill();fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({directory,passed:result.passed,title:result.task?.title,error:result.error}));if(!result.passed)process.exitCode=1;}
