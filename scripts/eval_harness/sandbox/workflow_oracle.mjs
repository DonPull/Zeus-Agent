/** Host-private fixture/control state and data-only workflow grading. */
import fs from 'node:fs';
import path from 'node:path';
import {verifyGradingResult} from './grading_auth.mjs';
import {missionDigest} from './mission_contract.mjs';
import {retainActorArtifacts} from './actor_artifacts.mjs';
import {gradeMission} from '../../../tests/benchmarks/mission_graders/outcomes.js';
import {observeManagedTicketUpdate} from '../../../tests/benchmarks/mission_graders/ticket_portal.js';
import {observeManagedCore,joinCoreObservations} from '../../../tests/benchmarks/mission_graders/core_portals.js';
import {captureContinuity,captureRestart} from '../../../tests/benchmarks/mission_graders/core_evidence.js';
import {remainingAllowance} from '../../../tests/benchmarks/workflow_limits.js';
const guestOrigin='http://127.0.0.1:19222',workspace='C:\\Zeus\\CandidateScratch\\App';
function proof(value){return value&&Number.isSafeInteger(value.pid)&&value.pid>0&&typeof value.started_utc==='string'&&Number.isFinite(Date.parse(value.started_utc));}
function rebase(url,origin){try{const value=new URL(url);return value.origin===guestOrigin?origin+value.pathname+value.search:url;}catch{return url;}}
export function rebaseBrowserCapture(capture,origin){
  const value=structuredClone(capture);
  if(value?.result){value.result.url=rebase(value.result.url,origin);for(const event of value.result.network_events??[])event.url=rebase(event.url,origin);}
  return value;
}
export function createWorkflowOracle({mission,fixture,identity,privateDirectory,limits}){
  if(!['B01','B02','B03','M01','M02'].includes(mission))throw Error('Unknown workflow oracle');
  const ledger={schema_version:1,kind:'host-workflow-ledger-v1',...identity,mission,status:'ready',requests:[]};
  const file=path.join(privateDirectory,'workflow-ledger.json');if(fs.existsSync(file))throw Error('Workflow state already exists');
  let taskId=null,beforeRestart=null,restarted=null;
  const save=()=>{const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(ledger,null,2));fs.renameSync(tmp,file);};save();
  return {snapshot:()=>structuredClone(ledger),
    async handle(request,pinned){
      const body=verifyGradingResult(JSON.parse(request.body),pinned,identity);
      const fields=request.path==='/correction'?['task_id']:request.path==='/restart-checkpoint'?['task_id','old_process','workspace','run_id']:['task_id','old_process','new_process','workspace','old_process_gone','spent','elapsed_ms','remaining_limits'];
      if(Object.keys(body).sort().join(',')!==fields.sort().join(',')||!(/^[a-f0-9-]{36}$/i.test(body.task_id??''))||taskId&&body.task_id!==taskId||ledger.requests.some(row=>row.path===request.path))throw Error('Invalid/repeated signed workflow request');
      if(!(mission==='B03'&&request.path==='/correction'||mission==='M02'&&['/restart-checkpoint','/restart-complete'].includes(request.path)))throw Error('Workflow request outside its mission');
      taskId=body.task_id;const row={id:request.id,path:request.path,body_sha256:missionDigest(request.body),status:'reserved_unknown'};ledger.requests.push(row);save();
      let response={ok:true},status=200;
      if(request.path==='/correction'){
        fixture.markCorrection('declared-user-turn:'+taskId);response.checkpoint=fixture.portal.snapshot().correction;
      }else if(request.path==='/restart-checkpoint'){
        if(!proof(body.old_process)||body.workspace!==workspace||!(/^[a-f0-9-]{36}$/i.test(body.run_id??'')))throw Error('Invalid old process/workspace');
        const state=fixture.portal.snapshot();
        if(state.audit.length!==1||!state.checkpoint||state.records.find(row=>row.id==='SYN-17')?.status!=='Open'){status=409;response={error:'Confirmed first-phase checkpoint was not reached'};}
        else {beforeRestart={state,process:body.old_process,workspace:body.workspace};response.checkpoint=state.checkpoint;}
      }else{
        if(!beforeRestart||!proof(body.new_process)||body.new_process.pid===beforeRestart.process.pid||JSON.stringify(body.old_process)!==JSON.stringify(beforeRestart.process)||body.workspace!==workspace||body.old_process_gone!==true)throw Error('Invalid restart proof');
        if(JSON.stringify(body.remaining_limits)!==JSON.stringify(remainingAllowance(limits,body.spent,body.elapsed_ms)))throw Error('Restart changed aggregate allowance');
        restarted=captureRestart({oldProcess:beforeRestart.process.pid,newProcess:body.new_process.pid,oldWorkspace:beforeRestart.workspace,newWorkspace:body.workspace,checkpoint:beforeRestart.state.checkpoint,beforeRestart:beforeRestart.state});
        ledger.restart={old_process:body.old_process,new_process:body.new_process,old_process_gone:true,remaining_limits:body.remaining_limits,phase_usage:body.spent.usage,elapsed_ms:body.elapsed_ms};
      }
      const bytes=Buffer.from(JSON.stringify(response));Object.assign(row,{status:'completed',http_status:status,response_sha256:missionDigest(bytes)});save();
      return {status,content_type:'application/json',body:bytes};
    },
    async grade({trace,artifactBytes,names}){
      if(taskId&&trace.observed.run?.task_id!==taskId)throw Error('Workflow result task differs from controller checkpoint');
      const retained=retainActorArtifacts(artifactBytes,identity,names,path.join(privateDirectory,'workflow-submission'));
      let browserObservation=null,memoryEvidence=null;
      if(fixture){
        const portal=fixture.portal,parts=[];
        for(const phase of trace.workflow?.browser??[]){
          const snapshots=[...phase.snapshots,...phase.actions.map(row=>{try{return JSON.parse(row.response);}catch{return null;}})].filter(Boolean);
          const transfers=phase.transfers.map(row=>({...row,metadata:row.metadata?{...row.metadata,source:rebase(row.metadata.source,portal.url)}:null}));
          for(const snapshot of snapshots){
            const raw=rebaseBrowserCapture(snapshot,portal.url),capture=mission==='B01'?observeManagedTicketUpdate(portal,raw):observeManagedCore(portal,raw,transfers);
            if(capture){if(mission==='B01')browserObservation=capture;else parts.push(capture);}
          }
          if(mission==='B02'){const capture=observeManagedCore(portal,null,transfers);if(capture)parts.push(capture);}
        }
        if(mission!=='B01'&&parts.length)browserObservation=joinCoreObservations(portal,...parts);
      }
      if(mission==='M01'&&trace.workflow?.history)memoryEvidence=captureContinuity(trace.workflow.history.before,trace.workflow.history.after);
      const assessment=await gradeMission(mission,retained.directory,{portal:fixture?.portal,browserObservation,memoryEvidence,restartEvidence:restarted});
      if(assessment.error)throw Error('Workflow grader failed: '+assessment.error.message);
      ledger.status='complete';ledger.evidence={browser_observed:!!browserObservation,compaction:memoryEvidence??null,restart:restarted??null};save();return assessment;
    }
  };
}
