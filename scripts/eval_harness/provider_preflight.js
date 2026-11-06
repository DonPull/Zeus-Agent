#!/usr/bin/env node
/** Explicit catalogue-only check. No POST, model inference, VM or UI launch. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {coreLimits} from '../../tests/benchmarks/core_plan.js';
import {PROVIDER_IDENTITY,createProviderRelay} from './sandbox/provider_relay.mjs';
const args=process.argv.slice(2);
if(args.length===0){console.log(JSON.stringify({status:'prepared-only',binding:PROVIDER_IDENTITY,catalogue_requests:0,inference_requests:0,next:'Add --check for one authenticated GET /models.'},null,2));}
else if(args.length===1&&args[0]==='--check'){
  const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
  const id=crypto.randomUUID(),root=path.join(repo,'.zeus/evaluations/provider-preflight',id);fs.mkdirSync(root,{recursive:true});
  const relay=createProviderRelay({privateDirectory:root,id,nonce:crypto.randomBytes(24).toString('hex'),limits:coreLimits('D01')});
  try{const observed=await relay.preflight();console.log(JSON.stringify({status:'available',binding:PROVIDER_IDENTITY,catalogue:observed,root,inference_requests:0},null,2));}
  catch{console.error(JSON.stringify({status:'failed',root,inference_requests:0,note:'See retained host ledger; no automatic retry or alternate model.'}));process.exitCode=1;}
}else throw Error('Usage: node scripts/eval_harness/provider_preflight.js [--check]');
