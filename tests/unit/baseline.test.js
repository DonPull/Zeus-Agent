import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {withScratch,mission} from '../benchmarks/mission_kit.js';
import {createBaselinePlan,configurationFor,assertPlan,assertTrial,summarizeBaseline,compareBaselines} from '../benchmarks/baseline_plan.js';
import {runStudy,readStudyRecords} from '../benchmarks/baseline_runner.js';
import {appendScore,buildScoreRecord} from '../benchmarks/score_recorder.js';
import {agentDuration,browserMeasurements} from '../benchmarks/mission_measurements.js';
const build={source_commit:'a'.repeat(40),dirty:false,diff_hash:'b'.repeat(64),node:process.version};
const plan=options=>createBaselinePlan({build,ids:['D01'],...options});
function record(p,a,{success=true,tokens=10,known=true}={}){
  const configuration=configurationFor(p.contract,a.mission,a.architecture);
  return buildScoreRecord({suiteTitle:'Controlled study test',suiteDir:'zeus-missions-v1',promptSpec:mission(a.mission).task,
    pythonCheckDetails:[{passed:success}],runMeta:{trial_id:a.id,architecture:a.architecture,build,
      evaluation_kind:'capability',execution_profile:'native-supervised',configuration,configuration_fingerprint:a.configuration_fingerprint,
      execution_status:success?'succeeded':'failed',usage:known?{requests:2,known_tokens:tokens,unknown_requests:0,requests_by_role:{master:1,worker:1}}:null,
      measurements:{agent_duration_seconds:5}}});
}
test('matched plans enable real Team roles and alternate order without changing mission limits',()=>{
  const p=plan({repetitions:3});assert.equal(p.attempts.length,6);assert.equal(p.envelope.max_requests,60);
  assert.deepEqual(p.attempts.map(a=>a.architecture),['solo','team','team','solo','solo','team']);
  const solo=configurationFor(p.contract,'D01','solo'),team=configurationFor(p.contract,'D01','team');
  assert.equal(solo.roles.worker.enabled,false);assert.equal(team.roles.worker.model,p.contract.model);
  assert.equal(team.roles.verifier.model,p.contract.model);assert.deepEqual(solo.evaluation_limits,team.evaluation_limits);
  assert.equal(team.roles.watcher.enabled,false);assert.notEqual(solo.configuration_fingerprint,team.configuration_fingerprint);
  assert.throws(()=>plan({ids:['C01']}),/nonexecutable/);assert.throws(()=>plan({repetitions:0}),/1..3/);
  assert.throws(()=>plan({model:'route-llm'}),/explicit/);
});
test('resume rejects a changed build, fixture contract or scheduled attempt',()=>{
  const p=plan();assertPlan(p,build);
  assertTrial(p,p.attempts[0],{...record(p,p.attempts[0]),build:{...build,runtime:'zeus-evaluation (same production library)'}});
  assert.throws(()=>assertPlan(p,{...build,source_commit:'c'.repeat(40)}),/changed/);
  const edited=structuredClone(p);edited.contract.missions[0].fixture_hash='wrong';assert.throws(()=>assertPlan(edited,build),/changed/);
  const reordered=structuredClone(p);reordered.attempts.reverse();assert.throws(()=>assertPlan(reordered,build),/changed/);
});
test('cost includes failed attempts and never treats interrupted or pending usage as free',()=>{
  const p=plan({repetitions:2}),rows={};
  for(const a of p.attempts)rows[a.id]=record(p,a,{success:a.repetition===1,tokens:a.repetition===1?10:30});
  let s=summarizeBaseline(p,rows);assert.equal(s.cells['D01/solo'].tokens_per_successful_outcome,40);
  assert.equal(s.cells['D01/solo'].outcome_success_rate,.5);assert.equal(s.cells['D01/solo'].verified_passes,0);
  rows[p.attempts[2].id].usage=null;s=summarizeBaseline(p,rows);assert.equal(s.cells['D01/team'].tokens_per_successful_outcome,null);
  rows[p.attempts[0].id].usage={...rows[p.attempts[0].id].usage,input_tokens:2,cached_tokens:20,reasoning_tokens:3};
  s=summarizeBaseline(p,rows);assert.equal(s.cells['D01/solo'].reported_usage.cached_tokens.known_sum,20);
  assert.equal(s.cells['D01/solo'].cache_exceeds_reported_input_trials,1);
  assert.equal(s.cells['D01/solo'].known_tokens,40);
  delete rows[p.attempts[0].id];s=summarizeBaseline(p,rows);assert.equal(s.cells['D01/solo'].usage_complete,false);
});
test('matched build comparisons reject config drift and incomplete studies',()=>{
  const p=plan(),s=summarizeBaseline(p,Object.fromEntries(p.attempts.map(a=>[a.id,record(p,a)])));
  assert.equal(compareBaselines(s,s).cells['D01/solo'].median_agent_seconds_delta,0);
  assert.throws(()=>compareBaselines(s,{...s,contract_fingerprint:'changed'}),/identical/);
  assert.throws(()=>compareBaselines(s,{...s,recorded:0}),/every scheduled/);
});
test('shutdown resume retains a completed child, records interrupted usage and dispatches only untouched attempts',()=>withScratch(async root=>{
  const p=plan({repetitions:2}),directory=path.join(root,'study');fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory,'plan.json'),JSON.stringify(p));
  appendScore(path.join(directory,'attempts',p.attempts[0].id),record(p,p.attempts[0]));
  fs.writeFileSync(path.join(directory,'state.json'),JSON.stringify({plan_id:p.plan_id,attempts:{[p.attempts[0].id]:{status:'running'},[p.attempts[1].id]:{status:'running',child_pid:123}}}));
  const dispatched=[];
  const summary=await runStudy({plan:p,directory,currentBuild:build,resume:true,alive:()=>false,execute:async(a,out)=>{
    dispatched.push(a.id);appendScore(out,record(p,a));return {code:2};}});
  assert.deepEqual(dispatched,p.attempts.slice(2).map(a=>a.id));assert.equal(summary.recorded,4);
  const records=readStudyRecords(p,directory);assert.equal(records[p.attempts[1].id].execution_status,'interrupted');
  assert.equal(records[p.attempts[1].id].usage,null);assert.equal(fs.existsSync(path.join(directory,'lock.json')),false);
}));
test('a live child blocks duplicate resume and a contradictory exit cannot launder a passing outcome',()=>withScratch(async root=>{
  const p=plan(),directory=path.join(root,'study');fs.mkdirSync(directory);fs.writeFileSync(path.join(directory,'plan.json'),JSON.stringify(p));
  fs.writeFileSync(path.join(directory,'state.json'),JSON.stringify({plan_id:p.plan_id,attempts:{[p.attempts[0].id]:{status:'running',child_pid:123}}}));
  await assert.rejects(()=>runStudy({plan:p,directory,currentBuild:build,resume:true,alive:pid=>pid===123,execute:()=>assert.fail('duplicate dispatch')}),/still running/);
  const other=path.join(root,'other');await runStudy({plan:p,directory:other,currentBuild:build,execute:async(a,out)=>{appendScore(out,record(p,a));return {code:1};}});
  const s=summarizeBaseline(p,readStudyRecords(p,other));assert.equal(s.cells['D01/solo'].successful_outcomes,0);
  const raw=JSON.parse(fs.readFileSync(path.join(other,'attempts',p.attempts[0].id,'trials',p.attempts[0].id+'.json'),'utf8'));
  assert.equal(raw.outcome_passed,true);
}));
test('agent and browser timings preserve missing coverage and use actual evidence',()=>{
  assert.equal(agentDuration({started_at:'2026-01-01T00:00:00Z',completed_at:'2026-01-01T00:00:02Z'}),2);
  assert.equal(agentDuration({started_at:'2026-01-01T00:00:00Z'}),null);
  const m=browserMeasurements([{op:'click',status:'failed',response:JSON.stringify({timing_ms:{total:120}})},
    {op:'observe',status:'succeeded',response:'broken'}]);
  assert.equal(m.actions,2);assert.equal(m.timed_actions,1);assert.equal(m.service_ms,120);
});

test('a changed-source dispatch stops the schedule without inventing records for untouched attempts',()=>withScratch(async root=>{
  const p=plan(),directory=path.join(root,'study');let calls=0;
  const s=await runStudy({plan:p,directory,currentBuild:build,execute:async()=>{calls++;throw Object.assign(Error('source changed'),{code:'FROZEN_PLAN_CHANGED'});}});
  assert.equal(calls,1);assert.equal(s.recorded,1);assert.equal(s.scheduled,2);
  assert.equal(s.cells['D01/solo'].statuses.infrastructure_error,1);assert.equal(s.cells['D01/team'].recorded,0);
}));
