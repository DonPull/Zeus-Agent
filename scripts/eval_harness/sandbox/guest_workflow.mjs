/** Private external user script. It does not give task answers to the actor. */
import {spawnSync} from 'node:child_process';
import {sendWithApprovals} from './bridge_run.js';
import {remainingAllowance} from './workflow_limits.js';
import {watchGuestBrowser} from './guest_browser_capture.mjs';
import {launchGuestApp} from './guest_app.mjs';
import {signGradingResult} from './grading_auth.mjs';
import {taskSettings,assertEffectiveSettings} from './benchmark_config.js';
export const hasBrowser=id=>['B01','B02','B03','M02'].includes(id);
function history(task,operation){
  const result=spawnSync('C:\\Zeus\\Runtime\\browser\\venv\\Scripts\\python.exe',['-I','-B','C:\\Zeus\\Input\\guest_history.py'],{input:JSON.stringify({task,operation}),windowsHide:true,encoding:'utf8',timeout:20000,maxBuffer:4*1024*1024});
  if(result.status!==0)throw Error('Private history fixture failed: '+result.stderr.slice(-2000));return JSON.parse(result.stdout);
}
export async function runGuestWorkflow({packet,task,app,rpc,key,identity,signal,decide,onIntervention,attachmentIds,onApp,evidence}){
  const started=Date.now();let current=app;
  const checkpoint=async(route,body)=>{
    const reply=await rpc('workflow','POST',route,Buffer.from(JSON.stringify(signGradingResult(key,identity,{task_id:task.id,...body}))));
    if(reply.status!==200)throw Error('Private workflow checkpoint refused');return JSON.parse(reply.body);
  };
  const send=async(prompt,attachments=[])=>{
    const watcher=hasBrowser(packet.mission)?watchGuestBrowser({getPage:()=>current.page,taskId:task.id,signal}):null;
    try{
      await sendWithApprovals(current.page,task.id,prompt,{signal,attachmentIds:attachments,decide,onIntervention});
      const state=await current.page.evaluate(async id=>({run:await window.__ZEUS_BRIDGE__.getTaskRunState(id),spend:await window.__ZEUS_BRIDGE__.getTaskSpend(id),debug:await window.__ZEUS_BRIDGE__.getDebugLog(id)}),task.id);
      evidence.phases.push({...state,process:current.processEvidence()});
      if(state.run?.status!=='completed')throw Object.assign(Error('Workflow turn did not complete'),{code:'AGENT_RUN_FAILED'});
    }finally{if(watcher)evidence.browser.push(await watcher.finish());}
  };
  await send(packet.task.prompt+(hasBrowser(packet.mission)?'\n\nController-supplied fixture URL: http://127.0.0.1:19222/':''),attachmentIds);
  if(packet.mission==='B03'){
    evidence.correction=await checkpoint('/correction',{});await send(packet.task.turns[0]);
  }else if(packet.mission==='M01'){
    await send(packet.task.turns[0]);const before=history(task.id,'inspect');
    history(task.id,'project_noise');await send(packet.task.turns[1]);evidence.history={before,after:history(task.id,'inspect')};
  }else if(packet.mission==='M02'){
    const old=current,oldProcess=old.processEvidence(),spent=evidence.phases.at(-1).spend;
    evidence.restart_checkpoint=await checkpoint('/restart-checkpoint',{old_process:oldProcess,workspace:old.workspace,run_id:evidence.phases.at(-1).run.id});
    const stopped=await old.stop();if(!stopped.app_process_gone||!stopped.helper_closed)throw Error('Old actor still running');
    const elapsed=Date.now()-started,remaining=remainingAllowance(packet.limits,spent,elapsed);
    current=await launchGuestApp({limits:remaining,rpc,fixture:true});onApp(current);
    const actual=await current.page.evaluate(async id=>(await window.__ZEUS_BRIDGE__.listTasks()).find(task=>task.id===id),task.id);assertEffectiveSettings(taskSettings(packet.configuration),actual);
    const newProcess=current.processEvidence();
    evidence.restart=await checkpoint('/restart-complete',{old_process:oldProcess,new_process:newProcess,workspace:current.workspace,old_process_gone:stopped.app_process_gone,spent,elapsed_ms:elapsed,remaining_limits:remaining});
    await send(packet.task.turns[0]);
  }
}
