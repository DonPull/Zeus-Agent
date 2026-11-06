import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync,spawn} from 'node:child_process';
import {withScratch} from '../benchmarks/mission_kit.js';
import {sandboxConfiguration,prepareProbe,inspectProbe,readBoundedFile,runtimeSmokeMatches} from '../../scripts/eval_harness/sandbox/session.js';

test('Sandbox config has only disjoint input/output mappings, network and redirection off',()=>{
  const xml=sandboxConfiguration({input:'C:\\bench & test\\input',output:'C:\\bench & test\\output'});
  assert.equal((xml.match(/<MappedFolder>/g)||[]).length,2);
  assert.match(xml,/<Networking>Disable<\/Networking>/);
  for(const device of ['vGPU','AudioInput','VideoInput','PrinterRedirection','ClipboardRedirection'])assert.ok(xml.includes('<'+device+'>Disable</'+device+'>'));
  assert.match(xml,/<ProtectedClient>Enable<\/ProtectedClient>/);
  assert.match(xml,/bench &amp; test/);assert.match(xml,/<ReadOnly>true<\/ReadOnly>/);
  assert.match(xml,/<MemoryInMB>4096<\/MemoryInMB>/);
  const runtime=sandboxConfiguration({input:'C:\\bench\\input',output:'C:\\bench\\output',runtime:'C:\\public-runtime'});
  assert.equal((runtime.match(/<MappedFolder>/g)||[]).length,3);
  assert.equal((runtime.match(/<ReadOnly>true<\/ReadOnly>/g)||[]).length,2);
  assert.throws(()=>sandboxConfiguration({input:'C:\\bench\\input',output:'C:\\bench\\output',runtime:'C:\\bench'}),/disjoint/);
  for(const [input,output] of [['C:\\same','C:\\same'],['C:\\parent','C:\\parent\\child'],['relative','C:\\output'],['\\\\server\\share','C:\\output'],['//server/share','C:\\output'],['C:\\','D:\\output'],['C:\\%USERPROFILE%','C:\\output']]){
    assert.throws(()=>sandboxConfiguration({input,output}));
  }
  assert.throws(()=>sandboxConfiguration({input:'C:\\input',output:'C:\\output',memoryMB:512}));
});

test('Sandbox exchange reads bounded data and rejects traversal, device syntax, links and oversized output',()=>withScratch(root=>{
  fs.writeFileSync(path.join(root,'data.json'),'{"ok":true}');
  assert.equal(readBoundedFile(root,'data.json').toString(),'{"ok":true}');
  for(const name of ['../data.json','sub/data.json','data.json:stream','CON:','NUL','COM1.txt','data.json.'])assert.throws(()=>readBoundedFile(root,name));
  assert.throws(()=>readBoundedFile(root,'data.json',2),/bounded/);
  fs.mkdirSync(path.join(root,'folder'));assert.throws(()=>readBoundedFile(root,'folder'),/regular/);
  fs.symlinkSync(root,path.join(root,'redirect'),'junction');
  assert.throws(()=>readBoundedFile(path.join(root,'redirect'),'data.json'),/Linked/);
}));

const windows={skip:process.platform!=='win32'};
test('guest runtime claims require exact dependency versions, successful fixture I/O and cleanup',()=>{
  const versions={python:'3.11.0',node:'v22.13.1',playwright:'1.62.0',chromium:'151.0.7922.34',webview2:'157.0.4341.42'};
  const smoke={status:'passed',provider_inference_requests:0,mock_requests:2,
    browser_runtime:{sdk:versions.playwright,browser:versions.chromium,cleanup:{owned_processes_remaining:0}},
    webview2_version:versions.webview2,python_version:versions.python,node_version:versions.node,
    observed:{run:{status:'completed'}},usage:{requests:2,unknown_requests:0},fixture_requests:1,
    navigation:{url:'http://127.0.0.1:19222/',http_status:200}};
  assert.equal(runtimeSmokeMatches(smoke,versions),true);
  for(const change of [s=>s.status='failed',s=>s.provider_inference_requests=1,s=>s.browser_runtime.browser='wrong',
    s=>s.browser_runtime.cleanup.owned_processes_remaining=1,s=>s.observed.run.status='failed',s=>s.usage.unknown_requests=1,
    s=>s.fixture_requests=0,s=>s.navigation.http_status=404,s=>s.navigation.url='http://other/']){
    const invalid=structuredClone(smoke);change(invalid);assert.equal(runtimeSmokeMatches(invalid,versions),false);
  }
});
function fakeReport(root,manifest){
  const report={schema_version:2,id:manifest.id,nonce:manifest.nonce,computer:'SYNTHETIC-GUEST-'+manifest.host_name,
    challenge_sha256:manifest.inputs['challenge.txt'],input_write_denied:true,private_read_denied:true,
    active_nonloopback_adapters:0,output_written:true,marker_preexisting:false,marker_created:true};
  fs.writeFileSync(path.join(root,'output','probe-result.json'),JSON.stringify(report));
  return report;
}
test('Sandbox preparation opens nothing, maps no private state, and guest JSON cannot certify isolation',windows,()=>withScratch(parent=>{
  const {root,manifest}=prepareProbe(parent);
  assert.equal(manifest.launch_requested,false);assert.equal(manifest.provider_requests,0);
  assert.equal(fs.readdirSync(path.join(root,'output')).length,0);
  assert.throws(()=>inspectProbe(root),/exactly one/);
  fakeReport(root,manifest);const result=inspectProbe(root);
  assert.equal(result.status,'probe_claims_consistent');assert.equal(result.isolation_validated,false);
  const cli=spawnSync(process.execPath,[path.resolve('scripts/eval_harness/sandbox/probe.js'),'--inspect',root],{encoding:'utf8',windowsHide:true});
  assert.equal(cli.status,2,cli.stderr);assert.equal(JSON.parse(cli.stdout).isolation_validated,false);
  const wsb=fs.readFileSync(path.join(root,'probe.wsb'),'utf8');
  assert.ok(!wsb.includes(manifest.private_file));assert.ok(!wsb.includes('<HostFolder>'+parent+'</HostFolder>'));
}));
test('Sandbox probe rejects changed input/configuration/sentinel rather than trusting a guest result',windows,()=>withScratch(parent=>{
  for(const target of ['input/challenge.txt','probe.wsb','private/host-only.bin']){
    const {root,manifest}=prepareProbe(parent);fakeReport(root,manifest);
    fs.appendFileSync(path.join(root,target),'tamper');assert.throws(()=>inspectProbe(root),/changed/i);
  }
}));
test('Sandbox probe rejects stale identities and reports failed boundary claims without a pass',windows,()=>withScratch(parent=>{
  const {root,manifest}=prepareProbe(parent),report=fakeReport(root,manifest);
  report.nonce='stale';fs.writeFileSync(path.join(root,'output/probe-result.json'),JSON.stringify(report));
  assert.throws(()=>inspectProbe(root),/identity/);
  report.nonce=manifest.nonce;report.active_nonloopback_adapters=1;
  fs.writeFileSync(path.join(root,'output/probe-result.json'),JSON.stringify(report));
  assert.equal(inspectProbe(root).status,'probe_failed');
  report.active_nonloopback_adapters=0;report.marker_preexisting=true;
  fs.writeFileSync(path.join(root,'output/probe-result.json'),JSON.stringify(report));
  assert.equal(inspectProbe(root).checks.fresh_guest_disk,false);
  fs.writeFileSync(path.join(root,'output/extra.txt'),'unexpected');
  assert.throws(()=>inspectProbe(root),/exactly one/);
}));

test('Sandbox cleanup refuses an unrelated live process and retains its failed receipt',windows,async()=>{
  const base=path.resolve('.zeus/evaluations/sandbox-sessions'),{root,manifest}=prepareProbe(base);
  const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'});
  const closed=new Promise(resolve=>child.once('exit',resolve));
  try{
    await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
    fs.writeFileSync(path.join(root,'host-launch.json'),JSON.stringify({pid:child.pid,started_utc:'wrong-creation-time',configuration_sha256:manifest.configuration_sha256}));
    const cli=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','RemoteSigned','-File',path.resolve('scripts/eval_harness/sandbox/run_probe.ps1'),'-Mode','Cleanup','-SessionDirectory',root],{encoding:'utf8',windowsHide:true,timeout:15000});
    assert.equal(cli.status,1,cli.stderr);assert.equal(JSON.parse(cli.stdout).status,'cleanup_failed');
    assert.doesNotThrow(()=>process.kill(child.pid,0));
    const receipts=fs.readdirSync(root).filter(name=>/^host-lifecycle-[0-9a-f-]+\.json$/.test(name));
    assert.equal(receipts.length,1);assert.equal(JSON.parse(fs.readFileSync(path.join(root,receipts[0]),'utf8')).cleanup.launcher_gone,null);
  }finally{
    if(child.exitCode===null)child.kill();await closed;
    const resolved=fs.realpathSync(root);
    if(path.dirname(resolved).toLowerCase()!==fs.realpathSync(base).toLowerCase()||!/^[0-9a-f-]{36}$/.test(path.basename(resolved)))throw Error('Unsafe synthetic session cleanup target');
    fs.rmSync(resolved,{recursive:true,force:true});
  }
});
