import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {startTicketPortal,observeManagedTicketUpdate,gradeTicketPortal} from '../benchmarks/mission_graders/ticket_portal.js';

test('managed browser evidence requires matching real request provenance and cannot be forged by a source label',async()=>{
  const portal=await startTicketPortal();
  try{
    const change={priority:'high',note:'Call after 16:00 Sofia time.'};
    await fetch(`${portal.url}/api/tickets/T-102`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(change)});
    const snapshot={ok:true,session_id:'controller-owned-session',generation:1,result:{url:portal.url,tab_id:'owned-tab',text:'Saved T-102',network_events:[]}};
    assert.equal(observeManagedTicketUpdate(portal,snapshot),null); // backend-only mutation is insufficient
    snapshot.result.network_events=[{method:'PATCH',url:`${portal.url}/api/tickets/T-102`,status:200,tab_id:'owned-tab',seq:1,body_sha256:crypto.createHash('sha256').update(JSON.stringify(change)).digest('hex')}];
    const observed=observeManagedTicketUpdate(portal,snapshot);
    assert.equal(gradeTicketPortal(portal,observed).find(check=>check.id==='browser_interaction').status,'passed');
    assert.equal(gradeTicketPortal(portal,{...observed}).find(check=>check.id==='browser_interaction').status,'failed');
    snapshot.result.network_events[0].body_sha256='wrong';assert.equal(observeManagedTicketUpdate(portal,snapshot),null);
    snapshot.result.network_events[0].body_sha256=observed.request_body_sha256;snapshot.result.url='https://unrelated.example';assert.equal(observeManagedTicketUpdate(portal,snapshot),null);
  }finally{await portal.close();}
});
