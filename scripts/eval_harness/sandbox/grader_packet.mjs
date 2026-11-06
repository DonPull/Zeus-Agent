/** Known-control package only. No candidate path, host execution or VM launch. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {mission,safeFile} from '../../../tests/benchmarks/mission_kit.js';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const ids=['C01','C02','C03','D02'];
export function prepareGraderPacket(){
  const files={},cases=[];
  const add=(relative,bytes)=>{
    if(Object.keys(files).length>=128||bytes.length>1024*1024)throw Error('Grading packet exceeds its file allowance');
    files[relative]={sha256:hash(bytes),base64:bytes.toString('base64')};
  };
  for(const name of ['mission_kit.js','benchmark_config.js','memory_core_controls.js'])add('tests/benchmarks/'+name,fs.readFileSync(path.join(repo,'tests/benchmarks',name)));
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
