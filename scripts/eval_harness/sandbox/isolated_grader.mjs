/** Execute a supplied artifact only in a fresh guest; host-side work reads data. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {prepareProbe,inspectProbe,readBoundedFile,unlinkedDirectory} from './session.js';
const directory=path.dirname(fileURLToPath(import.meta.url)),repo=path.resolve(directory,'../../..');
const registered=new WeakSet();
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const problem=(message,root)=>Object.assign(Error(message+'; retained session: '+root),{code:'INFRASTRUCTURE_ERROR',session_directory:root});
export const isIsolatedGrader=value=>registered.has(value);
export function prepareIsolatedGrade({id,submission,runtimeBundle}){
  return prepareProbe(path.join(repo,'.zeus/evaluations/sandbox-sessions'),{runtimeBundle,submission:{id,directory:submission}});
}
export function readIsolatedAssessment(root){
  root=unlinkedDirectory(root);
  const report=inspectProbe(root),manifest=JSON.parse(readBoundedFile(root,'session.json',16384));
  if(!manifest.submission_job||report.status!=='probe_claims_consistent'||!report.graded_assessment)throw problem('Submission result was not accepted',root);
  const runs=fs.readdirSync(root).filter(name=>/^host-lifecycle-[0-9a-f-]+\.json$/.test(name)).map(name=>({name,bytes:readBoundedFile(root,name,65536)})).filter(row=>JSON.parse(row.bytes).mode==='Run');
  if(runs.length!==1)throw problem('Expected one immutable launch receipt',root);
  const lifecycle=JSON.parse(runs[0].bytes);
  if(lifecycle.probe_id!==manifest.id||lifecycle.status!=='probe_observed'||lifecycle.cleanup?.client_gone!==true||lifecycle.cleanup?.launcher_gone!==true||lifecycle.cleanup?.transport_gone!==true||lifecycle.inspection?.result_sha256!==report.result_sha256)throw problem('VM execution/cleanup was not verified',root);
  return {...report.graded_assessment,execution:{profile:'windows-sandbox-protected-grader-v1',session_id:manifest.id,session_directory:root,
    lifecycle_receipt:runs[0].name,lifecycle_sha256:sha(runs[0].bytes),result_sha256:report.result_sha256,runtime_bundle:manifest.runtime_bundle.content_sha256,
    candidate_account:'non-admin',signed_controller:true,isolation_validated:false,
    limitations:['Independent HCS disposal, CPU and writable-mapping disk quotas remain unvalidated.']}};
}
function dispatch(root,mode,{signal,timeoutMs=110000}={}){
  return new Promise((resolve,reject)=>{
    const child=spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','RemoteSigned','-File',path.join(directory,'run_probe.ps1'),'-Mode',mode,'-TimeoutSeconds','90','-SessionDirectory',root],{cwd:repo,windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='',failure=null;
    const fail=error=>{failure??=error;if(child.exitCode===null)child.kill();};
    child.stdout.on('data',chunk=>{stdout+=chunk;if(stdout.length>128*1024)fail(Error('Grader controller output limit exceeded'));});
    child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-16000);});
    const timer=setTimeout(()=>fail(Error('Grader controller deadline expired')),timeoutMs);
    const aborted=()=>fail(signal.reason??Error('Grading cancelled'));
    signal?.addEventListener('abort',aborted,{once:true});if(signal?.aborted)aborted();
    child.once('error',error=>{failure=error;});
    child.once('close',code=>{clearTimeout(timer);signal?.removeEventListener('abort',aborted);if(failure)reject(failure);else resolve({code,stdout,stderr});});
  });
}
export function createIsolatedGrader({runtimeBundle,onSession=()=>{}}){
  if(process.platform!=='win32')throw Error('Windows Sandbox grading requires Windows');
  const grade=async({id,submission,signal})=>{
    if(signal?.aborted)throw signal.reason;
    const {root}=prepareIsolatedGrade({id,submission,runtimeBundle});
    onSession({id,root,status:'prepared'});const started=Date.now();
    let run;
    try{run=await dispatch(root,'Run',{signal});}
    catch(error){await dispatch(root,'Cleanup',{timeoutMs:30000}).catch(()=>{});throw problem('Grading controller interrupted: '+error.message,root);}
    if(run.code!==0)throw problem('Grading controller rejected the run: '+run.stderr.slice(-1500),root);
    const outcome=readIsolatedAssessment(root);outcome.execution.duration_ms=Date.now()-started;return outcome;
  };
  registered.add(grade);return grade;
}
