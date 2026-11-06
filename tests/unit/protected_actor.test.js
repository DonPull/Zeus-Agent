import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {protectedActorMatches} from '../../scripts/eval_harness/sandbox/session.js';
const versions={python:'3.11.0',node:'v22.13.1',playwright:'1.62.0',chromium:'151.0.7922.34',webview2:'157.0.4341.42'};
function observation(){return {kind:'protected-guest-actor-control-v1',status:'passed',provider_inference_requests:0,
  boundary:{username:'ZeusCandidate',is_admin:false,private_read_denied:true,private_write_denied:true,controller_process_denied:true,runtime_write_denied:true,runtime_readable:true,scratch_writable:true},
  candidate_cleanup:{remaining:0,account_disabled:true},artifact_export:{sha256:'a'.repeat(64),names:['actor-input.txt','actor-output.txt']},actor:{status:'passed',provider_inference_requests:0,mock_requests:2,
    browser_runtime:{sdk:versions.playwright,browser:versions.chromium,cleanup:{owned_processes_remaining:0}},
    webview2_version:versions.webview2,python_version:versions.python,node_version:versions.node,
    observed:{run:{status:'completed'}},usage:{requests:2,unknown_requests:0},fixture_requests:1,
    navigation:{url:'http://127.0.0.1:19222/',http_status:200},actor_start:{username:'ZeusCandidate',is_admin:false,pid:123}}};}
test('protected actor observations require real startup identity, boundary, complete runtime and cleanup together',()=>{
  assert.equal(protectedActorMatches(observation(),versions),true);
  for(const change of [value=>value.status='failed',value=>value.actor.actor_start.username='WDAGUtilityAccount',
    value=>value.actor.actor_start.is_admin=true,value=>delete value.actor.actor_start,value=>value.actor.actor_start.pid=0,
    value=>value.boundary.controller_process_denied=false,value=>value.boundary.runtime_write_denied=false,
    value=>value.candidate_cleanup.remaining=1,value=>value.candidate_cleanup.account_disabled=false,
    value=>value.actor.usage.unknown_requests=1,value=>value.actor.browser_runtime.cleanup.owned_processes_remaining=1,
    value=>delete value.artifact_export,value=>value.artifact_export.names=['other-file']]){
    const value=observation();change(value);assert.equal(protectedActorMatches(value,versions),false);
  }
});
test('actor bootstrap cannot be run from the host repository with spoofed guest environment names',()=>{
  const result=spawnSync('python',['-I','-B',path.resolve('scripts/eval_harness/sandbox/actor_bootstrap.py')],{
    env:{...process.env,USERNAME:'ZeusCandidate',COMPUTERNAME:'FAKE-GUEST',ZEUS_TEST_WORKSPACE_ROOT:'C:\\Zeus\\CandidateScratch\\App'},windowsHide:true,encoding:'utf8',timeout:5000});
  assert.equal(result.status,1,result.stderr);assert.match(result.stderr,/Disposable Windows actor bootstrap required/);assert.equal(result.stdout,'');
});
