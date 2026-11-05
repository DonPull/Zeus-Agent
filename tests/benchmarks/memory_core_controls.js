/** Independent reference checks for the planned core M01/M02 contracts.
 * Controller-owned state, never a model's claim. Runtime mission wiring follows
 * Phase 4; H01/H02 history probes do not replace these broader core missions.
 */
export const projectInitial={name:'Atlas',region:'eu-west',language:'English',currency:'EUR',send_email:false,
  exports:['csv'],columns:['id','total','currency'],chart:'bar'};
export const projectCorrected={...projectInitial,name:'Cedar',chart:'line'};
export function gradeProjectContinuity(artifact){
  const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const checks=Object.fromEntries(Object.entries(projectCorrected).map(([key,expected])=>[key,equal(artifact?.[key],expected)]));
  return {passed:Object.values(checks).every(Boolean),checks};
}

export const recoveryContract={ticket_id:'SYN-17',note:'Verified original request',final_status:'Resolved'};
export function gradeRecovery(before,after,checkpoint){
  const note=event=>event.ticket_id===recoveryContract.ticket_id&&event.op==='add_note'&&event.value===recoveryContract.note;
  const status=event=>event.ticket_id===recoveryContract.ticket_id&&event.op==='set_status'&&event.value===recoveryContract.final_status;
  const oldAudit=before?.audit??[],audit=after?.audit??[];
  const checks={
    controller_confirmed_checkpoint:checkpoint?.source==='controller-observed-commit'&&checkpoint?.note_event_id!=null,
    note_committed_before_restart:oldAudit.filter(note).length===1&&oldAudit.find(note)?.id===checkpoint?.note_event_id,
    original_event_preserved:oldAudit.every(event=>audit.some(actual=>JSON.stringify(actual)===JSON.stringify(event))),
    exactly_one_note:audit.filter(note).length===1,
    exactly_one_later_status:audit.filter(status).length===1&&audit.find(status)?.seq>checkpoint?.seq,
    final_state:after?.ticket?.id===recoveryContract.ticket_id&&after.ticket.status===recoveryContract.final_status&&
      after.ticket.notes?.filter(value=>value===recoveryContract.note).length===1,
    no_other_mutations:audit.every(event=>note(event)||status(event)),
  };
  return {passed:Object.values(checks).every(Boolean),checks};
}
