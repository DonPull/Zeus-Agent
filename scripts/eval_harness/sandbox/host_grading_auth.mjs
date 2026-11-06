#!/usr/bin/env node
/** Pin a guest controller's key before acknowledging permission to start code. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readBoundedFile,unlinkedDirectory} from './session.js';
import {pinControllerKey,verifyGradingResult} from './grading_auth.mjs';
import {publishResponse} from './file_rpc.mjs';
const parent=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../.zeus/evaluations/sandbox-sessions');
const root=unlinkedDirectory(process.argv[2]??'');
if(path.dirname(root).toLowerCase()!==parent.toLowerCase()||!/^[0-9a-f-]{36}$/.test(path.basename(root)))throw Error('Use an owned prepared session');
const manifest=JSON.parse(readBoundedFile(root,'session.json',16384));
if(!manifest.grading_auth)throw Error('No authenticated grading job declared');
const input=path.join(root,'input'),output=path.join(root,'output'),receipt=path.join(root,'private/grading-auth.json');
const identity={id:manifest.id,nonce:manifest.nonce,packet_sha256:manifest.auth_packet_sha256};
const record={schema_version:1,kind:'host-pinned-grading-key',...identity,status:'waiting_for_key',provider_inference_requests:0};
const save=()=>{const temporary=receipt+'.tmp';fs.writeFileSync(temporary,JSON.stringify(record,null,2));fs.renameSync(temporary,receipt);};
const pause=()=>new Promise(resolve=>setTimeout(resolve,25));
let pinned=null;save();
try{
  const deadline=Date.now()+170000;
  while(Date.now()<deadline){
    for(const name of fs.readdirSync(output)){
      const limit=name==='grading-key.json'||name==='grading-key.json.tmp'?4096:name==='probe-result.json'||name==='probe-result.tmp'?1024*1024:(manifest.candidate_control||manifest.submission_job)&&name==='candidate-write.txt'?128:0;
      if(!limit)throw Error('Undeclared grading output file');
      if(fs.lstatSync(path.join(output,name)).size>limit)throw Error('Grading output exceeds its allowance');
    }
    if(!pinned&&fs.existsSync(path.join(output,'grading-key.json'))){
      pinned=pinControllerKey(JSON.parse(readBoundedFile(output,'grading-key.json',4096)),identity);
      Object.assign(record,{status:'key_pinned',key_spki:pinned.spki,key_sha256:pinned.fingerprint,pinned_at:new Date().toISOString()});save();
      await publishResponse(input,'grading-key-ack.json',Buffer.from(JSON.stringify({...identity,key_sha256:pinned.fingerprint})));
    }
    if(fs.existsSync(path.join(output,'probe-result.json'))){
      if(!pinned)throw Error('Grading result arrived before controller key pinning');
      const result=JSON.parse(readBoundedFile(output,'probe-result.json',1024*1024));
      const signed=verifyGradingResult(result.runtime_smoke,pinned,identity);
      record.result_status=signed.status;record.status='verified';record.verified_at=new Date().toISOString();break;
    }
    await pause();
  }
  if(record.status!=='verified')throw Error('Authenticated grading deadline expired');
}catch(error){record.status='failed';record.error=String(error.message).slice(0,2000);process.exitCode=1;}
finally{save();}
