/** Known-control package only. No candidate path, host execution or VM launch. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {mission,safeFile} from '../../../tests/benchmarks/mission_kit.js';
import {assessment} from '../../../tests/benchmarks/mission_graders/outcomes.js';
import {unlinkedDirectory,readBoundedFile} from './exchange_files.mjs';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const ids=['C01','C02','C03','D02'];
export function prepareGraderPacket(){
  const files={},cases=[];
  const add=(relative,bytes)=>{
    if(Object.keys(files).length>=128||bytes.length>1024*1024)throw Error('Grading packet exceeds its file allowance');
    files[relative]={sha256:hash(bytes),base64:bytes.toString('base64')};
  };
  for(const name of ['mission_kit.js','benchmark_config.js','memory_core_controls.js','candidate_execution.js'])add('tests/benchmarks/'+name,fs.readFileSync(path.join(repo,'tests/benchmarks',name)));
  const graders=path.join(repo,'tests/benchmarks/mission_graders');
  for(const name of fs.readdirSync(graders))if(/\.(js|py)$/.test(name))add('tests/benchmarks/mission_graders/'+name,fs.readFileSync(safeFile(graders,name)));
  add('package.json',Buffer.from('{"type":"module","private":true}'));
  for(const id of ids){
    const {dir,task}=mission(id),artifact=task.artifacts[0],relative='tests/benchmarks/missions/v1/'+id;
    add(relative+'/task.json',fs.readFileSync(safeFile(dir,'task.json')));
    for(const name of fs.readdirSync(path.join(dir,'inputs')))add(relative+'/inputs/'+name,fs.readFileSync(safeFile(path.join(dir,'inputs'),name)));
    for(const name of fs.readdirSync(path.join(dir,'reference')))add(relative+'/reference/'+name,fs.readFileSync(safeFile(path.join(dir,'reference'),name)));
    for(const variant of ['reference','alternative','negative']){
      const source=variant==='alternative'?(id==='C03'?'alternative.html':'alternative.py'):artifact;
      let bytes;
      if(variant==='negative'&&id==='C03'){
        const original=fs.readFileSync(safeFile(path.join(dir,'reference'),artifact),'utf8');
        if(!original.includes('input.value.trim()'))throw Error('Dashboard negative-control source changed');
        bytes=Buffer.from(original.replace('input.value.trim()','input.value'));
      }else bytes=fs.readFileSync(safeFile(path.join(dir,variant==='negative'?'inputs':'reference'),source));
      const file='controls/'+id+'-'+variant+'/'+artifact;add(file,bytes);
      cases.push({mission:id,variant,artifact,file,source_sha256:hash(bytes),expected:variant==='negative'?'failed':'passed',required_criteria:task.required_criteria});
    }
  }
  const packet={schema_version:1,kind:'known-executable-grader-controls',files,cases};
  const bytes=Buffer.from(JSON.stringify(packet));if(bytes.length>1024*1024)throw Error('Grading packet exceeds its byte allowance');
  return {bytes,expected:cases};
}

export function prepareSubmissionPacket(id,directory){
  if(!ids.includes(id))throw Error('Not an executable mission');
  const root=unlinkedDirectory(directory);
  const {dir,task}=mission(id),base=JSON.parse(prepareGraderPacket().bytes),files={};
  for(const [name,value] of Object.entries(base.files))if(!name.startsWith('controls/')&&!name.includes('/reference/'))files[name]=value;
  const names=[...new Set([...fs.readdirSync(path.join(dir,'inputs')),...task.artifacts])],submission=[];
  for(const name of names){
    try{
      const bytes=readBoundedFile(root,name,Math.min(task.limits.artifact_bytes,2*1024*1024));
      const file='submission/'+name;files[file]={sha256:hash(bytes),base64:bytes.toString('base64')};
      submission.push({name,file,sha256:hash(bytes),status:'retained'});
    }catch(error){if(error.code!=='ENOENT')throw error;submission.push({name,status:'rejected_or_missing',reason:'Missing exported file'});}
  }
  const packet={schema_version:1,kind:'executable-submission-v1',mission:id,files,submission};
  const bytes=Buffer.from(JSON.stringify(packet));if(bytes.length>8*1024*1024)throw Error('Submission packet exceeds its allowance');
  const metadata=assessment(id,[]);
  return {bytes,expected:{mission:id,source_files:submission,required_criteria:task.required_criteria,
    assessment_identity:Object.fromEntries(['mission_id','mission_version','task_hash','fixture_hash','grader_version'].map(key=>[key,metadata[key]]))}};
}

export function validateSubmissionAssessment(result,expected){
  if(result?.kind!=='isolated-submission-grade-v1'||result.status!=='completed'||result.mission!==expected.mission||result.provider_inference_requests!==0||result.candidate_cleanup?.remaining!==0||result.candidate_cleanup?.account_disabled!==true)return false;
  const boundary=result.boundary;
  if(boundary?.username?.toLowerCase()!=='zeuscandidate'||boundary.is_admin!==false||['private_read_denied','private_write_denied','controller_process_denied','runtime_write_denied','runtime_readable','scratch_writable'].some(key=>boundary[key]!==true))return false;
  if(JSON.stringify(result.source_files)!==JSON.stringify(expected.source_files))return false;
  const actual=result.assessment;
  if(!actual||Object.entries(expected.assessment_identity).some(([key,value])=>actual[key]!==value)||!Array.isArray(actual.criteria))return false;
  const derived=actual.error?'error':actual.criteria.some(check=>check.status==='failed')?'failed':actual.criteria.length&&actual.criteria.every(check=>check.status==='passed')?'passed':'not_evaluated';
  if(actual.outcome_status!==derived)return false;
  if(derived==='passed'&&actual.criteria.map(check=>check.id).sort().join(',')!==[...expected.required_criteria].sort().join(','))return false;
  return ['passed','failed','error'].includes(derived);
}

/** Runtime controls are claims, never an isolation certificate or capability score. */
export function gradingSmokeMatches(smoke,expected){
  if(smoke?.kind!=='scripted-guest-grader-controls'||smoke.status!=='passed'||smoke.provider_inference_requests!==0||!Array.isArray(smoke.results)||smoke.results.length!==expected.length)return false;
  return expected.every((control,index)=>{
    const result=smoke.results[index];
    if(result.mission!==control.mission||result.variant!==control.variant||result.source_sha256!==control.source_sha256||result.outcome_status!==control.expected||result.error!=null||!Array.isArray(result.criteria))return false;
    if(control.expected==='failed')return result.criteria.some(check=>check.status==='failed');
    return result.criteria.every(check=>check.status==='passed')&&result.criteria.map(check=>check.id).sort().join(',')===[...control.required_criteria].sort().join(',');
  });
}
