/** Actual guest-only account/ACL/process experiment. No generated programs. */
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {controllerKey,signGradingResult} from './grading_auth.mjs';
import {atomicExchange,decodeResponseFrame} from './file_rpc.mjs';
if(process.env.USERNAME!=='WDAGUtilityAccount'||!import.meta.url.startsWith('file:///C:/Zeus/Input/'))throw Error('Disposable guest input required');
const result={kind:'guest-candidate-boundary-control',status:'failed',provider_inference_requests:0};
const job=JSON.parse(fs.readFileSync('C:\\Zeus\\Input\\job.json','utf8'));
const identity={id:job.id,nonce:job.nonce,packet_sha256:job.runtime_smoke.auth_packet_sha256},key=controllerKey();
try{
  const setup=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','RemoteSigned','-File','C:\\Zeus\\Input\\prepare_candidate.ps1'],{windowsHide:true,encoding:'utf8',timeout:30000});
  if(setup.status!==0)throw Error('Guest account setup failed: '+setup.stderr.slice(-5000));
  result.base=JSON.parse(process.env.ZEUS_GUEST_BASE_RESULT);
  await atomicExchange('C:\\Zeus\\Output','grading-key.json',Buffer.from(JSON.stringify({schema_version:1,id:job.id,nonce:job.nonce,key_spki:key.spki})));
  const deadline=Date.now()+20000;let acknowledged=false;
  while(Date.now()<deadline){
    const bytes=fs.readFileSync('C:\\Zeus\\Input\\grading-key-ack.json');if(bytes.length>4096)throw Error('Oversized key acknowledgment');
    const body=decodeResponseFrame(bytes);
    if(body){const ack=JSON.parse(body);if(ack.id!==job.id||ack.nonce!==job.nonce||ack.packet_sha256!==identity.packet_sha256||ack.key_sha256!==key.fingerprint)throw Error('Wrong controller key acknowledgment');acknowledged=true;break;}
    await new Promise(resolve=>setTimeout(resolve,25));
  }
  if(!acknowledged)throw Error('No host key acknowledgment; candidate was not started');
  fs.copyFileSync('C:\\Zeus\\Input\\candidate_boundary.py','C:\\Zeus\\PublicTools\\candidate_boundary.py');
  fs.copyFileSync('C:\\Zeus\\Input\\candidate_gate.py','C:\\Zeus\\PublicTools\\candidate_gate.py');
  const launch=(args,options={})=>spawnSync('C:\\Zeus\\GraderPrivate\\candidate-python.exe',args,{windowsHide:true,encoding:'utf8',timeout:15000,...options});
  const probe=launch(['-I','-B','C:\\Zeus\\PublicTools\\candidate_boundary.py',String(process.pid)]);
  if(probe.status!==0)throw Error('Candidate probe failed: '+probe.status+' '+probe.stderr.slice(-5000));
  result.boundary=JSON.parse(probe.stdout);
  const exit=launch(['-I','-c','raise SystemExit(37)']);result.failed_child_exit=exit.status;
  if(exit.status!==37)throw Error('Child exit code was not preserved');
  const absent=async pid=>{if(!Number.isSafeInteger(pid)||pid<1)return false;for(let i=0;i<40;i++){try{process.kill(pid,0);}catch(error){if(error.code==='ESRCH')return true;}await new Promise(resolve=>setTimeout(resolve,50));}return false;};
  const descendant=launch(['-I','-c','import subprocess,sys; p=subprocess.Popen([sys.executable,"-I","-c","import time; time.sleep(60)"],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); print(p.pid,flush=True)']);
  result.descendant_reaped=descendant.status===0&&await absent(Number(descendant.stdout.trim()));
  const timed=launch(['-I','-c','import os,time; print(os.getpid(),flush=True); time.sleep(60)'],{timeout:3000});
  result.timeout_reaped=timed.error?.code==='ETIMEDOUT'&&await absent(Number(timed.stdout.trim()));
  if(result.boundary.username.toLowerCase()!=='zeuscandidate'||result.boundary.is_admin||!result.descendant_reaped||!result.timeout_reaped||['private_read_denied','private_write_denied','controller_process_denied','runtime_write_denied','runtime_readable','scratch_writable'].some(key=>result.boundary[key]!==true))throw Error('Candidate private/process boundary did not pass');
  result.status='passed';
}catch(error){result.error=String(error.stack??error).slice(-10000);}
fs.writeFileSync('C:\\Zeus\\runtime-report.json',JSON.stringify(signGradingResult(key,identity,result)));
process.exitCode=result.status==='passed'?0:1;
