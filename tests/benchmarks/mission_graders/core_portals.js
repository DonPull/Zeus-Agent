/** Synthetic web fixtures: state and controller checkpoints have no HTTP API.
 * Browser evidence comes from external Playwright observation, not actor prose.
 */
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {mission,readArtifact} from '../mission_kit.js';
import {check,equal,unmeasured} from './outcomes.js';

const fixtures=new WeakSet(),observations=new WeakSet();
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const copy=value=>structuredClone(value);
export async function startCorePortal(id,{onNoteCommit=async()=>{}}={}){
  if(!['B02','B03','M02'].includes(id))throw Error('Unsupported core portal');
  const input=id==='B02'?'orders.json':id==='B03'?'drafts.json':'tickets.json';
  const original=readArtifact(path.join(mission(id).dir,'inputs'),input);
  let records=copy(original),audit=[],exports=[],correction=null,before=null,checkpoint=null;
  const identity=crypto.randomUUID();
  const event=(op,value)=>{const row={id:crypto.randomUUID(),seq:audit.length+1,op,...value};audit.push(row);return row;};
  const server=http.createServer(async(req,res)=>{
    const send=(status,value,type='application/json',headers={})=>{
      const bytes=Buffer.from(type==='application/json'?JSON.stringify(value):value);
      res.writeHead(status,{'Content-Type':type,'Content-Length':bytes.length,'Cache-Control':'no-store',...headers});res.end(bytes);
    };
    try{
      const url=new URL(req.url,'http://fixture');
      if(req.method==='GET'&&url.pathname==='/')return send(200,portalPage(id),'text/html; charset=utf-8');
      if(req.method==='GET'&&url.pathname==='/api/records')return send(200,records);
      if(id==='B02'&&req.method==='GET'&&['/api/orders','/api/orders.csv'].includes(url.pathname)){
        const query=Object.fromEntries(url.searchParams);
        if(Object.keys(query).some(k=>!['from','through','status','currency'].includes(k)))return send(400,{error:'Unknown filter'});
        const found=records.filter(o=>(!query.from||o.date>=query.from)&&(!query.through||o.date<=query.through)&&(!query.status||o.status===query.status)&&(!query.currency||o.currency===query.currency)).sort((a,b)=>a.id.localeCompare(b.id));
        if(url.pathname==='/api/orders')return send(200,found);
        const header=['id','date','status','currency','total_minor'];
        const bytes=Buffer.from([header.join(','),...found.map(o=>header.map(k=>o[k]).join(','))].join('\n')+'\n');
        exports.push({seq:exports.length+1,query,sha256:digest(bytes),bytes:bytes.length,ids:found.map(o=>o.id)});
        return send(200,bytes,'text/csv; charset=utf-8',{'Content-Disposition':'attachment; filename="orders.csv"'});
      }
      if(req.method!=='POST')return send(404,{error:'Not found'});
      let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>8192)return send(413,{error:'Too large'});}
      const body=JSON.parse(text||'{}'),hash=digest(Buffer.from(text||'{}'));
      if(id==='B03'){
        const match=/^\/api\/drafts\/(D-\d+)\/(save|submit)$/.exec(url.pathname);
        const item=records.find(row=>row.id===match?.[1]);if(!item)return send(404,{error:'Not found'});
        if(match[2]==='save'){
          if(Object.keys(body).sort().join(',')!=='delivery,note,owner'||!['Mina','Ivo','Raya','Unassigned'].includes(body.owner)||!['standard','express'].includes(body.delivery)||typeof body.note!=='string')return send(400,{error:'Invalid draft'});
          Object.assign(item,body);event('save_draft',{record_id:item.id,body:copy(body),body_sha256:hash});
        }else{item.submitted=true;event('submit',{record_id:item.id,body:copy(item),body_sha256:hash});}
        return send(200,{ok:true,record:item,audit_seq:audit.length});
      }
      if(id==='M02'){
        const match=/^\/api\/tickets\/(SYN-\d+)\/(note|status)$/.exec(url.pathname);
        const item=records.find(row=>row.id===match?.[1]);if(!item)return send(404,{error:'Not found'});
        if(Object.keys(body).join(',')!=='value'||typeof body.value!=='string')return send(400,{error:'Invalid change'});
        if(match[2]==='note'){
          item.notes.push(body.value);
          const committed=event('add_note',{ticket_id:item.id,value:body.value,body_sha256:hash});
          if(!checkpoint&&item.id==='SYN-17'){
            checkpoint={source:'controller-observed-commit',note_event_id:committed.id,seq:committed.seq};
            before={ticket:copy(item),audit:copy(audit)};
            await onNoteCommit(copy({before,checkpoint}));
          }
        }else{
          if(!['Open','Resolved'].includes(body.value))return send(400,{error:'Invalid status'});
          item.status=body.value;event('set_status',{ticket_id:item.id,value:body.value,body_sha256:hash});
        }
        return send(200,{ok:true,audit_seq:audit.length});
      }
      return send(403,{error:'Read-only fixture'});
    }catch{return send(400,{error:'Invalid request'});}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const portal=Object.freeze({id,identity,url:'http://127.0.0.1:'+server.address().port,
    snapshot:()=>copy({identity,id,original,records,audit,exports,correction,before,checkpoint}),
    markCorrection:sourceId=>{
      if(id!=='B03'||typeof sourceId!=='string'||!sourceId||correction)throw Error('Invalid correction checkpoint');
      correction=event('human_correction',{source_id:sourceId});
    },
    close:async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  });
  fixtures.add(portal);return portal;
}

/** Real controlled browser, used by reference/integration probes. */
export function watchCorePage(page,portal){
  if(!fixtures.has(portal))throw Error('Unknown fixture');
  const requests=[],downloads=[],pending=[];
  const request=req=>{
    let url;try{url=new URL(req.url());}catch{return;}
    if(url.origin!==portal.url)return;
    const body=req.postDataBuffer();
    requests.push({method:req.method(),path:url.pathname,query:url.search,status:null,body_sha256:body?digest(body):null});
  };
  const response=res=>{
    const req=res.request(),url=new URL(req.url());
    if(url.origin!==portal.url)return;
    const row=requests.findLast(r=>r.path===url.pathname&&r.query===url.search&&r.method===req.method()&&r.status===null);
    if(row)row.status=res.status();
  };
  const download=value=>pending.push((async()=>{
    const filename=await value.path();if(!filename)return;
    const stat=fs.lstatSync(filename);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>2097152)return;
    const bytes=fs.readFileSync(filename);downloads.push({url:value.url(),sha256:digest(bytes),bytes:bytes.length});
  })());
  page.on('request',request);page.on('response',response);page.on('download',download);
  return {async finish(){
    page.off('request',request);page.off('response',response);page.off('download',download);
    await Promise.all(pending);
    const capture=Object.freeze({identity:portal.identity,source:'external-playwright',requests:copy(requests),downloads:copy(downloads)});
    observations.add(capture);return capture;
  }};
}
export function joinCoreObservations(portal,...parts){
  if(!fixtures.has(portal)||parts.some(p=>!observations.has(p)||p.identity!==portal.identity))throw Error('Invalid browser observation');
  const joined=Object.freeze({identity:portal.identity,source:'external-playwright',
    requests:parts.flatMap(p=>p.requests),downloads:parts.flatMap(p=>p.downloads)});
  observations.add(joined);return joined;
}
const observed=(portal,observation)=>fixtures.has(portal)&&observations.has(observation)&&observation.identity===portal.identity;
function saw(portal,observation,row,route){
  return observed(portal,observation)&&observation.requests.some(r=>r.method==='POST'&&r.path===route&&r.body_sha256===row.body_sha256);
}
export function gradeOrderPortal(portal,observation,bytes){
  if(!fixtures.has(portal)||portal.id!=='B02')return ['download_bytes','browser_download','records_preserved'].map(id=>unmeasured(id,'No protected orders portal'));
  const state=portal.snapshot(),hash=digest(bytes);
  const exported=state.exports.find(e=>e.sha256===hash&&e.ids.join(',')==='O-102,O-103,O-104,O-109');
  return [exported?check('download_bytes',true,{export:exported,artifact_sha256:hash}):check('download_bytes',false,{exports:state.exports,artifact_sha256:hash}),
    observed(portal,observation)?check('browser_download',!!exported&&observation.downloads.some(d=>d.url.startsWith(portal.url+'/api/orders.csv?')&&d.sha256===hash),observation):unmeasured('browser_download','No independent browser download event'),
    check('records_preserved',equal(state.records,state.original)&&state.audit.length===0,{records:state.records,audit:state.audit})];
}
export function gradeDraftPortal(portal,observation){
  const ids=['initial_draft','correction_before_submit','revised_submission','exactly_once','other_records_preserved','browser_interaction'];
  if(!fixtures.has(portal)||portal.id!=='B03')return ids.map(id=>unmeasured(id,'No protected draft portal'));
  const s=portal.snapshot(),correction=s.correction,submits=s.audit.filter(e=>e.op==='submit'),saves=s.audit.filter(e=>e.op==='save_draft');
  const initial=saves.find(e=>e.record_id==='D-17'&&e.body.owner==='Mina'&&e.body.delivery==='standard'&&e.body.note==='Keep original packaging');
  const target=s.records.find(r=>r.id==='D-17'),wanted={id:'D-17',owner:'Ivo',delivery:'express',note:'Keep original packaging',reference:'REF-44',submitted:true};
  const effects=s.audit.filter(e=>['save_draft','submit'].includes(e.op));
  const browser=effects.length>0&&effects.every(e=>saw(portal,observation,e,'/api/drafts/'+e.record_id+'/'+(e.op==='submit'?'submit':'save')));
  return [check('initial_draft',!!initial&&!!correction&&initial.seq<correction.seq,{initial,correction}),
    check('correction_before_submit',!!correction&&submits.length>0&&submits.every(e=>e.seq>correction.seq),{correction,submits}),
    check('revised_submission',equal(target,wanted)&&submits.every(e=>equal(e.body,wanted)),{expected:wanted,observed:target,submits}),
    check('exactly_once',submits.length===1&&submits[0].record_id==='D-17',{submits}),
    check('other_records_preserved',equal(s.records.filter(r=>r.id!=='D-17'),s.original.filter(r=>r.id!=='D-17'))&&effects.every(e=>e.record_id==='D-17'),{records:s.records,effects}),
    observed(portal,observation)?check('browser_interaction',browser,observation):unmeasured('browser_interaction','No independent browser mutation observation')];
}
export function recoveryEvidence(portal,observation){
  if(!fixtures.has(portal)||portal.id!=='M02')return null;
  const s=portal.snapshot();
  const browser=s.audit.length>0&&s.audit.every(e=>saw(portal,observation,e,'/api/tickets/'+e.ticket_id+'/'+(e.op==='add_note'?'note':'status')));
  return {before:s.before,after:{ticket:s.records.find(r=>r.id==='SYN-17'),audit:s.audit},checkpoint:s.checkpoint,browser:browser?observation:null};
}

function portalPage(id){
  const common=`<!doctype html><html lang="en"><meta charset="utf-8"><title>Zeus core portal</title>
<style>body{font:16px system-ui;max-width:1000px;margin:30px auto;padding:16px}article{border:1px solid #aaa;padding:16px;margin:12px 0}label{display:block;margin:8px 0}input,select,textarea,button{font:inherit;padding:8px}button{margin:8px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #aaa;padding:8px}</style>
<h1>`+(id==='B02'?'Orders':id==='B03'?'Dispatch drafts':'Recovery tickets')+`</h1><main></main><p role="status"></p>
<script>
const main=document.querySelector('main'),status=document.querySelector('[role=status]');
async function get(route){const r=await fetch(route);if(!r.ok)throw Error('Request failed');return r.json();}
async function post(route,body){const r=await fetch(route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw Error('Save failed');await r.json();status.textContent='Saved '+route;await load();}
function node(tag,text){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;}
function field(row,label,value,choices){const wrap=node('label',label+' '),input=node(choices?'select':'input');input.setAttribute('aria-label',label);if(choices)for(const c of choices)input.add(new Option(c,c));input.value=value;wrap.append(input);row.append(wrap);return input;}
function button(row,text,fn){const b=node('button',text);b.onclick=()=>{b.disabled=true;Promise.resolve(fn()).catch(e=>{status.textContent=e.message;b.disabled=false;});};row.append(b);}
`;
  if(id==='B02')return common+`
const controls=node('section');main.append(controls);const from=field(controls,'From date',''),through=field(controls,'Through date',''),state=field(controls,'Status','',['','paid','pending','refunded']),currency=field(controls,'Currency','',['','EUR','USD']);
function query(){return new URLSearchParams({from:from.value,through:through.value,status:state.value,currency:currency.value}).toString();}
const table=node('table');main.append(table);
async function load(){const rows=await get('/api/orders?'+query());table.replaceChildren();const head=node('tr');for(const key of ['id','date','status','currency','total_minor'])head.append(node('th',key));table.append(head);for(const item of rows){const row=node('tr');for(const key of ['id','date','status','currency','total_minor'])row.append(node('td',String(item[key])));table.append(row);}status.textContent=rows.length+' orders';}
const apply=node('button','Apply filters');apply.onclick=load;controls.append(apply);
const download=node('button','Export CSV');download.onclick=()=>{window.location.href='/api/orders.csv?'+query();};controls.append(download);load();
</script></html>`;
  if(id==='B03')return common+`
async function load(){main.replaceChildren();for(const item of await get('/api/records')){const row=node('article');row.dataset.id=item.id;row.append(node('h2',item.id),node('p','Reference: '+item.reference),node('p','Submitted: '+item.submitted));
const owner=field(row,'Owner',item.owner,['Unassigned','Mina','Ivo','Raya']),delivery=field(row,'Delivery',item.delivery,['standard','express']),note=field(row,'Note',item.note);
button(row,'Save draft',()=>post('/api/drafts/'+item.id+'/save',{owner:owner.value,delivery:delivery.value,note:note.value}));
button(row,'Submit draft',()=>post('/api/drafts/'+item.id+'/submit',{}));main.append(row);}}load();
</script></html>`;
  return common+`
async function load(){main.replaceChildren();for(const item of await get('/api/records')){const row=node('article');row.dataset.id=item.id;row.append(node('h2',item.id),node('p','Status: '+item.status),node('p','Notes: '+item.notes.join(' / ')));
const note=field(row,'New note',''),state=field(row,'Ticket status',item.status,['Open','Resolved']);
button(row,'Append note',()=>post('/api/tickets/'+item.id+'/note',{value:note.value}));
button(row,'Save status',()=>post('/api/tickets/'+item.id+'/status',{value:state.value}));main.append(row);}}load();
</script></html>`;
}
