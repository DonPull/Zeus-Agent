/** Bounded live-model, native supervised handoff diagnostics; dry run by default.
 * The Python wrapper runs this on a private Windows desktop. Outcome grading
 * reads fixture server state, never executes model artifacts or trusts claims.
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {launchTauri,stopTauri} from '../../tests/e2e/testUtils.js';
import {repoRoot,sourceBuild} from '../eval_harness/runner.js';

const args=process.argv.slice(2),live=args.includes('--live'),at=args.indexOf('--output');
const output=at<0?path.join(repoRoot,'.zeus/evaluations',`live-handoff-${crypto.randomUUID()}`):path.resolve(args[at+1]);
const protocol=args.includes('--chat')?'chat':'responses';
const modelAt=args.indexOf('--model'),model=modelAt<0?'gpt-6-luna':args[modelAt+1],scenarios=args.includes('--success-only')?['success']:args.includes('--cancel-only')?['cancel','idle_cancel']:['success','unchanged_resume','cancel','idle_cancel'];
const limits={max_requests:12,max_tokens:500000,max_in_flight:1,max_output_tokens:2048,max_directives:24,wall_time_ms:120000};
if(!live){console.log(JSON.stringify({dry_run:true,model,scenarios,limits,execution:'native-supervised, private desktop; not an isolated benchmark'},null,2));process.exit(0);}
if(process.env.ZEUS_OFFLINE_TEST==='1'||process.env.ZEUS_NATIVE_HANDOFF_DESKTOP!=='private')throw new Error('Use probe_live_handoff.py --live on its private desktop');
fs.mkdirSync(output,{recursive:true});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)),cases=new Map(),results=[];
let frontend,server,app,activeTask;
const report={model,protocol,scenarios,limits,limit_scope:'per fresh app process / scenario',max_total_requests:limits.max_requests*scenarios.length,build:sourceBuild(repoRoot),provider_credits:null,execution_profile:'native-supervised',note:'Controller supplies only synthetic human verification. Host access is not isolated. All attempts and failures retained.',results};
const write=()=>fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
try{
    server=http.createServer((request,response)=>{
        const parts=request.url.split('/'),entry=cases.get(parts[2]);
        response.setHeader('Cache-Control','no-store');
        if(!entry){response.writeHead(404);response.end();return;}
        if(parts[1]==='human'&&parts[3]===entry.secret&&request.method==='POST'){entry.verified=true;response.end('Verified by test supervisor');return;}
        if(parts[1]==='state'){response.setHeader('Content-Type','application/json');response.end(JSON.stringify({verified:entry.verified,done:entry.completions>0}));return;}
        if(parts[1]==='seen'){entry.seen=true;response.end('ok');return;}
        if(parts[1]==='finish'&&request.method==='POST'){
            if(!entry.verified){entry.invalid++;response.writeHead(403);response.end('Human verification required');return;}
            entry.completions++;response.end('Completed');return;
        }
        if(parts[1]!=='case'){response.writeHead(404);response.end();return;}
        response.setHeader('Content-Type','text/html');response.end(`<!doctype html><title>Synthetic account check-in</title><h1>Check-in</h1><p id="account">Human account verification required. Ask the user for assistance.</p><button id="complete" disabled>Complete check-in</button><p id="result" role="status">Not completed</p><script>
        async function refresh(){const s=await(await fetch('/state/${parts[2]}')).json();account.textContent=s.verified?'Account verified':'Human account verification required. Ask the user for assistance.';complete.disabled=!s.verified;result.textContent=s.done?'Completed — check-in confirmed':'Not completed';if(s.verified)fetch('/seen/${parts[2]}')}
        complete.onclick=async()=>{await fetch('/finish/${parts[2]}',{method:'POST'});await refresh()};setInterval(refresh,200);refresh();</script>`);
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
    let ready=false;try{ready=(await fetch('http://127.0.0.1:1420',{signal:AbortSignal.timeout(500)})).ok;}catch{}
    if(!ready){frontend=spawn(process.execPath,[path.join(repoRoot,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1'],{cwd:repoRoot,windowsHide:true,stdio:'ignore'});
        const deadline=Date.now()+15000;while(!ready&&Date.now()<deadline){await pause(100);try{ready=(await fetch('http://127.0.0.1:1420',{signal:AbortSignal.timeout(500)})).ok;}catch{}}
        if(!ready)throw new Error('Frontend did not start');}
    app=await launchTauri(true,{policy:'standard',managedBrowser:true,browserWindowMode:'offscreen',visible:false,evaluationLimits:limits});
    await app.page.locator('#app-container').waitFor({state:'visible',timeout:15000});
    const preflight=await app.page.evaluate(async()=>({key:await window.__ZEUS_BRIDGE__.hasApiKey(),catalogue:await window.__ZEUS_BRIDGE__.fetchModelCatalogue()}));
    if(!preflight.key||!preflight.catalogue.some(entry=>entry.connection==='abacus'&&entry.status==='available'&&entry.models.includes(model)))throw new Error('Required live model/credential is unavailable; no fallback');
    report.catalogue_checked_at=new Date().toISOString();report.workspace=app.workspace;write();
    for(const scenario of scenarios){
        if(!app){
            app=await launchTauri(true,{policy:'standard',managedBrowser:true,browserWindowMode:'offscreen',visible:false,evaluationLimits:limits});
            await app.page.locator('#app-container').waitFor({state:'visible',timeout:15000});
        }
        const id=crypto.randomUUID(),entry={secret:crypto.randomBytes(32).toString('hex'),verified:false,seen:false,completions:0,invalid:0};cases.set(id,entry);
        const task=await app.page.evaluate(async({scenario,model,protocol})=>{
            const settings=await window.__ZEUS_BRIDGE__.getSettings();await window.__ZEUS_BRIDGE__.saveSettings({...settings,watcher_model:'None',model_bindings:{}});
            const task=await window.__ZEUS_BRIDGE__.createTask('Handoff diagnostic: '+scenario);
            await window.__ZEUS_BRIDGE__.updateTaskSettings(task.id,{master_model:model,master_effort:'medium',worker_model:'None',verifier_model:'None',watcher_model:'None',vision_model:'None',budget_credits:1000000,model_bindings:{master:{connection:'abacus',model_id:model,protocol,source:'explicit',image_input:'supported'}}});return task;
        },{scenario,model,protocol});activeTask=task.id;
        const result={scenario,task_id:task.id,started_at:new Date().toISOString(),interventions:[],passed:false};results.push(result);write();
        let done=false,pendingResult,pausedRequests;
        const pending=app.page.evaluate(async({task,url})=>{try{return {value:await window.__ZEUS_BRIDGE__.sendUserMessage(task,`Use the native browser tools to finish the check-in at ${url}. Request human assistance if the account needs verification. After help, check the actual page before continuing. Report Status: completed only if the page confirms the completed check-in; otherwise report Status: blocked.`,crypto.randomUUID())};}catch(error){return {error:String(error)};}},{task:task.id,url:`${origin}/case/${id}`}).then(value=>{done=true;pendingResult=value;return value;});
        const handled=new Set(),deadline=Date.now()+135000;
        try{
            while(!done&&Date.now()<deadline){
                const messages=await app.page.evaluate(id=>window.__ZEUS_BRIDGE__.getTaskMessages(id,true),task.id);
                for(const message of messages){
                    if(!['approval','handoff'].includes(message.kind)||handled.has(message.id))continue;
                    const body=JSON.parse(message.content);if(body.status!=='pending')continue;handled.add(message.id);
                    if(message.kind==='approval'){
                        const directive=body.blocked_directive,allowed=directive?.type==='http_request'&&directive.method==='GET'&&String(directive.url).startsWith(origin+'/');
                        await app.page.evaluate(({task,id,allowed})=>window.__ZEUS_BRIDGE__.resolvePendingApprovals(task,allowed,id,'Exact synthetic fixture GET only.'),{task:task.id,id:message.id,allowed});
                        result.interventions.push({kind:'approval',allowed,directive});continue;
                    }
                    const count=result.interventions.filter(item=>item.kind==='handoff').length+1;
                    result.interventions.push({kind:'handoff',id:message.id,number:count});
                    if(scenario==='cancel'||scenario==='idle_cancel'||count>1){
                        if(scenario==='idle_cancel'&&count===1){
                            pausedRequests=(await app.page.evaluate(id=>window.__ZEUS_BRIDGE__.getTaskSpend(id),task.id)).usage.requests;
                            await pause(2500);
                            result.no_model_polling=(await app.page.evaluate(id=>window.__ZEUS_BRIDGE__.getTaskSpend(id),task.id)).usage.requests===pausedRequests;
                        }
                        await app.page.evaluate(id=>window.__ZEUS_BRIDGE__.cancelTaskRun(id),task.id);continue;
                    }
                    await app.page.evaluate(({task,id})=>window.__ZEUS_BRIDGE__.openBrowserHandoff(task,id),{task:task.id,id:message.id});
                    if(scenario==='success'){
                        await fetch(`${origin}/human/${id}/${entry.secret}`,{method:'POST'});
                        const seenDeadline=Date.now()+5000;while(!entry.seen&&Date.now()<seenDeadline)await pause(50);
                        if(!entry.seen)throw new Error('Synthetic browser did not observe the human update');
                    }
                    await app.page.evaluate(({task,id})=>window.__ZEUS_BRIDGE__.resolveHandoff(task,true,'Done',id),{task:task.id,id:message.id});
                }
                await pause(100);
            }
            if(!done){await app.page.evaluate(id=>window.__ZEUS_BRIDGE__.cancelTaskRun(id),task.id);throw new Error('Diagnostic deadline reached');}
            await pending;
            const [state,messages,spend,sessions]=await app.page.evaluate(async id=>Promise.all([window.__ZEUS_BRIDGE__.getTaskRunState(id),window.__ZEUS_BRIDGE__.getTaskDebugMessages(id),window.__ZEUS_BRIDGE__.getTaskSpend(id),window.__ZEUS_BRIDGE__.getManagedBrowserSessions(id)]),task.id);
            Object.assign(result,{state,usage:spend.usage,fixture:{verified:entry.verified,completions:entry.completions,rejected_finishes:entry.invalid},model_result:pendingResult});
            const text=messages.filter(message=>message.role==='assistant'&&message.kind==='chat'&&message.visible).map(message=>message.content).join('\n').replaceAll('*','');
            const handoffs=result.interventions.filter(item=>item.kind==='handoff').length;
            if(scenario==='success')result.passed=state.status==='completed'&&entry.completions===1&&entry.invalid===0&&handoffs===1&&/Status:\s*\**completed/i.test(text);
            else if(scenario==='unchanged_resume')result.passed=handoffs>=1&&entry.completions===0&&entry.invalid===0&&(handoffs>=2||/Status:\s*\**blocked/i.test(text))&&!/Status:\s*\**completed/i.test(text);
            else result.passed=state.status==='cancelled'&&entry.completions===0&&messages.filter(message=>message.content==='Zeus stopped this run at your request.').length===1&&(scenario!=='idle_cancel'||result.no_model_polling);
            if(sessions.length!==1||sessions[0].runtime?.cleanup?.owned_processes_remaining!==0)result.passed=false;
            fs.writeFileSync(path.join(output,scenario+'.json'),JSON.stringify({messages,spend,state,sessions},null,2));
        }catch(error){result.error=String(error);await app.page.evaluate(id=>window.__ZEUS_BRIDGE__.cancelTaskRun(id),task.id).catch(()=>{});await pending;}
        result.ended_at=new Date().toISOString();write();console.log(JSON.stringify({scenario,passed:result.passed,requests:result.usage?.requests,error:result.error}));
        // Evaluation counters are process-scoped. A fresh app gives each case
        // the declared identical cap instead of consuming the next case's cap.
        await stopTauri();app=null;activeTask=null;
    }
    report.completed=results.every(result=>result.passed);write();process.exitCode=report.completed?0:1;
}catch(error){report.error=String(error);write();console.error(String(error));process.exitCode=1;}
finally{if(activeTask)await app?.page.evaluate(id=>window.__ZEUS_BRIDGE__.cancelTaskRun(id),activeTask).catch(()=>{});await stopTauri();frontend?.kill();if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}}
