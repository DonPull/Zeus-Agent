import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {withScratch} from '../benchmarks/mission_kit.js';
import {sandboxConfiguration,prepareProbe,inspectProbe,readBoundedFile} from '../../scripts/eval_harness/sandbox/session.js';

test('Sandbox config has only disjoint input/output mappings, network and redirection off',()=>{
  const xml=sandboxConfiguration({input:'C:\\bench & test\\input',output:'C:\\bench & test\\output'});
  assert.equal((xml.match(/<MappedFolder>/g)||[]).length,2);
  assert.match(xml,/<Networking>Disable<\/Networking>/);
  for(const device of ['vGPU','AudioInput','VideoInput','PrinterRedirection','ClipboardRedirection'])assert.ok(xml.includes('<'+device+'>Disable</'+device+'>'));
  assert.match(xml,/<ProtectedClient>Enable<\/ProtectedClient>/);
  assert.match(xml,/bench &amp; test/);assert.match(xml,/<ReadOnly>true<\/ReadOnly>/);
  assert.match(xml,/<MemoryInMB>4096<\/MemoryInMB>/);
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
function fakeReport(root,manifest){
  const report={schema_version:1,id:manifest.id,nonce:manifest.nonce,computer:'SYNTHETIC-GUEST-'+manifest.host_name,
    challenge_sha256:manifest.inputs['challenge.txt'],input_write_denied:true,private_read_denied:true,
    active_nonloopback_adapters:0,output_written:true};
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
  fs.writeFileSync(path.join(root,'output/extra.txt'),'unexpected');
  assert.throws(()=>inspectProbe(root),/exactly one/);
}));
