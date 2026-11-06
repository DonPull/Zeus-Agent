/** Public mission inputs/configuration. No reference solutions or grader code. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {mission,deployMission,withScratch} from '../../../tests/benchmarks/mission_kit.js';
import {coreConfiguration,coreLimits} from '../../../tests/benchmarks/core_plan.js';
import {snapshotActorArtifacts,ARTIFACT_LIMITS} from './actor_artifacts.mjs';
export function prepareActorPacket(id,architecture='solo'){
  if(!['solo','team'].includes(architecture))throw Error('Select Solo or Team');
  const {dir,task}=mission(id),inputNames=[...fs.readdirSync(path.join(dir,'inputs')),...(id==='D02'?['feedback.db']:[])];
  const exportedNames=[...new Set([...inputNames,...task.artifacts])];
  return withScratch(root=>{
    const workspace=path.join(root,'workspace'),deployment=deployMission(id,workspace);
    const initial=JSON.parse(snapshotActorArtifacts(workspace,{id:'prepared-inputs',nonce:'0'.repeat(48)},inputNames));
    if(initial.files.some(file=>file.status!=='retained'))throw Error('Missing prepared actor input');
    const packet={schema_version:1,kind:'public-actor-mission-packet-v1',mission:id,architecture,task,configuration:coreConfiguration(id,architecture),limits:coreLimits(id),deployment,inputs:initial.files,exported_names:exportedNames};
    const bytes=Buffer.from(JSON.stringify(packet));if(bytes.length>ARTIFACT_LIMITS.packetBytes)throw Error('Actor input packet exceeds allowance');
    return {bytes,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),exportedNames};
  });
}
