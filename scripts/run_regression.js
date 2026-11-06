#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { sourceBuild } from './eval_harness/runner.js';
import { atomicWrite } from '../tests/benchmarks/score_recorder.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requested = process.argv.slice(2);
let uiFiles=[];
const filterIndex=requested.indexOf('--ui-files');
if(filterIndex>=0){
  const value=requested[filterIndex+1];
  if(!value||!/^[a-z0-9_,]+$/i.test(value)){console.error('--ui-files requires comma-separated regression filenames');process.exit(1);}
  uiFiles=value.split(',');requested.splice(filterIndex,2);
  if(uiFiles.some(name=>!fs.existsSync(path.join(root,'tests/regression',`${name}.spec.js`)))){console.error('Unknown requested regression file');process.exit(1);}
  if(!requested.includes('--ui'))requested.push('--ui');
}
if (requested.some(arg => !['--unit', '--backend', '--ui', '--missions', '--release'].includes(arg))) {
  console.error('Usage: node scripts/run_regression.js [--unit] [--backend] [--ui] [--missions] [--release] [--ui-files filename,filename]'); process.exit(1);
}
const env = { ...process.env, ZEUS_OFFLINE_TEST: '1' };
for (const key of ['ZEUS_ALLOW_LIVE_EVAL', 'ZEUS_API_BASE_URL', 'ZEUS_EVAL_MODE', 'ZEUS_UNLIMITED_BUDGET',
  'ZEUS_UNLIMITED_ITERATIONS', 'ZEUS_AUTO_ALLOW_COMMANDS', 'ZEUS_AUTO_ALLOW_NEW_FILES', 'ZEUS_BENCH_MATRIX',
  'ZEUS_BENCH_OVERRIDES', 'ZEUS_BENCH_SELECTED_IDS', 'ZEUS_BENCH_RESULTS_DIR', 'ZEUS_BENCH_PROFILE', 'ZEUS_BENCH_ARCH', 'ZEUS_EVALUATION_LIMITS']) delete env[key];
env.ZEUS_BENCH_BUILD = JSON.stringify(sourceBuild(root));
let code = 0;
const receiptPath=path.join(root,'.zeus/evaluations/regression-receipts',crypto.randomUUID()+'.json');
const receipt={build:JSON.parse(env.ZEUS_BENCH_BUILD),selection:process.argv.slice(2),started_at:new Date().toISOString(),status:'running',stages:[]};
const saveReceipt=()=>atomicWrite(receiptPath,JSON.stringify(receipt,null,2));
saveReceipt();
const selected = group => !requested.length || requested.includes(`--${group}`);
async function run(command, args, cwd = root) {
  const stage={command,args,cwd:path.relative(root,cwd)||'.',status:'running',started_at:new Date().toISOString()};
  receipt.stages.push(stage);saveReceipt();
  const folder=path.join(root,'.zeus/evaluations/regression-logs',path.basename(receiptPath,'.json'));
  fs.mkdirSync(folder,{recursive:true});
  const maximum=8*1024*1024,logs={};let logError=null;
  for(const name of ['stdout','stderr']){
    const file=path.join(folder,'stage-'+receipt.stages.length+'.'+name+'.log');
    logs[name]={file:path.relative(root,file),fd:fs.openSync(file,'wx'),bytes:0,truncated:false};
  }
  stage.output=Object.fromEntries(Object.entries(logs).map(([name,log])=>[name,{file:log.file,bytes:0,truncated:false,sha256:null}]));saveReceipt();
  const result=await new Promise(resolve=>{
    const child=spawn(command,args,{cwd,env,stdio:['ignore','pipe','pipe'],shell:false,windowsHide:true});
    let error=null;
    for(const name of ['stdout','stderr'])child[name].on('data',chunk=>{
      process[name].write(chunk);const log=logs[name],retained=chunk.subarray(0,Math.max(0,maximum-log.bytes));
      try{if(retained.length)fs.writeFileSync(log.fd,retained);log.bytes+=retained.length;if(retained.length<chunk.length)log.truncated=true;}
      catch(failure){logError??=failure.message;}
    });
    child.once('error',failure=>{error=failure.message;console.error(error);});
    child.once('close',(status,signal)=>resolve({status,signal,error}));
  });
  for(const log of Object.values(logs)){
    fs.closeSync(log.fd);delete log.fd;
    log.sha256=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,log.file))).digest('hex');
  }
  Object.assign(stage,{status:result.status===0&&!logError?'passed':'failed',exit_code:result.status??null,signal:result.signal??null,error:result.error??logError,output:logs,ended_at:new Date().toISOString()});saveReceipt();
  code ||= result.status??1;if(logError)code||=1;
}
if (selected('unit')) await run(process.execPath, ['--test', ...fs.readdirSync(path.join(root, 'tests/unit')).filter(f => f.endsWith('.test.js')).map(f => `tests/unit/${f}`)]);
if (selected('missions')) await run(process.execPath, ['--test', ...fs.readdirSync(path.join(root,'tests/missions')).filter(f=>f.endsWith('.test.js')).map(f=>'tests/missions/'+f)]);
if (selected('backend')) await run('cargo', ['test', '--lib', '--locked'], path.join(root, 'src-tauri'));
if (selected('ui')) {
  env.ZEUS_CAPTURE_METRICS_PATH=path.join(root,'.zeus/evaluations/browser-capture-measurements.json');
  const browserPython=path.join(root,'.zeus/browser-runtime/venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
  if(!fs.existsSync(browserPython)){console.error('Prepare the isolated browser runtime explicitly: python scripts/browser_service/setup_runtime.py --destination .zeus/browser-runtime/venv --install');code||=1;}
  else if(!uiFiles.length)await run(browserPython,['tests/browser_service/test_service.py']);
  const regular=uiFiles.filter(name=>name!=='browser_handoff');
  if(!uiFiles.length||regular.length)await run(process.execPath, [path.join(root, 'node_modules/@playwright/test/cli.js'), 'test', '--config=playwright.offline.config.js',...regular.map(name=>`${name}.spec.js`)]);
  // Native Open-browser tests inherit a private Win32 desktop. Never expose
  // their windows over the user's current applications or inject desktop input.
  if(process.platform==='win32'&&(!uiFiles.length||uiFiles.includes('browser_handoff'))&&fs.existsSync(browserPython))await run(browserPython,['tests/browser_service/probe_native_handoff.py','--e2e']);
}
if (requested.includes('--release')) {
  env.ZEUS_TEST_RELEASE='1';
  await run('cargo',['build','--release','--locked','--bin','zeus-evaluation','--features','evaluation-runner'],path.join(root,'src-tauri'));
  if(!code)await run(process.execPath,[path.join(root,'node_modules/@playwright/test/cli.js'),'test','--config=playwright.offline.config.js',
    'attachments','browser_capture','browser_ownership','browser_recordings','browser_visuals','browser_readiness','browser_transfers','message_links','viewer_layout','replay_polish','chat_refinements','--grep',
    'large valid image|one root-owned browser|Stop during navigation|ordinary fresh launch|production collector and live viewer|real before/after evidence|explicit worker screenshot|readiness checks preserve|managed transfers verify|task files reveal|live and replay viewers use|replay keeps decoded images|settings headers stay visible|normal model responses name|persistent UI showcase']);
  const browserPython=path.join(root,'.zeus/browser-runtime/venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
  if(!code&&process.platform==='win32'&&fs.existsSync(browserPython))await run(browserPython,['tests/browser_service/probe_native_handoff.py','--e2e']);
}
process.exitCode = code;
Object.assign(receipt,{status:code===0?'passed':'failed',exit_code:code,ended_at:new Date().toISOString()});saveReceipt();
console.log('Regression receipt: '+path.relative(root,receiptPath));
