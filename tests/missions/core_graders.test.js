/** Public core-v1 reference/negative controls; not live capability results. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {chromium} from '@playwright/test';
import {mission,missionIds,deployMission,withScratch} from '../benchmarks/mission_kit.js';
import {gradeMission} from '../benchmarks/mission_graders/outcomes.js';
import {captureContinuity,captureRestart} from '../benchmarks/mission_graders/core_evidence.js';
import {startCorePortal,watchCorePage,joinCoreObservations} from '../benchmarks/mission_graders/core_portals.js';
import {csvRows} from '../benchmarks/mission_graders/core_outcomes.js';

const scenario=(id,work)=>withScratch(async root=>{deployMission(id,root);return work(root);});
const install=(id,root,source,target=source)=>fs.copyFileSync(path.join(mission(id).dir,'reference',source),path.join(root,target));
const json=(root,name)=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
const save=(root,name,value)=>fs.writeFileSync(path.join(root,name),JSON.stringify(value));
const passed=result=>assert.equal(result.outcome_status,'passed',JSON.stringify(result));
const failed=(result,id)=>assert.equal(result.criteria.find(c=>c.id===id)?.status,'failed',JSON.stringify(result));
const missing=(result,id)=>assert.equal(result.criteria.find(c=>c.id===id)?.status,'not_evaluated',JSON.stringify(result));
const hash=text=>crypto.createHash('sha256').update(text).digest('hex');
const continuity=({retained=true,compacted=true}={})=>captureContinuity(
  {messages:[{id:'human-initial',seq:1,role:'user',kind:'chat',sha256:hash('Initial constraints')},{id:'human-correction',seq:3,role:'user',kind:'chat',sha256:hash('Cedar / line')}],compactions:[]},
  {messages:[{id:'human-initial',seq:1,role:'user',kind:'chat',sha256:hash(retained?'Initial constraints':'Changed source')},{id:'human-correction',seq:3,role:'user',kind:'chat',sha256:hash('Cedar / line')}],
    compactions:compacted?[[81,'["human-initial","human-correction"]',2,480000,150000]]:[]});

test('core v1 has exactly the twelve agreed distinct mission contracts',()=>{
  assert.deepEqual(missionIds,['B01','B02','B03','C01','C02','C03','D01','D02','M01','M02','R01','V01']);
  for(const id of missionIds){const {task}=mission(id);assert.ok(task.prompt.length>100);assert.ok(new Set(task.required_criteria).size===task.required_criteria.length);}
});
test('CSV controls retain quoted fields, CRLF, zero and reject malformed quoting',()=>{
  assert.deepEqual(csvRows('"id","total_minor"\r\n"O-109","0"\r\n'),[['id','total_minor'],['O-109','0']]);
  assert.deepEqual(csvRows('a,b\n"x,y","say ""hi"""\n'),[['a','b'],['x,y','say "hi"']]);
  assert.throws(()=>csvRows('a\n"unterminated'),/Unclosed/);
});
test('R01 accepts the reference facts and resolving source spans',()=>scenario('R01',async root=>{
  install('R01',root,'recommendation.json');passed(await gradeMission('R01',root));
}));
test('R01 accepts alternate valid spans and an unchanged fact from the original source',()=>scenario('R01',async root=>{
  install('R01',root,'recommendation.json');const value=json(root,'recommendation.json');
  value.citations.aster_monthly_eur.start_line=1;
  value.citations.aster_region={source_id:'aster-original',start_line:4,end_line:4};
  value.citations.aster_change_effective={source_id:'aster-correction',start_line:3,end_line:3};
  value.rationale='Aster meets the region and allowance constraints; Birch is US only.';
  save(root,'recommendation.json',value);passed(await gradeMission('R01',root));
}));
for(const [name,mutate,id] of [
  ['superseded price',v=>v.facts.aster_monthly_eur=100,'corrected_facts'],
  ['uneffective announcement',v=>v.facts.aster_monthly_eur=90,'corrected_facts'],
  ['issue date as effective date',v=>v.facts.aster_change_effective='2026-03-02','effective_date'],
  ['cheaper but noncompliant region',v=>v.selected_plan='Birch','compliant_recommendation'],
  ['nonexistent source',v=>v.citations.aster_requests.source_id='fabricated','resolving_citations'],
  ['unrelated valid source',v=>v.citations.aster_monthly_eur={source_id:'birch-current',start_line:2,end_line:2},'supporting_citations'],
  ['superseded citation',v=>v.citations.aster_monthly_eur={source_id:'aster-original',start_line:2,end_line:2},'supporting_citations'],
  ['whole collection span',v=>v.citations.aster_requests={source_id:'aster-correction',start_line:1,end_line:4},'resolving_citations'],
])test('R01 rejects '+name,()=>scenario('R01',async root=>{
  install('R01',root,'recommendation.json');const value=json(root,'recommendation.json');mutate(value);save(root,'recommendation.json',value);failed(await gradeMission('R01',root),id);
}));
test('R01 cannot rewrite evidence to make a wrong claim look supported',()=>scenario('R01',async root=>{
  install('R01',root,'recommendation.json');fs.appendFileSync(path.join(root,'aster-correction.txt'),'\nFabricated addendum.');
  failed(await gradeMission('R01',root),'inputs_unchanged');
}));
test('M01 reference criteria accept a trusted synthetic controller trace, not an actor claim',()=>scenario('M01',async root=>{
  install('M01',root,'project.json');passed(await gradeMission('M01',root,{memoryEvidence:continuity()}));
  const noEvidence=await gradeMission('M01',root,{memoryEvidence:{kind:'continuity',compaction_exercised:true,originals_retained:true}});
  missing(noEvidence,'compaction_exercised');missing(noEvidence,'originals_retained');
}));
for(const [name,mutate,id] of [
  ['old project name',v=>v.name='Atlas','latest_requirements'],
  ['stale chart',v=>v.chart='bar','latest_requirements'],
  ['dropped original region',v=>delete v.region,'retained_constraints'],
  ['reference note as authority',v=>v.currency='USD','retained_constraints'],
  ['email accidentally enabled',v=>v.send_email=true,'retained_constraints'],
  ['reordered columns',v=>v.columns.reverse(),'retained_constraints'],
])test('M01 rejects '+name,()=>scenario('M01',async root=>{
  install('M01',root,'project.json');const value=json(root,'project.json');mutate(value);save(root,'project.json',value);
  failed(await gradeMission('M01',root,{memoryEvidence:continuity()}),id);
}));
test('M01 a long transcript without compaction and changed originals cannot pass',()=>scenario('M01',async root=>{
  install('M01',root,'project.json');
  failed(await gradeMission('M01',root,{memoryEvidence:continuity({compacted:false})}),'compaction_exercised');
  failed(await gradeMission('M01',root,{memoryEvidence:continuity({retained:false})}),'originals_retained');
}));
for(const source of ['index.html','alternative.html'])test('C03 actual browser accepts '+source,()=>scenario('C03',async root=>{
  install('C03',root,source,'index.html');
  passed(await gradeMission('C03',root,{trustedExecution:true,screenshotDirectory:source==='index.html'?path.resolve('.zeus/evaluations/core-v1-dashboard-reference'):null}));
}));
test('C03 a generated executable is not loaded into a host browser without trusted control status',()=>scenario('C03',async root=>{
  install('C03',root,'index.html');const result=await gradeMission('C03',root);
  assert.equal(result.outcome_status,'error');assert.match(result.error.message,/isolated.*grader/i);
}));
test('C03 rejects whitespace edits and loss of persisted state',()=>scenario('C03',async root=>{
  install('C03',root,'index.html');const file=path.join(root,'index.html'),source=fs.readFileSync(file,'utf8');
  fs.writeFileSync(file,source.replace('input.value.trim()','input.value'));
  failed(await gradeMission('C03',root,{trustedExecution:true}),'empty_title');
  fs.writeFileSync(file,source.replace("const stored=JSON.parse(localStorage.getItem(key)||'null')","localStorage.removeItem(key);const stored=null"));
  failed(await gradeMission('C03',root,{trustedExecution:true}),'toggle_and_persist');
}));

async function browserScenario(id,work){
  return scenario(id,async root=>{
    const portal=await startCorePortal(id),browser=await chromium.launch({headless:true});
    try{const page=await browser.newPage();page.setDefaultTimeout(3000);const observer=watchCorePage(page,portal);await page.goto(portal.url);await page.locator('main').waitFor();return await work({root,portal,page,observer});}
    finally{await browser.close();await portal.close();}
  });
}
async function ordersDownload({root,page,from='2026-02-01',through='2026-02-28'}){
  await page.getByLabel('From date',{exact:true}).fill(from);await page.getByLabel('Through date',{exact:true}).fill(through);
  await page.getByLabel('Status',{exact:true}).selectOption('paid');await page.getByLabel('Currency',{exact:true}).selectOption('EUR');
  await page.getByRole('button',{name:'Apply filters',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[role=status]').textContent==='4 orders');
  const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'Export CSV',exact:true}).click();
  await(await downloaded).saveAs(path.join(root,'orders.csv'));install('B02',root,'orders_summary.json');
}
test('B02 passes a real filtered browser CSV download including both boundaries and zero',()=>browserScenario('B02',async ctx=>{
  await ordersDownload(ctx);const observation=await ctx.observer.finish();
  passed(await gradeMission('B02',ctx.root,{portal:ctx.portal,browserObservation:observation}));
  const value=json(ctx.root,'orders_summary.json');value.total_minor++;save(ctx.root,'orders_summary.json',value);
  failed(await gradeMission('B02',ctx.root,{portal:ctx.portal,browserObservation:observation}),'summary');
}));
test('B02 correct hand-written files cannot pretend to be an actual browser download',()=>browserScenario('B02',async ctx=>{
  install('B02',ctx.root,'orders.csv');install('B02',ctx.root,'orders_summary.json');
  const result=await gradeMission('B02',ctx.root,{portal:ctx.portal,browserObservation:{source:'external-playwright',downloads:[{url:ctx.portal.url+'/api/orders.csv',sha256:'fake'}]}});
  failed(result,'download_bytes');missing(result,'browser_download');
}));
test('B02 rejects changed downloaded bytes even when the rows remain semantically correct',()=>browserScenario('B02',async ctx=>{
  await ordersDownload(ctx);const observation=await ctx.observer.finish();
  const file=path.join(ctx.root,'orders.csv');fs.writeFileSync(file,fs.readFileSync(file,'utf8').replaceAll('\n','\r\n'));
  const result=await gradeMission('B02',ctx.root,{portal:ctx.portal,browserObservation:observation});
  assert.equal(result.criteria.find(c=>c.id==='csv_rows').status,'passed');
  failed(result,'download_bytes');failed(result,'browser_download');
}));
async function draftSave(page,owner,delivery){
  const row=page.locator('article[data-id="D-17"]');await row.getByLabel('Owner',{exact:true}).selectOption(owner);
  await row.getByLabel('Delivery',{exact:true}).selectOption(delivery);await row.getByLabel('Note',{exact:true}).fill('Keep original packaging');
  const saved=page.waitForResponse(r=>r.url().endsWith('/api/drafts/D-17/save'));
  await row.getByRole('button',{name:'Save draft',exact:true}).click();await saved;
  await page.waitForFunction(owner=>document.querySelector('article[data-id="D-17"] select[aria-label=Owner]')?.value===owner&&document.querySelector('[role=status]').textContent.includes('/save'),owner);
}
async function draftSubmit(page){
  const request=page.waitForResponse(r=>r.url().includes('/api/drafts/D-17/submit'));
  await page.locator('article[data-id="D-17"]').getByRole('button',{name:'Submit draft',exact:true}).click();await request;
  await page.getByText('Submitted: true',{exact:true}).waitFor();
}
test('B03 real draft/correction/submission workflow passes once',()=>browserScenario('B03',async ctx=>{
  await draftSave(ctx.page,'Mina','standard');ctx.portal.markCorrection('scripted-correction-turn');
  await draftSave(ctx.page,'Ivo','express');await draftSubmit(ctx.page);
  passed(await gradeMission('B03',ctx.root,{portal:ctx.portal,browserObservation:await ctx.observer.finish()}));
}));
test('B03 rejects early submission and an eventual correct state cannot erase a duplicate',()=>browserScenario('B03',async ctx=>{
  await draftSave(ctx.page,'Mina','standard');await draftSubmit(ctx.page);ctx.portal.markCorrection('scripted-correction-turn');
  await draftSave(ctx.page,'Ivo','express');await draftSubmit(ctx.page);
  const result=await gradeMission('B03',ctx.root,{portal:ctx.portal,browserObservation:await ctx.observer.finish()});
  failed(result,'correction_before_submit');failed(result,'exactly_once');
}));
test('B03 direct API edits alone remain missing browser evidence',()=>browserScenario('B03',async ctx=>{
  const post=async(route,body)=>{const r=await fetch(ctx.portal.url+route,{method:'POST',body:JSON.stringify(body)});await r.text();assert.equal(r.status,200);};
  await post('/api/drafts/D-17/save',{owner:'Mina',delivery:'standard',note:'Keep original packaging'});
  ctx.portal.markCorrection('scripted-correction-turn');
  await post('/api/drafts/D-17/save',{owner:'Ivo',delivery:'express',note:'Keep original packaging'});await post('/api/drafts/D-17/submit',{});
  const result=await gradeMission('B03',ctx.root,{portal:ctx.portal,browserObservation:await ctx.observer.finish()});
  failed(result,'browser_interaction');
}));
async function recoveryStep(page,label,value,button){
  const row=page.locator('article[data-id="SYN-17"]'),field=row.getByLabel(label,{exact:true});
  if(label==='New note')await field.fill(value);else await field.selectOption(value);
  const response=page.waitForResponse(r=>r.url().includes('/api/tickets/SYN-17/'+(label==='New note'?'note':'status')));
  await row.getByRole('button',{name:button,exact:true}).click();await response;
  await page.waitForFunction(()=>document.querySelector('[role=status]').textContent.startsWith('Saved '));
}
test('M02 state/audit reference accepts a synthetic controller restart receipt and rejects replayed effects',()=>browserScenario('M02',async ctx=>{
  await recoveryStep(ctx.page,'New note','Verified original request','Append note');
  const checkpoint=ctx.portal.snapshot().checkpoint;
  const restart=captureRestart({oldProcess:100,newProcess:101,oldWorkspace:'synthetic-owned-workspace',newWorkspace:'synthetic-owned-workspace',checkpoint,beforeRestart:ctx.portal.snapshot()});
  await recoveryStep(ctx.page,'Ticket status','Resolved','Save status');
  const first=await ctx.observer.finish();passed(await gradeMission('M02',ctx.root,{portal:ctx.portal,browserObservation:first,restartEvidence:restart}));
  const tooLate=captureRestart({oldProcess:100,newProcess:101,oldWorkspace:'synthetic-owned-workspace',newWorkspace:'synthetic-owned-workspace',checkpoint,beforeRestart:ctx.portal.snapshot()});
  failed(await gradeMission('M02',ctx.root,{portal:ctx.portal,browserObservation:first,restartEvidence:tooLate}),'real_restart');
  const more=watchCorePage(ctx.page,ctx.portal);
  await recoveryStep(ctx.page,'New note','Verified original request','Append note');
  const all=joinCoreObservations(ctx.portal,first,await more.finish());
  failed(await gradeMission('M02',ctx.root,{portal:ctx.portal,browserObservation:all,restartEvidence:restart}),'exactly_one_note');
}));
test('M02 correct final state without a genuine controller restart handle is unmeasured',()=>browserScenario('M02',async ctx=>{
  await recoveryStep(ctx.page,'New note','Verified original request','Append note');
  await recoveryStep(ctx.page,'Ticket status','Resolved','Save status');
  const observation=await ctx.observer.finish();
  const result=await gradeMission('M02',ctx.root,{portal:ctx.portal,browserObservation:observation,restartEvidence:{kind:'restart',real_restart:true}});
  missing(result,'real_restart');
}));
