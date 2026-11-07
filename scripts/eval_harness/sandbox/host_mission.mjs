#!/usr/bin/env node
/** Host-only scripted broker. No provider credentials, external HTTP or eval. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {unlinkedDirectory,readBoundedFile} from './exchange_files.mjs';
import {publishResponse} from './file_rpc.mjs';
import {createMissionHostExchange} from './mission_rpc.mjs';
import {createProviderRelay} from './provider_relay.mjs';
import {scriptedProvider} from './scripted_provider.mjs';
import {pinControllerKey,verifyGradingResult} from './grading_auth.mjs';
import {validateMissionPacket,missionDigest,MISSION_TRACE_LIMIT} from './mission_contract.mjs';
const parent=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../.zeus/evaluations/sandbox-sessions');
const root=unlinkedDirectory(process.argv[2]??'');
if(path.dirname(root).toLowerCase()!==parent.toLowerCase()||!/^[0-9a-f-]{36}$/.test(path.basename(root)))throw Error('Use an owned prepared mission');
const manifest=JSON.parse(readBoundedFile(root,'session.json',16384)),expected=manifest.mission_job;
if(!expected||expected.mode!=='scripted_control'||expected.controller_timeout_secs!==780||!manifest.grading_auth)throw Error('Hosted mission dispatch remains gated');
const input=path.join(root,'input'),output=path.join(root,'output'),privateDir=path.join(root,'private');
validateMissionPacket(readBoundedFile(input,'actor-packet.json',8*1024*1024),expected);
const identity={id:manifest.id,nonce:manifest.nonce,packet_sha256:expected.packet_sha256};
const controls=readBoundedFile(privateDir,'control-replies.json',8*1024*1024);
if(missionDigest(controls)!==expected.control_replies_sha256)throw Error('Scripted controls changed');
const relay=createProviderRelay({privateDirectory:privateDir,id:manifest.id,nonce:manifest.nonce,limits:expected.limits,executionKind:'scripted_control',transport:scriptedProvider(JSON.parse(controls))});
const record={schema_version:1,kind:'host-mission-transport-v1',...identity,mode:expected.mode,status:'running',provider_inference_requests:0,requests:[],total_bytes:0};
const auth={schema_version:1,kind:'host-pinned-grading-key',...identity,status:'waiting_for_key',provider_inference_requests:0};
function save(name,value){const file=path.join(privateDir,name),temporary=file+'.tmp';fs.writeFileSync(temporary,JSON.stringify(value,null,2));fs.renameSync(temporary,file);}
const extra=['grading-key.json','grading-key.json.tmp','actor-export.json','actor-export.json.tmp','mission-trace.json','mission-trace.json.tmp','candidate-write.txt'];
const exchange=createMissionHostExchange({input,output,nonce:manifest.nonce,mission:expected.mission,read:readBoundedFile,additionalOutputNames:extra,handle:request=>{
  if(request.channel!=='provider')throw Error('No fixture route is available in this single-turn mission');
  return relay.request(request.id,request.body);
}});
let pinned=null;save('mission-host.json',record);save('grading-auth.json',auth);
try{
  await relay.preflight();const deadline=Date.now()+775000;
  while(Date.now()<deadline){
    for(const name of fs.readdirSync(output)){
      const limit=/^rpc-request-\d{6}\.json(\.tmp)?$/.test(name)?2*1024*1024:/^grading-key\.json(\.tmp)?$/.test(name)?4096:/^actor-export\.json(\.tmp)?$/.test(name)?8*1024*1024:/^mission-trace\.json(\.tmp)?$/.test(name)?MISSION_TRACE_LIMIT:/^probe-result\.(json|tmp)$/.test(name)?1024*1024:name==='candidate-write.txt'?128:0;
      const stat=fs.lstatSync(path.join(output,name));if(!limit||!stat.isFile()||stat.isSymbolicLink()||stat.size>limit)throw Error('Undeclared/oversized mission output');
    }
    if(!pinned&&fs.existsSync(path.join(output,'grading-key.json'))){
      pinned=pinControllerKey(JSON.parse(readBoundedFile(output,'grading-key.json',4096)),identity);
      Object.assign(auth,{status:'key_pinned',key_spki:pinned.spki,key_sha256:pinned.fingerprint,pinned_at:new Date().toISOString()});save('grading-auth.json',auth);
      await publishResponse(input,'grading-key-ack.json',Buffer.from(JSON.stringify({...identity,key_sha256:pinned.fingerprint})));
    }
    if(!pinned&&fs.readdirSync(output).some(name=>name.startsWith('rpc-request-')))throw Error('Actor request arrived before key pin');
    await exchange.step();
    Object.assign(record,{requests:exchange.rows,total_bytes:exchange.totalBytes});save('mission-host.json',record);
    if(fs.existsSync(path.join(output,'probe-result.json'))){
      if(!pinned)throw Error('Mission result before key pin');
      const outer=JSON.parse(readBoundedFile(output,'probe-result.json',1024*1024));
      const signed=verifyGradingResult(outer.runtime_smoke,pinned,identity);
      Object.assign(auth,{status:'verified',result_status:signed.status,verified_at:new Date().toISOString()});save('grading-auth.json',auth);
      record.status='complete';break;
    }
    await new Promise(resolve=>setTimeout(resolve,25));
  }
  if(record.status!=='complete')throw Error('Mission controller deadline expired');
}catch(error){record.status='failed';record.error=String(error.message).slice(-4000);process.exitCode=1;}
finally{record.provider_ledger_sha256=missionDigest(readBoundedFile(privateDir,'provider-ledger.json',4*1024*1024));record.completed_at=new Date().toISOString();save('mission-host.json',record);}
