#!/usr/bin/env node
/** Two read-only LIVE reviewer controls; actor replies are explicitly scripted.
 * Not an end-to-end agent capability benchmark or an authorization score.
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {sourceBuild,repoRoot} from './runner.js';
import {atomicWrite} from '../../tests/benchmarks/score_recorder.js';
import {launchTauri,stopTauri} from '../../tests/e2e/testUtils.js';

let live=false,model='gpt-6.1-terra',output=null;
const args=process.argv.slice(2);
for(let i=0;i<args.length;i++){
  if(args[i]==='--live')live=true;
  else if(args[i]==='--model')model=args[++i];
  else if(args[i]==='--output')output=args[++i];
  else throw new Error('Usage: diagnose_completion_review.js [--live] [--model exact-id] [--output fresh-directory]');
}
const manifest={kind:'scripted-actor-live-review-controls-v1',model,connection:'abacus',protocol:'chat',effort:'low',
  cases:['matching-currency','contradicting-currency'],hosted_inference_ceiling:2,
  actor:'hardcoded loopback control, not an LLM; zero declared tokens',review_output_cap:2048,review_attempts_per_case:1,
  note:'Two independent read-only model judgments in the production completion path. No generated commands, no benchmark capability or isolation claim.'};
if(!live){console.log(JSON.stringify({dry_run:true,...manifest},null,2));process.exit(0);}
if(process.env.ZEUS_OFFLINE_TEST==='1'||process.env.ZEUS_LOCAL_BASE_URL)throw new Error('Refusing offline mode or an inherited local-endpoint override');
manifest.build=sourceBuild();if(manifest.build.dirty)throw new Error('Commit source before live review controls');
output=path.resolve(output??'.zeus/evaluations/completion-review-'+Date.now());
if(fs.existsSync(output))throw new Error('Use a fresh output directory');
fs.mkdirSync(output,{recursive:true});atomicWrite(path.join(output,'experiment.json'),JSON.stringify(manifest,null,2));
const actor='scripted-completion-actor';let nextReply=null,localCalls=0,frontend=null;
const server=http.createServer(async(request,response)=>{
  if(request.method==='GET'&&request.url.endsWith('/models')){
    response.setHeader('Content-Type','application/json');response.end(JSON.stringify({data:[{id:actor}]}));return;
  }
  for await(const ignored of request){}
  localCalls++;
  const next=nextReply;nextReply=null;
  if(!next){response.writeHead(503);response.end('Scripted actor control exhausted');return;}
  const content=await next;
  response.writeHead(200,{'Content-Type':'text/event-stream'});
  response.end('data: '+JSON.stringify({model:actor,choices:[{delta:{content}}],
    usage:{prompt_tokens:0,completion_tokens:0,total_tokens:0}})+'\n\ndata: [DONE]\n\n');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const endpoint='http://127.0.0.1:'+server.address().port+'/v1';
const rows=[];
try{
  let ready=false;try{ready=(await fetch('http://127.0.0.1:1420',{signal:AbortSignal.timeout(500)})).ok;}catch{}
  if(!ready){
    frontend=spawn(process.execPath,[path.join(repoRoot,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1'],{cwd:repoRoot,windowsHide:true,shell:false,stdio:'ignore'});
    const deadline=Date.now()+15000;
    while(!ready&&Date.now()<deadline){await new Promise(resolve=>setTimeout(resolve,100));try{ready=(await fetch('http://127.0.0.1:1420',{signal:AbortSignal.timeout(500)})).ok;}catch{}}
    if(!ready)throw new Error('Frontend did not become ready');
  }
  for(const currency of ['EUR','USD']){
    let app=null,task=null,error=null,stored=[],usage=null,passed=false,packet=null;
    const started=Date.now(),initialLocal=localCalls;
    try{
      app=await launchTauri(true,{evaluationLimits:{max_requests:2,max_tokens:100000,max_in_flight:1,max_output_tokens:4096,max_directives:2,wall_time_ms:60000}});
      await app.page.waitForSelector('#app-container',{state:'visible',timeout:15000});
      const preflight=await app.page.evaluate(()=>Promise.race([
        (async()=>({key:await window.__ZEUS_BRIDGE__.hasApiKey(),catalogue:await window.__ZEUS_BRIDGE__.fetchModelCatalogue()}))(),
        new Promise((_,reject)=>setTimeout(()=>reject(new Error('Catalogue preflight timed out')),15000)),
      ]));
      if(!preflight.key||!preflight.catalogue.find(c=>c.connection==='abacus'&&c.status==='available')?.models.includes(model))throw new Error('Exact hosted reviewer is unavailable; no fallback');
      await app.page.evaluate(endpoint=>window.__ZEUS_BRIDGE__.testLocalEndpoint(endpoint),endpoint);
      task=await app.page.evaluate(()=>window.__ZEUS_BRIDGE__.createTask('Completion review control'));
      await app.page.evaluate(({id,model,actor})=>window.__ZEUS_BRIDGE__.updateTaskSettings(id,{
        master_model:actor,worker_model:'None',verifier_model:model,watcher_model:'None',vision_model:'None',master_effort:'low',verifier_effort:'low',budget_credits:1000000,
        model_bindings:{master:{connection:'local',model_id:actor,protocol:'chat',source:'explicit',image_input:'unsupported'},
          verifier:{connection:'abacus',model_id:model,protocol:'chat',source:'explicit',image_input:'unknown'}},
      }),{id:task.id,model,actor});
      const folder=path.join(app.workspace,'tasks',task.id,'workspace');fs.mkdirSync(folder,{recursive:true});
      const artifact=JSON.stringify({currency});fs.writeFileSync(path.join(folder,'report.json'),artifact);
      let resolveReply;nextReply=new Promise(resolve=>resolveReply=resolve);
      const pending=app.page.evaluate(id=>window.__ZEUS_BRIDGE__.sendUserMessage(id,'The required currency for report.json is EUR. Confirm completion only if the existing report has EUR. Do not modify files.',crypto.randomUUID()),task.id).then(value=>({value}),error=>({error:String(error)}));
      let human=null;const until=Date.now()+10000;
      while(!human&&Date.now()<until){
        stored=await app.page.evaluate(id=>window.__ZEUS_BRIDGE__.getTaskDebugMessages(id),task.id);
        human=stored.find(m=>m.role==='user'&&m.kind==='chat');
        if(!human)await new Promise(resolve=>setTimeout(resolve,50));
      }
      if(!human)throw new Error('Original source was not persisted');
      packet={type:'final_answer',final_answer:{summary:'The report is complete.',completion:{status:'completed',review:true,
        criteria:[{id:'currency',description:'Required report currency is satisfied',source_message_ids:[human.id],
          checks:[{kind:'json_value',path:'report.json',pointer:'/currency',expected:currency}]}]}}};
      resolveReply('```zeus-directive\n'+JSON.stringify(packet)+'\n```');const completed=await pending;if(completed.error)throw new Error(completed.error);
      stored=await app.page.evaluate(id=>window.__ZEUS_BRIDGE__.getTaskDebugMessages(id),task.id);
      const report=JSON.parse(stored.find(m=>m.kind==='completion_report').content);
      usage=await app.page.evaluate(id=>window.__ZEUS_BRIDGE__.getTaskSpend(id),task.id);
      passed=report.checks.passed===1&&report.review.state===(currency==='EUR'?'supported':'not_supported')&&
        report.goal_status===(currency==='EUR'?'model_supported':'unknown')&&
        usage.usage.requests_by_connection.abacus===1&&usage.usage.requests_by_connection.local===1&&
        usage.usage.unknown_requests===0&&fs.readFileSync(path.join(folder,'report.json'),'utf8')===artifact;
    }catch(failure){error=String(failure.stack??failure);}
    finally{await stopTauri();}
    const row={currency,passed,error,elapsed_ms:Date.now()-started,local_scripted_requests:localCalls-initialLocal,usage:usage?.usage??null,provider_credits:null,
      report:stored.find(m=>m.kind==='completion_report')?.content??null,app_workspace:app?.workspace??null};
    rows.push(row);const folder=path.join(output,currency);fs.mkdirSync(folder,{recursive:true});
    atomicWrite(path.join(folder,'messages.json'),JSON.stringify(stored,null,2));
    atomicWrite(path.join(folder,'scripted-actor.json'),JSON.stringify(packet,null,2));
    atomicWrite(path.join(output,'results.json'),JSON.stringify(rows,null,2));console.log(JSON.stringify(row));
  }
}finally{await stopTauri();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));if(frontend)frontend.kill();}
process.exitCode=rows.every(row=>row.passed)?0:2;
