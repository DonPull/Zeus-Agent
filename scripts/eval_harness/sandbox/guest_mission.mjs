/** Private collector. Actor artifacts and trace are exported after account stop. */
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {controllerKey,signGradingResult} from './grading_auth.mjs';
import {atomicExchange,decodeResponseFrame} from './file_rpc.mjs';
import {createMissionFileClient} from './mission_rpc.mjs';
import {snapshotActorArtifacts} from './actor_artifacts.mjs';
import {readBoundedFile} from './exchange_files.mjs';
import {validateMissionPacket,missionDigest,controlActionDigest,encodeMissionTrace} from './mission_contract.mjs';
import {launchGuestApp} from './guest_app.mjs';
import {runGuestWorkflow,hasBrowser} from './guest_workflow.mjs';
import {taskSettings,assertEffectiveSettings,fingerprint} from './benchmark_config.js';
import {createSyntheticSupervisor} from './synthetic_supervisor.js';
const input='C:\\Zeus\\Input',output='C:\\Zeus\\Output';
if(process.env.USERNAME!=='WDAGUtilityAccount'||!import.meta.url.startsWith('file:///C:/Zeus/Input/'))throw Error('Disposable private mission controller required');
const job=JSON.parse(readBoundedFile(input,'job.json',16384)),expected=job.mission_job;
const packet=validateMissionPacket(readBoundedFile(input,'actor-packet.json',8*1024*1024),expected);
const identity={id:job.id,nonce:job.nonce,packet_sha256:expected.packet_sha256},key=controllerKey();
const result={kind:'isolated-mission-result-v1',status:'failed',mode:expected.mode,mission:packet.mission,configuration_fingerprint:expected.configuration_fingerprint,provider_inference_requests:0,base:JSON.parse(process.env.ZEUS_GUEST_BASE_RESULT)};
const ps=name=>spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','RemoteSigned','-File',path.join(input,name)],{windowsHide:true,encoding:'utf8',timeout:30000});
let account=false,app=null,workspace=null,trace=null;
try{
  await atomicExchange(output,'grading-key.json',Buffer.from(JSON.stringify({schema_version:1,id:job.id,nonce:job.nonce,key_spki:key.spki})));
  let acknowledged=false;const deadline=Date.now()+20000;
  while(Date.now()<deadline){
    const frame=decodeResponseFrame(readBoundedFile(input,'grading-key-ack.json',4096));
    if(frame){const ack=JSON.parse(frame);if(ack.id!==job.id||ack.nonce!==job.nonce||ack.packet_sha256!==identity.packet_sha256||ack.key_sha256!==key.fingerprint)throw Error('Incorrect host key acknowledgment');acknowledged=true;break;}
    await new Promise(resolve=>setTimeout(resolve,25));
  }
  if(!acknowledged)throw Error('No host key pin; actor was not started');
  const setup=ps('prepare_candidate.ps1');if(setup.status!==0)throw Error('Actor setup failed: '+setup.stderr.slice(-3000));account=true;
  for(const name of ['candidate_gate.py','candidate_boundary.py','actor_bootstrap.py'])fs.copyFileSync(path.join(input,name),path.join('C:\\Zeus\\PublicTools',name));
  const boundary=spawnSync('C:\\Zeus\\GraderPrivate\\candidate-python.exe',['-I','-B','C:\\Zeus\\PublicTools\\candidate_boundary.py',String(process.pid)],{windowsHide:true,encoding:'utf8',timeout:15000});
  if(boundary.status!==0)throw Error('Actor boundary failed: '+boundary.stderr.slice(-2000));result.boundary=JSON.parse(boundary.stdout);
  if(result.boundary.username.toLowerCase()!=='zeuscandidate'||result.boundary.is_admin||['private_read_denied','private_write_denied','controller_process_denied','runtime_write_denied','runtime_readable','scratch_writable'].some(name=>result.boundary[name]!==true))throw Error('Actor boundary not confirmed');
  if(fs.existsSync(path.join(output,'candidate-write.txt')))fs.unlinkSync(path.join(output,'candidate-write.txt'));
  process.env.ZEUS_GUEST_ACTOR_LAUNCHER='C:\\Zeus\\GraderPrivate\\candidate-python.exe';
  const rpc=createMissionFileClient({input,output,nonce:job.nonce,mission:packet.mission,read:readBoundedFile,timeoutMs:60000});
  app=await launchGuestApp({limits:packet.limits,rpc,fixture:hasBrowser(packet.mission)});
  await app.page.evaluate(async python=>{const bridge=window.__ZEUS_BRIDGE__;await bridge.setApiKey('disposable-guest-relay-dummy');const settings=await bridge.getSettings();await bridge.saveSettings({...settings,browser_python_path:python,browser_block_ads:true,browser_agent_audio:false,watcher_model:'None'});},'C:\\Zeus\\Runtime\\browser\\venv\\Scripts\\python.exe');
  const task=await app.page.evaluate(name=>window.__ZEUS_BRIDGE__.createTask(name),'Mission '+packet.mission);
  if(!/^[a-f0-9-]{36}$/.test(task.id))throw Error('Invalid task identity');
  const settings=taskSettings(packet.configuration);
  await app.page.evaluate(({id,settings})=>window.__ZEUS_BRIDGE__.updateTaskSettings(id,settings),{id:task.id,settings});
  const actual=await app.page.evaluate(async id=>(await window.__ZEUS_BRIDGE__.listTasks()).find(task=>task.id===id),task.id);assertEffectiveSettings(settings,actual);
  const spend=await app.page.evaluate(id=>window.__ZEUS_BRIDGE__.getTaskSpend(id),task.id);
  if(fingerprint(spend.evaluation?.limits)!==fingerprint(packet.limits))throw Error('Active limits differ from packet');
  workspace=path.join(app.workspace,'tasks',task.id,'workspace');fs.mkdirSync(workspace,{recursive:true});
  for(const file of packet.inputs)fs.writeFileSync(path.join(workspace,file.name),Buffer.from(file.base64,'base64'),{flag:'wx'});
  const attachmentIds=[];
  if(packet.mission==='V01')for(const file of packet.inputs){const saved=await app.page.evaluate(({id,file})=>window.__ZEUS_BRIDGE__.saveTaskAttachment(id,file.name,file.base64),{id:task.id,file});attachmentIds.push(saved.id);}
  const filesOnly=createSyntheticSupervisor({taskId:task.id,workspace,files:packet.exported_names}),interventions=[];
  const supervisor=card=>{
    const directive=card.body?.blocked_directive;
    if(card.task_id===task.id&&card.kind==='approval'&&directive?.type==='run_action'&&expected.control_actions?.includes(controlActionDigest(directive.action)))return {approved:true,source:'exact-scripted-browser-control',note:'One-time execution of the exact controller-declared synthetic script in this disposable guest. No persistent rule.'};
    return filesOnly(card);
  };
  const abort=new AbortController(),timer=setTimeout(()=>abort.abort(Object.assign(Error('Mission deadline expired'),{code:'TIMED_OUT'})),packet.limits.wall_time_ms);
  let execution='succeeded',error=null;const started=Date.now();
  const workflow={phases:[],browser:[]};
  try{await runGuestWorkflow({packet,task,app,rpc,key,identity,signal:abort.signal,attachmentIds,decide:supervisor,onIntervention:value=>interventions.push(value),onApp:value=>app=value,evidence:workflow});}
  catch(failure){execution=failure.code==='TIMED_OUT'?'timed_out':failure.code==='RUN_CANCELLED'?'cancelled':'failed';error={code:failure.code??null,message:String(failure.message).slice(-4000)};}
  finally{clearTimeout(timer);}
  const observed=await app.page.evaluate(async id=>({run:await window.__ZEUS_BRIDGE__.getTaskRunState(id),spend:await window.__ZEUS_BRIDGE__.getTaskSpend(id),messages:await window.__ZEUS_BRIDGE__.getTaskDebugMessages(id),debug:await window.__ZEUS_BRIDGE__.getDebugLog(id),browser_sessions:await window.__ZEUS_BRIDGE__.getManagedBrowserSessions(id)}),task.id);
  if(observed.run?.status!=='completed'&&execution==='succeeded')execution='failed';
  result.actor={actor_start:app.actorStart,task_id:task.id,run:observed.run,usage:observed.spend.usage,evaluation:observed.spend.evaluation,execution_status:execution,error,duration_ms:Date.now()-started,versions:app.versions};
  trace=encodeMissionTrace({schema_version:1,id:job.id,nonce:job.nonce,mission:packet.mission,observed,workflow,interventions,diagnostics:app.diagnostics()});
  result.status='completed';
}catch(error){result.error=String(error.stack??error).slice(-8000);}
finally{
  if(app)await app.stop().catch(error=>{result.status='failed';result.stop_error=String(error.message).slice(-2000);});
  if(account){const stopped=ps('stop_candidate.ps1');if(stopped.status===0)result.candidate_cleanup=JSON.parse(stopped.stdout);else{result.status='failed';result.cleanup_error=stopped.stderr.slice(-3000);}}
  if(workspace&&trace)try{
    if(result.candidate_cleanup?.remaining!==0||result.candidate_cleanup?.account_disabled!==true)throw Error('Actor cleanup not verified');
    const bytes=snapshotActorArtifacts(workspace,{id:job.id,nonce:job.nonce},packet.exported_names);
    await atomicExchange(output,'actor-export.json',bytes);await atomicExchange(output,'mission-trace.json',trace);
    result.artifact_export={sha256:missionDigest(bytes)};result.trace={sha256:missionDigest(trace)};
  }catch(error){result.status='failed';result.export_error=String(error.message).slice(-2000);}
  fs.writeFileSync('C:\\Zeus\\runtime-report.json',JSON.stringify(signGradingResult(key,identity,result)));
}
process.exitCode=result.status==='completed'?0:1;
