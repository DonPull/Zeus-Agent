/** Controller-only evidence handles. Actor JSON is never an evidence capability.
 * These readers must be called by the external driver with actual observations;
 * their objects are not an OS attestation or an authorization certificate.
 */
const captures=new WeakSet();
export function captureContinuity(before,after){
  if(!Array.isArray(before?.messages)||!Array.isArray(after?.messages)||!Array.isArray(after?.compactions))throw Error('Invalid controller history snapshot');
  const originals=before.messages.filter(m=>['chat','directive','directive_result'].includes(m.kind)&&m.role!=='event');
  const current=new Map(after.messages.map(m=>[m.id,m]));
  const receipts=after.compactions.slice(before.compactions?.length??0);
  const evidence=Object.freeze({kind:'continuity',original_count:originals.length,
    originals_retained:originals.length>0&&originals.every(m=>current.get(m.id)?.seq===m.seq&&current.get(m.id)?.sha256===m.sha256),
    compaction_exercised:receipts.some(r=>Array.isArray(r)&&r.length===5&&Number.isInteger(r[0])&&r[0]>0&&r[3]>r[4]&&r[4]>0),
    receipts:structuredClone(receipts)});
  captures.add(evidence);return evidence;
}
export function captureRestart({oldProcess,newProcess,oldWorkspace,newWorkspace,checkpoint,beforeRestart}){
  const evidence=Object.freeze({kind:'restart',real_restart:Number.isInteger(oldProcess)&&oldProcess>0&&Number.isInteger(newProcess)&&newProcess>0&&oldProcess!==newProcess&&typeof oldWorkspace==='string'&&oldWorkspace===newWorkspace,
    confirmed_phase:beforeRestart?.audit?.length===1&&beforeRestart.audit[0].id===checkpoint?.note_event_id&&beforeRestart.records?.find(r=>r.id==='SYN-17')?.status==='Open',
    checkpoint:structuredClone(checkpoint)});
  captures.add(evidence);return evidence;
}
export function isCoreEvidence(value,kind){return value?.kind===kind&&captures.has(value);}
