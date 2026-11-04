/** Frozen native development studies; no provider or GUI side effects. */
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import {mission,treeHash} from './mission_kit.js';
import {fingerprint} from './benchmark_config.js';
import {missionConfiguration} from './mission_runtime.js';

export const limitsFor = id => ({max_requests:id==='B01'?16:id==='V01'?8:10,max_tokens:1000000,
  max_in_flight:1,max_output_tokens:8192,max_directives:24,wall_time_ms:300000});
export const modelsFor = (contract,id) => ({master:contract.model,vision:'None',delivery:'auto',effort:contract.effort,
  visionEffort:contract.effort,masterProtocol:contract.protocol,visionProtocol:contract.protocol,
  masterImageInput:['B01','V01'].includes(id)?'supported':'unknown',visionImageInput:'unknown',browserService:'managed-v1'});
export function configurationFor(contract,id,architecture) {
  return missionConfiguration({architecture,models:modelsFor(contract,id),executionProfile:'native-supervised',
    supervisionPolicy:'external-synthetic-supervisor-v1',evaluationLimits:limitsFor(id),timeoutMs:300000});
}

export function createBaselinePlan({build,model='gpt-6.1-terra',effort='low',protocol='chat',
  ids=['D01','B01','V01'],repetitions=1}={}) {
  if(!build?.source_commit||typeof build.dirty!=='boolean')throw Error('A recorded source build is required');
  if(typeof model!=='string'||!model.trim()||model!==model.trim()||['route-llm','None'].includes(model))throw Error('Select an exact explicit model');
  if(!['low','medium','high'].includes(effort)||protocol!=='chat')throw Error('This matched study requires explicit Chat and low/medium/high effort');
  if(!Number.isInteger(repetitions)||repetitions<1||repetitions>3)throw Error('Repetitions must be 1..3');
  if(!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!['D01','B01','V01'].includes(id)))throw Error('Select unique nonexecutable D01/B01/V01 missions');
  const service=fs.readFileSync(new URL('../../src-tauri/browser_service/service.py',import.meta.url),'utf8');
  const sdk=service.match(/^SDK_VERSION = ["']([^"']+)/m)?.[1];
  if(!sdk)throw Error('Cannot freeze the required browser SDK');
  const contract={schema_version:1,suite_id:'zeus-native-checkpoint-v1',model,effort,protocol,repetitions,
    environment:{platform:process.platform,os_release:os.release(),architecture:process.arch,node:process.version,browser_sdk:sdk},
    execution_profile:'native-supervised',permission_policy:'normal-approvals-fixture-v1',
    supervision_policy:'external-synthetic-supervisor-v1',browser:{window_mode:'headless',block_ads:true,agent_audio:false},
    missions:ids.map(id=>{const {dir,task}=mission(id);return {id,task_hash:fingerprint(task),fixture_hash:treeHash(path.join(dir,'inputs')),
      grader_hash:treeHash(path.resolve(dir,'../../../mission_graders')),limits:limitsFor(id)};})};
  const attempts=[];
  for(let repetition=1;repetition<=repetitions;repetition++)for(const id of ids)
    for(const architecture of repetition%2?['solo','team']:['team','solo']){
      const configuration=configurationFor(contract,id,architecture);
      attempts.push({id:`${id.toLowerCase()}-${architecture}-${repetition}`,mission:id,architecture,repetition,
        configuration_fingerprint:configuration.configuration_fingerprint});
    }
  const identity={contract,build};
  return {schema_version:1,plan_id:fingerprint(identity),contract_fingerprint:fingerprint(contract),...identity,attempts,
    envelope:{attempts:attempts.length,max_requests:attempts.reduce((sum,item)=>sum+limitsFor(item.mission).max_requests,0),
      retries:0,provider_credit_ceiling:null},
    limitations:['Native host permissions, not isolated grading or authorization certification.',
      'Three development missions, not the complete Zeus Benchmark v1.',
      'Token units are not subscription credits. Unknown usage is not zero.']};
}

export function assertPlan(plan,currentBuild) {
  const c=plan.contract;
  const current=createBaselinePlan({build:currentBuild,model:c.model,effort:c.effort,protocol:c.protocol,
    ids:c.missions.map(item=>item.id),repetitions:c.repetitions});
  if(fingerprint(current)!==fingerprint(plan))throw Error('Frozen plan/source/fixtures/graders changed; start a separate study');
}

export function assertTrial(plan,attempt,row) {
  // The diagnostic adds an informational runtime label to its source identity.
  // Compare the source fields while preserving that label in the raw record.
  const {runtime,...source}=row.build??{};
  if(row.prompt_id!==attempt.mission||row.architecture!==attempt.architecture||
    row.configuration_fingerprint!==attempt.configuration_fingerprint||fingerprint(source)!==fingerprint(plan.build)||
    row.execution_profile!=='native-supervised'||row.evaluation_kind!=='capability')throw Error(`Trial identity/configuration mismatch: ${attempt.id}`);
}

const finite=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
const median=values=>{const sorted=values.filter(finite).sort((a,b)=>a-b);const i=Math.floor(sorted.length/2);return !sorted.length?null:sorted.length%2?sorted[i]:(sorted[i-1]+sorted[i])/2;};
export function summarizeBaseline(plan,records) {
  const cells={};
  for(const attempt of plan.attempts){
    const key=`${attempt.mission}/${attempt.architecture}`;
    const cell=cells[key]??={scheduled:0,recorded:0,successful_outcomes:0,verified_passes:0,statuses:{},known_requests:0,
      known_tokens:0,complete_usage_records:0,requests_by_role:{},agent_seconds:[],browser_actions:0,browser_timed_actions:0,browser_service_ms:0};
    cell.scheduled++;const row=records[attempt.id];if(!row)continue;assertTrial(plan,attempt,row);
    cell.recorded++;cell.successful_outcomes+=Number(row.outcome_passed===true);cell.verified_passes+=Number(row.passed===true);
    const status=row.execution_status??'unknown';cell.statuses[status]=(cell.statuses[status]??0)+1;
    const u=row.usage;
    if(finite(u?.requests))cell.known_requests+=u.requests;
    if(finite(u?.known_tokens))cell.known_tokens+=u.known_tokens;
    if(u?.unknown_requests===0&&finite(u?.known_tokens)&&finite(u?.requests))cell.complete_usage_records++;
    for(const [role,count] of Object.entries(u?.requests_by_role??{}))if(finite(count))cell.requests_by_role[role]=(cell.requests_by_role[role]??0)+count;
    if(finite(row.measurements?.agent_duration_seconds))cell.agent_seconds.push(row.measurements.agent_duration_seconds);
    const browser=row.measurements?.browser;
    if(browser){cell.browser_actions+=browser.actions;cell.browser_timed_actions+=browser.timed_actions;cell.browser_service_ms+=browser.service_ms;}
  }
  for(const cell of Object.values(cells)){
    cell.outcome_success_rate=cell.successful_outcomes/cell.scheduled;
    cell.median_agent_seconds=median(cell.agent_seconds);cell.agent_timing_records=cell.agent_seconds.length;delete cell.agent_seconds;
    cell.usage_complete=cell.complete_usage_records===cell.scheduled;
    cell.tokens_per_successful_outcome=cell.usage_complete&&cell.successful_outcomes?cell.known_tokens/cell.successful_outcomes:null;
    cell.provider_credits=null;
  }
  return {schema_version:1,plan_id:plan.plan_id,contract_fingerprint:plan.contract_fingerprint,build:plan.build,
    scheduled:plan.attempts.length,recorded:Object.keys(records).length,cells,limitations:plan.limitations};
}

export function compareBaselines(left,right) {
  if(left.contract_fingerprint!==right.contract_fingerprint)throw Error('Comparison requires identical tasks, fixtures, graders, models, limits and repetitions');
  if(left.recorded!==left.scheduled||right.recorded!==right.scheduled)throw Error('Both studies must retain every scheduled attempt before comparison');
  const cells={};
  for(const [key,a] of Object.entries(left.cells)){
    const b=right.cells[key];if(!b)throw Error('Missing comparison cell');
    const delta=field=>finite(a[field])&&finite(b[field])?b[field]-a[field]:null;
    cells[key]={outcome_success_rate_delta:delta('outcome_success_rate'),median_agent_seconds_delta:delta('median_agent_seconds'),
      tokens_per_successful_outcome_delta:delta('tokens_per_successful_outcome'),before:a,after:b};
  }
  return {before_build:left.build,after_build:right.build,cells,note:'Descriptive development comparison, not statistical proof. Negative latency/token deltas are reductions; inspect success and coverage first.'};
}
