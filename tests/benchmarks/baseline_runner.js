/** Durable sequential scheduling. The injected executor is the existing real driver. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {mission} from './mission_kit.js';
import {atomicWrite,appendScore,loadScores,buildScoreRecord} from './score_recorder.js';
import {assertPlan,assertTrial,configurationFor,summarizeBaseline} from './baseline_plan.js';

export const isAlive = pid => {if(!Number.isInteger(pid)||pid<=0)return false;try{process.kill(pid,0);return true;}catch(error){return error.code!=='ESRCH';}};
export function readStudyRecords(plan,directory) {
  const records={};
  for(const attempt of plan.attempts){
    const rows=loadScores(path.join(directory,'attempts',attempt.id)).runs;
    if(rows.length>1)throw Error(`Expected one immutable trial, found ${rows.length}: ${attempt.id}`);
    if(rows.length){
      assertTrial(plan,attempt,rows[0]);let row=rows[0];
      const assessment=path.join(directory,'attempts',attempt.id,'controller-assessment.json');
      if(fs.existsSync(assessment))row={...row,execution_status:'infrastructure_error',passed:false,outcome_passed:false,controller_assessment:JSON.parse(fs.readFileSync(assessment,'utf8'))};
      records[attempt.id]=row;
    }
  }
  return records;
}

export function writeStudyReport(plan,directory) {
  const summary=summarizeBaseline(plan,readStudyRecords(plan,directory));
  atomicWrite(path.join(directory,'summary.json'),JSON.stringify(summary,null,2));
  const show=value=>value==null?'unknown':typeof value==='number'?String(Math.round(value*1000)/1000):String(value);
  const rows=Object.entries(summary.cells).map(([key,c])=>`| ${key} | ${c.successful_outcomes}/${c.scheduled} | ${c.verified_passes} | ${c.known_requests} | ${c.known_tokens}${c.usage_complete?'':' (incomplete)'} | ${show(c.tokens_per_successful_outcome)} | ${show(c.median_agent_seconds)} |`);
  atomicWrite(path.join(directory,'summary.md'),`# Native development measurement\n\nBuild: ${plan.build.source_commit}. Recorded ${summary.recorded}/${summary.scheduled} attempts.\n\nOutcome success is distinct from verified authorization. Tokens are not provider credits.\n\n| Cell | Successful outcomes | Verified passes | Known requests | Known tokens | Tokens / successful outcome | Median agent seconds |\n|---|---:|---:|---:|---:|---:|---:|\n${rows.join('\n')}\n\n${summary.limitations.map(s=>'- '+s).join('\n')}\n\nAll failures and interrupted attempts remain in the denominator. See summary.json for usage coverage, role requests and browser timings.\n`);
  return summary;
}

export async function runStudy({plan,directory,currentBuild,resume=false,execute,alive=isAlive,signal}) {
  assertPlan(plan,currentBuild);
  if(!resume){fs.mkdirSync(path.dirname(directory),{recursive:true});fs.mkdirSync(directory);fs.writeFileSync(path.join(directory,'plan.json'),JSON.stringify(plan,null,2),{flag:'wx'});}
  else if(!fs.existsSync(path.join(directory,'plan.json')))throw Error('No frozen study to resume');
  const lockPath=path.join(directory,'lock.json'),token=crypto.randomUUID();
  if(fs.existsSync(lockPath)){
    const previous=JSON.parse(fs.readFileSync(lockPath,'utf8'));
    if(alive(previous.pid))throw Error('Study controller is still running; refusing duplicate dispatch');
    fs.unlinkSync(lockPath);
  }
  fs.writeFileSync(lockPath,JSON.stringify({pid:process.pid,token}),{flag:'wx'});
  try{
    const statePath=path.join(directory,'state.json');
    const state=fs.existsSync(statePath)?JSON.parse(fs.readFileSync(statePath,'utf8')):{plan_id:plan.plan_id,attempts:{}};
    if(state.plan_id!==plan.plan_id)throw Error('Study progress belongs to another plan');
    const save=()=>atomicWrite(statePath,JSON.stringify(state,null,2));
    const missing=(attempt,status,message)=>{
      const configuration=configurationFor(plan.contract,attempt.mission,attempt.architecture);
      appendScore(path.join(directory,'attempts',attempt.id),buildScoreRecord({suiteTitle:'Native development checkpoint',suiteDir:'zeus-missions-v1',promptSpec:mission(attempt.mission).task,
        runMeta:{trial_id:`${attempt.id}-${status}`,experiment_id:plan.plan_id,build:plan.build,architecture:attempt.architecture,configuration,
          configuration_fingerprint:configuration.configuration_fingerprint,evaluation_kind:'capability',execution_profile:'native-supervised',
          execution_status:status,error:{name:status,message},usage:null}}));
    };
    for(const attempt of plan.attempts){
      let records=readStudyRecords(plan,directory),previous=state.attempts[attempt.id];
      // Even a child that finished before its parent died is not run again.
      if(records[attempt.id]){state.attempts[attempt.id]={...previous,status:'recorded'};save();continue;}
      if(previous){
        if(previous.status==='running'&&alive(previous.child_pid))throw Error(`Owned attempt still running: ${attempt.id}`);
        missing(attempt,previous.status==='running'?'interrupted':'infrastructure_error','An earlier dispatch produced no immutable result; no automatic retry. Usage may be unknown.');
        state.attempts[attempt.id]={...previous,status:'recorded'};save();writeStudyReport(plan,directory);continue;
      }
      if(signal?.aborted)break;
      state.attempts[attempt.id]={status:'running',started_at:new Date().toISOString(),child_pid:null};save();
      let result,error;
      try{result=await execute(attempt,path.join(directory,'attempts',attempt.id),pid=>{state.attempts[attempt.id].child_pid=pid;save();});}
      catch(reason){error=reason;}
      records=readStudyRecords(plan,directory);
      if(!records[attempt.id])missing(attempt,signal?.aborted?'interrupted':'infrastructure_error',String(error?.message??'Child exited without an immutable trial'));
      else{
        const row=records[attempt.id],expected=row.passed?0:row.outcome_passed?2:1;
        if(error||result?.code!==expected)atomicWrite(path.join(directory,'attempts',attempt.id,'controller-assessment.json'),JSON.stringify({
          error:String(error?.message??'Child exit status contradicts its recorded verdict'),expected_exit_code:expected,observed_exit_code:result?.code??null,
          original_trial_id:row.trial_id,note:'Raw trial preserved; controller failure prevents an execution-success claim.'},null,2));
      }
      state.attempts[attempt.id]={...state.attempts[attempt.id],status:'recorded',child_exit_code:result?.code??null,ended_at:new Date().toISOString()};save();
      writeStudyReport(plan,directory);
      if(signal?.aborted||error?.code==='FROZEN_PLAN_CHANGED')break;
    }
    return writeStudyReport(plan,directory);
  }finally{if(JSON.parse(fs.readFileSync(lockPath,'utf8')).token===token)fs.unlinkSync(lockPath);}
}
