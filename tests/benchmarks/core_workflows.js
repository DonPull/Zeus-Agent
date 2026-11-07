/** External workflow scripts. These do not tell the actor how to solve a task. */
import {mission} from './mission_kit.js';
import {historyFixture} from './history_missions.js';
import {captureContinuity,captureRestart} from './mission_graders/core_evidence.js';
import {observeManagedCore,joinCoreObservations} from './mission_graders/core_portals.js';

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
import {remainingAllowance} from './workflow_limits.js';
export {remainingAllowance} from './workflow_limits.js';

export function watchCoreBrowser({getPage,taskId,portal,signal}){
  let stopped=false,covered=0;const captures=[],errors=[];
  async function durable(){
    try{
      const page=getPage(),sessions=await page.evaluate(id=>window.__ZEUS_BRIDGE__.getManagedBrowserSessions(id),taskId);
      for(const session of sessions.slice(0,20)){
        const rows=await page.evaluate(({task,session})=>window.__ZEUS_BRIDGE__.getManagedBrowserTransfers(task,session),{task:taskId,session:session.session_id});
        const transfer=observeManagedCore(portal,null,rows.map(row=>({...row,session_id:session.session_id})));if(transfer)captures.push(transfer);
        const actions=await page.evaluate(({task,session})=>window.__ZEUS_BRIDGE__.getManagedBrowserActions(task,session,0),{task:taskId,session:session.session_id});
        for(const action of actions){
          try{const capture=observeManagedCore(portal,JSON.parse(action.response??'null'));if(capture)captures.push(capture);}catch{}
        }
      }
    }catch(error){errors.push(String(error.message).slice(0,500));}
  }
  const running=(async()=>{
    while(!stopped&&!signal?.aborted){
      const effects=portal.snapshot().audit.filter(e=>e.op!=='human_correction');
      if(effects.length>covered){
        try{
          const raw=await getPage().evaluate(id=>window.__ZEUS_BRIDGE__.getManagedBrowserObservation(id),taskId);
          const captured=observeManagedCore(portal,raw);
          if(captured){captures.push(captured);covered=effects.length;}
        }catch(error){if(errors.length<20)errors.push(String(error.message).slice(0,500));}
      }
      if(!stopped)await pause(50);
    }
  })();
  return {async finish(){stopped=true;await running;await durable();return captures.length?joinCoreObservations(portal,...captures):null;},errors:()=>[...errors]};
}

export function createCoreWorkflow({id,app,portal=null,limits,restart=null}){
  let current=app;const captures=[];
  const runWorkflow=async context=>{
    const {task}=context,contract=mission(id).task,started=Date.now();
    let watcher=portal?watchCoreBrowser({getPage:context.getPage,taskId:task.id,portal,signal:context.signal}):null;
    try{
      await context.send(context.prompt,context.attachments.map(f=>f.id));
      if(id==='B03'){
        // The checkpoint belongs to the declared external user script; its
        // source token is not provided by the actor or exposed over fixture HTTP.
        portal.markCorrection('declared-user-turn:'+task.id);
        await context.send(contract.turns[0]);
      }else if(id==='M01'){
        await context.send(contract.turns[0]);
        const before=historyFixture(current,task,'inspect');
        historyFixture(current,task,'project_noise',{count:contract.context_control.noise_messages,characters:contract.context_control.characters_per_message});
        await context.send(contract.turns[1]);
        return {memoryEvidence:captureContinuity(before,historyFixture(current,task,'inspect'))};
      }else if(id==='M02'){
        if(!restart)throw Error('M02 requires an actual controlled app restart adapter');
        const before=portal.snapshot(),checkpoint=before.checkpoint;
        if(before.audit.length!==1||!checkpoint||before.records.find(r=>r.id==='SYN-17')?.status!=='Open')throw Error('Confirmed restart checkpoint was not reached before later effects');
        captures.push(await watcher.finish());watcher=null;
        const old=current,spent=await context.getPage().evaluate(id=>window.__ZEUS_BRIDGE__.getTaskSpend(id),task.id);
        const allowance=remainingAllowance(limits,spent,Date.now()-started);
        current=await restart(current,allowance);context.replaceActor(current);
        const witness=captureRestart({oldProcess:old.processEvidence().pid,newProcess:current.processEvidence().pid,oldWorkspace:old.workspace,newWorkspace:current.workspace,checkpoint,beforeRestart:before});
        watcher=watchCoreBrowser({getPage:context.getPage,taskId:task.id,portal,signal:context.signal});
        await context.send(contract.turns[0]);
        return {restartEvidence:witness,restart_allowance:allowance,phase_usage:spent.usage};
      }
      return {};
    }finally{if(watcher)captures.push(await watcher.finish());}
  };
  return {runWorkflow,currentApp:()=>current,browserObservation:()=>{
    const valid=captures.filter(Boolean);return portal&&valid.length?joinCoreObservations(portal,...valid):null;
  }};
}
