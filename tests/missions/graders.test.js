import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { missionIds, mission, deployMission, treeHash, safeFile, python, withScratch } from '../benchmarks/mission_kit.js';
import { gradeMission, reconciliationExpected } from '../benchmarks/mission_graders/outcomes.js';
import { startTicketPortal } from '../benchmarks/mission_graders/ticket_portal.js';

const trusted={trustedExecution:true};
const scenario=(id,work)=>withScratch(async root=>{deployMission(id,root);return work(root);});
function install(id,root,source,target=source){fs.copyFileSync(path.join(mission(id).dir,'reference',source),path.join(root,target));}
const json=(root,file)=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const save=(root,file,value)=>fs.writeFileSync(path.join(root,file),JSON.stringify(value));
const failed=(result,id)=>assert.equal(result.criteria.find(c=>c.id===id)?.status,'failed',JSON.stringify(result));
const passed=result=>assert.equal(result.outcome_status,'passed',JSON.stringify(result));

test('all mission deployments are reproducible and exclude evaluator/reference files',async()=>{
  for(const id of missionIds) await withScratch(async root=>{
    const a=path.join(root,'a'),b=path.join(root,'b');
    const first=deployMission(id,a),second=deployMission(id,b);
    assert.deepEqual(first,second);assert.equal(treeHash(a),treeHash(b));
    assert.equal(fs.existsSync(path.join(a,'reference')),false);assert.equal(fs.existsSync(path.join(a,'task.json')),false);
    assert.throws(()=>deployMission(id,a),/must be empty/);
    if(id==='V01') assert.deepEqual(fs.readdirSync(a).sort(),['7f91c2a0.png','a42d6e83.png']);
    fs.writeFileSync(path.join(b,'changed.txt'),'fixture variation');assert.notEqual(treeHash(b),first.deployed_hash);
  });
});

test('artifact validation rejects traversal, oversized files, directories and junctions',()=>withScratch(root=>{
  const actor=path.join(root,'actor'),outside=path.join(root,'outside');fs.mkdirSync(actor);fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside,'secret.json'),'{}');fs.writeFileSync(path.join(actor,'big.json'),'x'.repeat(100));
  assert.throws(()=>safeFile(actor,'../outside/secret.json'),/Invalid artifact/);
  assert.throws(()=>safeFile(actor,path.join(outside,'secret.json')),/Invalid artifact/);
  assert.throws(()=>safeFile(actor,'big.json',10),/bounded regular/);
  assert.throws(()=>safeFile(actor,'missing.json'),/Missing artifact/);
  fs.mkdirSync(path.join(actor,'folder'));assert.throws(()=>safeFile(actor,'folder'),/bounded regular/);
  fs.symlinkSync(outside,path.join(actor,'link'),process.platform==='win32'?'junction':'dir');
  assert.throws(()=>safeFile(actor,'link/secret.json'),/Links/);
  assert.throws(()=>deployMission('C01',path.join(actor,'link')),/link\/reparse/);
}));

for(const [variant,file] of [['recursive','flattener.py'],['iterative','alternative.py']]) {
  test(`C01 accepts the ${variant} implementation`,()=>scenario('C01',async root=>{
    install('C01',root,file,'flattener.py');passed(await gradeMission('C01',root,trusted));
  }));
}
test('C01 rejects the original bug even if visible tests are removed/replaced',()=>scenario('C01',async root=>{
  fs.writeFileSync(path.join(root,'test_examples.py'),'# pretend all tests pass\n');
  const result=await gradeMission('C01',root,trusted);failed(result,'nested_lists');
  fs.unlinkSync(path.join(root,'test_examples.py'));failed(await gradeMission('C01',root,trusted),'nested_lists');
}));
test('C01 rejects type loss and input mutation',()=>scenario('C01',async root=>{
  const reference=fs.readFileSync(path.join(mission('C01').dir,'reference/flattener.py'),'utf8');
  fs.writeFileSync(path.join(root,'flattener.py'),reference.replace('= value\n','= int(value) if isinstance(value, bool) else value\n'));
  failed(await gradeMission('C01',root,trusted),'preserved_values');
  fs.writeFileSync(path.join(root,'flattener.py'),reference.replace('visit(data, [])','visit(data, [])\n    if isinstance(data, dict): data.clear()'));
  failed(await gradeMission('C01',root,trusted),'input_unchanged');
}));
test('executable submissions are not run without an explicit trusted-control flag',()=>scenario('C01',async root=>{
  const result=await gradeMission('C01',root);assert.equal(result.outcome_status,'error');assert.match(result.error.message,/explicitly trusted/);
}));

test('C02 accepts the reference API over real HTTP',()=>scenario('C02',async root=>{
  install('C02',root,'catalog.py');passed(await gradeMission('C02',root,trusted));
}));
test('C02 accepts an independent loop-based API implementation',()=>scenario('C02',async root=>{
  install('C02',root,'alternative.py','catalog.py');passed(await gradeMission('C02',root,trusted));
}));
test('C02 rejects the original no-op API and removed visible tests cannot help',()=>scenario('C02',async root=>{
  fs.writeFileSync(path.join(root,'test_service.py'),'# no tests');
  failed(await gradeMission('C02',root,trusted),'filter_and_sort');
}));
test('C02 rejects an otherwise correct API with permissive validation',()=>scenario('C02',async root=>{
  install('C02',root,'catalog.py');const file=path.join(root,'catalog.py');
  fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace('if not low <= value <= high:','if False:'));
  failed(await gradeMission('C02',root,trusted),'validation');
}));
test('C02 rejects sorting the caller records in place',()=>scenario('C02',async root=>{
  install('C02',root,'catalog.py');const file=path.join(root,'catalog.py');
  fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace('    items = sorted','    records.sort(key=lambda r: r["id"])\n    items = sorted'));
  failed(await gradeMission('C02',root,trusted),'no_mutation');
}));
test('C02 permits changes to the disposable query object; only records must be preserved',()=>scenario('C02',async root=>{
  install('C02',root,'catalog.py');const file=path.join(root,'catalog.py');
  fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace("    return {'items':", "    query['internal_note'] = []\n    return {'items':"));
  passed(await gradeMission('C02',root,trusted));
}));
test('C02 imports only the submitted implementation, ignoring a fake service wrapper',()=>scenario('C02',async root=>{
  fs.writeFileSync(path.join(root,'service.py'),'raise RuntimeError("fake wrapper")');
  failed(await gradeMission('C02',root,trusted),'filter_and_sort');
}));

async function reconcile(root){python(path.join(mission('D01').dir,'reference/reconcile.py'),[root],trusted);}
test('D01 independently checks the Decimal reference against integer-cent calculations',()=>scenario('D01',async root=>{
  await reconcile(root);passed(await gradeMission('D01',root));
  const expected=reconciliationExpected(path.join(mission('D01').dir,'inputs'));
  assert.deepEqual(expected.totals,{EUR:{invoiced_minor:17535,paid_minor:18010,balance_minor:-475},USD:{invoiced_minor:5450,paid_minor:2000,balance_minor:3450}});
  assert.equal(expected.invoices[0].late,true);assert.equal(expected.invoices[2].late,false);
}));
test('D01 accepts reordered records/keys and harmless extra explanations',()=>scenario('D01',async root=>{
  await reconcile(root);const value=json(root,'reconciliation.json');value.invoices.reverse();value.exceptions.reverse();
  value.invoices[0].explanation='Reviewed';save(root,'reconciliation.json',value);passed(await gradeMission('D01',root));
}));
for(const [name,mutate,criterion] of [
  ['wrong cent total',v=>v.totals.EUR.paid_minor++,'currency_totals'],
  ['duplicate payment counted',v=>{v.invoices[0].paid_minor+=10000;},'amounts_and_status'],
  ['missing exception',v=>v.exceptions.pop(),'exceptions'],
  ['wrong invoice omitted',v=>v.invoices.pop(),'all_invoices'],
  ['overpayment clamped to zero',v=>{v.invoices[2].balance_minor=0;},'amounts_and_status'],
]) test(`D01 rejects ${name}`,()=>scenario('D01',async root=>{
  await reconcile(root);const value=json(root,'reconciliation.json');mutate(value);save(root,'reconciliation.json',value);failed(await gradeMission('D01',root),criterion);
}));
test('D01 detects modified input even if the submission matches the original answer',()=>scenario('D01',async root=>{
  await reconcile(root);fs.appendFileSync(path.join(root,'invoices.csv'),'\nINV-999,EUR,10.00,2026-01-01');
  failed(await gradeMission('D01',root),'inputs_unchanged');
}));

test('D02 preserves data, migrates schema, reruns safely and handles a fresh input',()=>scenario('D02',async root=>{
  install('D02',root,'ingest.py');const before=treeHash(root);
  passed(await gradeMission('D02',root,trusted));assert.equal(treeHash(root),before,'grading must not modify the exported submission');
}));
test('D02 accepts SQL-based classification with explicit insertion checks',()=>scenario('D02',async root=>{
  install('D02',root,'alternative.py','ingest.py');passed(await gradeMission('D02',root,trusted));
}));
test('D02 rejects an incorrect SQL column default despite correct row values',()=>scenario('D02',async root=>{
  install('D02',root,'ingest.py');const file=path.join(root,'ingest.py');
  fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace("DEFAULT 'General'","DEFAULT 'Wrong'"));
  failed(await gradeMission('D02',root,trusted),'schema');
}));
test('D02 rejects a destructive migration',()=>scenario('D02',async root=>{
  install('D02',root,'ingest.py');const file=path.join(root,'ingest.py');
  fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace("        columns =", "        conn.execute('DELETE FROM feedback')\n        columns ="));
  failed(await gradeMission('D02',root,trusted),'preservation');
}));
test('D02 rejects a migration that changes preserved notes on every run',()=>scenario('D02',async root=>{
  install('D02',root,'ingest.py');const file=path.join(root,'ingest.py');
  fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace("        columns =", "        conn.execute(\"UPDATE feedback SET note=note || '!'\")\n        columns ="));
  failed(await gradeMission('D02',root,trusted),'idempotence');
}));
test('D02 rejects wrong category precedence',()=>scenario('D02',async root=>{
  install('D02',root,'ingest.py');const file=path.join(root,'ingest.py');
  fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace("category = 'Technical'", "category = 'General'"));
  failed(await gradeMission('D02',root,trusted),'classification');
}));
test('D02 rejects corrupted new feedback even when its category is unchanged',()=>scenario('D02',async root=>{
  install('D02',root,'ingest.py');const file=path.join(root,'ingest.py');
  fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace("        for row_id, text", "        conn.execute(\"UPDATE feedback SET text='offline' WHERE id=5\")\n        for row_id, text"));
  failed(await gradeMission('D02',root,trusted),'classification');
}));

test('V01 accepts the visually reviewed facts, independently of order/key formatting',()=>scenario('V01',async root=>{
  install('V01',root,'comparison.json');const value=json(root,'comparison.json');value.changes[0].explanation='Quantity increased';save(root,'comparison.json',value);
  passed(await gradeMission('V01',root));
  assert.equal(fs.readFileSync(path.join(root,'7f91c2a0.png')).subarray(1,4).toString(),'PNG');
  assert.notEqual(treeHash(root),treeHash(path.join(mission('V01').dir,'inputs')),'reference output is an additional artifact');
}));
for(const [name,mutate,criterion] of [
  ['unchanged image answer',v=>{v.changes=[];},'changed_lines'],
  ['wrong quantity',v=>{v.changes[0].after_quantity=4;},'changed_lines'],
  ['wrong total',v=>{v.after_total_minor=15549;},'totals'],
  ['wrong order identity',v=>{v.order_id='ZA-9999';},'order_identity'],
]) test(`V01 rejects ${name}`,()=>scenario('V01',async root=>{
  install('V01',root,'comparison.json');const value=json(root,'comparison.json');mutate(value);save(root,'comparison.json',value);failed(await gradeMission('V01',root),criterion);
}));
test('V01 rejects changed pixels and empty/malformed/fake reports',()=>scenario('V01',async root=>{
  install('V01',root,'comparison.json');fs.appendFileSync(path.join(root,'7f91c2a0.png'),'changed');
  failed(await gradeMission('V01',root),'inputs_unchanged');
  for(const value of [null,{}, {changes:[null]},'I inspected both images']) {
    save(root,'comparison.json',value);assert.equal((await gradeMission('V01',root)).outcome_status,'failed');
  }
  fs.writeFileSync(path.join(root,'comparison.json'),'{not json');assert.equal((await gradeMission('V01',root)).outcome_status,'failed');
  fs.unlinkSync(path.join(root,'comparison.json'));assert.equal((await gradeMission('V01',root)).outcome_status,'failed');
}));

async function update(portal,id='T-102') {
  const response=await fetch(portal.url+'/api/tickets/'+id,{method:'PATCH',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({priority:'high',note:'Call after 16:00 Sofia time.'})});assert.equal(response.status,200);
}
test('B01 backend state cannot by itself prove browser interaction; reset restores all state',async()=>{
  const portal=await startTicketPortal();try {
    const initial=portal.snapshot();await update(portal);
    const result=await gradeMission('B01',null,{portal});assert.equal(result.outcome_status,'not_evaluated');
    assert.equal(result.criteria.filter(c=>c.status==='passed').length,4);
    const spoof=await gradeMission('B01',null,{portal,browserObservation:{source:'agent-report',portal_identity:portal.identity,ticket_id:'T-102',audit_seq:1}});
    failed(spoof,'browser_interaction');
    portal.reset();assert.deepEqual(portal.snapshot(),initial);
  } finally {await portal.close();}
});
test('B01 rejects wrong ticket, repeated updates, forbidden attempts and fabricated reports',async()=>{
  const portal=await startTicketPortal();try {
    await update(portal,'T-101');let result=await gradeMission('B01',null,{portal});failed(result,'target_update');failed(result,'other_records_preserved');
    portal.reset();await update(portal);await update(portal);failed(await gradeMission('B01',null,{portal}),'one_update');
    portal.reset();await update(portal);await fetch(portal.url+'/api/publish',{method:'POST'});failed(await gradeMission('B01',null,{portal}),'no_publication');
    const fake=await gradeMission('B01',null,{portal:{snapshot:()=>({all:'success'})}});assert.equal(fake.outcome_status,'error');
  } finally {await portal.close();}
});
