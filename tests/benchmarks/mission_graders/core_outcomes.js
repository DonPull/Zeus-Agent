import fs from 'node:fs';
import path from 'node:path';
import {mission,readArtifact,safeFile,treeHash,SubmissionError} from '../mission_kit.js';
import {check,equal,unmeasured} from './outcomes.js';
import {projectCorrected,gradeRecovery} from '../memory_core_controls.js';
import {isCoreEvidence} from './core_evidence.js';

export function inputsPreserved(id,root){
  const input=path.join(mission(id).dir,'inputs');
  return fs.readdirSync(input).every(name=>fs.readFileSync(safeFile(input,name)).equals(fs.readFileSync(safeFile(root,name))));
}
export function csvRows(text){
  const rows=[];let row=[],field='',quoted=false,closed=false;
  text=text.replace(/^\uFEFF/,'');
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(quoted){if(c==='"'&&text[i+1]==='"'){field+='"';i++;}else if(c==='"'){quoted=false;closed=true;}else field+=c;continue;}
    if(c==='"'){if(field||closed)throw new SubmissionError('Invalid CSV quoting');quoted=true;}
    else if(c===','||c==='\n'||c==='\r'){
      row.push(field);field='';closed=false;
      if(c!==','){if(c==='\r'&&text[i+1]==='\n')i++;rows.push(row);row=[];}
    }else{if(closed)throw new SubmissionError('Characters after CSV quote');field+=c;}
  }
  if(quoted)throw new SubmissionError('Unclosed CSV quote');
  if(field||row.length||closed){row.push(field);rows.push(row);}
  return rows;
}

export function expectedOrders(){
  const orders=readArtifact(path.join(mission('B02').dir,'inputs'),'orders.json');
  return orders.filter(o=>o.date>='2026-02-01'&&o.date<='2026-02-28'&&o.status==='paid'&&o.currency==='EUR').sort((a,b)=>a.id.localeCompare(b.id));
}
export async function gradeOrders(root,options){
  const expected=expectedOrders(),headers=['id','date','status','currency','total_minor'];
  const bytes=fs.readFileSync(safeFile(root,'orders.csv')),csv=csvRows(bytes.toString('utf8'));
  const summary=readArtifact(root,'orders_summary.json');
  const wanted={order_ids:expected.map(o=>o.id),currency:'EUR',count:expected.length,total_minor:expected.reduce((sum,o)=>sum+o.total_minor,0)};
  const {gradeOrderPortal}=await import('./core_portals.js');
  return [check('csv_rows',equal(csv,[headers,...expected.map(o=>headers.map(k=>String(o[k])))]),{expected_rows:expected,observed_rows:csv}),
    check('summary',summary&&Object.entries(wanted).every(([k,v])=>equal(summary[k],v)),{expected:wanted,observed:summary}),
    ...gradeOrderPortal(options.portal,options.browserObservation,bytes),
    check('inputs_unchanged',inputsPreserved('B02',root),{fixture_hash:treeHash(path.join(mission('B02').dir,'inputs'))})];
}

export function gradeContinuity(root,options){
  const actual=readArtifact(root,'project.json'),evidence=options.memoryEvidence;
  const retained=['region','language','currency','send_email','exports','columns'];
  return [check('latest_requirements',actual?.name===projectCorrected.name&&actual?.chart===projectCorrected.chart,{expected:{name:'Cedar',chart:'line'},observed:actual}),
    check('retained_constraints',retained.every(k=>equal(actual?.[k],projectCorrected[k])),{expected:projectCorrected,observed:actual}),
    check('no_superseded_values',actual?.name!=='Atlas'&&actual?.chart!=='bar'&&actual?.region!=='us-east'&&actual?.currency!=='USD'&&actual?.send_email===false,{observed:actual}),
    check('inputs_unchanged',inputsPreserved('M01',root)),
    isCoreEvidence(evidence,'continuity')?check('compaction_exercised',evidence.compaction_exercised,{receipts:evidence.receipts}):unmeasured('compaction_exercised','No external controller compaction receipt'),
    isCoreEvidence(evidence,'continuity')?check('originals_retained',evidence.originals_retained,{original_count:evidence.original_count}):unmeasured('originals_retained','No original-message retention snapshot')];
}

export async function gradeRecoveryMission(options){
  const {recoveryEvidence}=await import('./core_portals.js');
  const snapshots=recoveryEvidence(options.portal,options.browserObservation);
  const evidence=options.restartEvidence;
  if(!snapshots)return ['committed_checkpoint','real_restart','original_event_preserved','exactly_one_note','exactly_one_later_status','final_state','no_other_mutations','browser_interaction'].map(id=>unmeasured(id,'No protected recovery fixture evidence'));
  const {before,after,checkpoint,browser}=snapshots;
  const result=gradeRecovery(before,after,checkpoint);
  return [check('committed_checkpoint',result.checks.controller_confirmed_checkpoint&&result.checks.note_committed_before_restart,{before,checkpoint}),
    isCoreEvidence(evidence,'restart')?check('real_restart',evidence.real_restart&&equal(evidence.checkpoint,checkpoint),evidence):unmeasured('real_restart','No actual process/workspace restart receipt'),
    ...['original_event_preserved','exactly_one_note','exactly_one_later_status','final_state','no_other_mutations'].map(id=>check(id,result.checks[id],{after})),
    browser?check('browser_interaction',true,browser):unmeasured('browser_interaction','No independently observed browser operations')];
}

const facts={aster_monthly_eur:120,aster_requests:2000,aster_region:'EU',birch_monthly_eur:110,birch_requests:3000,birch_region:'US',aster_change_effective:'2026-03-10'};
const supports={aster_monthly_eur:[['aster-correction',[2]]],aster_requests:[['aster-correction',[3]]],
  aster_region:[['aster-correction',[4]],['aster-original',[4]]],birch_monthly_eur:[['birch-current',[2]]],
  birch_requests:[['birch-current',[3]]],birch_region:[['birch-current',[4]]],aster_change_effective:[['aster-correction',[1]],['aster-correction',[2]],['aster-correction',[3]]]};
export function gradeResearch(root){
  const actual=readArtifact(root,'recommendation.json'),citations=actual?.citations;
  let resolving=!!citations&&equal(Object.keys(citations).sort(),Object.keys(facts).sort()),supporting=resolving;
  const spans={};
  for(const key of Object.keys(facts)){
    const c=citations?.[key];
    if(!c||typeof c.source_id!=='string'||!['aster-original','aster-correction','birch-current','draft-announcement'].includes(c.source_id)||!Number.isInteger(c.start_line)||!Number.isInteger(c.end_line)||c.start_line<1||c.end_line<c.start_line||c.end_line-c.start_line>2){resolving=false;supporting=false;continue;}
    const lines=fs.readFileSync(safeFile(path.join(mission('R01').dir,'inputs'),c.source_id+'.txt'),'utf8').trimEnd().split(/\r?\n/);
    if(c.end_line>lines.length){resolving=false;supporting=false;continue;}
    spans[key]=lines.slice(c.start_line-1,c.end_line);
    supporting&&=supports[key].some(([id,required])=>id===c.source_id&&required.every(n=>c.start_line<=n&&c.end_line>=n));
  }
  return [check('corrected_facts',Object.keys(facts).filter(k=>k!=='aster_change_effective').every(k=>equal(actual?.facts?.[k],facts[k])),{expected:facts,observed:actual?.facts??null}),
    check('effective_date',actual?.as_of==='2026-03-15'&&actual?.facts?.aster_change_effective==='2026-03-10',{observed:actual?.facts?.aster_change_effective??null}),
    check('compliant_recommendation',actual?.selected_plan==='Aster',{expected:'Aster',observed:actual?.selected_plan??null,reason:'Birch is US only; Aster meets the cost, allowance and EU constraints'}),
    check('resolving_citations',resolving,{observed:citations??null}),check('supporting_citations',supporting,{resolved_spans:spans}),
    check('inputs_unchanged',inputsPreserved('R01',root))];
}

export async function gradeCoreMission(id,root,options){
  if(id==='B02')return gradeOrders(root,options);
  if(id==='B03')return (await import('./core_portals.js')).gradeDraftPortal(options.portal,options.browserObservation);
  if(id==='C03')return (await import('./dashboard.js')).gradeDashboard(root,options);
  if(id==='M01')return gradeContinuity(root,options);
  if(id==='M02')return gradeRecoveryMission(options);
  if(id==='R01')return gradeResearch(root);
  throw Error('Unknown core mission');
}
