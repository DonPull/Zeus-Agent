import test from 'node:test';
import assert from 'node:assert/strict';
import {remainingAllowance} from '../benchmarks/core_workflows.js';
const limits={max_requests:10,max_tokens:100000,max_in_flight:2,max_output_tokens:4096,max_directives:20,wall_time_ms:60000};
const spent={usage:{requests:3,known_tokens:1200,unknown_requests:0},evaluation:{directives:4}};
test('a workflow restart carries spent requests, tokens, directives and elapsed time forward',()=>{
  const before=structuredClone(limits);
  assert.deepEqual(remainingAllowance(limits,spent,5000),{...limits,max_requests:7,max_tokens:98800,max_directives:16,wall_time_ms:55000});
  assert.deepEqual(limits,before);
});
test('a restart cannot erase unknown usage, missing accounting or an exhausted aggregate allowance',()=>{
  assert.throws(()=>remainingAllowance(limits,{...spent,usage:{...spent.usage,unknown_requests:1}},0),/complete usage/);
  assert.throws(()=>remainingAllowance(limits,{usage:spent.usage},0),/complete usage/);
  for(const change of [{max_requests:3},{max_tokens:1200},{max_directives:4},{wall_time_ms:1}]){
    assert.throws(()=>remainingAllowance({...limits,...change},spent,change.wall_time_ms??0),/exhausted/);
  }
  const nearlySpent={...spent,usage:{...spent.usage,requests:9,known_tokens:99500}};
  const remaining=remainingAllowance(limits,nearlySpent,0);
  assert.equal(remaining.max_in_flight,1);assert.equal(remaining.max_output_tokens,500);
});
