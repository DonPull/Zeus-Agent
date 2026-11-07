/** Public packet/result shape checks, shared by the host and private collector. */
import crypto from 'node:crypto';
import {validateActorArtifacts,ARTIFACT_LIMITS} from './actor_artifacts.mjs';
export const SINGLE_TURN_MISSIONS=Object.freeze(['C01','C02','C03','D01','D02','R01','V01']);
export const WORKFLOW_MISSIONS=Object.freeze(['B01','B02','B03','M01','M02']);
export const ISOLATED_MISSIONS=Object.freeze([...SINGLE_TURN_MISSIONS,...WORKFLOW_MISSIONS]);
export const MISSION_TRACE_LIMIT=8*1024*1024;
export function encodeMissionTrace(value){
  const bytes=Buffer.from(JSON.stringify(value));
  if(bytes.length>MISSION_TRACE_LIMIT)throw Error('Complete mission trace exceeds its bound');
  return bytes;
}
export const missionDigest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
export const controlActionDigest=action=>missionDigest(Buffer.from(JSON.stringify([action.language,action.code,action.timeout_secs])));
export function validateMissionPacket(bytes,expected){
  if(expected.mode!=='scripted_control')throw Error('Hosted mission dispatch remains gated');
  if(!Buffer.isBuffer(bytes)||bytes.length>ARTIFACT_LIMITS.packetBytes||missionDigest(bytes)!==expected.packet_sha256)throw Error('Mission packet size/hash mismatch');
  const value=JSON.parse(bytes),config=value.configuration;
  if(value.schema_version!==1||value.kind!=='public-actor-mission-packet-v1'||value.mission!==expected.mission||!ISOLATED_MISSIONS.includes(value.mission)||value.architecture!==expected.architecture||config?.configuration_fingerprint!==expected.configuration_fingerprint||value.task?.id!==expected.mission||JSON.stringify(value.exported_names)!==JSON.stringify(expected.exported_names))throw Error('Mission packet identity/configuration mismatch');
  if(JSON.stringify(value.limits)!==JSON.stringify(expected.limits)||value.limits.wall_time_ms!==600000||value.limits.max_in_flight!==1)throw Error('Mission limits differ from the prepared contract');
  for(const role of Object.values(config.roles))if(role.enabled&&(role.model!=='gpt-6.1-terra'||role.provider!=='abacus'||role.protocol!=='chat'||role.effort!=='low'))throw Error('Unexpected enabled model binding');
  validateActorArtifacts(Buffer.from(JSON.stringify({schema_version:1,kind:'actor-artifact-export-v1',id:'prepared-inputs',nonce:'0'.repeat(48),files:value.inputs})),{id:'prepared-inputs',nonce:'0'.repeat(48)},value.inputs.map(file=>file.name));
  if(value.inputs.some(file=>file.status!=='retained'))throw Error('Missing prepared mission input');
  return value;
}
export function missionResultMatches(result,expected){
  const start=result?.actor?.actor_start,boundary=result?.boundary;
  return result?.kind==='isolated-mission-result-v1'&&result.status==='completed'&&result.mission===expected.mission&&result.configuration_fingerprint===expected.configuration_fingerprint
    &&result.mode===expected.mode&&result.provider_inference_requests===0
    &&start?.username?.toLowerCase()==='zeuscandidate'&&start.is_admin===false&&Number.isSafeInteger(start.pid)&&start.pid>0
    &&boundary?.username?.toLowerCase()==='zeuscandidate'&&boundary.is_admin===false
    &&['private_read_denied','private_write_denied','controller_process_denied','runtime_write_denied','runtime_readable','scratch_writable'].every(key=>boundary[key]===true)
    &&result.candidate_cleanup?.remaining===0&&result.candidate_cleanup?.account_disabled===true
    &&['succeeded','failed','timed_out','cancelled'].includes(result.actor?.execution_status)
    &&/^[a-f0-9]{64}$/.test(result.artifact_export?.sha256??'')&&/^[a-f0-9]{64}$/.test(result.trace?.sha256??'');
}
