#!/usr/bin/env node
/** One bounded, native supervised diagnostic. Dry-run by default. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {mission} from '../../tests/benchmarks/mission_kit.js';
import {runMissionTrial,sendWithApprovals} from '../../tests/benchmarks/mission_runtime.js';
import {launchTauri,stopTauri} from '../../tests/e2e/testUtils.js';
import {atomicWrite,writeDashboard,appendScore,buildScoreRecord,loadScores} from '../../tests/benchmarks/score_recorder.js';
import {repoRoot,sourceBuild} from './runner.js';
import {createSyntheticSupervisor} from './synthetic_supervisor.js';
import {startTicketPortal} from '../../tests/benchmarks/mission_graders/ticket_portal.js';
import {watchTicketBrowser} from '../../tests/benchmarks/browser_observer.js';

const args=process.argv.slice(2);let live=false,model='gpt-6-luna',id='D01',delivery='direct',visionModel=null,supervision='synthetic',effort='medium',protocol='responses',approvalControl=false,followups=false;
for(let index=0;index<args.length;index++){
  if(args[index]==='--live')live=true;
  else if(args[index]==='--dry-run')live=false;
  else if(args[index]==='--approval-control')approvalControl=true;
  else if(args[index]==='--followups')followups=true;
  else if(args[index]==='--managed-browser')continue;
  else if(['--model','--mission','--delivery','--vision-model','--supervision','--effort','--protocol'].includes(args[index])){
    const key=args[index],value=args[++index];if(!value||value.startsWith('--'))throw new Error(`Missing value for ${key}`);
    if(key==='--model')model=value;else if(key==='--mission')id=value;else if(key==='--delivery')delivery=value;else if(key==='--vision-model')visionModel=value;
    else if(key==='--supervision')supervision=value;else if(key==='--effort')effort=value;else protocol=value;
  }else throw new Error(`Unknown argument: ${args[index]}`);
}
// Executable submissions require a later isolated grader; this first diagnostic
// uses data/controller-owned browser grading and never executes an agent output in the evaluator.
if(!['D01','V01','B01'].includes(id))throw new Error('Native diagnostics support only D01/V01 data and the controller-owned B01 browser fixture');
if(id==='B01'&&approvalControl)throw new Error('B01 has no artifact approval-control variant');
if(!['direct','helper'].includes(delivery))throw new Error('Delivery must be direct or helper');
if(!['synthetic','manual'].includes(supervision)||!['low','medium','high'].includes(effort)||!['auto','chat','responses'].includes(protocol))throw new Error('Invalid supervision, effort or protocol');
if(followups&&id!=='V01')throw new Error('Follow-up diagnostic is defined only for V01');
const helper=id==='V01'&&delivery==='helper'?(visionModel??model):null;
// The combined V01 variant contains the artifact mission plus two separate
// reinspection turns; the original 12-request allowance ended before its last
// answer. Keep that capped result, and label this larger operating envelope.
const limits={max_requests:followups?18:id==='B01'?16:id==='V01'?8:10,max_tokens:1000000,max_in_flight:1,max_output_tokens:8192,max_directives:24,wall_time_ms:300000};
const experiment=`native-diagnostic-${crypto.randomUUID()}`,output=path.join(repoRoot,'.zeus/evaluations',experiment);
const manifest={experiment_id:experiment,mission:id,task_version:mission(id).task.version,model,provider:'abacus-routellm',
  image_delivery:id==='V01'?delivery:null,vision_model:helper,
  supervision,effort,protocol,approval_control:approvalControl,followups,window_visible:supervision==='manual',
  browser_service:'managed-v1',diagnostic_envelope:id==='B01'?'phase3c-smoke-v1':null,
  execution_profile:'native-supervised',permission_policy:'normal-approvals-fixture-v1',limits,
  trial_retries:0,attempts:1,provider_credits:null,warning:'Native host permissions; independently graded outcome, partial authorization coverage. Not an isolated baseline.'};
if(!live){console.log(JSON.stringify({dry_run:true,...manifest},null,2));process.exit(0);}
if(process.env.ZEUS_OFFLINE_TEST==='1')throw new Error('Live diagnostics cannot run inside offline regression mode');

let frontend=null,portal=null,browserObserver=null;
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
  // The old flag is accepted for CLI compatibility, not engine selection.
  // Exercise ordinary startup with persisted setup and no browser env overrides.
  const app=await launchTauri(true,{policy:'standard',evaluationLimits:limits,visible:manifest.window_visible,managedBrowser:false});
  await app.page.locator('#app-container').waitFor({state:'visible',timeout:15000});
  const runtimePython=path.join(repoRoot,'.zeus/browser-runtime/venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
  if(!fs.existsSync(runtimePython))throw new Error('Prepare the pinned browser runtime explicitly before live diagnostics');
  await app.page.evaluate(async python=>{const settings=await window.__ZEUS_BRIDGE__.getSettings();await window.__ZEUS_BRIDGE__.saveSettings({...settings,browser_python_path:python});},runtimePython);
  // Query the supported catalogue through the app; never read/print API keys.
  const preflight=await app.page.evaluate(()=>Promise.race([
    (async()=>({key:await window.__ZEUS_BRIDGE__.hasApiKey(),
      catalogue:await window.__ZEUS_BRIDGE__.fetchModelCatalogue()}))(),
    new Promise((_,reject)=>setTimeout(()=>reject(new Error('Provider catalogue preflight timed out')),15000)),
  ]));
  if(!preflight.key)throw new Error('No RouteLLM credential is configured; refusing implicit local fallback');
  const catalogue=preflight.catalogue.find(entry=>entry.connection==='abacus');
  if(catalogue?.status!=='available')throw new Error('Abacus model catalogue is unavailable');
  for(const selected of [model,helper].filter(Boolean))if(!catalogue.models.includes(selected))throw new Error(`Requested model is absent from the Abacus catalogue: ${selected}`);
  manifest.catalogue_checked_at=new Date().toISOString();
  atomicWrite(path.join(output,'experiment.json'),JSON.stringify(manifest,null,2));
  console.log(JSON.stringify({diagnostic_started:experiment,output,model,cdp:app.cdpUrl,limits},null,2));
  let supervisor;
  if(id==='B01')portal=await startTicketPortal();
  const result=await runMissionTrial({id,page:app.page,appWorkspace:app.workspace,output,experimentId:experiment,build:manifest.build,
    portal,browserObservation:async()=>browserObserver?await browserObserver.finish():null,
    models:{master:model,vision:helper??'None',delivery:helper?'helper':'auto',effort,visionEffort:effort,
      masterProtocol:protocol,visionProtocol:protocol,masterImageInput:['V01','B01'].includes(id)?'supported':'unknown',visionImageInput:helper?'supported':'unknown',browserService:'managed-v1'},
    supervisionPolicy:(supervision==='synthetic'?'external-synthetic-supervisor-v1':'external-review')+(approvalControl?'+ask-artifact':'')+(followups?'+image-followups-v1':''),
    beforeSend:async context=>{supervisor=createSyntheticSupervisor({taskId:context.task.id,workspace:context.workspace,
      files:[...fs.readdirSync(path.join(mission(id).dir,'inputs')),...mission(id).task.artifacts]});
      if(portal)browserObserver=watchTicketBrowser({page:app.page,taskId:context.task.id,portal,signal:context.signal});
      if(approvalControl)await app.page.evaluate(({tid,name})=>window.__ZEUS_BRIDGE__.addFilePermission(tid,name,'ask','write','exact'),{tid:context.task.id,name:mission(id).task.artifacts[0]});},
    afterExecute:async context=>{
      if(!followups)return;
      const prompts=[
        'Without another upload, use analyze_visual to inspect the original BEFORE screenshot again. Reply only with JSON containing order_id and currency.',
        'Now inspect the original AFTER screenshot again with analyze_visual, without reattaching it. Reply only with JSON containing order_id and currency.',
      ];
      const expected=JSON.parse(fs.readFileSync(path.join(mission(id).dir,'reference/comparison.json'),'utf8'));
      for(const prompt of prompts){
        await sendWithApprovals(app.page,context.task.id,prompt,{decide:supervisor,signal:context.signal,onIntervention:context.recordIntervention});
        const visible=await app.page.evaluate(id=>window.__ZEUS_BRIDGE__.getTaskMessages(id),context.task.id);
        const text=visible.filter(message=>message.role==='assistant'&&message.kind==='chat').at(-1)?.content??'';
        const observed=JSON.parse(text.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));
        if(observed.order_id!==expected.order_id||observed.currency!==expected.currency)throw new Error('Stored-image follow-up facts did not match the original fixture');
      }
      const spend=await app.page.evaluate(id=>window.__ZEUS_BRIDGE__.getTaskSpend(id),context.task.id);
      if((spend.usage.requests_by_role.vision??0)<2)throw new Error('Follow-up trial did not perform both requested image inspections');
      context.checks.push({id:'stored_image_followups',passed:true,evidence:'Two text-only follow-ups re-inspected original attachment handles and returned the correct order/currency.'});
    },
    evaluationKind:'capability',executionProfile:'native-supervised',timeoutMs:limits.wall_time_ms,
    evaluationLimits:limits,expectedProviderOrigin:'https://routellm.abacus.ai',stopActor:stopTauri,
    decide:async card=>{
      if(supervision==='synthetic'){
        const decision=await supervisor(card);
        console.log(JSON.stringify({supervisor_decision:{id:card.id,type:card.body.blocked_directive?.type,...decision}}));
        return decision;
      }
      console.log(JSON.stringify({approval_pending:{id:card.id,task_id:card.task_id,kind:card.kind,
        summary:card.body.summary,blocked_directive:card.body.blocked_directive},instruction:'Review in the separate Zeus window; no automatic approval is applied.'},null,2));
      return {wait_for_user:true};
    }});
  const report=writeDashboard([output],path.join(output,'index.html'));
  if(browserObserver)atomicWrite(path.join(output,'browser-observer.json'),JSON.stringify(browserObserver.evidence(),null,2));
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
  await browserObserver?.finish();await portal?.close();
  await stopTauri();
  if(frontend?.pid&&frontend.exitCode===null){
    if(process.platform==='win32')await new Promise(resolve=>{const child=spawn('taskkill',['/pid',String(frontend.pid),'/f','/t'],{windowsHide:true,stdio:'ignore'});child.once('error',resolve);child.once('exit',resolve);});
    else frontend.kill('SIGTERM');
  }
}
