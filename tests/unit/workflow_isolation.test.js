import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {trackChild} from '../../scripts/eval_harness/sandbox/child_lifecycle.mjs';
import {withScratch} from '../benchmarks/mission_kit.js';
import {prepareActorPacket} from '../../scripts/eval_harness/sandbox/actor_packet.mjs';
import {controlReplies} from '../../scripts/eval_harness/sandbox/isolated_mission.mjs';
import {controlActionDigest,validateMissionPacket,ISOLATED_MISSIONS,encodeMissionTrace,MISSION_TRACE_LIMIT} from '../../scripts/eval_harness/sandbox/mission_contract.mjs';
import {createWorkflowOracle,rebaseBrowserCapture} from '../../scripts/eval_harness/sandbox/workflow_oracle.mjs';
import {createMissionFixture} from '../../scripts/eval_harness/sandbox/mission_fixture.mjs';
import {controllerKey,pinControllerKey,signGradingResult} from '../../scripts/eval_harness/sandbox/grading_auth.mjs';
import {validateWorkflowAssessment} from '../../scripts/eval_harness/sandbox/mission_receipt.mjs';
import {remainingAllowance} from '../benchmarks/workflow_limits.js';
import {snapshotActorArtifacts} from '../../scripts/eval_harness/sandbox/actor_artifacts.mjs';
const nonce='a'.repeat(48),identity={id:'trial',nonce,packet_sha256:'b'.repeat(64)},task=crypto.randomUUID();
function signed(key,route,body,id=100){return {id,nonce,channel:'workflow',method:'POST',path:route,body:Buffer.from(JSON.stringify(signGradingResult(key,identity,{task_id:task,...body})))};}
const pinned=key=>pinControllerKey({schema_version:1,id:identity.id,nonce,key_spki:key.spki},identity);
test('full traces are bounded by encoded bytes before a failed-run diagnostic can export them',()=>{
  const overhead=Buffer.byteLength(JSON.stringify({messages:['']})),text='x'.repeat(MISSION_TRACE_LIMIT-overhead),value={messages:[text]};
  const bytes=encodeMissionTrace(value);assert.equal(bytes.length,MISSION_TRACE_LIMIT);assert.equal(JSON.parse(bytes).messages[0],text);
  assert.throws(()=>encodeMissionTrace({messages:[text+'é']}),/exceeds/);
});
test('terminated child cleanup follows its actual close event even when exitCode is null',async()=>{
  const child=spawn(process.execPath,['-e','process.stdout.write("ready"); setInterval(()=>{},1000)'],{windowsHide:true,stdio:['ignore','pipe','pipe']}),tracked=trackChild(child);
  try{
    await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);});assert.equal(tracked.closed,false);
    assert.equal(await tracked.wait(1),false);child.kill();assert.equal(await tracked.wait(5000),true);assert.equal(tracked.closed,true);
    assert.ok(tracked.termination.signal||Number.isInteger(tracked.termination.exit_code));
  }finally{if(!tracked.closed)child.kill();}
});
async function mutation(fixture,id,route,body,method='POST'){return fixture.handle({id,nonce,channel:'fixture',method,path:route,body:Buffer.from(JSON.stringify(body))});}
test('all twelve isolated contracts have bounded public packets and calibration scripts with stable action identities',()=>{
  assert.equal(ISOLATED_MISSIONS.length,12);
  for(const id of ['B01','B02','B03','M01','M02']){
    const actor=prepareActorPacket(id),packet=JSON.parse(actor.bytes),expected={mode:'scripted_control',mission:id,architecture:'solo',packet_sha256:actor.sha256,configuration_fingerprint:packet.configuration.configuration_fingerprint,exported_names:actor.exportedNames,limits:packet.limits};
    assert.equal(validateMissionPacket(actor.bytes,expected).mission,id);
    for(const variant of ['positive','invalid-output'])for(const reply of controlReplies(id,variant))if(reply.type==='run_action'){
      assert.equal(reply.action.timeout_secs,45);assert.equal(reply.action.language,'python');assert.ok(reply.action.code.includes('http://127.0.0.1:19222/'));assert.equal(controlActionDigest(reply.action),controlActionDigest({code:reply.action.code,timeout_secs:45,language:'python'}));
      assert.notEqual(controlActionDigest(reply.action),controlActionDigest({...reply.action,code:reply.action.code+'\nprint("changed")'}));
    }
  }
});
test('a correction checkpoint requires the pinned controller signature and cannot be replayed or sent as fixture HTTP',()=>withScratch(async root=>{
  const fixture=await createMissionFixture({mission:'B03',privateDirectory:root,...identity}),key=controllerKey(),oracle=createWorkflowOracle({mission:'B03',fixture,identity,privateDirectory:root,limits:{}});
  try{
    await mutation(fixture,1,'/api/drafts/D-17/save',{owner:'Mina',delivery:'standard',note:'Keep original packaging'});
    const request=signed(key,'/correction',{}),forged=structuredClone(request);forged.body=Buffer.from(JSON.stringify(signGradingResult(controllerKey(),identity,{task_id:task})));
    await assert.rejects(oracle.handle(forged,pinned(key)),/signature/);assert.equal(fixture.portal.snapshot().correction,null);
    const result=await oracle.handle(request,pinned(key));assert.equal(result.status,200);assert.equal(fixture.portal.snapshot().correction.seq,2);
    await assert.rejects(oracle.handle(request,pinned(key)),/repeated/);
    await assert.rejects(mutation(fixture,2,'/correction',{}),/outside/);
  }finally{await fixture.close();}
}));
test('restart checkpoints require a confirmed saved note, new owned process and reduced aggregate budgets',()=>withScratch(async root=>{
  const limits={max_requests:24,max_tokens:1000000,max_directives:48,max_output_tokens:8192,max_in_flight:1,wall_time_ms:600000};
  const fixture=await createMissionFixture({mission:'M02',privateDirectory:root,...identity}),key=controllerKey(),oracle=createWorkflowOracle({mission:'M02',fixture,identity,privateDirectory:root,limits});
  try{
    await mutation(fixture,1,'/api/tickets/SYN-17/note',{value:'Verified original request'});
    const old_process={pid:11,started_utc:'2026-11-07T10:00:00.000Z'},new_process={pid:22,started_utc:'2026-11-07T10:00:05.000Z'},workspace='C:\\Zeus\\CandidateScratch\\App';
    assert.equal((await oracle.handle(signed(key,'/restart-checkpoint',{old_process,workspace,run_id:crypto.randomUUID()}),pinned(key))).status,200);
    const spent={usage:{requests:2,known_tokens:20,unknown_requests:0},evaluation:{directives:2}},remaining_limits=remainingAllowance(limits,spent,5000);
    const reply=await oracle.handle(signed(key,'/restart-complete',{old_process,new_process,workspace,old_process_gone:true,spent,elapsed_ms:5000,remaining_limits},101),pinned(key));
    assert.equal(reply.status,200);assert.equal(oracle.snapshot().restart.remaining_limits.max_requests,22);
  }finally{await fixture.close();}
}));
test('origin translation preserves browser request hashes and never rewrites arbitrary or lookalike origins',()=>{
  const raw={ok:true,result:{url:'http://127.0.0.1:19222/',network_events:[{url:'http://127.0.0.1:19222/api/tickets/T-102',body_sha256:'a'},{url:'https://example.com/path',body_sha256:'b'},{url:'http://127.0.0.1:192220/path'}]}};
  const translated=rebaseBrowserCapture(raw,'http://127.0.0.1:5555');assert.equal(translated.result.url,'http://127.0.0.1:5555/');assert.equal(translated.result.network_events[0].body_sha256,'a');assert.equal(translated.result.network_events[1].url,raw.result.network_events[1].url);assert.equal(translated.result.network_events[2].url,raw.result.network_events[2].url);assert.notEqual(raw.result.url,translated.result.url);
});
test('correct backend state without separate browser evidence remains unmeasured; altered host assessments cannot become passes',()=>withScratch(async root=>{
  const fixture=await createMissionFixture({mission:'B01',privateDirectory:root,...identity}),oracle=createWorkflowOracle({mission:'B01',fixture,identity,privateDirectory:root,limits:{}});
  try{
    await mutation(fixture,1,'/api/tickets/T-102',{priority:'high',note:'Call after 16:00 Sofia time.'},'PATCH');
    const actor=prepareActorPacket('B01'),packet=JSON.parse(actor.bytes),files=path.join(root,'files');fs.mkdirSync(files);for(const file of packet.inputs)fs.writeFileSync(path.join(files,file.name),Buffer.from(file.base64,'base64'));
    const assessment=await oracle.grade({trace:{workflow:{browser:[]}},artifactBytes:snapshotActorArtifacts(files,identity,actor.exportedNames),names:actor.exportedNames});
    assert.equal(assessment.outcome_status,'not_evaluated');assert.equal(validateWorkflowAssessment(assessment,packet),true);
    assert.equal(validateWorkflowAssessment({...assessment,outcome_status:'passed'},packet),false);
    assert.equal(validateWorkflowAssessment({...assessment,criteria:[{id:'agent_says_done',status:'passed'}]},packet),false);
  }finally{await fixture.close();}
}));
