/** Candidate core-v1 schedules. Read-only planning cannot enable paid dispatch. */
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import {mission,missionIds,treeHash} from './mission_kit.js';
import {missionConfiguration} from './mission_runtime.js';
import {fingerprint} from './benchmark_config.js';

const requestCaps={B01:16,B02:20,B03:28,C01:16,C02:24,C03:24,D01:10,D02:18,M01:24,M02:24,R01:16,V01:8};
export function coreLimits(id){
  if(!missionIds.includes(id))throw Error('Unknown core mission');
  return {max_requests:requestCaps[id],max_tokens:1000000,max_in_flight:1,max_output_tokens:8192,max_directives:48,wall_time_ms:600000};
}
export function coreConfiguration(id,architecture){
  return missionConfiguration({architecture,models:{master:'gpt-6.1-terra',effort:'low',masterProtocol:'chat',
    masterImageInput:['B01','B02','B03','C03','M02','V01'].includes(id)?'supported':'unknown',browserService:'managed-v1'},
    executionProfile:'windows-sandbox-v1',supervisionPolicy:'external-fixture-supervisor-v1',
    evaluationLimits:coreLimits(id),timeoutMs:600000});
}
export function createCorePlan({build,stage='pilot',ids=stage==='pilot'?['D01']:[...missionIds],
  architectures=stage==='pilot'?['solo']:['solo','team']}={}){
  if(!build?.source_commit||typeof build.dirty!=='boolean'||typeof build.diff_hash!=='string')throw Error('A complete source identity is required');
  if(!['pilot','repeated'].includes(stage))throw Error('Stage must be pilot or repeated');
  if(!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!missionIds.includes(id)))throw Error('Select unique core mission IDs');
  if(!architectures.length||new Set(architectures).size!==architectures.length||architectures.some(a=>!['solo','team'].includes(a)))throw Error('Select unique Solo/Team architectures');
  if(stage==='repeated'&&(fingerprint(ids)!==fingerprint([...missionIds])||fingerprint(architectures)!==fingerprint(['solo','team'])))throw Error('The repeated v1 schedule requires all twelve missions and both architectures');
  const repetitions=stage==='pilot'?1:3;
  const contract={schema_version:1,suite_id:'zeus-core-v1',stage,repetitions,
    models:{connection:'abacus',model:'gpt-6.1-terra',effort:'low',protocol:'chat',watcher:'None',vision_helper:'None'},
    execution_profile:'windows-sandbox-v1',authorization:'independently graded fixture channels; arbitrary native effects ungraded',
    environment:{platform:process.platform,host_os:os.release(),node:process.version,
      browser_sdk:fs.readFileSync(new URL('../../src-tauri/browser_service/service.py',import.meta.url),'utf8').match(/^SDK_VERSION = ["']([^"']+)/m)?.[1]??null,
      guest_runtime:null,boundary_validation:null},
    missions:ids.map(id=>{const {dir,task}=mission(id);return {id,version:task.version,task_hash:fingerprint(task),
      fixture_hash:treeHash(path.join(dir,'inputs')),authoring_hash:treeHash(dir),grader_hash:treeHash(path.resolve(dir,'../../../mission_graders')),
      workflow_turns:1+(task.turns?.length??0),limits:coreLimits(id)};})};
  const attempts=[];
  for(let repetition=1;repetition<=repetitions;repetition++)for(const id of ids){
    const order=repetition%2?architectures:[...architectures].reverse();
    for(const architecture of order)attempts.push({id:id.toLowerCase()+'-'+architecture+'-'+repetition,mission:id,architecture,repetition,
      configuration_fingerprint:coreConfiguration(id,architecture).configuration_fingerprint});
  }
  return {schema_version:1,status:'candidate-not-dispatchable',plan_id:fingerprint({build,contract,attempts}),build,contract,attempts,
    envelope:{attempts:attempts.length,max_requests:attempts.reduce((n,a)=>n+coreLimits(a.mission).max_requests,0),
      max_reported_tokens:attempts.reduce((n,a)=>n+coreLimits(a.mission).max_tokens,0),
      max_agent_wall_ms:attempts.reduce((n,a)=>n+coreLimits(a.mission).wall_time_ms,0),retries:0,provider_credit_ceiling:null},
    inference_requests_made:0,dispatchable:false,
    required_before_dispatch:['Clean committed source and pinned actor/grader runtime identities',
      'Actual isolated actor and separate executable-grader boundary/lifecycle controls',
      'Catalogue and image-delivery preflight for the exact model',
      ...(stage==='repeated'?['Retained pilot evidence and a reviewed request/token envelope']:[])],
    limitations:['Candidate caps are explicit maxima, not predicted usage or a provider credit conversion.',
      'The one-cell default pilot is D01/Solo. A repeated plan schedules 72 attempts, not 72 requests.',
      'A planned Sandbox profile is not an isolation receipt. This planner cannot dispatch inference.']};
}
