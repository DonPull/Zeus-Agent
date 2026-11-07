/** .wsb preparation and bounded data reads. Never launches a VM or candidate. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {unlinkedDirectory,readBoundedFile} from './exchange_files.mjs';
export {unlinkedDirectory,readBoundedFile} from './exchange_files.mjs';
import {RPC_LIMITS,validateRequest,validateResponse,requestName,responseName,decodeResponseFrame} from './file_rpc.mjs';
import {prepareGraderPacket,gradingSmokeMatches,prepareSubmissionPacket,validateSubmissionAssessment} from './grader_packet.mjs';
import {pinControllerKey,verifyGradingResult} from './grading_auth.mjs';
import {MISSION_RPC_LIMITS,missionRequestValidator,missionResponseValidator} from './mission_rpc.mjs';
import {validateActorArtifacts,ARTIFACT_LIMITS} from './actor_artifacts.mjs';
import {validateMissionPacket,missionResultMatches,MISSION_TRACE_LIMIT} from './mission_contract.mjs';
import {inspectMissionExchange} from './mission_receipt.mjs';

const directory=path.dirname(fileURLToPath(import.meta.url));
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const xml=value=>String(value).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
const canonical=value=>path.toNamespacedPath(path.resolve(value)).toLowerCase();
export function sandboxConfiguration({input,output,memoryMB=4096,runtime=null}){
  // Two exchange mappings plus an optional readonly public runtime. The
  // repository, real profile, host credentials and evaluator state stay unmapped.
  if(!Number.isInteger(memoryMB)||memoryMB<2048||memoryMB>8192)throw Error('Sandbox memory must be 2048..8192 MiB');
  const mappings=[input,output,...(runtime?[runtime]:[])];
  for(const value of mappings){
    if(typeof value!=='string'||!path.win32.isAbsolute(value)||/[\x00\r\n%]/.test(value)||!/^[a-z]:\\$/i.test(path.win32.parse(value).root)||path.win32.resolve(value)===path.win32.parse(value).root)throw Error('Use absolute local Windows mapping folders');
  }
  for(let i=0;i<mappings.length;i++)for(let j=i+1;j<mappings.length;j++){
    const a=path.win32.resolve(mappings[i]).toLowerCase(),b=path.win32.resolve(mappings[j]).toLowerCase();
    if(a===b||a.startsWith(b+'\\')||b.startsWith(a+'\\'))throw Error('Sandbox mappings must be disjoint');
  }
  return '<?xml version="1.0" encoding="utf-8"?>\n<Configuration>\n'+
    '  <vGPU>Disable</vGPU>\n  <Networking>Disable</Networking>\n  <ProtectedClient>Enable</ProtectedClient>\n'+
    '  <AudioInput>Disable</AudioInput>\n  <VideoInput>Disable</VideoInput>\n'+
    '  <PrinterRedirection>Disable</PrinterRedirection>\n  <ClipboardRedirection>Disable</ClipboardRedirection>\n'+
    '  <MemoryInMB>'+memoryMB+'</MemoryInMB>\n  <MappedFolders>\n'+
    '    <MappedFolder><HostFolder>'+xml(input)+'</HostFolder><SandboxFolder>C:\\Zeus\\Input</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>\n'+
    '    <MappedFolder><HostFolder>'+xml(output)+'</HostFolder><SandboxFolder>C:\\Zeus\\Output</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder>\n'+
    (runtime?'    <MappedFolder><HostFolder>'+xml(runtime)+'</HostFolder><SandboxFolder>C:\\Zeus\\RuntimeInput</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>\n':'')+
    '  </MappedFolders>\n  <LogonCommand><Command>powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File C:\\Zeus\\Input\\probe.ps1</Command></LogonCommand>\n</Configuration>\n';
}

export function prepareProbe(parent,{runtimeBundle=null,transportSmoke=false,transportDenyTest=false,transportMission=null,gradingSmoke=false,candidateProbe=false,actorProbe=false,submission=null,missionJob=null}={}){
  if(process.platform!=='win32')throw Error('The .wsb probe requires a Windows host');
  if(transportSmoke&&!runtimeBundle)throw Error('Transport smoke requires a prepared public runtime');
  if(transportDenyTest&&!transportSmoke)throw Error('A deny control requires synthetic transport');
  if(transportMission&&(!transportSmoke||transportDenyTest||!['B01','B02','B03','M02'].includes(transportMission)))throw Error('Mission transport requires a declared synthetic browser-fixture smoke');
  if(gradingSmoke&&(!runtimeBundle||transportSmoke||transportDenyTest))throw Error('Grading controls require a separate runtime guest without actor transport');
  if(candidateProbe&&(!runtimeBundle||transportSmoke||gradingSmoke))throw Error('Candidate boundary probe requires its own fresh runtime guest');
  if(submission&&(!runtimeBundle||transportSmoke||gradingSmoke||candidateProbe))throw Error('A submission requires its own fresh grading guest');
  if(actorProbe&&(!runtimeBundle||transportSmoke||gradingSmoke||candidateProbe||submission))throw Error('Protected actor control requires its own fresh runtime guest');
  if(missionJob){
    if(!runtimeBundle||transportSmoke||gradingSmoke||candidateProbe||actorProbe||submission)throw Error('Mission execution requires its own fresh runtime guest');
    validateMissionPacket(missionJob.bytes,missionJob.expected);
    if(missionJob.expected.controller_timeout_secs!==780)throw Error('Mission controller deadline must be 780 seconds');
  }
  let runtimeInfo=null;
  if(runtimeBundle){
    runtimeBundle=unlinkedDirectory(runtimeBundle);
    const runtimeParent=path.resolve(directory,'../../../.zeus/evaluations/sandbox-runtime');
    if(canonical(path.dirname(runtimeBundle))!==canonical(runtimeParent)||!/^bundle-[0-9a-f-]{36}$/.test(path.basename(runtimeBundle)))throw Error('Use a staged public runtime bundle');
    const bytes=readBoundedFile(runtimeBundle,'bundle.json',4*1024*1024),bundle=JSON.parse(bytes);
    if(bundle.kind!=='public-sandbox-runtime-bundle'||bundle.status!=='staged-unproven'||!Array.isArray(bundle.files)||bundle.files.length>20000||bundle.bytes>2*1024**3)throw Error('Invalid runtime bundle identity');
    runtimeInfo={path:runtimeBundle,manifest_sha256:hash(bytes),content_sha256:bundle.content_sha256,versions:bundle.versions};
  }
  const submitted=submission?prepareSubmissionPacket(submission.id,submission.directory):null;
  const authenticated=candidateProbe||actorProbe||Boolean(submitted)||Boolean(missionJob);
  const base=unlinkedDirectory(parent,{create:true}),id=crypto.randomUUID(),root=path.join(base,id);
  fs.mkdirSync(root);const input=path.join(root,'input'),output=path.join(root,'output'),privateDir=path.join(root,'private');
  for(const folder of [input,output,privateDir])fs.mkdirSync(folder);
  const nonce=crypto.randomBytes(24).toString('hex'),sentinel=crypto.randomBytes(32);
  const privateFile=path.join(privateDir,'host-only.bin');
  fs.writeFileSync(privateFile,sentinel,{flag:'wx'});
  const challenge=Buffer.from('Synthetic boundary challenge '+nonce+'\n');
  const job={schema_version:2,id,nonce,private_host_path:privateFile,host_name:os.hostname()};
  if(runtimeInfo)job.runtime_smoke={manifest_sha256:runtimeInfo.manifest_sha256};
  if(transportSmoke)job.runtime_smoke.transport='synthetic-file-v1';
  if(transportMission)job.runtime_smoke.fixture_mission=transportMission;
  if(transportDenyTest)job.runtime_smoke.deny_test=true;
  const grading=gradingSmoke?prepareGraderPacket():null;
  if(grading)job.runtime_smoke.mode='grader-controls-v1';
  if(candidateProbe)job.runtime_smoke.mode='candidate-boundary-v1';
  if(actorProbe)job.runtime_smoke.mode='protected-actor-v1';
  if(submitted)job.runtime_smoke.mode='submission-grade-v1';
  if(missionJob){job.runtime_smoke.mode='mission-job-v1';job.mission_job=missionJob.expected;}
  const authPacket=missionJob?hash(missionJob.bytes):submitted?hash(submitted.bytes):actorProbe?hash(fs.readFileSync(path.join(directory,'actor_bootstrap.py'))):candidateProbe?hash(fs.readFileSync(path.join(directory,'candidate_boundary.py'))):null;
  if(authPacket)job.runtime_smoke.auth_packet_sha256=authPacket;
  const inputs={'job.json':Buffer.from(JSON.stringify(job,null,2)),'challenge.txt':challenge,'probe.ps1':fs.readFileSync(path.join(directory,'probe_guest.ps1'))};
  if(runtimeInfo)for(const name of ['guest_smoke.mjs','guest_diagnostics.ps1'])inputs[name]=fs.readFileSync(path.join(directory,name));
  if(transportSmoke)inputs['file_rpc.mjs']=fs.readFileSync(path.join(directory,'file_rpc.mjs'));
  if(transportMission)inputs['mission_rpc.mjs']=fs.readFileSync(path.join(directory,'mission_rpc.mjs'));
  if(grading){inputs['guest_grading.mjs']=fs.readFileSync(path.join(directory,'guest_grading.mjs'));inputs['grader-packet.json']=grading.bytes;}
  if(authenticated)for(const name of ['guest_candidate_probe.mjs','prepare_candidate.ps1','candidate_python.cs','candidate_boundary.py','candidate_gate.py','grading_auth.mjs','file_rpc.mjs'])inputs[name]=fs.readFileSync(path.join(directory,name));
  if(submitted){inputs['submission-packet.json']=submitted.bytes;for(const name of ['guest_submission.mjs','stop_candidate.ps1'])inputs[name]=fs.readFileSync(path.join(directory,name));}
  if(actorProbe)for(const name of ['guest_actor_probe.mjs','actor_bootstrap.py','stop_candidate.ps1','actor_artifacts.mjs','exchange_files.mjs'])inputs[name]=fs.readFileSync(path.join(directory,name));
  if(missionJob){
    inputs['actor-packet.json']=missionJob.bytes;inputs['package.json']=Buffer.from('{"type":"module"}');
    for(const name of ['guest_mission.mjs','guest_app.mjs','child_lifecycle.mjs','guest_workflow.mjs','guest_browser_capture.mjs','guest_history.py','mission_contract.mjs','mission_rpc.mjs','actor_bootstrap.py','stop_candidate.ps1','actor_artifacts.mjs','exchange_files.mjs'])inputs[name]=fs.readFileSync(path.join(directory,name));
    for(const name of ['bridge_run.js','benchmark_config.js','workflow_limits.js'])inputs[name]=fs.readFileSync(path.resolve(directory,'../../../tests/benchmarks',name));
    inputs['synthetic_supervisor.js']=fs.readFileSync(path.resolve(directory,'../synthetic_supervisor.js'));
  }
  for(const [name,bytes] of Object.entries(inputs))fs.writeFileSync(path.join(input,name),bytes,{flag:'wx'});
  if(transportSmoke||missionJob)for(let id=1;id<=((transportMission||missionJob)?MISSION_RPC_LIMITS:RPC_LIMITS).messages;id++)fs.writeFileSync(path.join(input,responseName(id)),Buffer.alloc(0),{flag:'wx'});
  if(authenticated)fs.writeFileSync(path.join(input,'grading-key-ack.json'),Buffer.alloc(0),{flag:'wx'});
  const wsb=sandboxConfiguration({input,output,runtime:runtimeBundle});
  fs.writeFileSync(path.join(root,'probe.wsb'),wsb,{flag:'wx'});
  const manifest={schema_version:2,id,kind:'sandbox-boundary-probe',status:'prepared',created_at:new Date().toISOString(),
    host_name:os.hostname(),nonce,input,output,private_file:privateFile,private_sha256:hash(sentinel),
    inputs:Object.fromEntries(Object.entries(inputs).map(([name,bytes])=>[name,hash(bytes)])),configuration_sha256:hash(wsb),
    memory_mb:4096,networking:'disabled',mappings:runtimeBundle?3:2,runtime_bundle:runtimeInfo,transport_smoke:transportSmoke?'synthetic-file-v1':null,fixture_mission:transportMission,grader_controls:grading?.expected??null,candidate_control:candidateProbe,actor_control:actorProbe,submission_job:submitted?.expected??null,mission_job:missionJob?.expected??null,grading_auth:authenticated,auth_packet_sha256:authPacket,provider_requests:0,launch_requested:false,
    limitations:['Prepared configuration is not evidence of guest execution or isolation validation.',
      'Memory is configured; CPU, writable mapping disk quota and full actor/grader containment are not validated.']};
  fs.writeFileSync(path.join(root,'session.json'),JSON.stringify(manifest,null,2),{flag:'wx'});
  return {root,manifest};
}

export function runtimeSmokeMatches(smoke,versions){
  return smoke?.status==='passed'&&smoke.provider_inference_requests===0&&smoke.mock_requests===2
    &&smoke.browser_runtime?.sdk===versions.playwright&&smoke.browser_runtime?.browser===versions.chromium
    &&smoke.webview2_version===versions.webview2&&smoke.python_version===versions.python&&smoke.node_version===versions.node
    &&smoke.browser_runtime?.cleanup?.owned_processes_remaining===0&&smoke.observed?.run?.status==='completed'
    &&smoke.usage?.requests===2&&smoke.usage?.unknown_requests===0&&smoke.fixture_requests>0
    &&smoke.navigation?.url==='http://127.0.0.1:19222/'&&smoke.navigation.http_status===200;
}

export function protectedActorMatches(smoke,versions){
  const boundary=smoke?.boundary,start=smoke?.actor?.actor_start;
  return smoke?.kind==='protected-guest-actor-control-v1'&&smoke.status==='passed'&&smoke.provider_inference_requests===0
    &&runtimeSmokeMatches(smoke.actor,versions)&&start?.username?.toLowerCase()==='zeuscandidate'&&start.is_admin===false
    &&Number.isSafeInteger(start.pid)&&start.pid>0&&boundary?.username?.toLowerCase()==='zeuscandidate'&&boundary.is_admin===false
    &&['private_read_denied','private_write_denied','controller_process_denied','runtime_write_denied','runtime_readable','scratch_writable'].every(key=>boundary[key]===true)
    &&smoke.candidate_cleanup?.remaining===0&&smoke.candidate_cleanup?.account_disabled===true
    &&/^[a-f0-9]{64}$/.test(smoke.artifact_export?.sha256??'')&&JSON.stringify(smoke.artifact_export.names)===JSON.stringify(['actor-input.txt','actor-output.txt']);
}

export function inspectHostTransport({input,output,privateDir,id,nonce,mission=null}){
  const limits=mission?MISSION_RPC_LIMITS:RPC_LIMITS,requestValidator=mission?missionRequestValidator(mission):validateRequest,responseValidator=mission?missionResponseValidator:validateResponse;
  const names=fs.readdirSync(output);
  if(!names.includes('probe-result.json')||names.length>limits.messages+1||names.some(name=>name!=='probe-result.json'&&!/^rpc-request-\d{6}\.json$/.test(name)))throw Error('Unexpected transport result files');
  const receipt=JSON.parse(readBoundedFile(privateDir,'transport.json',mission?4*1024*1024:65536));
  let total=0,providers=0,fixtures=0;
  if(receipt.id!==id||receipt.nonce!==nonce||receipt.kind!=='host-observed-synthetic-file-transport'||!Array.isArray(receipt.requests)||receipt.requests.length!==names.length-1)throw Error('Invalid host transport receipt identity');
  const ids=new Set();
  for(const row of receipt.requests){
    if(ids.has(row.id))throw Error('Duplicate host exchange identity');ids.add(row.id);
    const request=readBoundedFile(output,'rpc-request-'+String(row.id).padStart(6,'0')+'.json',RPC_LIMITS.requestBytes);
    const response=readBoundedFile(input,responseName(row.id),RPC_LIMITS.responseBytes);
    if(hash(request)!==row.request_sha256||hash(response)!==row.response_sha256)throw Error('Exchange bytes changed after host handling');
    const observed=requestValidator(JSON.parse(request),nonce);
    if(observed.id!==row.id||observed.channel!==row.channel||observed.method!==row.method||observed.path!==row.path)throw Error('Host transport metadata mismatch');
    if(observed.channel==='provider')providers++;else fixtures++;
    const body=decodeResponseFrame(response);if(!body)throw Error('Incomplete host response frame');
    responseValidator(JSON.parse(body),nonce,row.id);
    total+=request.length+response.length;
  }
  if(mission){
    const bytes=readBoundedFile(privateDir,'fixture-ledger.json',4*1024*1024),fixture=JSON.parse(bytes);
    if(hash(bytes)!==receipt.fixture_ledger_sha256||fixture.id!==id||fixture.nonce!==nonce||fixture.mission!==mission||fixture.status!=='ready'||fixture.requests.length!==fixtures)throw Error('Changed or invalid host fixture ledger');
    for(const row of fixture.requests){
      const observed=requestValidator(JSON.parse(readBoundedFile(output,requestName(row.id),limits.requestBytes)),nonce);
      if(row.status!=='completed'||observed.channel!=='fixture'||row.method!==observed.method||row.path!==observed.path||row.body_sha256!==hash(observed.body))throw Error('Fixture request does not match host transport');
    }
  }
  return receipt.status==='complete'&&receipt.provider_requests===2&&providers===2&&receipt.fixture_requests===fixtures&&fixtures>0
    &&receipt.provider_inference_requests===0&&receipt.total_bytes===total&&total<=limits.totalBytes;
}

/** Diagnostic claims remain claims until an external lifecycle check is supplied.
 * Never turn a guest JSON report into an isolation capability or benchmark pass.
 */
export function inspectProbe(root){
  unlinkedDirectory(root);
  const manifest=JSON.parse(readBoundedFile(root,'session.json',16384));
  if(manifest.schema_version!==2||manifest.kind!=='sandbox-boundary-probe'||manifest.status!=='prepared'||path.basename(root)!==manifest.id)throw Error('Invalid probe identity or protocol');
  const input=path.join(root,'input'),output=path.join(root,'output'),privateDir=path.join(root,'private');
  if(canonical(manifest.input)!==canonical(input)||canonical(manifest.output)!==canonical(output)||canonical(manifest.private_file)!==canonical(path.join(privateDir,'host-only.bin')))throw Error('Changed probe mappings');
  if(hash(readBoundedFile(root,'probe.wsb',16384))!==manifest.configuration_sha256)throw Error('Changed Sandbox configuration');
  for(const [name,sha] of Object.entries(manifest.inputs))if(hash(readBoundedFile(input,name,['submission-packet.json','actor-packet.json'].includes(name)?8*1024*1024:1024*1024))!==sha)throw Error('Probe input changed: '+name);
  if(hash(readBoundedFile(privateDir,'host-only.bin'))!==manifest.private_sha256)throw Error('Unmapped host sentinel changed');
  const names=fs.readdirSync(output);
  if(manifest.mission_job){
    const declared=['probe-result.json','grading-key.json','actor-export.json','mission-trace.json'];
    if(!declared.every(name=>names.includes(name))||names.length>MISSION_RPC_LIMITS.messages+declared.length||names.some(name=>!declared.includes(name)&&!/^rpc-request-\d{6}\.json$/.test(name)))throw Error('Unexpected mission output files');
  }else if(manifest.transport_smoke){
    if(!names.includes('probe-result.json')||names.length>(manifest.fixture_mission?MISSION_RPC_LIMITS:RPC_LIMITS).messages+1||names.some(name=>name!=='probe-result.json'&&!/^rpc-request-\d{6}\.json$/.test(name)))throw Error('Unexpected transport result files');
  }else if(manifest.grader_controls){
    if(!names.includes('probe-result.json')||names.length>2||names.some(name=>!['probe-result.json','grader-evidence.json'].includes(name)))throw Error('Unexpected grader output files');
  }else if(manifest.actor_control){
    if(names.length!==3||!['probe-result.json','grading-key.json','actor-export.json'].every(name=>names.includes(name)))throw Error('Unexpected protected actor output');
  }else if(manifest.submission_job){
    if(names.length!==2||!names.includes('probe-result.json')||!names.includes('grading-key.json'))throw Error('Unexpected submission grading output');
  }else if(manifest.candidate_control){
    if(!names.includes('probe-result.json')||names.some(name=>!['probe-result.json','candidate-write.txt','grading-key.json'].includes(name)))throw Error('Unexpected account-probe output');
  }else if(names.length!==1||names[0]!=='probe-result.json')throw Error('Probe requires exactly one declared result file');
  const bytes=readBoundedFile(output,'probe-result.json',manifest.grading_auth?1024*1024:65536),guest=JSON.parse(bytes);
  if(guest.id!==manifest.id||guest.nonce!==manifest.nonce||guest.schema_version!==2)throw Error('Guest result identity mismatch');
  let base=guest,smoke=guest.runtime_smoke,actorExport=null;
  if(manifest.grading_auth){
    const identity={id:manifest.id,nonce:manifest.nonce,packet_sha256:manifest.auth_packet_sha256};
    const pinned=JSON.parse(readBoundedFile(privateDir,'grading-auth.json',16384));
    if(pinned.status!=='verified'||pinned.id!==manifest.id||pinned.nonce!==manifest.nonce)throw Error('No verified host-pinned grading key');
    const key=pinControllerKey({schema_version:1,id:manifest.id,nonce:manifest.nonce,key_spki:pinned.key_spki},identity);
    if(key.fingerprint!==pinned.key_sha256)throw Error('Pinned grading key changed');
    smoke=verifyGradingResult(smoke,key,identity);base=smoke.base;
    if(base?.id!==manifest.id||base.nonce!==manifest.nonce)throw Error('Signed base observation identity mismatch');
  }
  const checks={different_computer:typeof base.computer==='string'&&base.computer!==manifest.host_name,
    input_read:base.challenge_sha256===manifest.inputs['challenge.txt'],input_read_only:base.input_write_denied===true,
    host_private_unavailable:base.private_read_denied===true,network_disabled:base.active_nonloopback_adapters===0,
    writable_output:base.output_written===true,fresh_guest_disk:base.marker_preexisting===false&&base.marker_created===true};
  if(manifest.grading_auth)checks.authenticated_controller=true;
  if(manifest.mission_job){
    const packet=validateMissionPacket(readBoundedFile(input,'actor-packet.json',ARTIFACT_LIMITS.packetBytes),manifest.mission_job);
    checks.protected_mission=missionResultMatches(smoke,manifest.mission_job);
    const exportedBytes=readBoundedFile(output,'actor-export.json',ARTIFACT_LIMITS.packetBytes),traceBytes=readBoundedFile(output,'mission-trace.json',MISSION_TRACE_LIMIT);
    if(hash(exportedBytes)!==smoke.artifact_export?.sha256||hash(traceBytes)!==smoke.trace?.sha256)throw Error('Mission artifact/trace changed after signing');
    const exported=validateActorArtifacts(exportedBytes,{id:manifest.id,nonce:manifest.nonce},manifest.mission_job.exported_names),trace=JSON.parse(traceBytes);
    if(trace.id!==manifest.id||trace.nonce!==manifest.nonce||trace.mission!==manifest.mission_job.mission)throw Error('Mission trace identity changed');
    checks.host_mission_transport=inspectMissionExchange({manifest,input,output,privateDir,actorUsage:smoke.actor?.usage,packet});
    actorExport={sha256:hash(exportedBytes),files:exported.files.map(({base64,...file})=>file)};
  }else if(manifest.actor_control){
    checks.protected_actor_runtime=protectedActorMatches(smoke,manifest.runtime_bundle.versions);
    const bytes=readBoundedFile(output,'actor-export.json',ARTIFACT_LIMITS.packetBytes);
    if(hash(bytes)!==smoke.artifact_export?.sha256)throw Error('Actor export changed after signing');
    const exported=validateActorArtifacts(bytes,{id:manifest.id,nonce:manifest.nonce},['actor-input.txt','actor-output.txt']);
    checks.actor_export=exported.files.every(file=>file.status==='retained'&&file.sha256===manifest.inputs['challenge.txt']);
    actorExport={sha256:hash(bytes),files:exported.files.map(({base64,...file})=>file)};
  }else if(manifest.submission_job){
    checks.submission_grading=validateSubmissionAssessment(smoke,manifest.submission_job);
  }else if(manifest.candidate_control){
    const boundary=smoke?.boundary;
    checks.candidate_boundary=smoke?.kind==='guest-candidate-boundary-control'&&smoke.status==='passed'&&smoke.provider_inference_requests===0
      &&smoke.failed_child_exit===37&&boundary?.username?.toLowerCase()==='zeuscandidate'&&boundary.is_admin===false
      &&smoke.descendant_reaped===true&&smoke.timeout_reaped===true
      &&['private_read_denied','private_write_denied','controller_process_denied','runtime_write_denied','runtime_readable','scratch_writable'].every(key=>boundary[key]===true);
  }else if(manifest.grader_controls){
    const smoke=guest.runtime_smoke;
    checks.grader_runtime=gradingSmokeMatches(smoke,manifest.grader_controls)&&names.includes('grader-evidence.json');
    if(checks.grader_runtime){
      const evidence=readBoundedFile(output,'grader-evidence.json',2*1024*1024);
      checks.grader_evidence=hash(evidence)===smoke.evidence_sha256;
      const rows=JSON.parse(evidence);
      checks.grader_evidence&&=gradingSmokeMatches({...smoke,results:rows.map(row=>({mission:row.mission,variant:row.variant,source_sha256:row.source_sha256,...row.assessment}))},manifest.grader_controls);
    }
  }else if(manifest.runtime_bundle){
    checks.runtime_smoke=runtimeSmokeMatches(guest.runtime_smoke,manifest.runtime_bundle.versions);
  }
  if(manifest.transport_smoke){
    checks.host_file_transport=inspectHostTransport({input,output,privateDir,id:manifest.id,nonce:manifest.nonce,mission:manifest.fixture_mission});
  }
  return {id:manifest.id,status:Object.values(checks).every(Boolean)?'probe_claims_consistent':'probe_failed',
    checks,guest,actor_export:actorExport,graded_assessment:manifest.submission_job?smoke.assessment:null,result_sha256:hash(bytes),isolation_validated:false,
    note:'No VM lifecycle evidence has been checked. This report cannot authorize an isolated benchmark run.'};
}
