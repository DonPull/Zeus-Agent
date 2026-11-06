import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import {chromium} from 'playwright-core';
import {withScratch} from '../benchmarks/mission_kit.js';
import {readBoundedFile} from '../../scripts/eval_harness/sandbox/exchange_files.mjs';
import {validateRequest,requestName,responseName} from '../../scripts/eval_harness/sandbox/file_rpc.mjs';
import {fixtureRoute,missionRequestValidator,missionResponseValidator,createMissionFileClient,createMissionHostExchange,MISSION_RPC_LIMITS} from '../../scripts/eval_harness/sandbox/mission_rpc.mjs';
import {createMissionFixture} from '../../scripts/eval_harness/sandbox/mission_fixture.mjs';
import {inspectHostTransport} from '../../scripts/eval_harness/sandbox/session.js';
import {createProviderRelay,PROVIDER_IDENTITY} from '../../scripts/eval_harness/sandbox/provider_relay.mjs';
const nonce='a'.repeat(48),digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const value=(extra={})=>({schema_version:1,nonce,id:1,channel:'fixture',method:'GET',path:'/',body_base64:'',...extra});
function exchangeFolders(root){
  const input=path.join(root,'input'),output=path.join(root,'output'),privateDirectory=path.join(root,'private');
  for(const folder of [input,output,privateDirectory])fs.mkdirSync(folder);
  for(let index=1;index<=100;index++)fs.writeFileSync(path.join(input,responseName(index)),'');
  return {input,output,privateDirectory};
}
test('mission contracts declare exact fixture paths, preserve narrow smoke defaults and reject URL/header/checkpoint escapes',()=>{
  assert.equal(missionRequestValidator('B02')(value({id:100,path:'/api/orders.csv?from=2026-02-01&currency=EUR'}),nonce).id,100);
  assert.throws(()=>validateRequest(value({id:100,path:'/api/orders.csv?from=2026-02-01'}),nonce));
  for(const [mission,method,route,body] of [
    ['B01','GET','/api/tickets',''],['B01','PATCH','/api/tickets/T-102','{}'],['B01','POST','/api/publish','{}'],
    ['B03','POST','/api/drafts/D-17/submit','{}'],['M02','POST','/api/tickets/SYN-17/note','{}']
  ])assert.equal(fixtureRoute(mission,method,route,Buffer.from(body)),true);
  for(const route of ['https://example.com/','//example.com/','/../api/records','/%2e%2e/api/records','/api/records#x','/api/state','/api/checkpoint','/api/markCorrection','/api/orders?currency=EUR&currency=USD','/api/orders?url=http://example.com/'])assert.throws(()=>fixtureRoute('B02','GET',route,Buffer.alloc(0)),route);
  assert.throws(()=>fixtureRoute('D01','GET','/',Buffer.alloc(0)));
  assert.throws(()=>missionRequestValidator('B01')(value({headers:{Authorization:'bad'}}),nonce));
  assert.throws(()=>missionRequestValidator('B01')(value({id:MISSION_RPC_LIMITS.messages+1}),nonce));
  const response={schema_version:1,nonce,id:1,status:200,content_type:'text/csv',body_base64:'YQ==',content_disposition:'attachment; filename="orders.csv"'};
  assert.equal(missionResponseValidator(response,nonce,1).body.toString(),'a');
  assert.throws(()=>missionResponseValidator({...response,content_disposition:'attachment; filename="../../secret"'},nonce,1));
});

test('mutating fixture requests are persisted once and publication failure cannot duplicate a committed note',()=>withScratch(async root=>{
  const folders=exchangeFolders(root),fixture=await createMissionFixture({mission:'M02',...folders,id:'synthetic',nonce});
  try{
    const request=value({method:'POST',path:'/api/tickets/SYN-17/note',body_base64:Buffer.from('{"value":"Verified original request"}').toString('base64')});
    fs.writeFileSync(path.join(folders.output,requestName(1)),JSON.stringify(request));
    const exchange=createMissionHostExchange({...folders,nonce,mission:'M02',read:readBoundedFile,handle:r=>fixture.handle(r),publish:async()=>{throw Error('Synthetic publication failure');}});
    await assert.rejects(exchange.step(),/publication/);await assert.rejects(exchange.step(),/closed/);
    const next=createMissionHostExchange({...folders,nonce,mission:'M02',read:readBoundedFile,handle:r=>fixture.handle(r)});
    await assert.rejects(next.step(),/repeated/);
    const retained=JSON.parse(fs.readFileSync(path.join(folders.privateDirectory,'fixture-ledger.json')));
    assert.equal(retained.state.audit.length,1);assert.equal(retained.requests.length,1);assert.equal(retained.requests[0].status,'completed');
    assert.equal(retained.browser_interaction,'unobserved');assert.equal(retained.state.checkpoint.source,'controller-observed-commit');
    assert.throws(()=>fixtureRoute('M02','POST','/api/checkpoint',Buffer.from('{}')));
  }finally{await fixture.close();}
}));

test('fixture ledger write failure prevents the local mutation rather than guessing whether it occurred',()=>withScratch(async root=>{
  const fixture=await createMissionFixture({mission:'B03',privateDirectory:root,id:'synthetic',nonce});
  try{
    fs.mkdirSync(path.join(root,'fixture-ledger.json.tmp'));
    await assert.rejects(fixture.handle({...value({method:'POST',path:'/api/drafts/D-17/submit'}),body:Buffer.from('{}')}));
    assert.equal(fixture.portal.snapshot().audit.length,0);
  }finally{await fixture.close();}
}));

test('mixed provider/fixture identities above 32 validate against immutable host bytes and reject changed fixture ledgers',()=>withScratch(async root=>{
  const folders=exchangeFolders(root),fixture=await createMissionFixture({mission:'B02',...folders,id:'synthetic',nonce});
  const relay=createProviderRelay({privateDirectory:folders.privateDirectory,id:'synthetic',nonce,
    limits:{max_requests:2,max_tokens:10000,max_output_tokens:512,max_in_flight:1,wall_time_ms:10000},transport:async request=>({status:200,content_type:'application/json',body:Buffer.from(JSON.stringify(request.method==='GET'?{data:[{id:PROVIDER_IDENTITY.model}]}:{choices:[],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}}))})});
  try{
    await relay.preflight();
    const exchange=createMissionHostExchange({...folders,nonce,mission:'B02',read:readBoundedFile,handle:request=>request.channel==='fixture'?fixture.handle(request):relay.request(request.id,request.body)});
    const body=Buffer.from(JSON.stringify({model:PROVIDER_IDENTITY.model,reasoning_effort:'low',messages:[{role:'user',content:'Synthetic'}],max_tokens:512})).toString('base64');
    for(const request of [value(),value({id:2,path:'/api/orders?currency=EUR'}),value({id:33,channel:'provider',method:'POST',path:'/chat/completions',body_base64:body}),value({id:34,channel:'provider',method:'POST',path:'/chat/completions',body_base64:body})]){
      fs.writeFileSync(path.join(folders.output,requestName(request.id)),JSON.stringify(request));await exchange.step();
    }
    fs.writeFileSync(path.join(folders.output,'probe-result.json'),'{}');
    const file=path.join(folders.privateDirectory,'fixture-ledger.json'),bytes=fs.readFileSync(file);
    fs.writeFileSync(path.join(folders.privateDirectory,'transport.json'),JSON.stringify({id:'synthetic',nonce,kind:'host-observed-synthetic-file-transport',status:'complete',provider_requests:2,fixture_requests:2,provider_inference_requests:0,requests:exchange.rows,total_bytes:exchange.totalBytes,fixture_ledger_sha256:digest(bytes)}));
    const inspect=()=>inspectHostTransport({...folders,privateDir:folders.privateDirectory,id:'synthetic',nonce,mission:'B02'});
    assert.equal(inspect(),true);assert.equal(relay.snapshot().requests.length,2);
    fs.appendFileSync(file,' ');assert.throws(inspect,/Changed/);fs.writeFileSync(file,bytes);
    const response=path.join(folders.input,responseName(2));fs.appendFileSync(response,'x');assert.throws(inspect,/changed/);
  }finally{await fixture.close();}
}));

for(const mission of ['B01','B02','B03','M02'])test(mission+' actual browser traverses framed file exchange with host-owned fixture state',()=>withScratch(async root=>{
  const folders=exchangeFolders(root),fixture=await createMissionFixture({mission,...folders,id:'synthetic',nonce});
  const exchange=createMissionHostExchange({...folders,nonce,mission,read:readBoundedFile,handle:request=>fixture.handle(request)});
  const client=createMissionFileClient({...folders,nonce,mission,read:readBoundedFile,timeoutMs:5000});
  let stopped=false,pumpError=null;
  const pump=(async()=>{while(!stopped){try{await exchange.step();}catch(error){pumpError=error;return;}await new Promise(resolve=>setTimeout(resolve,5));}})();
  const server=http.createServer(async(req,res)=>{
    try{
      const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>8192)throw Error('Fixture body limit');chunks.push(chunk);}
      const reply=await client('fixture',req.method,req.url,Buffer.concat(chunks));
      res.writeHead(reply.status,{'Content-Type':reply.content_type,...(reply.content_disposition?{'Content-Disposition':reply.content_disposition}:{})});res.end(reply.body);
    }catch{res.writeHead(502).end();}
  });
  let browser;
  try{
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    browser=await chromium.launch({headless:true,channel:'chromium'});const page=await browser.newPage();page.setDefaultTimeout(5000);
    await page.goto('http://127.0.0.1:'+server.address().port,{waitUntil:'domcontentloaded'});
    if(mission==='B01'){
      const row=page.locator('article[data-ticket-id="T-102"]');await row.getByLabel('Priority').selectOption('high');await row.getByLabel('New note').fill('Call after 16:00 Sofia time.');await row.getByRole('button',{name:'Save ticket'}).click();
      await page.getByRole('status').filter({hasText:'Saved T-102'}).waitFor();
      assert.equal(fixture.portal.snapshot().mutations.length,1);
    }else if(mission==='B02'){
      await page.getByLabel('From date').fill('2026-02-01');await page.getByLabel('Through date').fill('2026-02-28');await page.getByLabel('Status',{exact:true}).selectOption('paid');await page.getByLabel('Currency').selectOption('EUR');await page.getByRole('button',{name:'Apply filters'}).click();await page.getByRole('status').filter({hasText:'4 orders'}).waitFor();
      const waiting=page.waitForEvent('download');await page.getByRole('button',{name:'Export CSV'}).click();const download=await waiting;
      assert.equal(download.suggestedFilename(),'orders.csv');const bytes=fs.readFileSync(await download.path());
      assert.equal(fixture.portal.snapshot().exports[0].sha256,digest(bytes));assert.match(bytes.toString(),/O-102/);assert.doesNotMatch(bytes.toString(),/O-101/);
    }else if(mission==='B03'){
      const row=page.locator('article[data-id="D-17"]');await row.getByLabel('Owner').selectOption('Mina');await row.getByLabel('Delivery').selectOption('standard');await row.getByLabel('Note',{exact:true}).fill('Keep original packaging');await row.getByRole('button',{name:'Save draft'}).click();await page.getByRole('status').filter({hasText:'Saved /api/drafts/D-17/save'}).waitFor();
      fixture.markCorrection('declared-test-user-turn');await row.getByLabel('Owner').selectOption('Ivo');await row.getByLabel('Delivery').selectOption('express');await row.getByRole('button',{name:'Save draft'}).click();await page.getByRole('status').filter({hasText:'Saved /api/drafts/D-17/save'}).waitFor();
      await row.getByRole('button',{name:'Submit draft'}).click();await page.getByRole('status').filter({hasText:'Saved /api/drafts/D-17/submit'}).waitFor();
      const state=fixture.portal.snapshot();assert.equal(state.audit.filter(row=>row.op==='submit').length,1);assert.equal(state.records.find(row=>row.id==='D-17').owner,'Ivo');assert.ok(state.correction.seq<state.audit.at(-1).seq);
    }else{
      const row=page.locator('article[data-id="SYN-17"]');await row.getByLabel('New note').fill('Verified original request');await row.getByRole('button',{name:'Append note'}).click();await page.getByRole('status').filter({hasText:'Saved /api/tickets/SYN-17/note'}).waitFor();
      await row.getByLabel('Ticket status',{exact:true}).selectOption('Resolved');await row.getByRole('button',{name:'Save status'}).click();await page.getByRole('status').filter({hasText:'Saved /api/tickets/SYN-17/status'}).waitFor();
      const state=fixture.portal.snapshot();assert.equal(state.audit.length,2);assert.equal(state.records.find(row=>row.id==='SYN-17').status,'Resolved');assert.ok(state.checkpoint);
    }
    if(pumpError)throw pumpError;
    const retained=JSON.parse(fs.readFileSync(path.join(folders.privateDirectory,'fixture-ledger.json')));
    assert.ok(retained.requests.length>1);assert.ok(retained.requests.every(row=>row.status==='completed'));assert.equal(retained.browser_interaction,'unobserved');
  }finally{if(browser)await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));stopped=true;await pump;await fixture.close();}
}));
