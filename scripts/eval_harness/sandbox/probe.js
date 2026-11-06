#!/usr/bin/env node
/** Prepare/inspect only. No Windows feature change, VM window or inference. */
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepareProbe,inspectProbe} from './session.js';

const args=process.argv.slice(2),repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const runtimeArgs=args[0]==='--runtime-bundle'&&(args.length===2||(args[2]==='--transport-smoke'&&(args.length===3||(args.length===4&&args[3]==='--deny-test'))));
if(args.length===0||runtimeArgs){
  const prepared=prepareProbe(path.join(repo,'.zeus/evaluations/sandbox-sessions'),{runtimeBundle:args[1]?path.resolve(args[1]):null,transportSmoke:args[2]==='--transport-smoke',transportDenyTest:args[3]==='--deny-test'});
  console.log(JSON.stringify({root:prepared.root,status:'prepared',launch_requested:false,provider_requests:0,
    next:'After confirming Sandbox is active, schedule the visible guest probe. This command has opened no windows.'},null,2));
}else if(args.length===2&&args[0]==='--inspect'){
  const report=inspectProbe(path.resolve(args[1]));
  console.log(JSON.stringify(report,null,2));
  process.exitCode=report.status==='probe_claims_consistent'?2:1;
}else throw Error('Usage: node scripts/eval_harness/sandbox/probe.js [--inspect <session-directory> | --runtime-bundle <public-bundle> [--transport-smoke [--deny-test]]]');
