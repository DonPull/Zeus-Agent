#!/usr/bin/env node
/** Bounded H01/H02 stress comparison. Dry by default; synthetic sources only. */
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {repoRoot,sourceBuild} from './runner.js';
import {atomicWrite} from '../../tests/benchmarks/score_recorder.js';
import {historyFixture,memoryPrompt,imagePrompt,gradeMemory,gradeImage,verifyPreserved} from '../../tests/benchmarks/history_missions.js';
import {sendWithApprovals} from '../../tests/benchmarks/mission_runtime.js';
import {launchTauri,stopTauri} from '../../tests/e2e/testUtils.js';

const args=process.argv.slice(2);let live=false,model='gpt-6.1-terra',output=null;
for(let i=0;i<args.length;i++){
  if(args[i]==='--live')live=true;
  else if(args[i]==='--model')model=args[++i];
  else if(args[i]==='--output')output=args[++i];
  else throw new Error('Usage: diagnose_history.js [--live] [--model exact-id] [--output fresh-directory]');
}
if(!model||model.startsWith('--'))throw new Error('Missing exact model ID');
const limits={max_requests:12,max_tokens:300000,max_in_flight:1,max_output_tokens:4096,max_directives:16,wall_time_ms:240000};
const cells=['H01-short','H01-compacted-restart','H02-short','H02-compacted-restart'];
const manifest={kind:'native-supervised-memory-stress-v1',model,connection:'abacus',protocol:'chat',effort:'low',
  architecture:'solo',cells,limits_per_cell:limits,max_requests_all_cells:48,provider_credits:null,
  note:'Synthetic owned transcript; short versus forced compaction/restart on this build. Not a version regression baseline, full Benchmark v1, or isolated authorization score.'};
if(!live){console.log(JSON.stringify({dry_run:true,...manifest},null,2));process.exit(0);}
if(process.env.ZEUS_OFFLINE_TEST==='1')throw new Error('Live mode is unavailable in offline regression');
manifest.build=sourceBuild();if(manifest.build.dirty)throw new Error('Commit the evaluated source before live inference');
output=path.resolve(output??'.zeus/evaluations/history-'+Date.now());
if(fs.existsSync(output))throw new Error('Output must be a fresh directory');
fs.mkdirSync(output,{recursive:true});atomicWrite(path.join(output,'experiment.json'),JSON.stringify(manifest,null,2));
const truth=JSON.parse(fs.readFileSync(path.join(repoRoot,'tests/benchmarks/missions/v1/V01/reference/comparison.json')));
const images=['7f91c2a0.png','a42d6e83.png'].map(name=>fs.readFileSync(path.join(repoRoot,'tests/benchmarks/missions/v1/V01/inputs',name)));
const results=[];let frontend=null;
try{
  let ready=false;try{ready=(await fetch('http://127.0.0.1:1420',{signal:AbortSignal.timeout(500)})).ok;}catch{}
  if(!ready){
    frontend=spawn(process.execPath,[path.join(repoRoot,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1'],{cwd:repoRoot,windowsHide:true,shell:false,stdio:'ignore'});
    const until=Date.now()+15000;
    while(!ready&&Date.now()<until){if(frontend.exitCode!==null)throw new Error('Frontend exited during startup');
      await new Promise(resolve=>setTimeout(resolve,150));
      try{ready=(await fetch('http://127.0.0.1:1420',{signal:AbortSignal.timeout(500)})).ok;}catch{}
    }
    if(!ready)throw new Error('Frontend startup timed out');
  }
  for(const cell of cells){
    const folder=path.join(output,cell);fs.mkdirSync(folder);
    let app=null,task=null,seeded=null,error=null,grade=null,retained=false,compactions=0,usage=null,raw=[];
    const started=Date.now();const abort=new AbortController();
    const timer=setTimeout(()=>abort.abort(new Error('Memory diagnostic wall-time limit')),limits.wall_time_ms);
    try{
      app=await launchTauri(true,{evaluationLimits:limits});
      await app.page.waitForSelector('#app-container',{state:'visible',timeout:15000});
      await app.page.waitForFunction(()=>Boolean(window.__ZEUS_BRIDGE__),{timeout:15000});
      const preflight=await app.page.evaluate(()=>Promise.race([
        (async()=>({key:await window.__ZEUS_BRIDGE__.hasApiKey(),catalogue:await window.__ZEUS_BRIDGE__.fetchModelCatalogue()}))(),
        new Promise((_,reject)=>setTimeout(()=>reject(new Error('Catalogue timeout')),15000)),
      ]));
      if(!preflight.key||!preflight.catalogue.find(c=>c.connection==='abacus'&&c.status==='available')?.models.includes(model))
        throw new Error('Explicit model or RouteLLM credential unavailable; no fallback');
      task=await app.page.evaluate(()=>window.__ZEUS_BRIDGE__.createTask('Synthetic memory diagnostic'));
      await app.page.evaluate(({id,model})=>window.__ZEUS_BRIDGE__.updateTaskSettings(id,{
        master_model:model,worker_model:'None',verifier_model:'None',watcher_model:'None',vision_model:'None',
        master_effort:'low',vision_effort:'low',budget_credits:1000000,
        model_bindings:{master:{connection:'abacus',model_id:model,protocol:'chat',image_input:'supported',source:'explicit'}},
      }),{id:task.id,model});
      const files=[];
      if(cell.startsWith('H02'))for(const bytes of images)files.push(await app.page.evaluate(({id,data})=>window.__ZEUS_BRIDGE__.saveTaskAttachment(id,'sketch.png',data),{id:task.id,data:bytes.toString('base64')}));
      const long=cell.includes('compacted');
      seeded=historyFixture(app,task,'seed',{filler:long?140:0,attachments:files.map(f=>f.id)});
      if(long){
        await sendWithApprovals(app.page,task.id,'Acknowledge that the correspondence notes are saved. No new personal facts or actions are needed.',{signal:abort.signal});
        const spent=await app.page.evaluate(id=>window.__ZEUS_BRIDGE__.getTaskSpend(id),task.id);usage=spent;
        raw=await app.page.evaluate(id=>window.__ZEUS_BRIDGE__.getTaskDebugMessages(id),task.id);
        historyFixture(app,task,'append');const workspace=app.workspace;await stopTauri();
        const remaining=limits.max_requests-spent.usage.requests;if(remaining<1||spent.usage.unknown_requests)throw new Error('Warm-up exhausted the known-usage request budget');
        const remainingTokens=limits.max_tokens-spent.usage.known_tokens;if(remainingTokens<1)throw new Error('Warm-up exhausted token budget');
        app=await launchTauri(true,{reuseWorkspace:workspace,evaluationLimits:{...limits,max_requests:remaining,max_tokens:remainingTokens,wall_time_ms:Math.max(1000,limits.wall_time_ms-(Date.now()-started))}});
        await app.page.waitForSelector('#app-container',{state:'visible',timeout:15000});
        await app.page.waitForFunction(()=>Boolean(window.__ZEUS_BRIDGE__),{timeout:15000});
      }
      const targetStart=historyFixture(app,task,'inspect').messages.at(-1)?.seq??0;
      await sendWithApprovals(app.page,task.id,cell.startsWith('H01')?memoryPrompt:imagePrompt,{signal:abort.signal});
      raw=await app.page.evaluate(id=>window.__ZEUS_BRIDGE__.getTaskDebugMessages(id),task.id);
      const answer=raw.filter(m=>m.role==='assistant'&&m.kind==='chat').at(-1)?.content??'';
      grade=cell.startsWith('H01')?gradeMemory(answer):gradeImage(answer,truth);
      const after=historyFixture(app,task,'inspect');retained=verifyPreserved(seeded,after);compactions=after.compactions.length;
      atomicWrite(path.join(folder,'retention.json'),JSON.stringify({seeded,after},null,2));
      if(long&&compactions<2)throw new Error('Forced-compaction coverage was not observed');
      const targetDirectives=raw.filter(m=>m.seq>targetStart&&m.kind==='directive');
      if(long&&cell.startsWith('H01')&&!targetDirectives.some(m=>/"(?:find_history|recall_messages|read_history)"/.test(m.content)))
        throw new Error('H01 did not retrieve archive sources after restart');
      if(cell.startsWith('H02')&&!targetDirectives.some(m=>m.content.includes('"analyze_visual"')&&m.content.includes(files[0].id)))
        throw new Error('H02 did not inspect the selected original attachment');
    }catch(failure){error=String(failure.stack??failure);}
    finally{
      clearTimeout(timer);
      if(app&&task){
        usage=await app.page.evaluate(id=>window.__ZEUS_BRIDGE__.getTaskSpend(id),task.id).catch(()=>usage);
        raw=await app.page.evaluate(id=>window.__ZEUS_BRIDGE__.getTaskDebugMessages(id),task.id).catch(()=>raw);
      }
      await stopTauri();
    }
    const measured=usage?.usage;const withinBudget=measured&&measured.unknown_requests===0&&measured.requests<=limits.max_requests&&measured.known_tokens<=limits.max_tokens;
    const row={cell,passed:Boolean(!error&&grade?.passed&&retained&&withinBudget),grade,error,retained,compactions,within_budget:withinBudget,elapsed_ms:Date.now()-started,
      usage:usage?.usage??null,provider_credits:null,source_build:manifest.build,app_workspace:app?.workspace??null};
    results.push(row);
    atomicWrite(path.join(folder,'messages.json'),JSON.stringify(raw,null,2));
    atomicWrite(path.join(folder,'result.json'),JSON.stringify(row,null,2));
    atomicWrite(path.join(output,'results.json'),JSON.stringify(results,null,2));
    console.log(JSON.stringify(row));
    if((usage?.usage?.requests??0)>limits.max_requests)throw new Error('Aggregate cell request limit exceeded');
  }
}finally{await stopTauri();if(frontend)frontend.kill();}
console.log(JSON.stringify({output,passed:results.filter(r=>r.passed).length,total:results.length,provider_credits:null}));
process.exitCode=results.every(r=>r.passed)?0:2;
