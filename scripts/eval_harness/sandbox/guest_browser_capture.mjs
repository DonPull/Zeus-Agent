/** Private controller reads production browser evidence; no agent messages parsed. */
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
import {createHash} from 'node:crypto';
export function watchGuestBrowser({getPage,taskId,signal}){
  const snapshots=[],actions=[],transfers=[],errors=[],seen=new Set(),observed=new Set();let stopped=false;
  const failure=error=>{if(errors.length<20)errors.push(String(error.message).slice(-500));};
  const running=(async()=>{
    while(!stopped&&!signal.aborted){
      try{
        const snapshot=await getPage().evaluate(id=>window.__ZEUS_BRIDGE__.getManagedBrowserObservation(id),taskId);
        if(snapshot?.ok){
          const digest=createHash('sha256').update(JSON.stringify([snapshot.session_id,snapshot.result?.tab_id,snapshot.result?.text,snapshot.result?.network_events])).digest('hex');
          if(!observed.has(digest)){observed.add(digest);snapshots.push(snapshot);if(snapshots.length>200)snapshots.shift();}
        }
      }catch(error){failure(error);}
      if(!stopped)await pause(50);
    }
  })();
  return {async finish(){
    stopped=true;await running;
    try{
      const sessions=await getPage().evaluate(id=>window.__ZEUS_BRIDGE__.getManagedBrowserSessions(id),taskId);
      for(const session of sessions.slice(0,20)){
        const rows=await getPage().evaluate(async({id,session})=>({actions:await window.__ZEUS_BRIDGE__.getManagedBrowserActions(id,session,0),transfers:await window.__ZEUS_BRIDGE__.getManagedBrowserTransfers(id,session)}),{id:taskId,session:session.session_id});
        for(const row of rows.actions)if(!seen.has(row.id)){seen.add(row.id);actions.push(row);}
        transfers.push(...rows.transfers.map(row=>({...row,session_id:session.session_id})));
      }
    }catch(error){failure(error);}
    return {snapshots,actions,transfers,errors};
  }};
}
