import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {prepareActorPacket} from '../../scripts/eval_harness/sandbox/actor_packet.mjs';
import {validateMissionPacket,missionResultMatches,missionDigest} from '../../scripts/eval_harness/sandbox/mission_contract.mjs';
import {controlReplies,prepareIsolatedMission} from '../../scripts/eval_harness/sandbox/isolated_mission.mjs';
import {scriptedProvider} from '../../scripts/eval_harness/sandbox/scripted_provider.mjs';
import {createProviderRelay,PROVIDER_IDENTITY} from '../../scripts/eval_harness/sandbox/provider_relay.mjs';
import {createMissionHostExchange,createMissionFileClient} from '../../scripts/eval_harness/sandbox/mission_rpc.mjs';
import {responseName} from '../../scripts/eval_harness/sandbox/file_rpc.mjs';
import {readBoundedFile} from '../../scripts/eval_harness/sandbox/exchange_files.mjs';
import {inspectMissionExchange} from '../../scripts/eval_harness/sandbox/mission_receipt.mjs';
import {prepareProbe} from '../../scripts/eval_harness/sandbox/session.js';
import {withScratch} from '../benchmarks/mission_kit.js';
const nonce='a'.repeat(48);
test('Windows controller rejects extended ordinary probes and undeclared hosted modes before launching any window',{skip:process.platform!=='win32'},()=>{
  const parent=path.resolve('.zeus/evaluations/sandbox-sessions'),prepared=prepareProbe(parent);
  try{
    for(const hosted of [false,true]){
      if(hosted)fs.writeFileSync(path.join(prepared.root,'session.json'),JSON.stringify({...prepared.manifest,mission_job:{mode:'hosted',controller_timeout_secs:780}}));
      const result=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','RemoteSigned','-File',path.resolve('scripts/eval_harness/sandbox/run_probe.ps1'),'-Mode','Run','-SessionDirectory',prepared.root,'-TimeoutSeconds','780'],{encoding:'utf8',windowsHide:true,timeout:15000});
      assert.notEqual(result.status,0);assert.match(result.stderr,hosted?/Only the declared 780-second scripted mission control/:/Ordinary probes retain their 180-second maximum/);
      assert.equal(fs.existsSync(path.join(prepared.root,'host-launch.json')),false);assert.deepEqual(fs.readdirSync(path.join(prepared.root,'output')),[]);
    }
  }finally{
    const target=fs.realpathSync(prepared.root);assert.equal(path.dirname(target).toLowerCase(),fs.realpathSync(parent).toLowerCase());assert.match(path.basename(target),/^[a-f0-9-]{36}$/);fs.rmSync(target,{recursive:true});
  }
});
function expectedFor(actor){const packet=JSON.parse(actor.bytes);return {mode:'scripted_control',mission:packet.mission,architecture:packet.architecture,packet_sha256:actor.sha256,configuration_fingerprint:packet.configuration.configuration_fingerprint,exported_names:actor.exportedNames,limits:packet.limits};}
test('single-turn isolated packets bind model/configuration, inputs, output names and limits',()=>{
  for(const id of ['C01','C02','C03','D01','D02','R01','V01']){
    const actor=prepareActorPacket(id),expected=expectedFor(actor);assert.equal(validateMissionPacket(actor.bytes,expected).mission,id);
    for(const modify of [e=>e.mode='hosted',e=>e.packet_sha256='0'.repeat(64),e=>e.configuration_fingerprint='wrong',e=>e.exported_names=['foreign.txt'],e=>e.limits={...e.limits,wall_time_ms:1}]){
      const invalid=structuredClone(expected);modify(invalid);assert.throws(()=>validateMissionPacket(actor.bytes,invalid));
    }
  }
  assert.throws(()=>prepareIsolatedMission({id:'D01',mode:'hosted'}),/gated/);
  assert.equal(controlReplies('B01')[0].type,'run_action');
});
test('scripted controls preserve exact known reference bytes and include a deliberate wrong-output control',()=>{
  const replies=controlReplies('C01');assert.equal(replies[0].type,'write_file');assert.equal(replies[0].content,fs.readFileSync('tests/benchmarks/missions/v1/C01/reference/flattener.py','utf8'));
  assert.equal(replies.at(-1).type,'final_answer');assert.notEqual(controlReplies('D01')[0].content,'{}');assert.equal(controlReplies('D01','invalid-output')[0].content,'{}');
  const cli=spawnSync(process.execPath,['scripts/eval_harness/run_isolated_mission.js','--live'],{encoding:'utf8',windowsHide:true});assert.notEqual(cli.status,0);assert.match(cli.stderr,/hosted --live dispatch remains gated/);
  const duplicate=spawnSync(process.execPath,['scripts/eval_harness/run_isolated_mission.js','--mission','D01,D01','--runtime-bundle','unused','--run'],{encoding:'utf8',windowsHide:true});assert.notEqual(duplicate.status,0);assert.match(duplicate.stderr,/unique supported/);
});
test('protected collection accepts task failure but requires real identity, cleanup and signed export hashes',()=>{
  const expected={mission:'D01',mode:'scripted_control',configuration_fingerprint:'f'},result={kind:'isolated-mission-result-v1',status:'completed',...expected,provider_inference_requests:0,
    actor:{actor_start:{username:'ZeusCandidate',is_admin:false,pid:42},execution_status:'failed'},boundary:{username:'ZeusCandidate',is_admin:false,private_read_denied:true,private_write_denied:true,controller_process_denied:true,runtime_write_denied:true,runtime_readable:true,scratch_writable:true},candidate_cleanup:{remaining:0,account_disabled:true},artifact_export:{sha256:'a'.repeat(64)},trace:{sha256:'b'.repeat(64)}};
  assert.equal(missionResultMatches(result,expected),true);
  for(const change of [r=>r.actor.actor_start.is_admin=true,r=>r.boundary.controller_process_denied=false,r=>r.candidate_cleanup.remaining=1,r=>r.candidate_cleanup.account_disabled=false,r=>r.trace.sha256='bad',r=>r.provider_inference_requests=1]){
    const invalid=structuredClone(result);change(invalid);assert.equal(missionResultMatches(invalid,expected),false);
  }
});
test('combined mission transport keeps scripted usage separate and verifies both wire and provider ledger hashes',()=>withScratch(async root=>{
  const input=path.join(root,'input'),output=path.join(root,'output'),privateDir=path.join(root,'private');for(const folder of [input,output,privateDir])fs.mkdirSync(folder);
  const limits={max_requests:10,max_tokens:1000000,max_output_tokens:8192,wall_time_ms:600000,max_in_flight:1};
  const relay=createProviderRelay({privateDirectory:privateDir,id:'trial',nonce,limits,executionKind:'scripted_control',transport:scriptedProvider([{type:'final_answer',final_answer:{summary:'calibration'}}])});
  await relay.preflight();fs.writeFileSync(path.join(input,responseName(1)),Buffer.alloc(0));fs.writeFileSync(path.join(output,'grading-key.json'),'{}');
  const client=createMissionFileClient({input,output,nonce,mission:'D01',read:readBoundedFile});
  const exchange=createMissionHostExchange({input,output,nonce,mission:'D01',read:readBoundedFile,additionalOutputNames:['grading-key.json'],handle:value=>relay.request(value.id,value.body)});
  const payload=Buffer.from(JSON.stringify({model:PROVIDER_IDENTITY.model,reasoning_effort:'low',max_tokens:8192,messages:[{role:'user',content:'test'}]}));
  const pending=client('provider','POST','/chat/completions',payload);await exchange.step();const reply=await pending;assert.equal(JSON.parse(reply.body).usage.total_tokens,10);
  const ledger=relay.snapshot();assert.equal(ledger.execution_kind,'scripted_control');assert.equal(ledger.requests.length,1);assert.equal(ledger.unknown_requests,0);
  const host={kind:'host-mission-transport-v1',status:'complete',id:'trial',nonce,mode:'scripted_control',provider_inference_requests:0,provider_ledger_sha256:missionDigest(readBoundedFile(privateDir,'provider-ledger.json',65536)),requests:exchange.rows,total_bytes:exchange.totalBytes};
  fs.writeFileSync(path.join(privateDir,'mission-host.json'),JSON.stringify(host));const args={manifest:{id:'trial',nonce,mission_job:{mission:'D01'}},input,output,privateDir};assert.equal(inspectMissionExchange(args),true);
  assert.equal(inspectMissionExchange({...args,actorUsage:{requests:1,unknown_requests:0,known_tokens:10}}),true);
  assert.throws(()=>inspectMissionExchange({...args,actorUsage:{requests:2,unknown_requests:0,known_tokens:10}}),/App usage/);
  const providerFile=path.join(privateDir,'provider-ledger.json'),original=fs.readFileSync(providerFile);fs.writeFileSync(providerFile,JSON.stringify({...ledger,execution_kind:'hosted'}));assert.throws(()=>inspectMissionExchange(args),/receipt/);fs.writeFileSync(providerFile,original);
  fs.appendFileSync(path.join(output,'rpc-request-000001.json'),' ');assert.throws(()=>inspectMissionExchange(args),/changed/);
}));
