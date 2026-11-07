/** Verify host-owned ledgers against exact exchanged bytes; never execute exports. */
import {readBoundedFile} from './exchange_files.mjs';
import {missionDigest,WORKFLOW_MISSIONS} from './mission_contract.mjs';
import {MISSION_RPC_LIMITS,missionRequestValidator,missionResponseValidator} from './mission_rpc.mjs';
import {requestName,responseName,decodeResponseFrame} from './file_rpc.mjs';
export function inspectMissionExchange({manifest,input,output,privateDir,actorUsage,packet}){
  const host=JSON.parse(readBoundedFile(privateDir,'mission-host.json',4*1024*1024));
  const bytes=readBoundedFile(privateDir,'provider-ledger.json',4*1024*1024),provider=JSON.parse(bytes);
  if(host.kind!=='host-mission-transport-v1'||host.status!=='complete'||host.id!==manifest.id||host.nonce!==manifest.nonce||host.mode!=='scripted_control'||host.provider_inference_requests!==0||host.provider_ledger_sha256!==missionDigest(bytes)||!Array.isArray(host.requests))throw Error('Invalid host mission receipt');
  if(provider.kind!=='host-provider-ledger-v1'||provider.id!==manifest.id||provider.nonce!==manifest.nonce||provider.execution_kind!=='scripted_control'||provider.status!=='ready'||provider.unknown_requests!==0||!provider.requests.length)throw Error('Invalid mission provider ledger');
  const load=(name,hash,kind)=>{const bytes=readBoundedFile(privateDir,name,4*1024*1024),value=JSON.parse(bytes);if(missionDigest(bytes)!==hash||value.kind!==kind||value.id!==manifest.id||value.nonce!==manifest.nonce||value.mission!==manifest.mission_job.mission)throw Error('Invalid or changed workflow/fixture ledger');return value;};
  const fixture=['B01','B02','B03','M02'].includes(manifest.mission_job.mission)?load('fixture-ledger.json',host.fixture_ledger_sha256,'host-mission-fixture-v1'):null;
  const workflow=WORKFLOW_MISSIONS.includes(manifest.mission_job.mission)?load('workflow-ledger.json',host.workflow_ledger_sha256,'host-workflow-ledger-v1'):null;
  if(fixture&&fixture.status!=='ready'||workflow&&workflow.status!=='complete')throw Error('Workflow/fixture did not complete');
  let total=0,providers=0,fixtures=0,checkpoints=0;const ids=new Set();
  for(const row of host.requests){
    if(ids.has(row.id))throw Error('Duplicate mission exchange');ids.add(row.id);
    const request=readBoundedFile(output,requestName(row.id),MISSION_RPC_LIMITS.requestBytes),response=readBoundedFile(input,responseName(row.id),MISSION_RPC_LIMITS.responseBytes);
    if(missionDigest(request)!==row.request_sha256||missionDigest(response)!==row.response_sha256)throw Error('Mission exchange changed after handling');
    const observed=missionRequestValidator(manifest.mission_job.mission)(JSON.parse(request),manifest.nonce),frame=decodeResponseFrame(response);
    if(observed.id!==row.id||observed.channel!==row.channel||observed.method!==row.method||observed.path!==row.path||!frame)throw Error('Invalid mission exchange metadata');
    const reply=missionResponseValidator(JSON.parse(frame),manifest.nonce,row.id);
    if(observed.channel==='provider'){
      providers++;const paid=provider.requests.find(value=>value.id===row.id);
      if(!paid||paid.status!=='completed'||paid.usage_known!==true||paid.request_sha256!==missionDigest(observed.body)||paid.response_sha256!==missionDigest(reply.body))throw Error('Provider ledger differs from exchanged bytes');
    }else{
      const ledger=observed.channel==='fixture'?fixture:workflow,item=ledger?.requests.find(value=>value.id===row.id);
      if(!item||item.status!=='completed'||item.body_sha256!==missionDigest(observed.body)||item.response_sha256!==missionDigest(reply.body)||item.http_status!==reply.status)throw Error('Fixture/workflow ledger differs from exchanged bytes');
      if(observed.channel==='fixture')fixtures++;else checkpoints++;
    }
    total+=request.length+response.length;
  }
  if(total!==host.total_bytes||total>MISSION_RPC_LIMITS.totalBytes)throw Error('Mission exchange byte accounting mismatch');
  if(providers!==provider.requests.length||fixtures!==(fixture?.requests.length??0)||checkpoints!==(workflow?.requests.length??0))throw Error('Mission channel counts differ from host ledgers');
  if(actorUsage&&(actorUsage.requests!==provider.requests.length||actorUsage.unknown_requests!==0||actorUsage.known_tokens!==provider.known_tokens))throw Error('App usage differs from host provider accounting');
  if(workflow){
    const assessmentBytes=readBoundedFile(privateDir,'mission-assessment.json',1024*1024),assessment=JSON.parse(assessmentBytes);
    if(missionDigest(assessmentBytes)!==host.assessment_sha256||!validateWorkflowAssessment(assessment,packet))throw Error('Invalid or changed host workflow assessment');
  }
  return true;
}
export function validateWorkflowAssessment(assessment,packet){
  if(!packet||assessment?.mission_id!==packet.mission||assessment.task_hash!==packet.deployment.task_hash||assessment.fixture_hash!==packet.deployment.fixture_hash||assessment.error||!Array.isArray(assessment.criteria)||!assessment.criteria.length)return false;
  const criteria=assessment.criteria,invalid=criteria.length===1&&criteria[0].id==='submission_valid'&&criteria[0].status==='failed';
  if(!invalid&&JSON.stringify(criteria.map(row=>row.id).sort())!==JSON.stringify([...packet.task.required_criteria].sort()))return false;
  if(criteria.some(row=>!['passed','failed','not_evaluated'].includes(row.status)))return false;
  const expected=criteria.some(row=>row.status==='failed')?'failed':criteria.some(row=>row.status==='not_evaluated')?'not_evaluated':'passed';return assessment.outcome_status===expected;
}
