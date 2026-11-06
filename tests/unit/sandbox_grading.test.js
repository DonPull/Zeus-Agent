import {test} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {prepareGraderPacket,gradingSmokeMatches} from '../../scripts/eval_harness/sandbox/grader_packet.mjs';

test('grading packet stages only known controls and public grading inputs, with all executable contracts represented',()=>{
  const {bytes,expected}=prepareGraderPacket(),packet=JSON.parse(bytes);
  assert.equal(expected.length,12);assert.ok(bytes.length<1024*1024);
  for(const id of ['C01','C02','C03','D02']){
    assert.deepEqual(expected.filter(row=>row.mission===id).map(row=>row.variant),['reference','alternative','negative']);
    const controls=expected.filter(row=>row.mission===id);
    assert.notEqual(controls[0].source_sha256,controls[2].source_sha256);
  }
  for(const [name,file] of Object.entries(packet.files)){
    assert.match(name,/^(package\.json|tests\/benchmarks\/|controls\/(?:C01|C02|C03|D02)-)/);assert.doesNotMatch(name,/credentials|profile|\.env|src-tauri/i);
    assert.equal(crypto.createHash('sha256').update(Buffer.from(file.base64,'base64')).digest('hex'),file.sha256);
  }
});

test('grading runtime claims require every exact source, expected outcome and reference criterion',()=>{
  const {expected}=prepareGraderPacket();
  const smoke={kind:'scripted-guest-grader-controls',status:'passed',provider_inference_requests:0,results:expected.map(control=>({
    mission:control.mission,variant:control.variant,source_sha256:control.source_sha256,outcome_status:control.expected,error:null,
    criteria:control.expected==='passed'?control.required_criteria.map(id=>({id,status:'passed'})):[{id:'submission_valid',status:'failed'}]}))};
  assert.equal(gradingSmokeMatches(smoke,expected),true);
  for(const mutate of [s=>s.results.pop(),s=>s.results.reverse(),s=>s.results[0].source_sha256='wrong',s=>s.results[0].criteria.pop(),
    s=>s.results[2].outcome_status='passed',s=>s.results[0].error={message:'Infrastructure failed'},s=>s.provider_inference_requests=1]){
    const invalid=structuredClone(smoke);mutate(invalid);assert.equal(gradingSmokeMatches(invalid,expected),false);
  }
});
