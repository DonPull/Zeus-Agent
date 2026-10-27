import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {withScratch,deployMission} from '../benchmarks/mission_kit.js';
import {exportMission} from '../benchmarks/mission_runtime.js';
import {buildScoreRecord} from '../benchmarks/score_recorder.js';

test('mission export retains only contracted inputs/artifacts and hashes the exported bytes',()=>withScratch(root=>{
  const actor=path.join(root,'actor');deployMission('D01',actor);
  fs.writeFileSync(path.join(actor,'reconciliation.json'),'{}');fs.writeFileSync(path.join(actor,'extra-secret.txt'),'not an artifact');
  const exported=path.join(root,'export');const files=exportMission('D01',actor,exported);
  assert.equal(fs.existsSync(path.join(exported,'extra-secret.txt')),false);
  assert.ok(files.every(file=>file.status==='retained'&&file.sha256.length===64));
  assert.throws(()=>exportMission('D01',actor,exported),/fresh/);
}));
test('missing or linked actor outputs cannot silently become valid exports',()=>withScratch(root=>{
  const actor=path.join(root,'actor');deployMission('D01',actor);
  const files=exportMission('D01',actor,path.join(root,'export'));
  assert.equal(files.find(file=>file.name==='reconciliation.json').status,'rejected_or_missing');
  const link=path.join(root,'linked');fs.symlinkSync(actor,link,process.platform==='win32'?'junction':'dir');
  assert.throws(()=>exportMission('D01',link,path.join(root,'other')),/link\/reparse/);
}));
test('an unmeasured required criterion remains unmeasured instead of becoming a failure or pass',()=>{
  const row=buildScoreRecord({suiteTitle:'mission',suiteDir:'mission',promptSpec:{id:'B01'},runMeta:{status:'succeeded'},
    pythonCheckDetails:[{passed:true},{passed:null}],authorizationChecks:[{passed:null}]});
  assert.equal(row.outcome_status,'not_evaluated');assert.equal(row.authorization_status,'not_evaluated');assert.equal(row.passed,false);
});
test('a failed criterion still fails when other required observations are missing',()=>{
  const row=buildScoreRecord({suiteTitle:'mission',suiteDir:'mission',promptSpec:{id:'B01'},runMeta:{status:'succeeded'},pythonCheckDetails:[{passed:false},{passed:null}]});
  assert.equal(row.outcome_status,'failed');
});
