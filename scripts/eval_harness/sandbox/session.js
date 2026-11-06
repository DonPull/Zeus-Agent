/** .wsb preparation and bounded data reads. Never launches a VM or candidate. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {RPC_LIMITS,validateRequest,validateResponse,responseName,decodeResponseFrame} from './file_rpc.mjs';
import {prepareGraderPacket,gradingSmokeMatches} from './grader_packet.mjs';

const directory=path.dirname(fileURLToPath(import.meta.url));
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const xml=value=>String(value).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
const canonical=value=>path.toNamespacedPath(path.resolve(value)).toLowerCase();
export function unlinkedDirectory(location,{create=false}={}){
  const absolute=path.resolve(location),ancestors=[];
  for(let cursor=absolute;;cursor=path.dirname(cursor)){
    ancestors.unshift(cursor);if(path.dirname(cursor)===cursor)break;
  }
  for(const cursor of ancestors){
    if(!fs.existsSync(cursor)){
      if(!create)throw Error('Missing owned directory');
      fs.mkdirSync(cursor);
    }
    const stat=fs.lstatSync(cursor);
    if(!stat.isDirectory()||stat.isSymbolicLink()||canonical(fs.realpathSync(cursor))!==canonical(cursor))throw Error('Linked or redirected directory is not accepted');
  }
  return absolute;
}

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

/** Read bytes only; no shell, dynamic import, HTML rendering or model-selected path. */
export function readBoundedFile(root,name,limit=1024*1024){
  if(typeof name!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(name)||name.includes(':')||name.endsWith('.')||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))throw Error('Invalid exchange filename');
  if(!Number.isSafeInteger(limit)||limit<1||limit>64*1024*1024)throw Error('Invalid exchange byte limit');
  const base=unlinkedDirectory(root),file=path.join(base,name),before=fs.lstatSync(file);
  if(!before.isFile()||before.isSymbolicLink()||before.size>limit||canonical(fs.realpathSync(file))!==canonical(file))throw Error('Exchange file must be a bounded unlinked regular file');
  const fd=fs.openSync(file,'r');
  try{
    const opened=fs.fstatSync(fd);
    if(opened.dev!==before.dev||opened.ino!==before.ino||!opened.isFile())throw Error('Exchange file changed while opening');
    const buffer=Buffer.alloc(Math.min(limit+1,opened.size+1));let length=0;
    while(length<buffer.length){const n=fs.readSync(fd,buffer,length,buffer.length-length,null);if(!n)break;length+=n;}
    const after=fs.fstatSync(fd);
    if(length!==opened.size||after.size!==opened.size||after.mtimeMs!==opened.mtimeMs)throw Error('Exchange file changed while reading');
    return buffer.subarray(0,length);
  }finally{fs.closeSync(fd);}
}

export function prepareProbe(parent,{runtimeBundle=null,transportSmoke=false,transportDenyTest=false,gradingSmoke=false}={}){
  if(process.platform!=='win32')throw Error('The .wsb probe requires a Windows host');
  if(transportSmoke&&!runtimeBundle)throw Error('Transport smoke requires a prepared public runtime');
  if(transportDenyTest&&!transportSmoke)throw Error('A deny control requires synthetic transport');
  if(gradingSmoke&&(!runtimeBundle||transportSmoke||transportDenyTest))throw Error('Grading controls require a separate runtime guest without actor transport');
  let runtimeInfo=null;
  if(runtimeBundle){
    runtimeBundle=unlinkedDirectory(runtimeBundle);
    const runtimeParent=path.resolve(directory,'../../../.zeus/evaluations/sandbox-runtime');
    if(canonical(path.dirname(runtimeBundle))!==canonical(runtimeParent)||!/^bundle-[0-9a-f-]{36}$/.test(path.basename(runtimeBundle)))throw Error('Use a staged public runtime bundle');
    const bytes=readBoundedFile(runtimeBundle,'bundle.json',4*1024*1024),bundle=JSON.parse(bytes);
    if(bundle.kind!=='public-sandbox-runtime-bundle'||bundle.status!=='staged-unproven'||!Array.isArray(bundle.files)||bundle.files.length>20000||bundle.bytes>2*1024**3)throw Error('Invalid runtime bundle identity');
    runtimeInfo={path:runtimeBundle,manifest_sha256:hash(bytes),content_sha256:bundle.content_sha256,versions:bundle.versions};
  }
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
  if(transportDenyTest)job.runtime_smoke.deny_test=true;
  const grading=gradingSmoke?prepareGraderPacket():null;
  if(grading)job.runtime_smoke.mode='grader-controls-v1';
  const inputs={'job.json':Buffer.from(JSON.stringify(job,null,2)),'challenge.txt':challenge,'probe.ps1':fs.readFileSync(path.join(directory,'probe_guest.ps1'))};
  if(runtimeInfo)for(const name of ['guest_smoke.mjs','guest_diagnostics.ps1'])inputs[name]=fs.readFileSync(path.join(directory,name));
  if(transportSmoke)inputs['file_rpc.mjs']=fs.readFileSync(path.join(directory,'file_rpc.mjs'));
  if(grading){inputs['guest_grading.mjs']=fs.readFileSync(path.join(directory,'guest_grading.mjs'));inputs['grader-packet.json']=grading.bytes;}
  for(const [name,bytes] of Object.entries(inputs))fs.writeFileSync(path.join(input,name),bytes,{flag:'wx'});
  if(transportSmoke)for(let id=1;id<=RPC_LIMITS.messages;id++)fs.writeFileSync(path.join(input,responseName(id)),Buffer.alloc(0),{flag:'wx'});
  const wsb=sandboxConfiguration({input,output,runtime:runtimeBundle});
  fs.writeFileSync(path.join(root,'probe.wsb'),wsb,{flag:'wx'});
  const manifest={schema_version:2,id,kind:'sandbox-boundary-probe',status:'prepared',created_at:new Date().toISOString(),
    host_name:os.hostname(),nonce,input,output,private_file:privateFile,private_sha256:hash(sentinel),
    inputs:Object.fromEntries(Object.entries(inputs).map(([name,bytes])=>[name,hash(bytes)])),configuration_sha256:hash(wsb),
    memory_mb:4096,networking:'disabled',mappings:runtimeBundle?3:2,runtime_bundle:runtimeInfo,transport_smoke:transportSmoke?'synthetic-file-v1':null,grader_controls:grading?.expected??null,provider_requests:0,launch_requested:false,
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

export function inspectHostTransport({input,output,privateDir,id,nonce}){
  const names=fs.readdirSync(output);
  if(!names.includes('probe-result.json')||names.length>RPC_LIMITS.messages+1||names.some(name=>name!=='probe-result.json'&&!/^rpc-request-\d{6}\.json$/.test(name)))throw Error('Unexpected transport result files');
  const receipt=JSON.parse(readBoundedFile(privateDir,'transport.json',65536));
  let total=0,providers=0,fixtures=0;
  if(receipt.id!==id||receipt.nonce!==nonce||receipt.kind!=='host-observed-synthetic-file-transport'||!Array.isArray(receipt.requests)||receipt.requests.length!==names.length-1)throw Error('Invalid host transport receipt identity');
  const ids=new Set();
  for(const row of receipt.requests){
    if(ids.has(row.id))throw Error('Duplicate host exchange identity');ids.add(row.id);
    const request=readBoundedFile(output,'rpc-request-'+String(row.id).padStart(6,'0')+'.json',RPC_LIMITS.requestBytes);
    const response=readBoundedFile(input,responseName(row.id),RPC_LIMITS.responseBytes);
    if(hash(request)!==row.request_sha256||hash(response)!==row.response_sha256)throw Error('Exchange bytes changed after host handling');
    const observed=validateRequest(JSON.parse(request),nonce);
    if(observed.id!==row.id||observed.channel!==row.channel||observed.method!==row.method||observed.path!==row.path)throw Error('Host transport metadata mismatch');
    if(observed.channel==='provider')providers++;else fixtures++;
    const body=decodeResponseFrame(response);if(!body)throw Error('Incomplete host response frame');
    validateResponse(JSON.parse(body),nonce,row.id);
    total+=request.length+response.length;
  }
  return receipt.status==='complete'&&receipt.provider_requests===2&&providers===2&&receipt.fixture_requests===fixtures&&fixtures>0
    &&receipt.provider_inference_requests===0&&receipt.total_bytes===total&&total<=RPC_LIMITS.totalBytes;
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
  for(const [name,sha] of Object.entries(manifest.inputs))if(hash(readBoundedFile(input,name))!==sha)throw Error('Probe input changed: '+name);
  if(hash(readBoundedFile(privateDir,'host-only.bin'))!==manifest.private_sha256)throw Error('Unmapped host sentinel changed');
  const names=fs.readdirSync(output);
  if(manifest.transport_smoke){
    if(!names.includes('probe-result.json')||names.length>RPC_LIMITS.messages+1||names.some(name=>name!=='probe-result.json'&&!/^rpc-request-\d{6}\.json$/.test(name)))throw Error('Unexpected transport result files');
  }else if(manifest.grader_controls){
    if(!names.includes('probe-result.json')||names.length>2||names.some(name=>!['probe-result.json','grader-evidence.json'].includes(name)))throw Error('Unexpected grader output files');
  }else if(names.length!==1||names[0]!=='probe-result.json')throw Error('Probe requires exactly one declared result file');
  const bytes=readBoundedFile(output,'probe-result.json',65536),guest=JSON.parse(bytes);
  if(guest.id!==manifest.id||guest.nonce!==manifest.nonce||guest.schema_version!==2)throw Error('Guest result identity mismatch');
  const checks={different_computer:typeof guest.computer==='string'&&guest.computer!==manifest.host_name,
    input_read:guest.challenge_sha256===manifest.inputs['challenge.txt'],input_read_only:guest.input_write_denied===true,
    host_private_unavailable:guest.private_read_denied===true,network_disabled:guest.active_nonloopback_adapters===0,
    writable_output:guest.output_written===true,fresh_guest_disk:guest.marker_preexisting===false&&guest.marker_created===true};
  if(manifest.grader_controls){
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
    checks.host_file_transport=inspectHostTransport({input,output,privateDir,id:manifest.id,nonce:manifest.nonce});
  }
  return {id:manifest.id,status:Object.values(checks).every(Boolean)?'probe_claims_consistent':'probe_failed',
    checks,guest,result_sha256:hash(bytes),isolation_validated:false,
    note:'No VM lifecycle evidence has been checked. This report cannot authorize an isolated benchmark run.'};
}
