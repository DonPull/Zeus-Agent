/** Declared artifact bytes only. Never imports, renders or executes a submission. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {unlinkedDirectory,readBoundedFile} from './exchange_files.mjs';
export const ARTIFACT_LIMITS=Object.freeze({files:64,fileBytes:2*1024*1024,packetBytes:8*1024*1024});
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function namesAllowed(names){
  if(!Array.isArray(names)||!names.length||names.length>ARTIFACT_LIMITS.files||new Set(names).size!==names.length||names.some(name=>typeof name!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(name)||name.endsWith('.')||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)))throw Error('Invalid declared artifact names');
}
function identity(value){if(!value||typeof value.id!=='string'||!/^[a-z0-9-]{1,64}$/i.test(value.id)||!/^[a-f0-9]{48}$/.test(value.nonce))throw Error('Invalid artifact job identity');}
export function snapshotActorArtifacts(directory,job,names){
  identity(job);namesAllowed(names);const root=unlinkedDirectory(directory),files=[];let encoded=0;
  for(const name of names){
    try{
      const bytes=readBoundedFile(root,name,ARTIFACT_LIMITS.fileBytes),base64=bytes.toString('base64');encoded+=base64.length;
      if(encoded>ARTIFACT_LIMITS.packetBytes)throw Error('Artifact packet exceeds allowance');
      files.push({name,status:'retained',bytes:bytes.length,sha256:sha(bytes),base64});
    }catch(error){if(error.code!=='ENOENT')throw error;files.push({name,status:'missing'});}
  }
  const packet={schema_version:1,kind:'actor-artifact-export-v1',id:job.id,nonce:job.nonce,files};
  const bytes=Buffer.from(JSON.stringify(packet));if(bytes.length>ARTIFACT_LIMITS.packetBytes)throw Error('Artifact packet exceeds allowance');
  return bytes;
}
export function validateActorArtifacts(bytes,job,names){
  identity(job);namesAllowed(names);
  if(!Buffer.isBuffer(bytes)||bytes.length>ARTIFACT_LIMITS.packetBytes)throw Error('Artifact packet exceeds allowance');
  const packet=JSON.parse(bytes);
  if(Object.keys(packet).sort().join(',')!=='files,id,kind,nonce,schema_version'||packet.schema_version!==1||packet.kind!=='actor-artifact-export-v1'||packet.id!==job.id||packet.nonce!==job.nonce||!Array.isArray(packet.files)||packet.files.length!==names.length)throw Error('Artifact identity/count mismatch');
  for(const [index,file] of packet.files.entries()){
    if(file.name!==names[index])throw Error('Undeclared or reordered artifact');
    if(file.status==='missing'){if(Object.keys(file).sort().join(',')!=='name,status')throw Error('Unexpected missing artifact fields');continue;}
    if(file.status!=='retained'||Object.keys(file).sort().join(',')!=='base64,bytes,name,sha256,status'||!Number.isSafeInteger(file.bytes)||file.bytes<0||file.bytes>ARTIFACT_LIMITS.fileBytes||typeof file.base64!=='string'||file.base64.length>ARTIFACT_LIMITS.fileBytes*4/3+4||!/^[A-Za-z0-9+/]*={0,2}$/.test(file.base64))throw Error('Invalid artifact descriptor');
    const data=Buffer.from(file.base64,'base64');if(data.length!==file.bytes||data.toString('base64')!==file.base64||sha(data)!==file.sha256)throw Error('Artifact bytes/hash mismatch');
  }
  return packet;
}
export function retainActorArtifacts(bytes,job,names,destination){
  const packet=validateActorArtifacts(bytes,job,names),parent=unlinkedDirectory(path.dirname(path.resolve(destination)));
  const root=path.join(parent,path.basename(destination));if(fs.existsSync(root))throw Error('Artifact destination must be fresh');fs.mkdirSync(root);
  for(const file of packet.files)if(file.status==='retained')fs.writeFileSync(path.join(root,file.name),Buffer.from(file.base64,'base64'),{flag:'wx'});
  return {directory:root,packet_sha256:sha(bytes),files:packet.files.map(({base64,...file})=>file)};
}
