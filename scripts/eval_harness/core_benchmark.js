#!/usr/bin/env node
/** Full-core candidate planning. Dispatch stays unavailable until isolation gates. */
import fs from 'node:fs';
import path from 'node:path';
import {sourceBuild,repoRoot} from './runner.js';
import {createCorePlan} from '../../tests/benchmarks/core_plan.js';
const args=process.argv.slice(2),options={build:sourceBuild(repoRoot)};
let output=null;
for(let i=0;i<args.length;i++){
  const key=args[i];
  if(key==='--dry-run')continue;
  if(key==='--live')throw Error('Core live dispatch is unavailable until isolated actor/grader validation and the reviewed pilot envelope are complete. No inference was started.');
  if(!['--stage','--missions','--architectures','--output'].includes(key))throw Error('Unknown core benchmark argument: '+key);
  const value=args[++i];if(!value||value.startsWith('--'))throw Error('Missing value for '+key);
  if(key==='--stage')options.stage=value;
  if(key==='--missions')options.ids=value.split(',');
  if(key==='--architectures')options.architectures=value.split(',');
  if(key==='--output')output=path.resolve(value);
}
const plan=createCorePlan(options);
if(output){fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(plan,null,2),{flag:'wx'});}
console.log(JSON.stringify(plan,null,2));
