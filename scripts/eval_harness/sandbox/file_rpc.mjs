/** Bounded data-only exchange. No arbitrary URLs, headers, commands or retries. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const RPC_LIMITS=Object.freeze({messages:32,requestBytes:2*1024*1024,responseBytes:2*1024*1024,totalBytes:16*1024*1024});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
export const requestName=id=>'rpc-request-'+String(id).padStart(6,'0')+'.json';
export const responseName=id=>'rpc-response-'+String(id).padStart(6,'0')+'.json';
const FRAME_HEADER=80;
export function encodeResponseFrame(bytes){
  return Buffer.concat([Buffer.from('ZR1:'+String(bytes.length).padStart(10,'0')+':'+sha(bytes)+'\n'),bytes,Buffer.from('\nEND\n')]);
}
export function decodeResponseFrame(bytes){
  if(bytes.length<FRAME_HEADER)return null;
  const match=/^ZR1:(\d{10}):([0-9a-f]{64})\n$/.exec(bytes.subarray(0,FRAME_HEADER).toString());
  if(!match)throw Error('Invalid response frame header');
  const length=Number(match[1]);if(length>RPC_LIMITS.responseBytes-FRAME_HEADER-5)throw Error('Response frame exceeds its allowance');
  if(bytes.length<FRAME_HEADER+length+5)return null;
  const body=bytes.subarray(FRAME_HEADER,FRAME_HEADER+length);
  if(bytes.length!==FRAME_HEADER+length+5||bytes.subarray(-5).toString()!=='\nEND\n'||sha(body)!==match[2])throw Error('Response frame checksum/length mismatch');
  return body;
}
function exactKeys(value,keys){
  if(!value||Array.isArray(value)||typeof value!=='object'||Object.keys(value).sort().join(',')!==[...keys].sort().join(','))throw Error('Invalid exchange fields');
}
function identity(value,nonce){
  if(value.schema_version!==1||value.nonce!==nonce||!Number.isSafeInteger(value.id)||value.id<1||value.id>RPC_LIMITS.messages)throw Error('Invalid exchange identity');
}
function decode(value,maximum){
  if(typeof value!=='string'||value.length>maximum*4/3+4||value.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(value))throw Error('Invalid exchange body');
  const bytes=Buffer.from(value,'base64');
  if(bytes.length>maximum||bytes.toString('base64')!==value)throw Error('Invalid exchange body bounds');
  return bytes;
}
export function validateRequest(value,nonce){
  exactKeys(value,['schema_version','nonce','id','channel','method','path','body_base64']);identity(value,nonce);
  const body=decode(value.body_base64,1024*1024);
  const provider=value.channel==='provider'&&value.method==='POST'&&value.path==='/chat/completions';
  const fixture=value.channel==='fixture'&&value.method==='GET'&&value.path==='/'&&body.length===0;
  if(!provider&&!fixture)throw Error('Exchange route is outside this synthetic contract');
  return {...value,body};
}
export function validateResponse(value,nonce,id){
  exactKeys(value,['schema_version','nonce','id','status','content_type','body_base64']);identity(value,nonce);
  if(value.id!==id||!Number.isInteger(value.status)||value.status<200||value.status>599||!['text/event-stream','text/html','application/json'].includes(value.content_type))throw Error('Invalid exchange response');
  return {...value,body:decode(value.body_base64,1024*1024)};
}
export async function atomicExchange(directory,name,bytes,{rename=fs.renameSync,timeoutMs=2000}={}){
  if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>5000)throw Error('Invalid publication deadline');
  const temporary=path.join(directory,name+'.tmp'),destination=path.join(directory,name);
  if(fs.existsSync(destination))throw Error('Exchange destination already exists');
  fs.writeFileSync(temporary,bytes,{flag:'wx'});
  const deadline=Date.now()+timeoutMs;
  while(true){
    try{rename(temporary,destination);return;}
    catch(error){
      if(!['EBUSY','EPERM','EACCES'].includes(error.code)||Date.now()>=deadline)throw error;
      await pause(25);
    }
  }
}
/** WSB's readonly mapping locks renames. Publish once into an empty prepared slot.
 * The length/hash/commit frame keeps partial reads from becoming responses. */
export async function publishResponse(directory,name,bytes){
  const file=path.join(directory,name),before=fs.lstatSync(file);
  if(!before.isFile()||before.isSymbolicLink()||before.size!==0)throw Error('Response slot is missing, linked or already used');
  const frame=encodeResponseFrame(bytes);if(frame.length>RPC_LIMITS.responseBytes)throw Error('Response frame exceeds its allowance');
  const fd=fs.openSync(file,'r+');
  try{
    const opened=fs.fstatSync(fd);
    if(opened.dev!==before.dev||opened.ino!==before.ino||opened.size!==0)throw Error('Response slot changed');
    let offset=0;while(offset<frame.length){const written=fs.writeSync(fd,frame,offset,frame.length-offset,offset);if(written<1)throw Error('Response publication made no progress');offset+=written;}
    fs.fsyncSync(fd);
  }finally{fs.closeSync(fd);}
  return frame;
}
/** Only a trusted synthetic controller creates this client. Host reads stay bounded. */
export function createFileClient({input,output,nonce,read,timeoutMs=20000}){
  if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000)throw Error('Invalid client response deadline');
  let sequence=0,total=0;
  return async function request(channel,method,route,body=Buffer.alloc(0)){
    const id=++sequence,value={schema_version:1,nonce,id,channel,method,path:route,body_base64:Buffer.from(body).toString('base64')};
    validateRequest(value,nonce);
    const bytes=Buffer.from(JSON.stringify(value));total+=bytes.length;
    if(bytes.length>RPC_LIMITS.requestBytes||total>RPC_LIMITS.totalBytes)throw Error('Guest exchange allowance exhausted');
    await atomicExchange(output,requestName(id),bytes);
    const deadline=Date.now()+timeoutMs;
    while(Date.now()<deadline){
      try{
        const bytes=read(input,responseName(id),RPC_LIMITS.responseBytes);
        const frame=decodeResponseFrame(bytes);
        if(frame){total+=bytes.length;if(total>RPC_LIMITS.totalBytes)throw Error('Guest exchange allowance exhausted');return validateResponse(JSON.parse(frame),nonce,id);}
      }catch(error){if(error.code!=='ENOENT')throw error;}
      await pause(20);
    }
    throw Error('Exchange response deadline expired; request was not retried');
  };
}
/** One host step handles immutable request files and never executes their content. */
export function createHostExchange({input,output,nonce,read,handle,publish=publishResponse}){
  const handled=new Map(),rows=[];let total=0,closed=false;
  return {rows,get totalBytes(){return total;},
    async step(){
      if(closed)throw Error('Exchange is closed after a failure');
      try{
        const names=fs.readdirSync(output);if(names.length>RPC_LIMITS.messages*2+4)throw Error('Too many exchange files');
        for(const name of names.sort()){
          if(name==='probe-result.json'||name==='probe-result.tmp'||/^rpc-request-\d{6}\.json\.tmp$/.test(name))continue;
          if(!/^rpc-request-\d{6}\.json$/.test(name))throw Error('Undeclared exchange output file');
          const bytes=read(output,name,RPC_LIMITS.requestBytes),digest=sha(bytes);
          if(handled.has(name)){if(handled.get(name)!==digest)throw Error('Previously handled exchange request changed');continue;}
          if(rows.length>=RPC_LIMITS.messages)throw Error('Host exchange request allowance exhausted');
          const value=validateRequest(JSON.parse(bytes),nonce);
          if(name!==requestName(value.id)||rows.some(row=>row.id===value.id))throw Error('Exchange filename/identity mismatch');
          total+=bytes.length;if(total>RPC_LIMITS.totalBytes)throw Error('Host exchange byte allowance exhausted');
          const response=await handle(value);
          const reply={schema_version:1,nonce,id:value.id,status:response.status,content_type:response.content_type,body_base64:Buffer.from(response.body).toString('base64')};
          validateResponse(reply,nonce,value.id);const encoded=Buffer.from(JSON.stringify(reply)),frame=encodeResponseFrame(encoded);total+=frame.length;
          if(frame.length>RPC_LIMITS.responseBytes||total>RPC_LIMITS.totalBytes)throw Error('Host exchange response allowance exhausted');
          await publish(input,responseName(value.id),encoded);handled.set(name,digest);
          rows.push({id:value.id,channel:value.channel,method:value.method,path:value.path,request_sha256:digest,response_sha256:sha(frame),request_bytes:bytes.length,response_bytes:frame.length});
        }
      }catch(error){closed=true;throw error;}
    }};
}
