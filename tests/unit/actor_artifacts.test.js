import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {withScratch,missionIds,mission} from '../benchmarks/mission_kit.js';
import {snapshotActorArtifacts,validateActorArtifacts,retainActorArtifacts,ARTIFACT_LIMITS} from '../../scripts/eval_harness/sandbox/actor_artifacts.mjs';
import {prepareActorPacket} from '../../scripts/eval_harness/sandbox/actor_packet.mjs';
const job={id:'synthetic',nonce:'a'.repeat(48)};
test('declared artifacts retain exact bytes and missing status, reject stale/tampered data, and never execute code',()=>withScratch(root=>{
  const source=path.join(root,'source');fs.mkdirSync(source);const program='raise RuntimeError("must not execute on host")';
  fs.writeFileSync(path.join(source,'candidate.py'),program);fs.writeFileSync(path.join(source,'image.png'),Buffer.from([0,255,1,128]));
  const names=['candidate.py','image.png','missing.json'],bytes=snapshotActorArtifacts(source,job,names);
  const packet=validateActorArtifacts(bytes,job,names);assert.equal(packet.files[2].status,'missing');
  const retained=retainActorArtifacts(bytes,job,names,path.join(root,'export'));
  assert.equal(fs.readFileSync(path.join(retained.directory,'candidate.py'),'utf8'),program);assert.deepEqual(fs.readFileSync(path.join(retained.directory,'image.png')),Buffer.from([0,255,1,128]));
  assert.throws(()=>retainActorArtifacts(bytes,job,names,path.join(root,'export')),/fresh/);
  assert.throws(()=>validateActorArtifacts(bytes,{...job,nonce:'b'.repeat(48)},names),/identity/);
  packet.files[0].base64=Buffer.from('changed').toString('base64');assert.throws(()=>validateActorArtifacts(Buffer.from(JSON.stringify(packet)),job,names),/hash/);
  assert.throws(()=>validateActorArtifacts(bytes,job,['image.png','candidate.py','missing.json']),/reordered/);
}));
test('artifact collection rejects links, device names, directories and per-file/aggregate excess',()=>withScratch(root=>{
  for(const name of ['../secret','CON.txt','file.','a/b','a:b'])assert.throws(()=>snapshotActorArtifacts(root,job,[name]),/names/);
  fs.mkdirSync(path.join(root,'folder'));assert.throws(()=>snapshotActorArtifacts(root,job,['folder']),/regular/);
  fs.symlinkSync(root,path.join(root,'redirect'),'junction');assert.throws(()=>snapshotActorArtifacts(path.join(root,'redirect'),job,['a']),/Linked/);
  fs.writeFileSync(path.join(root,'large'),Buffer.alloc(ARTIFACT_LIMITS.fileBytes+1));assert.throws(()=>snapshotActorArtifacts(root,job,['large']),/bounded/);
  for(let index=0;index<4;index++)fs.writeFileSync(path.join(root,'large-'+index),Buffer.alloc(ARTIFACT_LIMITS.fileBytes));
  assert.throws(()=>snapshotActorArtifacts(root,job,['large-0','large-1','large-2','large-3']),/packet exceeds/);
}));
test('all twelve actor input packets contain public inputs and frozen role settings without reference solutions',()=>{
  for(const id of missionIds){
    const prepared=prepareActorPacket(id),packet=JSON.parse(prepared.bytes);
    assert.equal(packet.mission,id);assert.equal(packet.configuration.architecture,'solo');assert.equal(packet.configuration.roles.worker.model,null);assert.equal(packet.configuration.roles.worker.enabled,false);
    assert.equal(packet.configuration.roles.master.model,'gpt-6.1-terra');assert.ok(packet.inputs.length>0);
    assert.ok(packet.inputs.every(file=>file.status==='retained'));
    for(const file of packet.inputs)if(file.name!=='feedback.db')assert.deepEqual(Buffer.from(file.base64,'base64'),fs.readFileSync(path.join(mission(id).dir,'inputs',file.name)),id+'/'+file.name+' must contain the public starter bytes');
    assert.ok(!('graders' in packet));assert.equal(packet.limits.max_in_flight,1);
    assert.equal(prepared.exportedNames.length,new Set(prepared.exportedNames).size);
    if(id==='D02')assert.ok(packet.inputs.some(file=>file.name==='feedback.db'));
  }
  const team=JSON.parse(prepareActorPacket('D01','team').bytes);assert.equal(team.configuration.roles.worker.model,'gpt-6.1-terra');
});
