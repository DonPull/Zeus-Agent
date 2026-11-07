/** Verify host-owned ledgers against exact exchanged bytes; never execute exports. */
import {readBoundedFile} from './exchange_files.mjs';
import {missionDigest} from './mission_contract.mjs';
import {MISSION_RPC_LIMITS,missionRequestValidator,missionResponseValidator} from './mission_rpc.mjs';
import {requestName,responseName,decodeResponseFrame} from './file_rpc.mjs';
export function inspectMissionExchange({manifest,input,output,privateDir,actorUsage}){
  const host=JSON.parse(readBoundedFile(privateDir,'mission-host.json',4*1024*1024));
  const bytes=readBoundedFile(privateDir,'provider-ledger.json',4*1024*1024),provider=JSON.parse(bytes);
  if(host.kind!=='host-mission-transport-v1'||host.status!=='complete'||host.id!==manifest.id||host.nonce!==manifest.nonce||host.mode!=='scripted_control'||host.provider_inference_requests!==0||host.provider_ledger_sha256!==missionDigest(bytes)||!Array.isArray(host.requests))throw Error('Invalid host mission receipt');
  if(provider.kind!=='host-provider-ledger-v1'||provider.id!==manifest.id||provider.nonce!==manifest.nonce||provider.execution_kind!=='scripted_control'||provider.status!=='ready'||provider.unknown_requests!==0||provider.requests.length!==host.requests.length||!provider.requests.length)throw Error('Invalid mission provider ledger');
  let total=0;const ids=new Set();
  for(const row of host.requests){
    if(ids.has(row.id))throw Error('Duplicate mission exchange');ids.add(row.id);
    const request=readBoundedFile(output,requestName(row.id),MISSION_RPC_LIMITS.requestBytes),response=readBoundedFile(input,responseName(row.id),MISSION_RPC_LIMITS.responseBytes);
    if(missionDigest(request)!==row.request_sha256||missionDigest(response)!==row.response_sha256)throw Error('Mission exchange changed after handling');
    const observed=missionRequestValidator(manifest.mission_job.mission)(JSON.parse(request),manifest.nonce),frame=decodeResponseFrame(response);
    if(observed.id!==row.id||observed.channel!=='provider'||!frame)throw Error('Invalid mission provider exchange');
    const reply=missionResponseValidator(JSON.parse(frame),manifest.nonce,row.id),paid=provider.requests.find(value=>value.id===row.id);
    if(!paid||paid.status!=='completed'||paid.usage_known!==true||paid.request_sha256!==missionDigest(observed.body)||paid.response_sha256!==missionDigest(reply.body))throw Error('Provider ledger differs from exchanged bytes');
    total+=request.length+response.length;
  }
  if(total!==host.total_bytes||total>MISSION_RPC_LIMITS.totalBytes)throw Error('Mission exchange byte accounting mismatch');
  if(actorUsage&&(actorUsage.requests!==provider.requests.length||actorUsage.unknown_requests!==0||actorUsage.known_tokens!==provider.known_tokens))throw Error('App usage differs from host provider accounting');
  return true;
}
