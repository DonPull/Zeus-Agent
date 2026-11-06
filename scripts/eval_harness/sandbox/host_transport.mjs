#!/usr/bin/env node
/** Synthetic host broker only. No provider key, external HTTP or code execution. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readBoundedFile,unlinkedDirectory} from './session.js';
import {createHostExchange} from './file_rpc.mjs';
import crypto from 'node:crypto';
import {createMissionHostExchange} from './mission_rpc.mjs';
import {createMissionFixture} from './mission_fixture.mjs';

const parent=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../.zeus/evaluations/sandbox-sessions');
const root=unlinkedDirectory(process.argv[2]??'');
if(path.dirname(root).toLowerCase()!==parent.toLowerCase()||!/^[0-9a-f-]{36}$/.test(path.basename(root)))throw Error('Use an owned prepared session');
const manifest=JSON.parse(readBoundedFile(root,'session.json',16384));
if(manifest.transport_smoke!=='synthetic-file-v1'||manifest.id!==path.basename(root))throw Error('No declared synthetic transport');
const input=path.join(root,'input'),output=path.join(root,'output'),receipt=path.join(root,'private/transport.json');
const code='import json\nfrom zeus_browser import call\nprint(json.dumps(call("navigate",url="http://127.0.0.1:19222/")))';
const replies=[{type:'run_action',action:{language:'python',code,timeout_secs:30},success_criteria:'Inspect the synthetic local browser fixture.'},
  {type:'final_answer',final_answer:{summary:'Synthetic isolated runtime control completed.'}}];
let provider=0,fixture=0;
const missionFixture=manifest.fixture_mission?await createMissionFixture({mission:manifest.fixture_mission,privateDirectory:path.join(root,'private'),id:manifest.id,nonce:manifest.nonce}):null;
const result={schema_version:1,id:manifest.id,nonce:manifest.nonce,kind:'host-observed-synthetic-file-transport',status:'running',provider_inference_requests:0,provider_requests:0,fixture_requests:0,requests:[],total_bytes:0};
const save=()=>{
  const temporary=receipt+'.tmp';fs.writeFileSync(temporary,JSON.stringify(result,null,2));fs.renameSync(temporary,receipt);
};
const exchange=(missionFixture?createMissionHostExchange:createHostExchange)({input,output,nonce:manifest.nonce,mission:manifest.fixture_mission,read:readBoundedFile,handle:async request=>{
  if(request.channel==='fixture'){
    fixture++;if(missionFixture)return missionFixture.handle(request);
    return {status:200,content_type:'text/html',body:'<!doctype html><title>Host fixture</title><main><h1>Managed browser is working</h1></main>'};
  }
  const payload=JSON.parse(request.body);
  if(payload.model!=='phase1-mock'||!Array.isArray(payload.messages)||payload.stream!==true)throw Error('Unexpected synthetic provider payload');
  const reply=replies[provider++];if(!reply)throw Error('Synthetic provider request allowance exhausted');
  return {status:200,content_type:'text/event-stream',body:'data: '+JSON.stringify({choices:[{delta:{content:'```zeus-directive\n'+JSON.stringify(reply)+'\n```'}}],usage:{prompt_tokens:5,completion_tokens:5,total_tokens:10}})+'\n\ndata: [DONE]\n\n'};
}});
save();
try{
  const deadline=Date.now()+170000;
  while(Date.now()<deadline){
    await exchange.step();
    Object.assign(result,{provider_requests:provider,fixture_requests:fixture,requests:exchange.rows,total_bytes:exchange.totalBytes});save();
    if(fs.existsSync(path.join(output,'probe-result.json'))){
      if(provider!==2||fixture<1)throw Error('Guest finished without its required host-observed requests');
      result.status='complete';break;
    }
    await new Promise(resolve=>setTimeout(resolve,25));
  }
  if(result.status!=='complete')throw Error('Host exchange deadline expired');
}catch(error){result.status='failed';result.error=String(error.message).slice(0,2000);process.exitCode=1;}
finally{Object.assign(result,{provider_requests:provider,fixture_requests:fixture,requests:exchange.rows,total_bytes:exchange.totalBytes});
  if(missionFixture){await missionFixture.close();result.fixture_ledger_sha256=crypto.createHash('sha256').update(readBoundedFile(path.join(root,'private'),'fixture-ledger.json',4*1024*1024)).digest('hex');}
  result.completed_at=new Date().toISOString();save();}
