import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {withScratch} from '../benchmarks/mission_kit.js';
import {PROVIDER_IDENTITY,validateProviderPayload,createProviderRelay,providerTransport,createProviderExchange} from '../../scripts/eval_harness/sandbox/provider_relay.mjs';
import {requestName,responseName,decodeResponseFrame} from '../../scripts/eval_harness/sandbox/file_rpc.mjs';
const limits={max_requests:2,max_tokens:10000,max_output_tokens:512,max_in_flight:1,wall_time_ms:10000};
const payload=extra=>Buffer.from(JSON.stringify({model:PROVIDER_IDENTITY.model,reasoning_effort:'low',messages:[{role:'user',content:'Synthetic public fixture'}],max_tokens:512,stream:true,stream_options:{include_usage:true},...extra}));
const catalogue=()=>({status:200,content_type:'application/json',body:Buffer.from(JSON.stringify({data:[{id:PROVIDER_IDENTITY.model}]}))});
const completion=(usage={prompt_tokens:10,completion_tokens:5,total_tokens:15,prompt_tokens_details:{cached_tokens:7}})=>({status:200,content_type:'text/event-stream',body:Buffer.from('data: '+JSON.stringify({choices:[{delta:{content:'Synthetic answer'}}],...(usage?{usage}:{})})+'\n\ndata: [DONE]\n\n')});
const config=root=>({privateDirectory:root,id:'synthetic-trial',nonce:'a'.repeat(48),limits});

test('provider payload freezes model/effort/output and rejects external image fetches, extra fields and unsupported protocols',()=>{
  assert.equal(validateProviderPayload(payload(),limits).model,PROVIDER_IDENTITY.model);
  for(const extra of [{model:'other'},{reasoning_effort:'high'},{max_tokens:513},{max_tokens:0},{stream:false},{url:'https://other/'},
    {messages:[{role:'tool',content:'x'}]},{messages:[{role:'user',content:[{type:'image_url',image_url:{url:'https://other/image.png'}}]}]},
    {stream_options:{include_usage:false}},{messages:[{role:'user',content:'x',headers:{Authorization:'bad'}}]}])assert.throws(()=>validateProviderPayload(payload(extra),limits));
  assert.doesNotThrow(()=>validateProviderPayload(payload({messages:[{role:'user',content:[{type:'text',text:'Image fixture'},{type:'image_url',image_url:{url:'data:image/png;base64,YQ=='}}]}]}),limits));
  assert.throws(()=>validateProviderPayload(Buffer.alloc(1024*1024+1),limits));
});

test('host ledger persists unknown intent before dispatch, preserves raw cache usage and never repeats an identity',()=>withScratch(async root=>{
  let calls=0,post=0;
  const relay=createProviderRelay({...config(root),transport:async request=>{
    calls++;if(request.method==='GET')return catalogue();post++;
    const before=JSON.parse(fs.readFileSync(path.join(root,'provider-ledger.json')));
    assert.equal(before.requests.length,post);assert.equal(before.requests.at(-1).status,'reserved_unknown');assert.equal(before.unknown_requests,1);
    return completion();
  }});
  await assert.rejects(relay.request(1,payload()),/preflight/);assert.equal(calls,0);
  await relay.preflight();await relay.request(1,payload());
  let record=relay.snapshot();assert.equal(record.known_tokens,15);assert.equal(record.unknown_requests,0);
  assert.equal(record.requests[0].raw_usage[0].prompt_tokens_details.cached_tokens,7);
  await assert.rejects(relay.request(1,payload()),/already used/);assert.equal(post,1);
  await relay.request(2,payload());await assert.rejects(relay.request(3,payload()),/allowance/);assert.equal(post,2);
  assert.throws(()=>createProviderRelay(config(root)),/cannot be reset/);
}));

test('missing, interrupted and failed provider responses retain paid attempts and close further dispatch',()=>withScratch(async root=>{
  for(const [index,response] of [completion(null),{...completion(),status:429},{...completion(),body:Buffer.from('data: {"usage":{"total_tokens":99}}\n\n')},null].entries()){
    const directory=path.join(root,String(index));fs.mkdirSync(directory);let post=0;
    const relay=createProviderRelay({...config(directory),transport:async request=>{if(request.method==='GET')return catalogue();post++;if(response)return response;throw Error('Synthetic lost connection');}});
    await relay.preflight();await assert.rejects(relay.request(1,payload()));await assert.rejects(relay.request(2,payload()),/stopped/);
    const record=relay.snapshot();assert.equal(post,1);assert.equal(record.requests.length,1);assert.equal(record.status,'failed');
    assert.equal(record.unknown_requests,index===1?0:1);assert.equal(record.requests[0].status,'failed');
  }
}));

test('catalogue absence, reservations, deadlines and concurrency stop before a paid operation',()=>withScratch(async root=>{
  let post=0,release;const pending=new Promise(resolve=>release=resolve);
  const relay=createProviderRelay({...config(root),transport:async request=>{if(request.method==='GET')return catalogue();post++;return pending;}});
  await relay.preflight();const first=relay.request(1,payload());
  await assert.rejects(relay.request(2,payload()),/concurrency/);release(completion());await first;assert.equal(post,1);
  for(const [name,extra,transport,error] of [
    ['catalogue',{},async()=>({...catalogue(),body:Buffer.from('{"data":[]}')}),/absent/],
    ['reservation',{limits:{...limits,max_tokens:1}},async request=>request.method==='GET'?catalogue():completion(),/allowance/],
    ['deadline',{now:()=>0},async request=>request.method==='GET'?catalogue():completion(),null]
  ]){
    const directory=path.join(root,name);fs.mkdirSync(directory);let clock=0;
    const next=createProviderRelay({...config(directory),...extra,...(name==='deadline'?{now:()=>clock}:{}),transport});
    if(name==='catalogue'){await assert.rejects(next.preflight(),error);assert.equal(next.snapshot().requests.length,0);}
    else{await next.preflight();if(name==='deadline')clock=10001;await assert.rejects(next.request(1,payload()),error??/deadline/);assert.equal(next.snapshot().requests.length,0);}
  }
}));

test('ledger write failure prevents network dispatch even after local reservation',()=>withScratch(async root=>{
  let posts=0;const relay=createProviderRelay({...config(root),transport:async request=>{if(request.method==='GET')return catalogue();posts++;return completion();}});
  await relay.preflight();fs.mkdirSync(path.join(root,'provider-ledger.json.tmp'));
  await assert.rejects(relay.request(1,payload()));assert.equal(posts,0);
  const retained=JSON.parse(fs.readFileSync(path.join(root,'provider-ledger.json')));assert.equal(retained.requests.length,0);
}));

test('actual Python transport uses fixed routes, never follows redirects, caps bodies and keeps secrets out of results',()=>withScratch(async root=>{
  let behavior='catalogue',requests=[];
  const server=http.createServer(async(req,res)=>{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    requests.push({method:req.method,url:req.url,authorization:req.headers.authorization,body:Buffer.concat(chunks)});
    if(behavior==='redirect'){res.writeHead(307,{Location:'/stolen'}).end();return;}
    if(behavior==='large'){res.writeHead(200,{'Content-Type':'application/json'}).end(Buffer.alloc(1024*1024+1,65));return;}
    if(behavior==='echo'){res.writeHead(400,{'Content-Type':'application/json'}).end('offline-provider-key');return;}
    const response=behavior==='catalogue'?catalogue():completion();res.writeHead(response.status,{'Content-Type':response.content_type});res.end(response.body);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const transport=providerTransport({offlineOrigin:'http://127.0.0.1:'+server.address().port});
    const relay=createProviderRelay({...config(root),transport});await relay.preflight();behavior='completion';await relay.request(1,payload());
    assert.equal(requests[0].url,'/v1/models');assert.equal(requests[1].url,'/v1/chat/completions');
    assert.ok(requests.every(row=>row.authorization==='Bearer offline-provider-key'));
    assert.ok(!JSON.stringify(relay.snapshot()).includes('offline-provider-key'));
    behavior='redirect';const redirect=await transport({method:'GET',path:'/models',timeoutMs:2000});assert.equal(redirect.status,307);assert.equal(requests.filter(row=>row.url==='/stolen').length,0);
    behavior='large';await assert.rejects(transport({method:'GET',path:'/models',timeoutMs:2000}));
    behavior='echo';await assert.rejects(transport({method:'GET',path:'/models',timeoutMs:2000}),/usage unknown/);
    await assert.rejects(transport({method:'POST',path:'https://example.invalid/',body:payload(),timeoutMs:2000}));
    assert.throws(()=>providerTransport({offlineOrigin:'http://localhost:1234'}),/loopback/);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}));

test('provider file exchange retains a completed billed call when publication fails and cannot re-dispatch it',()=>withScratch(async root=>{
  const input=path.join(root,'input'),output=path.join(root,'output'),privateDirectory=path.join(root,'private');
  for(const folder of [input,output,privateDirectory])fs.mkdirSync(folder);
  fs.writeFileSync(path.join(input,responseName(1)),'');let posts=0;
  const relay=createProviderRelay({...config(privateDirectory),transport:async request=>{if(request.method==='GET')return catalogue();posts++;return completion();}});
  await relay.preflight();
  fs.writeFileSync(path.join(output,requestName(1)),JSON.stringify({schema_version:1,nonce:'a'.repeat(48),id:1,channel:'provider',method:'POST',path:'/chat/completions',body_base64:payload().toString('base64')}));
  const exchange=createProviderExchange({input,output,nonce:'a'.repeat(48),relay,publish:async()=>{throw Error('Synthetic publication failure');}});
  await assert.rejects(exchange.step(),/publication/);await assert.rejects(exchange.step(),/closed/);
  assert.equal(posts,1);assert.equal(relay.snapshot().requests[0].status,'completed');assert.equal(relay.snapshot().known_tokens,15);
  const restarted=createProviderExchange({input,output,nonce:'a'.repeat(48),relay});await assert.rejects(restarted.step(),/already used/);assert.equal(posts,1);
  assert.equal(decodeResponseFrame(fs.readFileSync(path.join(input,responseName(1)))),null);
}));

test('cancelling an actual in-flight transport keeps usage unknown and never dispatches another call',()=>withScratch(async root=>{
  let observed,posts=0;const arrived=new Promise(resolve=>observed=resolve);
  const server=http.createServer(async(req,res)=>{
    for await(const chunk of req){};
    if(req.method==='GET'){res.writeHead(200,{'Content-Type':'application/json'}).end(catalogue().body);return;}
    posts++;observed(); // Deliberately leave this request unresolved.
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const transport=providerTransport({offlineOrigin:'http://127.0.0.1:'+server.address().port});
    const relay=createProviderRelay({...config(root),transport});await relay.preflight();
    const controller=new AbortController(),pending=relay.request(1,payload(),{signal:controller.signal});
    await arrived;controller.abort();await assert.rejects(pending,/cancelled/);
    await assert.rejects(relay.request(2,payload()),/stopped/);assert.equal(posts,1);assert.equal(relay.snapshot().unknown_requests,1);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}));
