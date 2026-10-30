/** External read-only browser observer. It never supplies task answers/actions. */
import {observeManagedTicketUpdate} from './mission_graders/ticket_portal.js';

export function watchTicketBrowser({page,taskId,portal,signal}){
  let stopped=false,observation=null,attempts=0,wake=null;
  const inspections=[];
  const pause=()=>new Promise(resolve=>{
    const timer=setTimeout(()=>{wake=null;resolve();},100);
    wake=()=>{clearTimeout(timer);wake=null;resolve();};
  });
  const running=(async()=>{
    while(!stopped&&!signal?.aborted&&attempts<6){
      if(!portal.snapshot().mutations.length){await pause();continue;}
      attempts++;
      try{
        const snapshot=await page.evaluate(task=>window.__ZEUS_BRIDGE__.getManagedBrowserObservation(task),taskId);
        inspections.push({at:new Date().toISOString(),snapshot});
        observation=observeManagedTicketUpdate(portal,snapshot);
        if(observation)return;
      }catch(error){inspections.push({at:new Date().toISOString(),error:String(error.message)});}
      await pause();
    }
  })();
  return {
    async finish(){stopped=true;wake?.();await running;return observation;},
    evidence(){return {source:'external-read-only-controller',observation,inspections,portal:portal.snapshot()};},
  };
}
