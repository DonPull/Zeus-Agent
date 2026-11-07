#!/usr/bin/env node
/** Explicit scripted calibration only; default prepares without opening a VM. */
import path from 'node:path';
import {prepareIsolatedMission,runPreparedMission} from './sandbox/isolated_mission.mjs';
import {SINGLE_TURN_MISSIONS} from './sandbox/mission_contract.mjs';
const args=process.argv.slice(2),options={};let run=false;
for(let index=0;index<args.length;index++){
  const key=args[index];if(key==='--run'){run=true;continue;}
  if(!['--mission','--architecture','--runtime-bundle','--control'].includes(key))throw Error('Unknown argument; hosted --live dispatch remains gated');
  if(Object.hasOwn(options,key))throw Error('Duplicate argument');
  const value=args[++index];if(!value||value.startsWith('--'))throw Error('Missing argument value');options[key]=value;
}
if(!options['--mission']||!options['--runtime-bundle'])throw Error('Require --mission (one ID or comma-separated unique IDs) and --runtime-bundle; optional --architecture solo|team, --control positive|invalid-output, --run');
const ids=options['--mission'].split(','),architecture=options['--architecture']??'solo',variant=options['--control']??'positive';
if(!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!SINGLE_TURN_MISSIONS.includes(id)))throw Error('Select unique supported single-turn mission IDs');
if(!['solo','team'].includes(architecture)||!['positive','invalid-output'].includes(variant))throw Error('Invalid architecture/control');
for(const id of ids){
  const prepared=prepareIsolatedMission({id,runtimeBundle:path.resolve(options['--runtime-bundle']),architecture,variant});
  if(!run){console.log(JSON.stringify({mission:id,root:prepared.root,status:'prepared',launch_requested:false,hosted_inference_requests:0},null,2));continue;}
  const result=await runPreparedMission(prepared.root,{onSession:value=>process.stderr.write(JSON.stringify(value)+'\n')});
  console.log(JSON.stringify({mission:id,root:result.root,output:result.output,evaluation_kind:result.row.evaluation_kind,execution_status:result.row.execution_status,outcome_status:result.row.outcome_status,authorization_status:result.row.authorization_status,hosted_inference_requests:0},null,2));
  if(result.row.execution_status==='infrastructure_error'){process.exitCode=1;break;}
}
