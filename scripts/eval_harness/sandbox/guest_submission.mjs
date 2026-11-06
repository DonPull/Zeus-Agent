/** Privileged grading controller; submitted Python runs under ZeusCandidate. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {controllerKey,signGradingResult} from './grading_auth.mjs';
import {atomicExchange,decodeResponseFrame} from './file_rpc.mjs';
const input='C:\\Zeus\\Input',root='C:\\Zeus\\Grading',runtime='C:\\Zeus\\Runtime';
if(process.env.USERNAME!=='WDAGUtilityAccount'||!import.meta.url.startsWith('file:///C:/Zeus/Input/'))throw Error('Disposable grading controller required');
const job=JSON.parse(fs.readFileSync(path.join(input,'job.json'),'utf8'));
const identity={id:job.id,nonce:job.nonce,packet_sha256:job.runtime_smoke.auth_packet_sha256};
const key=controllerKey(),hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const result={kind:'isolated-submission-grade-v1',status:'failed',provider_inference_requests:0,base:JSON.parse(process.env.ZEUS_GUEST_BASE_RESULT)};
const ps=name=>spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','RemoteSigned','-File',path.join(input,name)],{windowsHide:true,encoding:'utf8',timeout:30000});
let account=false;
try{
  await atomicExchange('C:\\Zeus\\Output','grading-key.json',Buffer.from(JSON.stringify({schema_version:1,id:job.id,nonce:job.nonce,key_spki:key.spki})));
  let acknowledged=false;const deadline=Date.now()+20000;
  while(Date.now()<deadline){
    const bytes=fs.readFileSync(path.join(input,'grading-key-ack.json'));if(bytes.length>4096)throw Error('Oversized key acknowledgment');
    const frame=decodeResponseFrame(bytes);
    if(frame){const ack=JSON.parse(frame);if(ack.id!==job.id||ack.nonce!==job.nonce||ack.packet_sha256!==identity.packet_sha256||ack.key_sha256!==key.fingerprint)throw Error('Incorrect host acknowledgment');acknowledged=true;break;}
    await new Promise(resolve=>setTimeout(resolve,25));
  }
  if(!acknowledged)throw Error('No host key pin; submitted code was not started');
  const setup=ps('prepare_candidate.ps1');if(setup.status!==0)throw Error('Candidate setup failed: '+setup.stderr.slice(-3000));account=true;
  for(const name of ['candidate_gate.py','candidate_boundary.py'])fs.copyFileSync(path.join(input,name),path.join('C:\\Zeus\\PublicTools',name));
  const boundary=spawnSync('C:\\Zeus\\GraderPrivate\\candidate-python.exe',['-I','-B','C:\\Zeus\\PublicTools\\candidate_boundary.py',String(process.pid)],{windowsHide:true,encoding:'utf8',timeout:15000});
  if(boundary.status!==0)throw Error('Account boundary probe failed: '+boundary.stderr.slice(-3000));
  result.boundary=JSON.parse(boundary.stdout);
  if(result.boundary.username.toLowerCase()!=='zeuscandidate'||result.boundary.is_admin||['private_read_denied','private_write_denied','controller_process_denied','runtime_write_denied','runtime_readable','scratch_writable'].some(name=>result.boundary[name]!==true))throw Error('Candidate boundary was not confirmed');
  // The boundary canary intentionally tests the writable mapping. Remove only
  // this declared local test file before allowing any submission to execute.
  if(fs.existsSync('C:\\Zeus\\Output\\candidate-write.txt'))fs.unlinkSync('C:\\Zeus\\Output\\candidate-write.txt');
  const bytes=fs.readFileSync(path.join(input,'submission-packet.json'));if(bytes.length>8*1024*1024||hash(bytes)!==identity.packet_sha256)throw Error('Changed submission packet');
  const packet=JSON.parse(bytes);if(packet.kind!=='executable-submission-v1'||packet.schema_version!==1||Object.keys(packet.files).length>128)throw Error('Invalid submission packet');
  for(const [name,file] of Object.entries(packet.files)){
    if(!/^[a-zA-Z0-9_./-]+$/.test(name)||name.split('/').some(part=>!part||part==='.'||part==='..'))throw Error('Invalid staged grading path');
    const data=Buffer.from(file.base64,'base64');if(data.length>2*1024*1024||hash(data)!==file.sha256)throw Error('Changed staged grading file');
    const target=path.join(root,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,data,{flag:'wx'});
  }
  fs.mkdirSync(path.join(root,'node_modules'));fs.cpSync(path.join(runtime,'node_modules/playwright-core'),path.join(root,'node_modules/playwright-core'),{recursive:true});
  fs.copyFileSync(path.join(root,'tests/benchmarks/mission_graders/function_probe.py'),'C:\\Zeus\\PublicTools\\function_probe.py');
  const workspace='C:\\Zeus\\CandidateScratch\\submission';fs.mkdirSync(workspace);
  for(const file of packet.submission.filter(file=>file.status==='retained')){
    if(path.basename(file.name)!==file.name)throw Error('Invalid exported artifact name');
    fs.copyFileSync(path.join(root,file.file),path.join(workspace,file.name));
  }
  process.env.PATH=path.join(runtime,'browser/venv/Scripts')+';'+process.env.PATH;
  process.env.PLAYWRIGHT_BROWSERS_PATH=path.join(runtime,'browsers');
  process.env.TMP=process.env.TEMP='C:\\Zeus\\CandidateScratch';
  process.env.ZEUS_GRADER_CANDIDATE_LAUNCHER='C:\\Zeus\\GraderPrivate\\candidate-python.exe';
  const {gradeMission}=await import(pathToFileURL(path.join(root,'tests/benchmarks/mission_graders/outcomes.js')));
  result.assessment=await gradeMission(packet.mission,workspace,{trustedExecution:true});
  result.mission=packet.mission;result.source_files=packet.submission;result.status='completed';
}catch(error){result.error=String(error.stack??error).slice(-8000);}
finally{
  if(account){const cleanup=ps('stop_candidate.ps1');if(cleanup.status===0){result.candidate_cleanup=JSON.parse(cleanup.stdout);}else{result.status='failed';result.cleanup_error=cleanup.stderr.slice(-3000);}}
  fs.writeFileSync('C:\\Zeus\\runtime-report.json',JSON.stringify(signGradingResult(key,identity,result)));
}
process.exitCode=result.status==='completed'?0:1;
