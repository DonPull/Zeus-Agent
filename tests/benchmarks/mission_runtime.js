/** Real bridge driver. Scripted controls and native diagnostics retain different labels. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { mission, deployMission, safeFile, treeHash, SubmissionError } from './mission_kit.js';
import { gradeMission } from './mission_graders/outcomes.js';
import { resolveBenchmarkConfig, taskSettings, assertEffectiveSettings, fingerprint } from './benchmark_config.js';
import { appendScore, atomicWrite } from './score_recorder.js';
import { runTrial } from './trial_runner.js';
import { agentDuration, browserMeasurements, contextMeasurements } from './mission_measurements.js';

const pause = ms => new Promise(resolve=>setTimeout(resolve,ms));
export const hashBytes = data => crypto.createHash('sha256').update(data).digest('hex');
const infrastructure = message => Object.assign(new Error(message),{code:'INFRASTRUCTURE_ERROR'});

export function exportMission(id, workspace, destination) {
  const {dir,task}=mission(id), inputs=path.join(dir,'inputs');
  if(fs.existsSync(destination)) throw new Error('Export destination must be fresh');
  if(fs.lstatSync(workspace).isSymbolicLink())throw new Error('Actor workspace is a link/reparse point');
  fs.mkdirSync(destination,{recursive:true});
  const names=new Set([...fs.readdirSync(inputs),...task.artifacts,...(id==='D02'?['feedback.db']:[])]);
  const evidence=[];
  for(const name of names){
    try {
      const source=safeFile(workspace,name,task.limits.artifact_bytes), bytes=fs.readFileSync(source);
      const target=path.join(destination,name);fs.writeFileSync(target,bytes,{flag:'wx'});
      evidence.push({name,sha256:hashBytes(bytes),bytes:bytes.length,status:'retained'});
    } catch(error){
      if(!(error instanceof SubmissionError)) throw error;
      evidence.push({name,status:'rejected_or_missing',reason:error.message});
    }
  }
  return evidence;
}

/** No model decides approvals here. Exact scripted choices or external review only. */
export async function sendWithApprovals(page,taskId,prompt,{signal,decide=async()=>null,onIntervention=()=>{},attachmentIds=[]}={}) {
  const pending=page.evaluate(async({taskId,prompt,attachmentIds})=>{
    try {const result=await window.__ZEUS_BRIDGE__.sendUserMessage(taskId,prompt,crypto.randomUUID(),attachmentIds);return {result};}
    catch(error){return {error:String(error)};}
  },{taskId,prompt,attachmentIds});
  let complete=false;const result=pending.catch(error=>({error:String(error)})).then(value=>{complete=true;return value;});
  const handled=new Map();
  while(!complete){
    if(signal?.aborted){await page.evaluate(id=>window.__ZEUS_BRIDGE__.cancelTaskRun(id),taskId).catch(()=>{});throw signal.reason;}
    const messages=await page.evaluate(id=>window.__ZEUS_BRIDGE__.getTaskMessages(id,true),taskId);
    for(const message of messages){
      if(!['approval','choice','handoff'].includes(message.kind))continue;
      const body=JSON.parse(message.content);
      if(handled.has(message.id)){
        if(handled.get(message.id)==='waiting'&&body.status!=='pending'){
          onIntervention({message_id:message.id,decision:body.status,source:'external-ui',note:body.note??null});handled.set(message.id,'resolved');
        }
        continue;
      }
      if(body.status!=='pending')continue;
      handled.set(message.id,'pending');
      const choice=await decide({id:message.id,task_id:taskId,kind:message.kind,body});
      if(choice?.wait_for_user){handled.set(message.id,'waiting');onIntervention({message_id:message.id,decision:'waiting',source:'external-ui'});continue;}
      if(!choice){
        await page.evaluate(id=>window.__ZEUS_BRIDGE__.cancelTaskRun(id),taskId).catch(()=>{});
        throw Object.assign(new Error('INTERVENTION_REQUIRED: no declared decision for pending approval/choice/handoff'),{code:'RUN_CANCELLED'});
      }
      if(message.kind!=='approval') throw infrastructure('This driver has no declared choice/handoff script');
      if(typeof choice.approved!=='boolean')throw infrastructure('Invalid controller approval decision');
      await page.evaluate(({taskId,id,choice})=>window.__ZEUS_BRIDGE__.resolvePendingApprovals(taskId,choice.approved,id,choice.note??null),
        {taskId,id:message.id,choice});
      onIntervention({message_id:message.id,decision:choice.approved?'approved':'denied',source:choice.source??'declared-user-script',note:choice.note??null});
    }
    if(!complete)await pause(75);
  }
  const final=await result;
  if(final.error)throw Object.assign(new Error(final.error),{code:final.error.includes('RUN_CANCELLED')?'RUN_CANCELLED':'AGENT_RUN_FAILED'});
  return final.result;
}

export function missionConfiguration({architecture='solo',models={},executionProfile='reference-offline',
  supervisionPolicy='external-review',evaluationLimits,timeoutMs=60000}={}) {
  return resolveBenchmarkConfig({suite:{architecture,master_model:models.master??'phase1-mock',
    worker_model:models.worker??models.master??'None',verifier_model:models.verifier??models.master??'None',watcher_model:'None',
    worker_effort:models.workerEffort??models.effort??'default',verifier_effort:models.verifierEffort??models.effort??'default',
    worker_protocol:models.workerProtocol??models.masterProtocol??'auto',verifier_protocol:models.verifierProtocol??models.masterProtocol??'auto',
    worker_image_input:models.masterImageInput??'unknown',verifier_image_input:models.masterImageInput??'unknown',
    vision_model:models.vision??'None',vision_image_input:models.visionImageInput??'unknown',master_image_input:models.masterImageInput??'unknown',
    master_protocol:models.masterProtocol??'auto',vision_protocol:models.visionProtocol??'auto',vision_effort:models.visionEffort??'default',
    image_delivery:models.delivery??'auto',master_effort:models.effort??'default',supervision_policy:supervisionPolicy,browser_service:models.browserService??'managed-v1',budget_credits:1000000,
    permission_policy:'normal-approvals-fixture-v1',execution_profile:executionProfile,evaluation_limits:evaluationLimits,
    prompt_timeout_ms:timeoutMs,turn_timeout_ms:timeoutMs}});
}

export async function runMissionTrial({id, page, appWorkspace, output, experimentId, build, models={},architecture='solo',
  evaluationKind='scripted_runtime', executionProfile='reference-offline', scriptedFiles={},
  beforeSend=async()=>{}, decide, stopActor=async()=>{}, portal=null, browserObservation=null, timeoutMs=60000,
  evaluationLimits=null,expectedProviderOrigin=null,supervisionPolicy='external-review',afterExecute=async()=>{},
  runWorkflow=null,collectionTimeoutMs=10000}) {
  const {task,dir}=mission(id), trial=crypto.randomUUID(), interventions=[];
  if(!evaluationLimits)throw new Error('Mission trials require an explicit evaluation-limit manifest');
  if(!['scripted_runtime','capability'].includes(evaluationKind))throw new Error('Invalid evaluation kind');
  if(evaluationKind==='capability'&&executionProfile!=='native-supervised')throw new Error('This driver currently supports native supervised diagnostics only');
  if(evaluationKind!=='scripted_runtime'&&Object.keys(scriptedFiles).length)throw new Error('Reference execution trust cannot be attached to a live trial');
  const configuration=missionConfiguration({architecture,models,executionProfile,supervisionPolicy,evaluationLimits,timeoutMs});
  const artifactsDir=path.join(output,'artifacts',trial);
  let outcome=null,runId=null,usage=null,limits=null,messages=[],stopped=false,workflowEvidence={},workflowWall=null;
  const runSnapshots=[];
  const processLogs=new Map();
  const row=await runTrial({suiteTitle:'Zeus mission diagnostics',suiteDir:dir,promptSpec:{...task,name:task.name},timeoutMs,collectionTimeoutMs,
    runMeta:{trial_id:trial,experiment_id:experimentId,build,configuration,configuration_fingerprint:configuration.configuration_fingerprint,
      model_set:Object.fromEntries(Object.entries(configuration.roles).map(([role,value])=>[role,value.model])),architecture,suite_id:'zeus-missions-v1',suite_version:'1.0.0',
      evaluation_kind:evaluationKind,execution_profile:executionProfile},
    setup:async context=>{
      context.task=await page.evaluate(name=>window.__ZEUS_BRIDGE__.createTask(name),`Mission ${id}`);
      const tid=context.task.id, settings=taskSettings(configuration);
      await page.evaluate(({tid,settings})=>window.__ZEUS_BRIDGE__.updateTaskSettings(tid,settings),{tid,settings});
      const actual=await page.evaluate(async tid=>(await window.__ZEUS_BRIDGE__.listTasks()).find(t=>t.id===tid),tid);
      assertEffectiveSettings(settings,actual);
      const browserService=await page.evaluate(()=>window.__ZEUS_BRIDGE__.getManagedBrowserStatus());
      if(browserService.enabled!==(configuration.browser_service==='managed-v1'))throw infrastructure('Actual browser service does not match the declared configuration');
      const active=await page.evaluate(tid=>window.__ZEUS_BRIDGE__.getTaskSpend(tid),tid);
      if(fingerprint(active.evaluation?.limits)!==fingerprint(evaluationLimits))throw infrastructure('Active evaluation limits do not match the manifest');
      await page.evaluate(async()=>{await window.__ZEUS_REFRESH_TASKS__?.();});
      await page.locator('.sidebar-task').filter({has:page.locator(`.sidebar-task-title[title="Mission ${id}"]`)}).click();
      context.workspace=path.join(appWorkspace,'tasks',tid,'workspace');
      context.manifest=deployMission(id,context.workspace);
      let prompt=task.prompt;context.attachments=[];
      if(portal)prompt+=`\n${id==='B01'?'Ticket':'Task'} portal URL: ${portal.url}`;
      if(id==='V01'){
        for(const name of fs.readdirSync(path.join(dir,'inputs'))){
          const base64=fs.readFileSync(safeFile(context.workspace,name)).toString('base64');
          const saved=await page.evaluate(({tid,name,base64})=>window.__ZEUS_BRIDGE__.saveTaskAttachment(tid,name,base64),{tid,name,base64});
          context.attachments.push(saved);
        }
      }
      context.prompt=prompt;
      fs.mkdirSync(artifactsDir,{recursive:true});
      atomicWrite(path.join(artifactsDir,'deployment.json'),JSON.stringify(context.manifest,null,2));
      await beforeSend(context);
    },
    execute:async context=>{
      const started=Date.now();
      const send=async(prompt,attachmentIds=[])=>{
        const result=await sendWithApprovals(page,context.task.id,prompt,{signal:context.signal,decide,attachmentIds,onIntervention:value=>interventions.push(value)});
        const run=await page.evaluate(id=>window.__ZEUS_BRIDGE__.getTaskRunState(id),context.task.id);
        if(run&&!runSnapshots.some(value=>value.id===run.id))runSnapshots.push(run);
        // Keep the latest process-local snapshot before a controlled restart
        // loses its ring buffer. Repeated user turns must not double-count it.
        processLogs.set(page,await page.evaluate(id=>window.__ZEUS_BRIDGE__.getDebugLog(id),context.task.id));
        if(run?.status!=='completed')throw new Error(`Agent turn ended with ${run?.status??'unknown'}`);
        return result;
      };
      if(runWorkflow){
        workflowEvidence=await runWorkflow({...context,send,getPage:()=>page,replaceActor:fresh=>{
          if(context.signal.aborted)throw context.signal.reason;
          if(!fresh?.page||!fresh?.workspace||fs.realpathSync(fresh.workspace)!==fs.realpathSync(appWorkspace))throw infrastructure('A workflow restart must retain its exact owned workspace');
          page=fresh.page;
        },recordIntervention:value=>interventions.push(value)})??{};
      }else{
        await send(context.prompt,context.attachments.map(file=>file.id));
        await afterExecute({...context,recordIntervention:value=>interventions.push(value)});
      }
      workflowWall=(Date.now()-started)/1000;
      const state=await page.evaluate(id=>window.__ZEUS_BRIDGE__.getTaskRunState(id),context.task.id);
      runId=state?.id??null;
      if(state?.status!=='completed')throw new Error(`Agent run ended with ${state?.status??'unknown'}`);
    },
    collect:async context=>{
      if(!context.task)return {};
      const tid=context.task.id;
      messages=await page.evaluate(id=>window.__ZEUS_BRIDGE__.getTaskDebugMessages(id),tid);
      const spend=await page.evaluate(id=>window.__ZEUS_BRIDGE__.getTaskSpend(id),tid);
      const state=await page.evaluate(id=>window.__ZEUS_BRIDGE__.getTaskRunState(id),tid);
      usage=spend.usage;limits=spend.evaluation;runId=state?.id??runId;
      for(const intervention of [...interventions])if(intervention.decision==='waiting'){
        const stored=messages.find(message=>message.id===intervention.message_id),body=stored?JSON.parse(stored.content):null;
        if(body&&body.status!=='pending'&&!interventions.some(value=>value.message_id===intervention.message_id&&value.decision===body.status))
          interventions.push({message_id:intervention.message_id,decision:body.status,source:'external-ui',note:body.note??null});
      }
      const durations=runSnapshots.map(agentDuration);
      const measurements={agent_duration_seconds:durations.length&&durations.every(value=>value!==null)?durations.reduce((a,b)=>a+b,0):agentDuration(state),browser:null};
      if(runWorkflow){measurements.workflow_wall_seconds=workflowWall;measurements.root_runs=runSnapshots.length;}
      context.observation={unitsUsed:usage?.unknown_requests===0?spend.spent_credits:null,messageCount:messages.length,
        runMeta:{task_id:tid,run_id:runId,usage,evaluation_limits:limits,interventions,measurements}};
      const browserEvidence=typeof browserObservation==='function'?await browserObservation():browserObservation;
      const browserSessions=await page.evaluate(id=>window.__ZEUS_BRIDGE__.getManagedBrowserSessions(id),tid);
      if(browserSessions.length){
        const browserActions=[];let truncated=false,images=0;
        const recordings=[];
        for(const session of browserSessions){
          let after=0;
          while(browserActions.length<1000){
            const batch=await page.evaluate(({task,session,after})=>window.__ZEUS_BRIDGE__.getManagedBrowserActions(task,session,after),{task:tid,session:session.session_id,after});
            browserActions.push(...batch);if(batch.length<100)break;after=batch.at(-1).seq;
          }
          if(browserActions.length>=1000)truncated=true;
          // Export through the production terminal reader before stopping the
          // desktop. Never follow artifact paths supplied by the model.
          try{
            const exported=await page.evaluate(({task,session})=>window.__ZEUS_BRIDGE__.exportBrowserRecording(task,session),{task:tid,session:session.session_id});
            const relative=path.relative(appWorkspace,exported.path);
            const manifestFile=safeFile(appWorkspace,path.join(relative,'recording.json'),4*1024*1024);
            const bytes=fs.readFileSync(manifestFile),recording=JSON.parse(bytes);
            if(recording.snapshot?.session?.session_id!==session.session_id||recording.snapshot?.session?.task_id!==tid)throw new Error('Recording export identity mismatch');
            const destination=path.join(artifactsDir,`recording-${session.session_id}`);fs.mkdirSync(destination,{recursive:true});
            const retain=(name,limit,expectedHash)=>{
              if(path.basename(name)!==name)throw new Error('Invalid recording export filename');
              const data=fs.readFileSync(safeFile(appWorkspace,path.join(relative,name),limit));
              const sha256=hashBytes(data);if(expectedHash&&sha256!==expectedHash)throw new Error('Recording export hash mismatch');
              const target=path.join(destination,name);fs.writeFileSync(target,data,{flag:'wx'});
              context.artifacts.push({path:path.relative(output,target),sha256});
            };
            retain('recording.json',4*1024*1024);retain('actions.jsonl',32*1024*1024);
            if(recording.frames.length>200)throw new Error('Diagnostic recording image export bound exceeded');
            for(const frame of recording.frames.filter(frame=>frame.status==='available'))retain(frame.file,2*1024*1024,frame.metadata.sha256);
            recordings.push({session_id:session.session_id,path:path.relative(output,destination),status:'retained'});
          }catch(error){recordings.push({session_id:session.session_id,status:'unavailable',error:String(error.message)});}
        }
        for(const action of browserActions){
          const artifact=action.response?JSON.parse(action.response).result?.artifact:null;
          if(!artifact)continue;
          if(images>=10){artifact.export_status='image export limit';continue;}
          try{
            const relative=path.relative(context.workspace,artifact.path);
            const source=safeFile(context.workspace,relative,2*1024*1024),bytes=fs.readFileSync(source);
            if(hashBytes(bytes)!==artifact.sha256)throw new Error('changed screenshot bytes');
            const name=`browser-${artifact.id}.jpg`,destination=path.join(artifactsDir,name);fs.writeFileSync(destination,bytes);images++;
            context.artifacts.push({path:path.relative(output,destination),sha256:artifact.sha256});
          }catch(error){action.artifact_export_error=String(error.message);}
        }
        measurements.browser=browserMeasurements(browserActions,truncated);
        const destination=path.join(artifactsDir,'browser-journal.json');
        atomicWrite(destination,JSON.stringify({sessions:browserSessions,actions:browserActions,recordings,coverage:{truncated,max_actions:1000,max_images:10,images,max_recording_images:200}},null,2));
        context.artifacts.push({path:path.relative(output,destination),sha256:hashBytes(fs.readFileSync(destination))});
      }
      atomicWrite(path.join(artifactsDir,'messages.json'),JSON.stringify(messages,null,2));
      const debug=await page.evaluate(id=>window.__ZEUS_BRIDGE__.getDebugLog(id),tid);
      processLogs.set(page,debug);
      measurements.context=contextMeasurements([...processLogs.values()],messages);
      for(const [index,log] of [...processLogs.values()].entries()){
        const name='process-'+index+'-debug.log',file=path.join(artifactsDir,name);
        atomicWrite(file,String(log).slice(-2_000_000));
        context.artifacts.push({path:path.relative(output,file),sha256:hashBytes(fs.readFileSync(file))});
      }
      atomicWrite(path.join(artifactsDir,'debug.log'),String(debug).slice(-2_000_000));
      await page.screenshot({path:path.join(artifactsDir,'desktop.png')});
      for(const file of ['deployment.json','messages.json','debug.log','desktop.png']){
        const full=path.join(artifactsDir,file);context.artifacts.push({path:path.relative(output,full),sha256:hashBytes(fs.readFileSync(full))});
      }
      // Stop owned actor processes before exporting/grading their outputs.
      await stopActor();stopped=true;
      const exported=path.join(artifactsDir,'submission');
      const files=exportMission(id,context.workspace,exported);
      atomicWrite(path.join(artifactsDir,'export.json'),JSON.stringify(files,null,2));
      const executable=['C01','C02','C03','D02'].includes(id);
      let trustedExecution=false;
      if(executable&&evaluationKind==='scripted_runtime'){
        const artifact=task.artifacts[0],file=files.find(f=>f.name===artifact);
        trustedExecution=file?.status==='retained'&&scriptedFiles[artifact]===file.sha256;
      }
      if(executable&&!trustedExecution){
        outcome={mission_id:id,outcome_status:'not_evaluated',criteria:[{id:'isolated_grading',status:'not_evaluated',evidence:'No isolated executor or exact known-control hash; exported code was not executed'}]};
      }else outcome=await gradeMission(id,exported,{trustedExecution,portal,browserObservation:browserEvidence,
        memoryEvidence:workflowEvidence.memoryEvidence,restartEvidence:workflowEvidence.restartEvidence,screenshotDirectory:id==='C03'?path.join(artifactsDir,'rendered-app'):null});
      if(runWorkflow){
        atomicWrite(path.join(artifactsDir,'workflow.json'),JSON.stringify({runs:runSnapshots,evidence:workflowEvidence},null,2));
        context.artifacts.push({path:path.relative(output,path.join(artifactsDir,'workflow.json')),sha256:hashBytes(fs.readFileSync(path.join(artifactsDir,'workflow.json')))});
      }
      atomicWrite(path.join(artifactsDir,'assessment.json'),JSON.stringify(outcome,null,2));
      for(const file of ['export.json','assessment.json']){
        const full=path.join(artifactsDir,file);context.artifacts.push({path:path.relative(output,full),sha256:hashBytes(fs.readFileSync(full))});
      }
      context.observation.runMeta.mission_assessment=outcome;
      if(expectedProviderOrigin&&Object.keys(usage.requests_by_provider).some(origin=>origin!==expectedProviderOrigin))
        throw infrastructure('Observed provider origin does not match the declared live provider');
      if(outcome.error)throw infrastructure(`Mission grader error: ${outcome.error.message}`);
      context.checks.push(...outcome.criteria.map(c=>({...c,passed:c.status==='passed'?true:c.status==='failed'?false:null})));
      return {unitsUsed:usage?.unknown_requests===0?spend.spent_credits:null,messageCount:messages.length,
        modelsUsed:[...new Set(messages.map(m=>m.model).filter(Boolean))],
        runMeta:{task_id:tid,run_id:runId,fixture_hash:context.manifest.fixture_hash,mission_assessment:outcome,
          model_set:{...Object.fromEntries(Object.entries(configuration.roles).map(([role,value])=>[role,value.model])),models_used:[...new Set(messages.map(m=>m.model).filter(Boolean))]},
          evaluation_limits:limits,usage,interventions,measurements,authorization_coverage:{scope:'fixture-observations',status:'partial',unobserved:['arbitrary_native_effects']}}};
    },
    cleanup:async()=>{if(!stopped)await stopActor();},persist:record=>appendScore(output,record),
  });
  return {row,outcome,messages,interventions,limits};
}
