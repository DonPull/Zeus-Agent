/** Controlled fixtures remain on the host; no arbitrary URL/headers interface. */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import {startTicketPortal} from '../../../tests/benchmarks/mission_graders/ticket_portal.js';
import {startCorePortal} from '../../../tests/benchmarks/mission_graders/core_portals.js';
import {unlinkedDirectory} from './exchange_files.mjs';
import {fixtureRoute} from './mission_rpc.mjs';
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
export async function createMissionFixture({mission,privateDirectory,id,nonce}){
  if(!['B01','B02','B03','M02'].includes(mission))throw Error('Mission has no browser fixture');
  if(typeof id!=='string'||!/^\w[\w-]*$/.test(id)||!/^([0-9a-f]{48})$/.test(nonce))throw Error('Invalid fixture trial identity');
  const root=unlinkedDirectory(privateDirectory),file=path.join(root,'fixture-ledger.json');
  if(fs.existsSync(file))throw Error('Fixture ledger already exists; do not reset effects');
  const portal=mission==='B01'?await startTicketPortal():await startCorePortal(mission);
  const record={schema_version:1,kind:'host-mission-fixture-v1',id,nonce,mission,identity:portal.identity,status:'ready',requests:[],browser_interaction:'unobserved'};
  let inFlight=false,closed=false;
  const save=()=>{const temporary=file+'.tmp';fs.writeFileSync(temporary,JSON.stringify({...record,state:portal.snapshot()},null,2));fs.renameSync(temporary,file);};
  try{save();}catch(error){await portal.close();throw error;}
  return {portal,snapshot:()=>structuredClone({...record,state:portal.snapshot()}),
    async handle(request){
      if(closed||inFlight)throw Error('Fixture is stopped or busy');
      if(request.nonce!==nonce||request.channel!=='fixture'||!Number.isSafeInteger(request.id)||request.id<1||request.id>4096||record.requests.some(row=>row.id===request.id))throw Error('Invalid or repeated fixture identity');
      fixtureRoute(mission,request.method,request.path,request.body);
      const row={id:request.id,method:request.method,path:request.path,body_sha256:sha(request.body),status:'reserved_unknown'};
      record.requests.push(row);inFlight=true;
      try{
        save(); // Mutation intent is durable before the one local HTTP request.
        const response=await new Promise((resolve,reject)=>{
          const target=new URL(request.path,portal.url),call=http.request(target,{method:request.method,headers:{'Content-Type':'application/json','Content-Length':request.body.length}},res=>{
            let size=0;const chunks=[];
            res.on('data',chunk=>{size+=chunk.length;if(size>1024*1024)call.destroy(Error('Fixture response exceeds allowance'));else chunks.push(chunk);});
            res.once('error',reject);res.once('end',()=>resolve({status:res.statusCode,content_type:res.headers['content-type']?.split(';')[0],content_disposition:res.headers['content-disposition']??null,body:Buffer.concat(chunks)}));
          });
          call.setTimeout(5000,()=>call.destroy(Error('Fixture deadline expired')));call.once('error',reject);call.end(request.body);
        });
        if(!['text/html','application/json','text/csv'].includes(response.content_type)||![null,'attachment; filename="orders.csv"'].includes(response.content_disposition))throw Error('Undeclared fixture response metadata');
        Object.assign(row,{status:'completed',http_status:response.status,response_sha256:sha(response.body),response_bytes:response.body.length});save();return response;
      }catch(error){row.status='failed';record.status='failed';closed=true;save();throw error;}
      finally{inFlight=false;}
    },
    markCorrection(source){portal.markCorrection(source);save();},
    async close(){closed=true;await portal.close();}
  };
}
