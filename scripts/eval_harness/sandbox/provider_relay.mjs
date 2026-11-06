/** Host-controlled paid-call boundary. Guest requests carry no provider secrets. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {unlinkedDirectory,readBoundedFile} from './exchange_files.mjs';
import {createHostExchange} from './file_rpc.mjs';
const directory=path.dirname(fileURLToPath(import.meta.url));
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const maximum=1024*1024;
export const PROVIDER_IDENTITY=Object.freeze({connection:'abacus',origin:'https://routellm.abacus.ai/v1',model:'gpt-6.1-terra',effort:'low',protocol:'chat'});
function fields(value,allowed,required=[]){
  if(!value||Array.isArray(value)||typeof value!=='object'||Object.keys(value).some(key=>!allowed.includes(key))||required.some(key=>!Object.hasOwn(value,key)))throw Error('Undeclared provider payload fields');
}
function count(value){return Number.isSafeInteger(value)&&value>=0;}
export function validateProviderPayload(bytes,limits){
  if(!Buffer.isBuffer(bytes)||bytes.length>maximum)throw Error('Provider payload exceeds allowance');
  const body=JSON.parse(bytes);
  fields(body,['model','messages','stream','stream_options','reasoning_effort','max_tokens'],['model','messages','reasoning_effort','max_tokens']);
  if(body.model!==PROVIDER_IDENTITY.model||body.reasoning_effort!==PROVIDER_IDENTITY.effort)throw Error('Provider model/effort differs from frozen binding');
  if(!Number.isSafeInteger(body.max_tokens)||body.max_tokens<1||body.max_tokens>limits.max_output_tokens)throw Error('Provider output cap exceeds allowance');
  if(body.stream!==undefined&&body.stream!==true)throw Error('Only native Chat streaming or omitted stream is supported');
  if(body.stream_options!==undefined){fields(body.stream_options,['include_usage'],['include_usage']);if(body.stream!==true||body.stream_options.include_usage!==true)throw Error('Invalid stream usage request');}
  if(!Array.isArray(body.messages)||body.messages.length<1||body.messages.length>4096)throw Error('Invalid provider messages');
  for(const message of body.messages){
    fields(message,['role','content'],['role','content']);
    if(!['system','user','assistant'].includes(message.role))throw Error('Unsupported provider message role');
    if(typeof message.content==='string')continue;
    if(!Array.isArray(message.content)||!message.content.length)throw Error('Invalid multimodal content');
    for(const part of message.content){
      if(part?.type==='text'){fields(part,['type','text'],['type','text']);if(typeof part.text!=='string')throw Error('Invalid provider text');}
      else if(part?.type==='image_url'){
        fields(part,['type','image_url'],['type','image_url']);fields(part.image_url,['url'],['url']);
        const match=/^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/.exec(part.image_url.url);
        if(!match||Buffer.from(match[2],'base64').toString('base64')!==match[2])throw Error('Only supplied inline images are allowed');
      }else throw Error('Undeclared provider modality');
    }
  }
  return body;
}
function usageFrom(response){
  const text=response.body.toString('utf8'),events=[];let terminal=false;
  if(response.content_type==='text/event-stream'){
    for(const line of text.split(/\r?\n/)){
      if(!line.startsWith('data:'))continue;
      const data=line.slice(5).trim();if(data==='[DONE]'){terminal=true;continue;}if(!data)continue;
      const chunk=JSON.parse(data);if(chunk.usage)events.push(chunk.usage);
    }
  }else if(response.content_type==='application/json'){
    const body=JSON.parse(text);terminal=Array.isArray(body.choices);if(body.usage)events.push(body.usage);
  }
  const raw=events.at(-1),input=raw?.prompt_tokens??raw?.input_tokens,output=raw?.completion_tokens??raw?.output_tokens;
  const total=raw?.total_tokens??(count(input)&&count(output)?input+output:null);
  // Keep cache/reasoning fields raw; do not add subsets as extra billed tokens.
  return {raw_usage:events,usage_known:terminal&&count(input)&&count(output)&&count(total),
    input_tokens:count(input)?input:null,output_tokens:count(output)?output:null,total_tokens:count(total)?total:null};
}
export function providerTransport({python='python',offlineOrigin=null}={}){
  if(offlineOrigin!==null){const parsed=new URL(offlineOrigin);if(parsed.protocol!=='http:'||parsed.hostname!=='127.0.0.1'||!parsed.port||parsed.pathname!=='/'||parsed.search||parsed.hash||parsed.username||parsed.password)throw Error('Explicit loopback offline origin required');}
  return ({method,path:route,body=Buffer.alloc(0),timeoutMs,signal})=>new Promise((resolve,reject)=>{
    const args=['-I','-S','-B',path.join(directory,'provider_worker.py'),...(offlineOrigin?['--offline-origin',offlineOrigin.replace(/\/$/,'')]:[])];
    const child=spawn(python,args,{windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});
    let chunks=[],size=0,failed=null;
    const fail=error=>{failed??=error;if(child.exitCode===null)child.kill();};
    const timer=setTimeout(()=>fail(Error('Provider worker deadline expired; usage unknown')),timeoutMs+2000);
    const abort=()=>fail(Error('Provider worker cancelled; usage unknown'));
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    child.stdout.on('data',chunk=>{size+=chunk.length;if(size>maximum*1.5)fail(Error('Provider worker output exceeds allowance'));else chunks.push(chunk);});
    child.stderr.on('data',()=>{}); // Never surface arbitrary credential/transport diagnostics.
    child.stdin.on('error',()=>{});child.once('error',()=>{failed=Error('Provider worker unavailable');});
    child.once('close',code=>{
      clearTimeout(timer);signal?.removeEventListener('abort',abort);
      if(failed)return reject(failed);
      if(code!==0)return reject(Error('Provider transport failed; usage unknown'));
      try{const result=JSON.parse(Buffer.concat(chunks));if(result.error)throw Error('Provider transport failed');
        const bytes=Buffer.from(result.body_base64,'base64');
        if(bytes.length>maximum||bytes.toString('base64')!==result.body_base64)throw Error('Invalid provider response encoding');
        resolve({...result,body:bytes});
      }catch{reject(Error('Invalid provider transport response; usage unknown'));}
    });
    child.stdin.end(JSON.stringify({method,path:route,body_base64:body.toString('base64'),timeout_ms:timeoutMs}));
  });
}
/** One immutable ledger per trial. A crash leaves a reserved/unknown paid call. */
export function createProviderRelay({privateDirectory,id,nonce,limits,transport=providerTransport(),now=Date.now}){
  const root=unlinkedDirectory(privateDirectory),file=path.join(root,'provider-ledger.json');
  if(typeof id!=='string'||!id||!/^\w[\w-]*$/.test(id)||!/^([0-9a-f]{48})$/.test(nonce))throw Error('Invalid provider trial identity');
  for(const [key,upper] of Object.entries({max_requests:32,max_tokens:100000000,max_output_tokens:8192,wall_time_ms:600000}))if(!Number.isSafeInteger(limits?.[key])||limits[key]<1||limits[key]>upper)throw Error('Invalid provider limit');
  if(limits.max_in_flight!==1)throw Error('Provider relay requires one request in flight');
  if(fs.existsSync(file))throw Error('Existing provider ledger cannot be reset or replayed');
  const started=now(),record={schema_version:1,kind:'host-provider-ledger-v1',id,nonce,binding:PROVIDER_IDENTITY,limits:{...limits},
    started_at:new Date(started).toISOString(),status:'prepared',catalogue:null,requests:[],known_tokens:0,unknown_requests:0,
    input_estimate:'serialized_request_bytes_divided_by_three_not_an_exact_tokenizer',provider_credits:null,transport:'buffered_response_v1'};
  const save=()=>{const temporary=file+'.tmp';fs.writeFileSync(temporary,JSON.stringify(record,null,2),{flag:'w'});fs.renameSync(temporary,file);};
  let inFlight=false,closed=false;save();
  const remaining=()=>limits.wall_time_ms-(now()-started);
  const available=()=>{if(closed||record.status==='failed')throw Error('Provider relay stopped; no further dispatch');if(remaining()<=0)throw Error('Provider trial deadline expired');};
  return {
    snapshot:()=>structuredClone(record),
    async preflight({signal}={}){
      available();if(record.catalogue||inFlight)throw Error('Catalogue preflight already attempted');
      inFlight=true;record.status='catalogue_pending';save();
      try{
        const response=await transport({method:'GET',path:'/models',timeoutMs:Math.min(5000,remaining()),signal});
        if(response.status!==200||response.content_type!=='application/json')throw Error('Provider catalogue unavailable');
        const body=JSON.parse(response.body),models=body.data??body.models;
        if(!Array.isArray(models)||!models.some(model=>(model?.id??model?.name)===PROVIDER_IDENTITY.model))throw Error('Frozen model absent from provider catalogue');
        record.catalogue={checked_at:new Date(now()).toISOString(),sha256:sha(response.body),model:PROVIDER_IDENTITY.model};record.status='ready';save();return record.catalogue;
      }catch(error){closed=true;record.status='failed';record.error='Catalogue preflight failed';save();throw error;}
      finally{inFlight=false;}
    },
    async request(requestId,bytes,{signal}={}){
      available();if(!record.catalogue)throw Error('Catalogue preflight required');
      if(!Number.isSafeInteger(requestId)||requestId<1||requestId>4096||record.requests.some(row=>row.id===requestId))throw Error('Provider request identity already used or invalid');
      if(inFlight)throw Error('Provider request concurrency exceeds allowance');
      const payload=validateProviderPayload(bytes,limits),estimate=Math.ceil(bytes.length/3)+payload.max_tokens;
      if(record.requests.length>=limits.max_requests||record.known_tokens+estimate>limits.max_tokens)throw Error('Provider request/token reservation allowance exhausted');
      const row={id:requestId,request_sha256:sha(bytes),request_bytes:bytes.length,input_token_estimate:Math.ceil(bytes.length/3),reserved_estimate:estimate,
        status:'reserved_unknown',usage_known:false,started_at:new Date(now()).toISOString(),provider_credits:null};
      record.requests.push(row);record.unknown_requests++;inFlight=true;
      try{
        save(); // Persist intent BEFORE any operation which may incur provider cost.
        const response=await transport({method:'POST',path:'/chat/completions',body:bytes,timeoutMs:Math.min(300000,remaining()),signal});
        Object.assign(row,{http_status:response.status,response_sha256:sha(response.body),response_bytes:response.body.length,first_byte_ms:response.first_byte_ms??null,duration_ms:response.duration_ms??null});
        const usage=usageFrom(response);Object.assign(row,usage);
        if(usage.usage_known){record.unknown_requests--;record.known_tokens+=usage.total_tokens;}
        if(response.status!==200||!usage.usage_known||record.known_tokens>limits.max_tokens)throw Error('Provider response failed, usage unknown or token allowance exceeded');
        row.status='completed';save();return response;
      }catch(error){row.status='failed';record.status='failed';record.error='Provider request failed; no automatic retry';closed=true;save();throw error;}
      finally{inFlight=false;}
    }
  };
}

/** Reuse the validated file framing. Paid intent survives publication failure. */
export function createProviderExchange({input,output,nonce,relay,publish}){
  return createHostExchange({input,output,nonce,read:readBoundedFile,publish,handle:async request=>{
    if(request.channel!=='provider')throw Error('This provider exchange has no fixture handler');
    return relay.request(request.id,request.body);
  }});
}
