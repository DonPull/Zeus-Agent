/** Protected controller; the real Zeus app executes with the standard-user token. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {controllerKey,signGradingResult} from './grading_auth.mjs';
import {atomicExchange,decodeResponseFrame} from './file_rpc.mjs';
import {snapshotActorArtifacts} from './actor_artifacts.mjs';
const input='C:\\Zeus\\Input',reportFile='C:\\Zeus\\runtime-report.json';
if(process.env.USERNAME!=='WDAGUtilityAccount'||!import.meta.url.startsWith('file:///C:/Zeus/Input/'))throw Error('Disposable actor controller required');
const job=JSON.parse(fs.readFileSync(path.join(input,'job.json'),'utf8'));
const identity={id:job.id,nonce:job.nonce,packet_sha256:job.runtime_smoke.auth_packet_sha256};
const key=controllerKey(),result={kind:'protected-guest-actor-control-v1',status:'failed',provider_inference_requests:0,base:JSON.parse(process.env.ZEUS_GUEST_BASE_RESULT)};
const ps=name=>spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','RemoteSigned','-File',path.join(input,name)],{windowsHide:true,encoding:'utf8',timeout:30000});
let account=false;
try{
  await atomicExchange('C:\\Zeus\\Output','grading-key.json',Buffer.from(JSON.stringify({schema_version:1,id:job.id,nonce:job.nonce,key_spki:key.spki})));
  let acknowledged=false;const deadline=Date.now()+20000;
  while(Date.now()<deadline){
    const bytes=fs.readFileSync(path.join(input,'grading-key-ack.json'));if(bytes.length>4096)throw Error('Oversized host acknowledgment');
    const frame=decodeResponseFrame(bytes);
    if(frame){const ack=JSON.parse(frame);if(ack.id!==job.id||ack.nonce!==job.nonce||ack.packet_sha256!==identity.packet_sha256||ack.key_sha256!==key.fingerprint)throw Error('Incorrect host key acknowledgment');acknowledged=true;break;}
    await new Promise(resolve=>setTimeout(resolve,25));
  }
  if(!acknowledged)throw Error('No host key pin; actor was not started');
  const setup=ps('prepare_candidate.ps1');if(setup.status!==0)throw Error('Actor account setup failed: '+setup.stderr.slice(-3000));account=true;
  for(const name of ['candidate_gate.py','candidate_boundary.py','actor_bootstrap.py'])fs.copyFileSync(path.join(input,name),path.join('C:\\Zeus\\PublicTools',name));
  const boundary=spawnSync('C:\\Zeus\\GraderPrivate\\candidate-python.exe',['-I','-B','C:\\Zeus\\PublicTools\\candidate_boundary.py',String(process.pid)],{windowsHide:true,encoding:'utf8',timeout:15000});
  if(boundary.status!==0)throw Error('Actor boundary probe failed: '+boundary.stderr.slice(-3000));
  result.boundary=JSON.parse(boundary.stdout);
  if(result.boundary.username.toLowerCase()!=='zeuscandidate'||result.boundary.is_admin||['private_read_denied','private_write_denied','controller_process_denied','runtime_write_denied','runtime_readable','scratch_writable'].some(name=>result.boundary[name]!==true))throw Error('Actor boundary was not confirmed');
  if(fs.existsSync('C:\\Zeus\\Output\\candidate-write.txt'))fs.unlinkSync('C:\\Zeus\\Output\\candidate-write.txt');
  process.env.ZEUS_GUEST_ACTOR_LAUNCHER='C:\\Zeus\\GraderPrivate\\candidate-python.exe';
  await import('./guest_smoke.mjs');
  result.actor=JSON.parse(fs.readFileSync('C:\\Zeus\\GraderPrivate\\actor-runtime.json','utf8'));
  if(result.actor.status!=='passed')throw Error('Protected actor runtime failed');
  result.status='passed';
}catch(error){result.error=String(error.stack??error).slice(-8000);}
finally{
  if(account){const stopped=ps('stop_candidate.ps1');if(stopped.status===0)result.candidate_cleanup=JSON.parse(stopped.stdout);else{result.status='failed';result.cleanup_error=stopped.stderr.slice(-3000);}}
  if(result.status==='passed')try{
    if(result.candidate_cleanup?.remaining!==0||result.candidate_cleanup?.account_disabled!==true)throw Error('Actor cleanup not confirmed before export');
    const names=['actor-input.txt','actor-output.txt'];
    const bytes=snapshotActorArtifacts(result.actor.actor_workspace,{id:job.id,nonce:job.nonce},names);
    await atomicExchange('C:\\Zeus\\Output','actor-export.json',bytes);
    result.artifact_export={sha256:crypto.createHash('sha256').update(bytes).digest('hex'),names};
  }catch(error){result.status='failed';result.export_error=String(error.message).slice(-2000);}
  fs.writeFileSync(reportFile,JSON.stringify(signGradingResult(key,identity,result)));
}
process.exitCode=result.status==='passed'?0:1;
