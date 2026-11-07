#!/usr/bin/env node
/** Prepare/inspect only. No Windows feature change, VM window or inference. */
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepareProbe,inspectProbe} from './session.js';

const args=process.argv.slice(2),repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const runtimeArgs=args[0]==='--runtime-bundle'&&(args.length===2||(args[2]==='--transport-smoke'&&(args.length===3||(args.length===4&&args[3]==='--deny-test'))));
const gradingArgs=args.length===3&&args[0]==='--runtime-bundle'&&args[2]==='--grading-smoke';
const candidateArgs=args.length===3&&args[0]==='--runtime-bundle'&&args[2]==='--candidate-probe';
const actorArgs=args.length===3&&args[0]==='--runtime-bundle'&&args[2]==='--actor-probe';
const missionArgs=args.length===4&&args[0]==='--runtime-bundle'&&args[2]==='--mission-transport';
if(args.length===4&&args[0]==='--grade-submission'){
  const prepared=prepareProbe(path.join(repo,'.zeus/evaluations/sandbox-sessions'),{runtimeBundle:path.resolve(args[3]),submission:{id:args[1],directory:path.resolve(args[2])}});
  console.log(JSON.stringify({root:prepared.root,status:'prepared',launch_requested:false,provider_requests:0},null,2));
}else if(args.length===0||runtimeArgs||gradingArgs||candidateArgs||actorArgs||missionArgs){
  const prepared=prepareProbe(path.join(repo,'.zeus/evaluations/sandbox-sessions'),{runtimeBundle:args[1]?path.resolve(args[1]):null,transportSmoke:args[2]==='--transport-smoke'||missionArgs,transportMission:missionArgs?args[3]:null,transportDenyTest:args[3]==='--deny-test',gradingSmoke:gradingArgs,candidateProbe:candidateArgs,actorProbe:actorArgs});
  console.log(JSON.stringify({root:prepared.root,status:'prepared',launch_requested:false,provider_requests:0,
    next:'After confirming Sandbox is active, schedule the visible guest probe. This command has opened no windows.'},null,2));
}else if(args.length===2&&['--inspect','--inspect-summary'].includes(args[0])){
  const report=inspectProbe(path.resolve(args[1]));
  const visible=args[0]==='--inspect-summary'?{id:report.id,status:report.status,checks:report.checks,result_sha256:report.result_sha256,isolation_validated:false,note:report.note}:report;
  console.log(JSON.stringify(visible,null,2));
  process.exitCode=report.status==='probe_claims_consistent'?2:1;
}else throw Error('Usage: node scripts/eval_harness/sandbox/probe.js [--inspect[-summary] <session-directory> | --runtime-bundle <public-bundle> [--actor-probe | --grading-smoke | --candidate-probe | --mission-transport <B01|B02|B03|M02> | --transport-smoke [--deny-test]] | --grade-submission <mission> <submission-directory> <public-bundle>]');
