#!/usr/bin/env node
/** Explicit developer grading entry point. Preparation never starts submitted code. */
import path from 'node:path';
import {prepareIsolatedGrade,createIsolatedGrader} from './sandbox/isolated_grader.mjs';
const args=process.argv.slice(2),options={};let run=false;
for(let index=0;index<args.length;index++){
  const key=args[index];if(key==='--run'){run=true;continue;}
  if(!['--mission','--submission','--runtime-bundle'].includes(key))throw Error('Unknown grading argument');
  const value=args[++index];if(!value||value.startsWith('--'))throw Error('Missing grading argument');
  options[key]=value;
}
if(!options['--mission']||!options['--submission']||!options['--runtime-bundle'])throw Error('Require --mission, --submission and --runtime-bundle; add --run only for an actual guest launch');
const selected={id:options['--mission'],submission:path.resolve(options['--submission']),runtimeBundle:path.resolve(options['--runtime-bundle'])};
if(!run){const prepared=prepareIsolatedGrade(selected);console.log(JSON.stringify({status:'prepared',root:prepared.root,launch_requested:false},null,2));}
else{
  const outcome=await createIsolatedGrader({runtimeBundle:selected.runtimeBundle,onSession:value=>process.stderr.write(JSON.stringify(value)+'\n')})(selected);
  console.log(JSON.stringify({mission_id:outcome.mission_id,outcome_status:outcome.outcome_status,criteria:outcome.criteria.map(({id,status})=>({id,status})),execution:outcome.execution},null,2));
}
