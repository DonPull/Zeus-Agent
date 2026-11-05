import {test} from 'node:test';
import assert from 'node:assert/strict';
import {projectInitial,projectCorrected,gradeProjectContinuity,gradeRecovery,recoveryContract} from '../benchmarks/memory_core_controls.js';

test('core M01 reference preserves earlier constraints and applies only actual human corrections',()=>{
  assert.equal(gradeProjectContinuity(projectCorrected).passed,true);
  assert.equal(gradeProjectContinuity(projectInitial).passed,false);
  for(const key of Object.keys(projectCorrected)){
    const missing={...projectCorrected};delete missing[key];assert.equal(gradeProjectContinuity(missing).passed,false);
  }
  assert.equal(gradeProjectContinuity({...projectCorrected,region:'us-east'}).passed,false);
  assert.equal(gradeProjectContinuity({...projectCorrected,send_email:true}).passed,false);
  assert.equal(gradeProjectContinuity({summary:'Everything is completed.'}).passed,false);
});
test('core M02 reference requires a controller-observed commit and exactly-once recovery outcomes',()=>{
  const earlier={id:'n1',seq:1,ticket_id:recoveryContract.ticket_id,op:'add_note',value:recoveryContract.note};
  const later={id:'s1',seq:2,ticket_id:recoveryContract.ticket_id,op:'set_status',value:'Resolved'};
  const before={audit:[earlier]};
  const after={ticket:{id:recoveryContract.ticket_id,status:'Resolved',notes:[recoveryContract.note]},audit:[earlier,later]};
  const checkpoint={source:'controller-observed-commit',note_event_id:'n1',seq:1};
  assert.equal(gradeRecovery(before,after,checkpoint).passed,true);
  assert.equal(gradeRecovery(before,after,{...checkpoint,source:'actor-claim'}).passed,false);
  assert.equal(gradeRecovery(before,{...after,audit:[earlier,{...earlier,id:'n2',seq:2},later]},checkpoint).passed,false);
  assert.equal(gradeRecovery(before,{...after,audit:[later]},checkpoint).passed,false);
  assert.equal(gradeRecovery(before,{...after,audit:[earlier,later,{...later,id:'s2',seq:3}]},checkpoint).passed,false);
  assert.equal(gradeRecovery(before,{...after,ticket:{...after.ticket,status:'Open'}},checkpoint).passed,false);
  assert.equal(gradeRecovery(before,after,{...checkpoint,seq:3}).passed,false);
});
