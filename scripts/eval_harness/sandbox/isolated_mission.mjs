/** Scripted real-app calibration. Hosted inference remains explicitly disabled. */
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {prepareActorPacket} from './actor_packet.mjs';
import {prepareProbe,inspectProbe,readBoundedFile,unlinkedDirectory} from './session.js';
import {retainActorArtifacts} from './actor_artifacts.mjs';
import {missionDigest,controlActionDigest,SINGLE_TURN_MISSIONS,WORKFLOW_MISSIONS,MISSION_TRACE_LIMIT} from './mission_contract.mjs';
import {workflowControlReplies} from './workflow_controls.mjs';
import {createIsolatedGrader} from './isolated_grader.mjs';
import {mission,withScratch,deployMission,python} from '../../../tests/benchmarks/mission_kit.js';
import {gradeMission} from '../../../tests/benchmarks/mission_graders/outcomes.js';
import {buildScoreRecord,appendScore,atomicWrite} from '../../../tests/benchmarks/score_recorder.js';
import {sourceBuild} from '../runner.js';
const directory=path.dirname(fileURLToPath(import.meta.url)),repo=path.resolve(directory,'../../..');
const sessions=path.join(repo,'.zeus/evaluations/sandbox-sessions');
export function controlReplies(id,variant='positive'){
  if(WORKFLOW_MISSIONS.includes(id))return workflowControlReplies(id,variant);
  if(!SINGLE_TURN_MISSIONS.includes(id)||!['positive','invalid-output'].includes(variant))throw Error('Undeclared single-turn calibration');
  const {dir,task}=mission(id);
  return withScratch(root=>{
    let reference=path.join(dir,'reference');
    if(id==='D01'){
      reference=path.join(root,'reference');deployMission(id,reference);
      // Only this fixed repository reference is run on the host, never exports.
      python(path.join(dir,'reference/reconcile.py'),[reference],{trustedExecution:true});
    }
    const replies=task.artifacts.map(name=>({type:'write_file',path:name,content:variant==='positive'?fs.readFileSync(path.join(reference,name),'utf8'):name.endsWith('.py')?'raise RuntimeError("intentional negative calibration")\n':'{}'}));
    replies.push({type:'final_answer',final_answer:{summary:'Scripted controller calibration finished; independent graders decide correctness.'}});
    return replies;
  });
}
export function prepareIsolatedMission({id,architecture='solo',runtimeBundle,mode='scripted_control',variant='positive'}){
  if(mode!=='scripted_control')throw Error('Hosted mission dispatch remains gated');
  const controls=Buffer.from(JSON.stringify(controlReplies(id,variant))),actor=prepareActorPacket(id,architecture),packet=JSON.parse(actor.bytes);
  const expected={mission:id,architecture,mode,variant,packet_sha256:actor.sha256,configuration_fingerprint:packet.configuration.configuration_fingerprint,
    exported_names:actor.exportedNames,limits:packet.limits,controller_timeout_secs:780,control_replies_sha256:missionDigest(controls),
    control_actions:JSON.parse(controls).filter(reply=>reply.type==='run_action').map(reply=>controlActionDigest(reply.action))};
  const prepared=prepareProbe(sessions,{runtimeBundle,missionJob:{bytes:actor.bytes,expected}});
  fs.writeFileSync(path.join(prepared.root,'private/control-replies.json'),controls,{flag:'wx'});
  fs.writeFileSync(path.join(prepared.root,'private/build.json'),JSON.stringify(sourceBuild(repo),null,2),{flag:'wx'});
  return prepared;
}
export function readIsolatedMission(root){
  root=unlinkedDirectory(root);const manifest=JSON.parse(readBoundedFile(root,'session.json',16384)),report=inspectProbe(root);
  if(!manifest.mission_job||report.status!=='probe_claims_consistent')throw Error('Mission execution evidence not accepted');
  const runs=fs.readdirSync(root).filter(name=>/^host-lifecycle-[0-9a-f-]+\.json$/.test(name)).map(name=>({name,bytes:readBoundedFile(root,name,65536)})).filter(row=>JSON.parse(row.bytes).mode==='Run');
  if(runs.length!==1)throw Error('Expected one immutable mission launch receipt');
  const lifecycle=JSON.parse(runs[0].bytes);
  if(lifecycle.status!=='probe_observed'||lifecycle.probe_id!==manifest.id||lifecycle.cleanup?.client_gone!==true||lifecycle.cleanup?.launcher_gone!==true||lifecycle.cleanup?.transport_gone!==true||lifecycle.inspection?.result_sha256!==report.result_sha256)throw Error('Mission VM lifecycle/cleanup not verified');
  const packet=JSON.parse(readBoundedFile(path.join(root,'input'),'actor-packet.json',8*1024*1024));
  const signed=JSON.parse(Buffer.from(report.guest.runtime_smoke.payload_base64,'base64')).body;
  const trace=JSON.parse(readBoundedFile(path.join(root,'output'),'mission-trace.json',MISSION_TRACE_LIMIT));
  return {manifest,packet,report,signed,trace,lifecycle_receipt:runs[0].name,lifecycle_sha256:missionDigest(runs[0].bytes)};
}
function dispatch(root,mode,{signal}={}){
  return new Promise((resolve,reject)=>{
    const child=spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','RemoteSigned','-File',path.join(directory,'run_probe.ps1'),'-Mode',mode,'-TimeoutSeconds',mode==='Run'?'780':'30','-SessionDirectory',root],{cwd:repo,windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});
    let stderr='',failure=null;const fail=error=>{failure??=error;if(child.exitCode===null)child.kill();};
    child.stdout.on('data',()=>{});child.stderr.on('data',chunk=>stderr=(stderr+chunk).slice(-16000));
    const timer=setTimeout(()=>fail(Error('Mission controller deadline expired')),mode==='Run'?810000:30000);
    const aborted=()=>fail(signal.reason??Error('Mission cancelled'));signal?.addEventListener('abort',aborted,{once:true});if(signal?.aborted)aborted();
    child.once('error',error=>{failure=error;});child.once('close',code=>{clearTimeout(timer);signal?.removeEventListener('abort',aborted);if(failure)reject(failure);else resolve({code,stderr});});
  });
}
export async function runPreparedMission(root,{signal,onSession=()=>{}}={}){
  root=unlinkedDirectory(root);if(path.dirname(root).toLowerCase()!==sessions.toLowerCase())throw Error('Use an owned mission session');
  const manifest=JSON.parse(readBoundedFile(root,'session.json',16384));if(manifest.kind!=='sandbox-boundary-probe'||manifest.id!==path.basename(root)||manifest.mission_job?.mode!=='scripted_control')throw Error('Only an owned scripted calibration is enabled');
  const {id}=manifest,output=path.join(repo,'.zeus/evaluations/isolated-missions',id);fs.mkdirSync(output,{recursive:true});
  if(fs.readdirSync(output).length)throw Error('Mission result directory must be fresh');
  const packet=JSON.parse(readBoundedFile(path.join(root,'input'),'actor-packet.json',8*1024*1024)),started=Date.now();
  let observed=null,outcome=null,error=null,execution='infrastructure_error',artifacts=[];
  onSession({id,root,status:'launching_scripted_control'});
  try{
    let run;try{run=await dispatch(root,'Run',{signal});}catch(failure){await dispatch(root,'Cleanup').catch(()=>{});throw failure;}
    if(run.code!==0)throw Error('Mission controller rejected execution; inspect retained session: '+run.stderr.slice(-1500));
    observed=readIsolatedMission(root);execution=observed.signed.actor.execution_status;
    const bytes=readBoundedFile(path.join(root,'output'),'actor-export.json',8*1024*1024);
    const retained=retainActorArtifacts(bytes,{id,nonce:manifest.nonce},manifest.mission_job.exported_names,path.join(output,'submission'));
    artifacts=retained.files;
    atomicWrite(path.join(output,'trace.json'),JSON.stringify(observed.trace,null,2));
    if(WORKFLOW_MISSIONS.includes(packet.mission))outcome=JSON.parse(readBoundedFile(path.join(root,'private'),'mission-assessment.json',1024*1024));
    else if(['C01','C02','C03','D02'].includes(packet.mission))outcome=await createIsolatedGrader({runtimeBundle:manifest.runtime_bundle.path,onSession})({id:packet.mission,submission:retained.directory,signal});
    else outcome=await gradeMission(packet.mission,retained.directory);
    if(outcome.error)throw Error('Independent grader failed: '+outcome.error.message);
    atomicWrite(path.join(output,'assessment.json'),JSON.stringify(outcome,null,2));
  }catch(failure){error={code:failure.code??'INFRASTRUCTURE_ERROR',message:String(failure.message).slice(-4000),session_directory:failure.session_directory??root};execution='infrastructure_error';}
  const row=buildScoreRecord({suiteTitle:'Zeus core v1 isolated calibration',suiteDir:output,promptSpec:packet.task,mode:'score-only',
    pythonCheckDetails:outcome?.criteria.map(criterion=>({...criterion,passed:criterion.status==='passed'?true:criterion.status==='failed'?false:null}))??[],
    messageCount:observed?.trace.observed.messages.length??null,durationSeconds:(Date.now()-started)/1000,
    runMeta:{suite_id:'zeus-core-v1',suite_version:'1',experiment_id:'isolated-scripted-controls',trial_id:id,evaluation_kind:'scripted_runtime',execution_status:execution,
      architecture:packet.architecture,configuration:packet.configuration,configuration_fingerprint:packet.configuration.configuration_fingerprint,
      build:JSON.parse(readBoundedFile(path.join(root,'private'),'build.json',65536)),fixture_hash:packet.deployment.fixture_hash,mission_assessment:outcome,error,
      task_id:observed?.signed.actor.task_id??null,run_id:observed?.signed.actor.run?.id??null,usage:observed?.signed.actor.usage??null,
      evaluation_limits:observed?.signed.actor.evaluation??null,interventions:observed?.trace.interventions??[],artifacts,
      execution_profile:'windows-sandbox-scripted-calibration-v1',authorization_coverage:{status:'partial',scope:'declared fixture file approvals',unobserved:['arbitrary_native_effects']},
      measurements:{hosted_inference_requests:0,synthetic_provider_usage:true,control_variant:manifest.mission_job.variant,isolation_validated:false,actor_session:root,lifecycle_receipt:observed?.lifecycle_receipt??null,lifecycle_sha256:observed?.lifecycle_sha256??null,
        limitations:['Independent HCS disposal, CPU and writable-mapping disk quotas remain unvalidated.','Scripted outputs test plumbing, not model capability.']}}});
  appendScore(output,row);return {root,output,row};
}
