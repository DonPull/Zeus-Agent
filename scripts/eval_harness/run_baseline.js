#!/usr/bin/env node
/** Native baseline checkpoint. Dry run by default; no legacy evaluation policy. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {repoRoot,sourceBuild} from './runner.js';
import {createBaselinePlan,assertPlan,compareBaselines} from '../../tests/benchmarks/baseline_plan.js';
import {runStudy,writeStudyReport} from '../../tests/benchmarks/baseline_runner.js';

const args=process.argv.slice(2),options={live:false,repetitions:1,model:'gpt-6.1-terra',effort:'low',protocol:'chat',ids:['D01','B01','V01']};
for(let i=0;i<args.length;i++){
  const flag=args[i];
  if(flag==='--live')options.live=true;
  else if(flag==='--dry-run')options.live=false;
  else if(['--output','--resume','--model','--effort','--trials','--missions','--compare','--report'].includes(flag)){
    const value=args[++i];if(!value||value.startsWith('--'))throw Error(`Missing value: ${flag}`);
    if(flag==='--trials')options.repetitions=Number(value);
    else if(flag==='--missions')options.ids=value.split(',');
    else options[flag.slice(2)]=value;
  }else throw Error(`Unknown option: ${flag}`);
}
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
if(options.report){
  const directory=path.resolve(options.report),plan=read(path.join(directory,'plan.json'));
  const summary=writeStudyReport(plan,directory);
  if(options.compare){const before=path.resolve(options.compare),left=writeStudyReport(read(path.join(before,'plan.json')),before);const comparison=compareBaselines(left,summary);fs.writeFileSync(path.join(directory,'comparison.json'),JSON.stringify(comparison,null,2));}
  console.log(JSON.stringify({directory,...summary},null,2));
}else{
  if(options.compare)throw Error('--compare requires --report');
  if(options.resume&&args.some(arg=>['--model','--effort','--trials','--missions','--output'].includes(arg)))throw Error('Resume uses its frozen options; do not supply replacements');
  const build=sourceBuild(),directory=options.resume?path.resolve(options.resume):path.resolve(options.output??path.join(repoRoot,'.zeus/evaluations',`baseline-${crypto.randomUUID()}`));
  const plan=options.resume?read(path.join(directory,'plan.json')):createBaselinePlan({build,...options});
  assertPlan(plan,build);
  if(!options.live)console.log(JSON.stringify({dry_run:true,directory,...plan},null,2));
  else{
    if(build.dirty)throw Error('Commit the measurement source before live dispatch so the study has a reproducible build');
    if(process.env.ZEUS_OFFLINE_TEST==='1')throw Error('Live study is not permitted inside offline regression');
    const controller=new AbortController();let activeChild;
    const stop=()=>{controller.abort();if(activeChild?.pid)terminate(activeChild.pid);};
    process.on('SIGINT',stop);process.on('SIGTERM',stop);
    function terminate(pid){
      if(process.platform==='win32'){const killer=spawn('taskkill',['/pid',String(pid),'/f','/t'],{windowsHide:true,stdio:'ignore'});killer.on('error',error=>console.error(error.message));}
      else try{process.kill(pid,'SIGTERM');}catch{}
    }
    try{
      const summary=await runStudy({plan,directory,currentBuild:build,resume:Boolean(options.resume),signal:controller.signal,
        execute:(attempt,output,onSpawn)=>new Promise((resolve,reject)=>{
          try{assertPlan(plan,sourceBuild());}catch(error){error.code='FROZEN_PLAN_CHANGED';throw error;}
          const logPath=path.join(directory,`${attempt.id}.log`),log=fs.openSync(logPath,'wx');
          console.log(JSON.stringify({starting:attempt.id,output,model:plan.contract.model,limits:plan.contract.missions.find(m=>m.id===attempt.mission).limits}));
          const child=spawn(process.execPath,[path.join(repoRoot,'scripts/eval_harness/diagnose_mission.js'),'--live','--mission',attempt.mission,
            '--arch',attempt.architecture,'--model',plan.contract.model,'--effort',plan.contract.effort,'--protocol',plan.contract.protocol,'--output',output],
            {cwd:repoRoot,windowsHide:true,shell:false,stdio:['ignore',log,log]});
          activeChild=child;
          child.once('spawn',()=>onSpawn(child.pid));
          const deadline=setTimeout(()=>terminate(child.pid),420000);
          let settled=false;
          const finish=(error,code)=>{if(settled)return;settled=true;clearTimeout(deadline);fs.closeSync(log);activeChild=null;if(error)reject(error);else resolve({code});};
          child.once('error',error=>finish(error));
          child.once('close',code=>finish(null,code));
        })});
      console.log(JSON.stringify({directory,...summary},null,2));
      process.exitCode=controller.signal.aborted?130:summary.recorded!==summary.scheduled?1:
        Object.values(summary.cells).every(c=>c.verified_passes===c.scheduled)?0:
        Object.values(summary.cells).every(c=>c.successful_outcomes===c.scheduled)?2:1;
    }finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);}
  }
}
