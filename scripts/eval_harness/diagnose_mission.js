#!/usr/bin/env node
/** One bounded, native supervised diagnostic. Dry-run by default. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {mission} from '../../tests/benchmarks/mission_kit.js';
import {runMissionTrial} from '../../tests/benchmarks/mission_runtime.js';
import {launchTauri,stopTauri} from '../../tests/e2e/testUtils.js';
import {atomicWrite,writeDashboard,appendScore,buildScoreRecord,loadScores} from '../../tests/benchmarks/score_recorder.js';
import {repoRoot,sourceBuild} from './runner.js';

const args=process.argv.slice(2);let live=false,model='gpt-5-nano',id='D01';
for(let index=0;index<args.length;index++){
  if(args[index]==='--live')live=true;
  else if(args[index]==='--dry-run')live=false;
  else if(['--model','--mission'].includes(args[index])){
    const key=args[index],value=args[++index];if(!value||value.startsWith('--'))throw new Error(`Missing value for ${key}`);
    if(key==='--model')model=value;else id=value;
  }else throw new Error(`Unknown argument: ${args[index]}`);
}
// Executable submissions require a later isolated grader; this first diagnostic
// uses data-only grading and never executes an agent output in the evaluator.
if(id!=='D01')throw new Error('The initial native diagnostic is limited to D01; do not run a model matrix through this command');
const limits={max_requests:6,max_tokens:100000,max_in_flight:1,max_output_tokens:4096,max_directives:12,wall_time_ms:180000};
const experiment=`native-diagnostic-${crypto.randomUUID()}`,output=path.join(repoRoot,'.zeus/evaluations',experiment);
const manifest={experiment_id:experiment,mission:id,task_version:mission(id).task.version,model,provider:'abacus-routellm',
  execution_profile:'native-supervised',permission_policy:'normal-approvals-fixture-v1',limits,
  trial_retries:0,attempts:1,provider_credits:null,warning:'Native host permissions; independently graded outcome, partial authorization coverage. Not an isolated baseline.'};
if(!live){console.log(JSON.stringify({dry_run:true,...manifest},null,2));process.exit(0);}
if(process.env.ZEUS_OFFLINE_TEST==='1')throw new Error('Live diagnostics cannot run inside offline regression mode');

let frontend=null;
try{
  manifest.build={...sourceBuild(repoRoot),runtime:'zeus-evaluation (same production library)'};
  atomicWrite(path.join(output,'experiment.json'),JSON.stringify(manifest,null,2));
  let ready=false;
  try{ready=(await fetch('http://127.0.0.1:1420',{signal:AbortSignal.timeout(1500)})).ok;}catch{}
  if(!ready){
    frontend=spawn(process.execPath,[path.join(repoRoot,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1'],{cwd:repoRoot,windowsHide:true,stdio:'ignore',shell:false});
    let spawnError=null;frontend.once('error',error=>{spawnError=error;});
    const deadline=Date.now()+15000;
    while(!ready&&Date.now()<deadline){
      if(spawnError)throw spawnError;if(frontend.exitCode!==null)throw new Error('Fixture frontend exited during startup');
      try{ready=(await fetch('http://127.0.0.1:1420',{signal:AbortSignal.timeout(500)})).ok;}catch{}
      if(!ready)await new Promise(resolve=>setTimeout(resolve,150));
    }
    if(!ready)throw new Error('Fixture frontend did not become ready');
  }
  const app=await launchTauri(true,{policy:'standard',evaluationLimits:limits,visible:true});
  await app.page.locator('#app-container').waitFor({state:'visible',timeout:15000});
  // Query the supported catalogue through the app; never read/print API keys.
  const preflight=await app.page.evaluate(()=>Promise.race([
    (async()=>({key:await window.__ZEUS_BRIDGE__.hasApiKey(),
      models:await window.__ZEUS_BRIDGE__.fetchAvailableModels(),local:await window.__ZEUS_BRIDGE__.getLocalModelIds()}))(),
    new Promise((_,reject)=>setTimeout(()=>reject(new Error('Provider catalogue preflight timed out')),15000)),
  ]));
  if(!preflight.key)throw new Error('No RouteLLM credential is configured; refusing implicit local fallback');
  if(!preflight.models.includes(model))throw new Error(`Requested model is absent from the supported catalogue: ${model}`);
  if(preflight.local.includes(model))throw new Error('Model ID is registered as local; refusing provider ambiguity');
  manifest.catalogue_checked_at=new Date().toISOString();
  atomicWrite(path.join(output,'experiment.json'),JSON.stringify(manifest,null,2));
  console.log(JSON.stringify({diagnostic_started:experiment,output,model,cdp:app.cdpUrl,limits},null,2));
  const result=await runMissionTrial({id,page:app.page,appWorkspace:app.workspace,output,experimentId:experiment,build:manifest.build,
    models:{master:model,effort:'low'},evaluationKind:'capability',executionProfile:'native-supervised',timeoutMs:180000,
    evaluationLimits:limits,expectedProviderOrigin:'https://routellm.abacus.ai',stopActor:stopTauri,
    decide:async card=>{
      console.log(JSON.stringify({approval_pending:{id:card.id,task_id:card.task_id,kind:card.kind,
        summary:card.body.summary,blocked_directive:card.body.blocked_directive},instruction:'Review in the separate Zeus window; no automatic approval is applied.'},null,2));
      return {wait_for_user:true};
    }});
  const report=writeDashboard([output],path.join(output,'index.html'));
  console.log(JSON.stringify({report:report.out,execution:result.row.execution_status,outcome:result.row.outcome_status,
    authorization:result.row.authorization_status,usage:result.row.usage,interventions:result.interventions,error:result.row.error},null,2));
  process.exitCode=result.row.passed?0:result.row.outcome_passed?2:1;
}catch(error){
  console.error(error.message);process.exitCode=1;
  if(!loadScores(output).runs.length){
    appendScore(output,buildScoreRecord({suiteTitle:'Zeus mission diagnostics',suiteDir:'zeus-missions-v1',promptSpec:mission(id).task,
      runMeta:{experiment_id:experiment,evaluation_kind:'capability',execution_profile:'native-supervised',configuration:manifest,
        build:manifest.build,execution_status:'infrastructure_error',error:{name:error.name,message:error.message}}}));
    writeDashboard([output],path.join(output,'index.html'));
  }
}
finally{
  await stopTauri();
  if(frontend?.pid&&frontend.exitCode===null){
    if(process.platform==='win32')await new Promise(resolve=>{const child=spawn('taskkill',['/pid',String(frontend.pid),'/f','/t'],{windowsHide:true,stdio:'ignore'});child.once('error',resolve);child.once('exit',resolve);});
    else frontend.kill('SIGTERM');
  }
}
