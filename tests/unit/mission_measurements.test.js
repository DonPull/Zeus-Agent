import {test} from 'node:test';
import assert from 'node:assert/strict';
import {contextMeasurements} from '../benchmarks/mission_measurements.js';
test('context measurements retain distinct process snapshots and distinguish repair causes',()=>{
  const logs=["[orchestrator] Sending payload to master model 'example' (2 messages, ~13000 bytes)\n[worker] Sending payload to model (4 messages, ~8000 bytes)",
    "[orchestrator] Sending payload to master model 'example' (6 messages, ~21000 bytes)"];
  const messages=[
    {role:'user',kind:'directive_result',content:'[DIRECTIVE_ERROR] Multiple ```zeus-directive blocks detected.'},
    {role:'user',kind:'directive_result',content:'[DIRECTIVE_ERROR] invalid JSON directive: expected comma'},
    {role:'user',kind:'chat',content:'[DIRECTIVE_ERROR] invalid JSON directive quoted by human'},
    {role:'assistant',kind:'directive',content:'[DIRECTIVE_ERROR] invalid JSON directive quoted by model'}];
  const result=contextMeasurements(logs,messages);
  assert.equal(result.estimated_payload_bytes,42000);
  assert.deepEqual(result.payload_samples.map(s=>[s.process_index,s.role]),[[0,'master'],[0,'worker'],[1,'master']]);
  assert.deepEqual(result.format_rejections,{total:2,multiple_directives:1,invalid_json:1});
  assert.equal(result.model_latency_ms,null);assert.match(result.coverage,/Partial/);
});
test('absent payload logs remain partial coverage and do not invent model latency or usage',()=>{
  const result=contextMeasurements(['Unrelated event'],[]);
  assert.equal(result.payload_samples.length,0);assert.equal(result.model_latency_ms,null);
  assert.match(result.note,/not provider usage/);
});
