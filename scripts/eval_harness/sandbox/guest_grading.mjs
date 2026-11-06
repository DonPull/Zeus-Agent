/** Known executable grader controls inside a fresh disposable guest only. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
const runtime='C:\\Zeus\\Runtime',root='C:\\Zeus\\Grading',input='C:\\Zeus\\Input',output='C:\\Zeus\\Output';
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const result={kind:'scripted-guest-grader-controls',status:'failed',provider_inference_requests:0,results:[]};
if(process.env.USERNAME!=='WDAGUtilityAccount'||!import.meta.url.startsWith('file:///C:/Zeus/Input/'))throw Error('Run the grading control only from its disposable guest input');
const timer=setTimeout(()=>{fs.writeFileSync('C:\\Zeus\\runtime-report.json',JSON.stringify({...result,error:'Grading control deadline expired'}));process.exit(1);},130000);
try{
  const packetBytes=fs.readFileSync(path.join(input,'grader-packet.json'));
  if(packetBytes.length>4*1024*1024)throw Error('Oversized grading packet');
  const packet=JSON.parse(packetBytes);
  if(packet.kind!=='known-executable-grader-controls'||packet.schema_version!==1||packet.cases.length!==12||Object.keys(packet.files).length>128)throw Error('Invalid known-control packet');
  fs.mkdirSync(root);
  for(const [name,file] of Object.entries(packet.files)){
    if(!/^[a-zA-Z0-9_./-]+$/.test(name)||name.split('/').some(part=>!part||part==='.'||part==='..'))throw Error('Invalid grading file path');
    const bytes=Buffer.from(file.base64,'base64');if(bytes.length>1024*1024||hash(bytes)!==file.sha256)throw Error('Changed grading file');
    const destination=path.join(root,name);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,bytes,{flag:'wx'});
  }
  // Public SDK copied locally; no repository or personal profile is mapped.
  fs.mkdirSync(path.join(root,'node_modules'));
  fs.cpSync(path.join(runtime,'node_modules/playwright-core'),path.join(root,'node_modules/playwright-core'),{recursive:true});
  process.env.PATH=path.join(runtime,'browser/venv/Scripts')+';'+process.env.PATH;
  process.env.PLAYWRIGHT_BROWSERS_PATH=path.join(runtime,'browsers');
  const {gradeMission}=await import(pathToFileURL(path.join(root,'tests/benchmarks/mission_graders/outcomes.js')));
  const {deployMission}=await import(pathToFileURL(path.join(root,'tests/benchmarks/mission_kit.js')));
  const assessments=[];
  for(const control of packet.cases){
    const workspace=path.join(root,'submissions',control.mission+'-'+control.variant);
    deployMission(control.mission,workspace);
    fs.copyFileSync(path.join(root,control.file),path.join(workspace,control.artifact));
    const assessment=await gradeMission(control.mission,workspace,{trustedExecution:true});
    assessments.push({mission:control.mission,variant:control.variant,source_sha256:control.source_sha256,assessment});
    result.results.push({mission:control.mission,variant:control.variant,source_sha256:control.source_sha256,outcome_status:assessment.outcome_status,error:assessment.error,criteria:assessment.criteria.map(({id,status})=>({id,status}))});
  }
  const bytes=Buffer.from(JSON.stringify(assessments));if(bytes.length>2*1024*1024)throw Error('Grading evidence exceeded its allowance');
  fs.writeFileSync(path.join(output,'grader-evidence.json'),bytes,{flag:'wx'});result.evidence_sha256=hash(bytes);
  if(!result.results.every((observed,index)=>observed.outcome_status===packet.cases[index].expected&&!observed.error))throw Error('A grading control did not match its expected outcome');
  result.status='passed';
}catch(error){result.error=String(error.stack??error).slice(-8000);}
finally{clearTimeout(timer);fs.writeFileSync('C:\\Zeus\\runtime-report.json',JSON.stringify(result));}
process.exitCode=result.status==='passed'?0:1;
