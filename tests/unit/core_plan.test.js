import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {missionIds} from '../benchmarks/mission_kit.js';
import {createCorePlan,coreConfiguration,coreLimits} from '../benchmarks/core_plan.js';
import {fingerprint} from '../benchmarks/benchmark_config.js';
const build={source_commit:'a'.repeat(40),dirty:false,diff_hash:'b'.repeat(64)};
test('core candidate planner defaults to one bounded economical pilot, without dispatch',()=>{
  const p=createCorePlan({build});
  assert.equal(p.attempts.length,1);assert.equal(p.attempts[0].mission,'D01');assert.equal(p.attempts[0].architecture,'solo');
  assert.equal(p.envelope.max_requests,10);assert.equal(p.dispatchable,false);assert.equal(p.inference_requests_made,0);
  assert.equal(p.contract.environment.boundary_validation,null);assert.equal(p.envelope.provider_credit_ceiling,null);
  const cli=spawnSync(process.execPath,[path.resolve('scripts/eval_harness/core_benchmark.js'),'--live'],{encoding:'utf8',windowsHide:true});
  assert.equal(cli.status,1);assert.match(cli.stderr,/Core live dispatch is unavailable/);
});
test('core repeated candidate includes twelve distinct missions and 72 matched attempts',()=>{
  const p=createCorePlan({build,stage:'repeated'});
  assert.deepEqual(p.contract.missions.map(m=>m.id),[...missionIds]);assert.equal(p.attempts.length,72);
  assert.equal(p.envelope.max_requests,p.attempts.reduce((n,a)=>n+coreLimits(a.mission).max_requests,0));
  assert.equal(p.envelope.retries,0);
  assert.deepEqual(p.attempts.filter(a=>a.mission==='D01').map(a=>a.architecture),['solo','team','team','solo','solo','team']);
  for(const id of missionIds){
    const solo=coreConfiguration(id,'solo'),team=coreConfiguration(id,'team');
    assert.equal(team.roles.worker.model,'gpt-6.1-terra');assert.equal(team.roles.verifier.protocol,'chat');
    assert.equal(team.roles.master.provider,'abacus');assert.equal(solo.roles.worker.enabled,false);
    assert.equal(team.roles.watcher.enabled,false);assert.deepEqual(solo.evaluation_limits,team.evaluation_limits);
  }
});
test('core candidates reject incomplete/relabelled repeated portfolios and ambiguous selections',()=>{
  for(const options of [{stage:'repeated',ids:['D01']},{stage:'repeated',architectures:['solo']},{ids:['D01','D01']},{ids:['H01']},{stage:'automatic'},{architectures:['team','team']}]){
    assert.throws(()=>createCorePlan({build,...options}));
  }
  const a=createCorePlan({build}),b=createCorePlan({build:{...build,source_commit:'c'.repeat(40)}});
  assert.notEqual(a.plan_id,b.plan_id);assert.equal(fingerprint(a),fingerprint(createCorePlan({build})));
});
