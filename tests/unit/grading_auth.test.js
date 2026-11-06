import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {controllerKey,pinControllerKey,signGradingResult,verifyGradingResult} from '../../scripts/eval_harness/sandbox/grading_auth.mjs';
const identity={id:'synthetic-job',nonce:'a'.repeat(48),packet_sha256:'b'.repeat(64)};
test('only the pinned controller key can authenticate a result for its exact job and source packet',()=>{
  const key=controllerKey(),pinned=pinControllerKey({schema_version:1,id:identity.id,nonce:identity.nonce,key_spki:key.spki},identity);
  const body={status:'completed',assessment:{outcome_status:'failed'}};
  const envelope=signGradingResult(key,identity,body);
  assert.deepEqual(verifyGradingResult(envelope,pinned,identity),body);
  const forged={...envelope,payload_base64:Buffer.from(JSON.stringify({...identity,schema_version:1,body:{status:'completed',assessment:{outcome_status:'passed'}}})).toString('base64')};
  assert.throws(()=>verifyGradingResult(forged,pinned,identity),/signature/);
  assert.throws(()=>verifyGradingResult(signGradingResult(controllerKey(),identity,body),pinned,identity),/signature/);
  for(const change of [{id:'other'},{nonce:'stale'},{packet_sha256:'other'}])assert.throws(()=>verifyGradingResult(envelope,pinned,{...identity,...change}),/identity/);
  assert.throws(()=>verifyGradingResult({status:'passed'},pinned,identity),/Missing signed/);
  assert.throws(()=>signGradingResult(key,identity,{text:'x'.repeat(256*1024)}),/allowance/);
});

test('candidate activation preserves stdin and exit codes; missing activation executes no child',()=>{
  const gate=path.resolve('scripts/eval_harness/sandbox/candidate_gate.py');
  const argumentsList=['-I','-c','import sys,json; print(json.dumps(sys.stdin.read())); raise SystemExit(37)'];
  const result=spawnSync('python',['-I','-B',gate],{input:JSON.stringify(argumentsList)+'\noriginal input\nwith another line',encoding:'utf8',timeout:5000,windowsHide:true});
  assert.equal(result.status,37,result.stderr);assert.equal(JSON.parse(result.stdout),'original input\nwith another line');
  const empty=spawnSync('python',['-I','-B',gate],{input:'',encoding:'utf8',timeout:5000,windowsHide:true});
  assert.equal(empty.status,1);assert.match(empty.stderr,/Missing or oversized candidate activation/);assert.equal(empty.stdout,'');
});

test('candidate account provisioning refuses a host identity before changing accounts or permissions',{skip:process.platform!=='win32'},()=>{
  const result=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','RemoteSigned','-File',path.resolve('scripts/eval_harness/sandbox/prepare_candidate.ps1')],{env:{...process.env,USERNAME:'WDAGUtilityAccount',COMPUTERNAME:'FAKE-GUEST'},encoding:'utf8',timeout:10000,windowsHide:true});
  assert.equal(result.status,1);assert.match(result.stderr,/Disposable guest controller identity required/);
});
