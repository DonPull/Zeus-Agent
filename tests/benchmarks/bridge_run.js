/** Shared real-bridge approval/cancellation loop; no provider or grader imports. */
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const infrastructure=message=>Object.assign(Error(message),{code:'INFRASTRUCTURE_ERROR'});
export async function sendWithApprovals(page,taskId,prompt,{signal,decide=async()=>null,onIntervention=()=>{},attachmentIds=[]}={}) {
  const pending=page.evaluate(async({taskId,prompt,attachmentIds})=>{
    try {const result=await window.__ZEUS_BRIDGE__.sendUserMessage(taskId,prompt,crypto.randomUUID(),attachmentIds);return {result};}
    catch(error){return {error:String(error)};}
  },{taskId,prompt,attachmentIds});
  let complete=false;const result=pending.catch(error=>({error:String(error)})).then(value=>{complete=true;return value;});
  const handled=new Map();
  while(!complete){
    if(signal?.aborted){await page.evaluate(id=>window.__ZEUS_BRIDGE__.cancelTaskRun(id),taskId).catch(()=>{});throw signal.reason;}
    const messages=await page.evaluate(id=>window.__ZEUS_BRIDGE__.getTaskMessages(id,true),taskId);
    for(const message of messages){
      if(!['approval','choice','handoff'].includes(message.kind))continue;
      const body=JSON.parse(message.content);
      if(handled.has(message.id)){
        if(handled.get(message.id)==='waiting'&&body.status!=='pending'){
          onIntervention({message_id:message.id,decision:body.status,source:'external-ui',note:body.note??null});handled.set(message.id,'resolved');
        }
        continue;
      }
      if(body.status!=='pending')continue;
      handled.set(message.id,'pending');
      const choice=await decide({id:message.id,task_id:taskId,kind:message.kind,body});
      if(choice?.wait_for_user){handled.set(message.id,'waiting');onIntervention({message_id:message.id,decision:'waiting',source:'external-ui'});continue;}
      if(!choice){
        await page.evaluate(id=>window.__ZEUS_BRIDGE__.cancelTaskRun(id),taskId).catch(()=>{});
        throw Object.assign(Error('INTERVENTION_REQUIRED: no declared decision for pending approval/choice/handoff'),{code:'RUN_CANCELLED'});
      }
      if(message.kind!=='approval')throw infrastructure('This driver has no declared choice/handoff script');
      if(typeof choice.approved!=='boolean')throw infrastructure('Invalid controller approval decision');
      await page.evaluate(({taskId,id,choice})=>window.__ZEUS_BRIDGE__.resolvePendingApprovals(taskId,choice.approved,id,choice.note??null),{taskId,id:message.id,choice});
      onIntervention({message_id:message.id,decision:choice.approved?'approved':'denied',source:choice.source??'declared-user-script',note:choice.note??null});
    }
    if(!complete)await pause(75);
  }
  const final=await result;
  if(final.error)throw Object.assign(Error(final.error),{code:final.error.includes('RUN_CANCELLED')?'RUN_CANCELLED':'AGENT_RUN_FAILED'});
  return final.result;
}
