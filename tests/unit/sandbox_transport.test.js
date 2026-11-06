import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {withScratch} from '../benchmarks/mission_kit.js';
import {readBoundedFile,inspectHostTransport} from '../../scripts/eval_harness/sandbox/session.js';
import {RPC_LIMITS,validateRequest,validateResponse,createHostExchange,createFileClient,requestName,responseName,atomicExchange,publishResponse,encodeResponseFrame,decodeResponseFrame} from '../../scripts/eval_harness/sandbox/file_rpc.mjs';
const nonce='a'.repeat(48);
const value=(extra={})=>({schema_version:1,nonce,id:1,channel:'provider',method:'POST',path:'/chat/completions',body_base64:Buffer.from('{"model":"phase1-mock"}').toString('base64'),...extra});
function folders(root){const input=path.join(root,'input'),output=path.join(root,'output');fs.mkdirSync(input);fs.mkdirSync(output);for(let id=1;id<=RPC_LIMITS.messages;id++)fs.writeFileSync(path.join(input,responseName(id)),'');return {input,output};}

test('file transport accepts only the declared provider and fixture routes without arbitrary headers or URLs',()=>{
  assert.equal(validateRequest(value(),nonce).channel,'provider');
  assert.equal(validateRequest(value({channel:'fixture',method:'GET',path:'/',body_base64:''}),nonce).body.length,0);
  for(const extra of [{nonce:'stale'},{id:0},{id:33},{path:'https://example.com/'},{path:'/../../private'},
    {channel:'shell'},{method:'CONNECT'},{headers:{Authorization:'secret'}},{body_base64:'!'},
    {channel:'fixture',method:'GET',path:'/',body_base64:'YQ=='}])assert.throws(()=>validateRequest(value(extra),nonce));
  assert.equal(validateRequest(value({body_base64:Buffer.alloc(1024*1024).toString('base64')}),nonce).body.length,1024*1024);
  assert.throws(()=>validateRequest(value({body_base64:Buffer.alloc(1024*1024+1).toString('base64')}),nonce),/bounds|body/);
  const response={schema_version:1,nonce,id:1,status:200,content_type:'text/event-stream',body_base64:'YQ=='};
  assert.equal(validateResponse(response,nonce,1).body.toString(),'a');
  for(const extra of [{id:2},{status:101},{status:700},{content_type:'application/javascript'},{body_base64:'YQ='}])assert.throws(()=>validateResponse({...response,...extra},nonce,1));
});

test('one immutable request is handled once, replies are hashed, and changed requests close the broker',()=>withScratch(async root=>{
  const {input,output}=folders(root);let calls=0;
  const host=createHostExchange({input,output,nonce,read:readBoundedFile,handle:async()=>{calls++;return {status:200,content_type:'text/html',body:'hello'};}});
  fs.writeFileSync(path.join(output,requestName(1)),JSON.stringify(value()));
  await host.step();await host.step();assert.equal(calls,1);assert.equal(host.rows.length,1);
  assert.equal(host.rows[0].request_sha256.length,64);assert.equal(host.rows[0].response_sha256.length,64);
  const reply=validateResponse(JSON.parse(decodeResponseFrame(readBoundedFile(input,responseName(1)))),nonce,1);assert.equal(reply.body.toString(),'hello');
  fs.appendFileSync(path.join(output,requestName(1)),' ');
  await assert.rejects(host.step(),/changed/);await assert.rejects(host.step(),/closed/);assert.equal(calls,1);
}));

test('client/host round trip is data only and missing replies expire without resending',()=>withScratch(async root=>{
  const {input,output}=folders(root);let calls=0;
  const client=createFileClient({input,output,nonce,read:readBoundedFile,timeoutMs:2000});
  const host=createHostExchange({input,output,nonce,read:readBoundedFile,handle:async request=>{calls++;return {status:200,content_type:'application/json',body:JSON.stringify({bytes:request.body.length})};}});
  const pending=client('provider','POST','/chat/completions',Buffer.from('{}'));
  await host.step();assert.equal(JSON.parse((await pending).body).bytes,2);assert.equal(calls,1);
  const expiring=createFileClient({input,output,nonce,read:readBoundedFile,timeoutMs:30});
  fs.unlinkSync(path.join(output,requestName(1)));fs.unlinkSync(path.join(input,responseName(1)));
  await assert.rejects(expiring('fixture','GET','/'),/not retried/);
  assert.deepEqual(fs.readdirSync(output),[requestName(1)]);
}));

test('malformed, extra or excessive exchange files cannot trigger host handlers',()=>withScratch(async root=>{
  for(const [index,prepare] of [
    output=>fs.writeFileSync(path.join(output,'arbitrary.json'),'{}'),
    output=>fs.writeFileSync(path.join(output,requestName(2)),JSON.stringify(value())),
    output=>fs.writeFileSync(path.join(output,requestName(1)),Buffer.alloc(RPC_LIMITS.requestBytes+1)),
    output=>{for(let i=0;i<70;i++)fs.writeFileSync(path.join(output,'junk'+i),'');},
  ].entries()){
    const dir=path.join(root,String(index));fs.mkdirSync(dir);const {input,output}=folders(dir);prepare(output);let calls=0;
    const host=createHostExchange({input,output,nonce,read:readBoundedFile,handle:async()=>{calls++;throw Error('must not be called');}});
    await assert.rejects(host.step());assert.equal(calls,0);await assert.rejects(host.step(),/closed/);
  }
}));

test('transient request publication locks are bounded and response frames reject partial/corrupt bytes and reuse',()=>withScratch(async root=>{
  const {input,output}=folders(root);let renames=0;
  await atomicExchange(output,requestName(1),Buffer.from('request'),{rename:(source,target)=>{
    if(++renames<3)throw Object.assign(Error('Synthetic sharing lock'),{code:'EBUSY'});fs.renameSync(source,target);
  }});assert.equal(renames,3);
  const locked=()=>{throw Object.assign(Error('Persistent lock'),{code:'EBUSY'});};
  await assert.rejects(atomicExchange(output,'locked.json',Buffer.from('data'),{rename:locked,timeoutMs:30}),/Persistent lock/);
  assert.equal(fs.existsSync(path.join(output,'locked.json')),false);
  const data=Buffer.from('response'),frame=encodeResponseFrame(data);
  for(const length of [0,10,79,80,81,frame.length-1])assert.equal(decodeResponseFrame(frame.subarray(0,length)),null);
  assert.equal(decodeResponseFrame(frame).toString(),'response');
  const corrupt=Buffer.from(frame);corrupt[82]^=1;assert.throws(()=>decodeResponseFrame(corrupt),/checksum/);
  await publishResponse(input,responseName(1),data);
  assert.equal(decodeResponseFrame(readBoundedFile(input,responseName(1))).toString(),'response');
  await assert.rejects(publishResponse(input,responseName(1),data),/already used/);
}));

test('response publication failure stops the broker after one handler invocation',()=>withScratch(async root=>{
  const {input,output}=folders(root);let calls=0;
  const host=createHostExchange({input,output,nonce,read:readBoundedFile,publish:async()=>{throw Error('Publication failed');},handle:async()=>{calls++;return {status:200,content_type:'text/html',body:'one response'};}});
  fs.writeFileSync(path.join(output,requestName(1)),JSON.stringify(value()));
  await assert.rejects(host.step(),/Publication failed/);await assert.rejects(host.step(),/closed/);assert.equal(calls,1);
}));

test('Windows redirected broker process handles retain both successful and failed exit codes',{skip:process.platform!=='win32'},()=>withScratch(root=>{
  const script="$ErrorActionPreference='Stop'; . $env:ZEUS_PROCESS_STATUS; foreach ($expected in @(0,37,259)) { $env:ZEUS_EXIT_GATE=Join-Path $env:ZEUS_PROBE_ROOT ('gate-'+$expected); $env:ZEUS_EXIT_CODE=[string]$expected; $argsList=@('-e',\"setInterval(()=>{if(require('fs').existsSync(process.env.ZEUS_EXIT_GATE))process.exit(Number(process.env.ZEUS_EXIT_CODE))},10)\"); $child=Start-Process -FilePath $env:ZEUS_PROBE_NODE -ArgumentList $argsList -WindowStyle Hidden -PassThru -RedirectStandardOutput ($env:ZEUS_PROBE_ROOT+'\\out-'+$expected) -RedirectStandardError ($env:ZEUS_PROBE_ROOT+'\\err-'+$expected); try { $pending=[ZeusBenchmarkProcessStatus]::ExitCode($child,0); [IO.File]::WriteAllText($env:ZEUS_EXIT_GATE,'exit'); $actual=[ZeusBenchmarkProcessStatus]::ExitCode($child,5000); [ordered]@{expected=$expected;pending=($null -eq $pending);waited=($null -ne $actual);exit_code=$actual} | ConvertTo-Json -Compress } finally { if (-not $child.HasExited) { $child.Kill() }; $child.Dispose() } }";
  const result=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','RemoteSigned','-Command',script],{env:{...process.env,ZEUS_PROBE_NODE:process.execPath,ZEUS_PROBE_ROOT:root,ZEUS_PROCESS_STATUS:path.resolve('scripts/eval_harness/sandbox/process_status.ps1')},windowsHide:true,encoding:'utf8',timeout:15000});
  assert.equal(result.status,0,result.stderr);
  const rows=result.stdout.trim().split(/\r?\n/).map(line=>JSON.parse(line));
  assert.deepEqual(rows,[0,37,259].map(expected=>({expected,pending:true,waited:true,exit_code:expected})));
}));

test('independent transport inspection rejects altered responses, stale receipts, invented usage and undeclared files',()=>withScratch(async root=>{
  const {input,output}=folders(root),privateDir=path.join(root,'private'),id='synthetic';fs.mkdirSync(privateDir);
  const host=createHostExchange({input,output,nonce,read:readBoundedFile,handle:async()=>({status:200,content_type:'application/json',body:'{}'})});
  for(const request of [value(),value({id:2,channel:'fixture',method:'GET',path:'/',body_base64:''}),value({id:3})]){
    fs.writeFileSync(path.join(output,requestName(request.id)),JSON.stringify(request));await host.step();
  }
  fs.writeFileSync(path.join(output,'probe-result.json'),'{}');
  const receipt={id,nonce,kind:'host-observed-synthetic-file-transport',status:'complete',provider_requests:2,fixture_requests:1,provider_inference_requests:0,requests:host.rows,total_bytes:host.totalBytes};
  const save=value=>fs.writeFileSync(path.join(privateDir,'transport.json'),JSON.stringify(value));
  const inspect=()=>inspectHostTransport({input,output,privateDir,id,nonce});save(receipt);assert.equal(inspect(),true);
  save({...receipt,provider_requests:3});assert.equal(inspect(),false);
  save({...receipt,status:'running'});assert.equal(inspect(),false);
  save({...receipt,nonce:'stale'});assert.throws(inspect,/identity/);save(receipt);
  const file=path.join(input,responseName(1)),original=fs.readFileSync(file);fs.appendFileSync(file,'x');assert.throws(inspect,/changed/);fs.writeFileSync(file,original);
  fs.writeFileSync(path.join(output,'extra.txt'),'unexpected');assert.throws(inspect,/Unexpected/);
}));
