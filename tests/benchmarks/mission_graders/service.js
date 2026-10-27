import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mission, missionRoot, readArtifact, safeFile, python, withScratch, SubmissionError } from '../mission_kit.js';
import { check, equal } from './outcomes.js';

async function stop(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child,'exit'); child.kill();
  let timer;
  try { await Promise.race([exited,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Fixture process did not stop')),2000);})]); }
  finally { clearTimeout(timer); }
}

export async function gradeService(submission, options) {
  if (!options.trustedExecution) throw new Error('Service execution requires a trusted reference/control in Phase 2A; untrusted execution is not available');
  return withScratch(async root => {
    const fixture = path.join(mission('C02').dir,'inputs');
    for (const name of ['service.py','records.json']) fs.copyFileSync(safeFile(fixture,name),path.join(root,name));
    fs.copyFileSync(safeFile(submission,'catalog.py'),path.join(root,'catalog.py'));
    const child = spawn('python',['-I','-B',path.join(root,'service.py'),'--port','0','--data',path.join(root,'records.json')],
      {cwd:root,windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});
    let stderr='', stdout='', timer;
    child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-2000);});
    try {
      const port = await new Promise((resolve,reject)=>{
        timer=setTimeout(()=>reject(new SubmissionError('Service startup timed out')),5000);
        child.once('error',reject);
        child.once('exit',()=>reject(new SubmissionError(`Service exited during startup: ${stderr}`)));
        child.stdout.on('data',chunk=>{
          stdout+=chunk;
          if(stdout.length>65536){reject(new SubmissionError('Excessive service startup output'));return;}
          for(const line of stdout.split(/\r?\n/).slice(0,-1)) {
            try { const value=JSON.parse(line); if(Number.isInteger(value.port)&&value.port>0&&value.port<65536) resolve(value.port); } catch {}
          }
        });
      });
      clearTimeout(timer);
      const get = async route => {
        const response=await fetch(`http://127.0.0.1:${port}${route}`,{signal:AbortSignal.timeout(1500)});
        let data='';
        for await(const chunk of response.body){data+=Buffer.from(chunk).toString('utf8');if(data.length>1048576) throw new SubmissionError('Excessive HTTP output');}
        try { return {status:response.status,body:JSON.parse(data)}; }
        catch { throw new SubmissionError('Service returned invalid JSON'); }
      };
      const seed=readArtifact(fixture,'records.json'), sorted=[...seed].sort((a,b)=>a.id.localeCompare(b.id));
      const hardware=sorted.filter(r=>r.category==='hardware');
      const expected=(items,offset,limit)=>({items:items.slice(offset,offset+limit),total:items.length,offset,limit});
      const first=await get('/api/items'), filtered=await get('/api/items?category=hardware&limit=3');
      const second=await get('/api/items?category=hardware&offset=1&limit=2'), beyond=await get('/api/items?offset=999');
      const empty=await get('/api/items?category=unknown');
      let valid=true;const invalidQueries=[];
      for(const query of ['limit=0','limit=6','offset=-1','offset=1001','limit=2.0','limit=%2B2','limit=','limit=2&limit=3','category=','category=x&category=y','offset=%D9%A1','extra=1']) {
        const observed=await get('/api/items?'+query);invalidQueries.push({query,expected_status:400,observed});
        if(observed.status!==400) valid=false;
      }
      const health=await get('/health'), missing=await get('/missing');
      const args=[seed,{}];
      const result=JSON.parse(python(path.join(missionRoot,'../../mission_graders/function_probe.py'),[path.join(root,'catalog.py'),'select_items'],
        {...options,input:JSON.stringify([args])}).trim().split(/\r?\n/).at(-1));
      return [check('filter_and_sort',first.status===200&&equal(first.body,expected(sorted,0,2))&&filtered.status===200&&equal(filtered.body,expected(hardware,0,3)),
          {observed:{first,filtered},expected:{first:expected(sorted,0,2),filtered:expected(hardware,0,3)}}),
        check('pagination',second.status===200&&equal(second.body,expected(hardware,1,2))&&beyond.status===200&&equal(beyond.body,expected(sorted,999,2)),
          {observed:{second,beyond},expected:{second:expected(hardware,1,2),beyond:expected(sorted,999,2)}}),
        check('empty_results',empty.status===200&&equal(empty.body,expected([],0,2)),{observed:empty,expected:expected([],0,2)}),
        check('validation',valid,invalidQueries),
        check('existing_routes',health.status===200&&equal(health.body,{ok:true})&&missing.status===404,{observed:{health,missing},expected_statuses:[200,404]}),
        check('no_mutation',equal(result[0]?.after?.[0],seed),{expected:seed,observed:result[0]?.after?.[0]??null})];
    } catch(error) {
      if(error.name==='TimeoutError'||error.name==='TypeError') throw new SubmissionError(`Service request failed: ${error.message}`);
      throw error;
    } finally { clearTimeout(timer); await stop(child); }
  });
}
