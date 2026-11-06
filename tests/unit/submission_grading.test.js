import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {withScratch,mission,deployMission,python} from '../benchmarks/mission_kit.js';
import {prepareSubmissionPacket,validateSubmissionAssessment} from '../../scripts/eval_harness/sandbox/grader_packet.mjs';
import {isIsolatedGrader} from '../../scripts/eval_harness/sandbox/isolated_grader.mjs';

test('submission packaging snapshots bounded bytes without shipping reference solutions or executing programs',()=>withScratch(root=>{
  const source=path.join(root,'export');deployMission('C01',source);
  const canary=path.join(root,'must-not-exist');
  fs.writeFileSync(path.join(source,'flattener.py'),'from pathlib import Path\nPath('+JSON.stringify(canary)+').write_text("unwanted execution")\n');
  const {bytes,expected}=prepareSubmissionPacket('C01',source),packet=JSON.parse(bytes);
  assert.equal(packet.kind,'executable-submission-v1');assert.equal(fs.existsSync(canary),false);
  assert.ok(Object.keys(packet.files).every(name=>!name.includes('/reference/')&&!name.startsWith('controls/')));
  const before=expected.source_files.find(row=>row.name==='flattener.py').sha256;
  fs.appendFileSync(path.join(source,'flattener.py'),'# later mutation');
  assert.notEqual(prepareSubmissionPacket('C01',source).expected.source_files.find(row=>row.name==='flattener.py').sha256,before);
  assert.equal(fs.existsSync(canary),false);
}));

test('submission paths reject links, directories and oversized bytes while retaining missing-file status',()=>withScratch(root=>{
  const source=path.join(root,'export');fs.mkdirSync(source);
  assert.equal(prepareSubmissionPacket('C01',source).expected.source_files.find(row=>row.name==='flattener.py').status,'rejected_or_missing');
  fs.mkdirSync(path.join(source,'flattener.py'));assert.throws(()=>prepareSubmissionPacket('C01',source),/regular/);fs.rmdirSync(path.join(source,'flattener.py'));
  fs.writeFileSync(path.join(source,'flattener.py'),Buffer.alloc(2*1024*1024+1));assert.throws(()=>prepareSubmissionPacket('C01',source),/bounded/);
  fs.symlinkSync(source,path.join(root,'linked'),'junction');assert.throws(()=>prepareSubmissionPacket('C01',path.join(root,'linked')),/Linked/);
}));

test('submission result checking rejects invented passes, missing source identity and uncleared candidates',()=>withScratch(root=>{
  deployMission('C01',root);const {expected}=prepareSubmissionPacket('C01',root);
  const result={kind:'isolated-submission-grade-v1',status:'completed',mission:'C01',provider_inference_requests:0,
    source_files:expected.source_files,candidate_cleanup:{remaining:0,account_disabled:true},
    boundary:{username:'ZeusCandidate',is_admin:false,private_read_denied:true,private_write_denied:true,controller_process_denied:true,runtime_write_denied:true,runtime_readable:true,scratch_writable:true},
    assessment:{...expected.assessment_identity,error:null,outcome_status:'passed',criteria:expected.required_criteria.map(id=>({id,status:'passed'}))}};
  assert.equal(validateSubmissionAssessment(result,expected),true);
  for(const change of [r=>r.assessment.criteria[0].status='failed',r=>r.assessment.criteria.pop(),r=>r.assessment.task_hash='wrong',
    r=>r.candidate_cleanup.remaining=1,r=>r.boundary.is_admin=true,r=>r.source_files=[]]){
    const bad=structuredClone(result);change(bad);assert.equal(validateSubmissionAssessment(bad,expected),false);
  }
  result.assessment.outcome_status='failed';result.assessment.criteria=[{id:'submission_valid',status:'failed'}];assert.equal(validateSubmissionAssessment(result,expected),true);
}));

test('candidate routing does not grant host execution permission and unverified callbacks are not graders',()=>{
  assert.throws(()=>python('untrusted.py',[],{candidateExecution:true}),/isolated executor/);
  assert.equal(isIsolatedGrader(async()=>({outcome_status:'passed'})),false);
});
