import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {mission} from '../benchmarks/mission_kit.js';
import {runMissionTrial,hashBytes} from '../benchmarks/mission_runtime.js';
import {createCoreWorkflow} from '../benchmarks/core_workflows.js';
import {startCorePortal} from '../benchmarks/mission_graders/core_portals.js';
import {projectInitial,projectCorrected} from '../benchmarks/memory_core_controls.js';
import {startMockServer,stopMockServer,launchTauri,stopTauri,queueMockResponse} from '../e2e/testUtils.js';

const limits={max_requests:28,max_tokens:1000000,max_in_flight:1,max_output_tokens:4096,max_directives:40,wall_time_ms:120000};
const reply=(value,extra={})=>({choices:[{delta:{content:'```zeus-directive\n'+JSON.stringify(value)+'\n```'}}],usage:{prompt_tokens:5,completion_tokens:5,total_tokens:10},...extra});
const done=summary=>queueMockResponse(reply({type:'final_answer',final_answer:{summary}},{_delay_ms:200}));
const encoded=object=>'json.loads('+JSON.stringify(JSON.stringify(object))+')';
const command=(op,params={})=>'call('+JSON.stringify(op)+', **'+encoded(params)+')';
const scope='article[data-id="D-17"]';
function draftCode(url,owner,delivery,submit=false){
  return ['import json','from zeus_browser import call',command('navigate',{url}),
    command('select_option',{target:{css:scope+' select[aria-label="Owner"]'},value:owner}),
    command('select_option',{target:{css:scope+' select[aria-label="Delivery"]'},value:delivery}),
    command('fill',{target:{css:scope+' input[aria-label="Note"]'},value:'Keep original packaging'}),
    command('click',{target:{css:scope+' button:has-text("Save draft")'},expect:{target:{css:'[role=status]'},condition:{kind:'text',value:'Saved /api/drafts/D-17/save',match:'equals'}}}),
    ...(submit?[command('click',{target:{css:scope+' button:has-text("Submit draft")'},expect:{target:{css:'[role=status]'},condition:{kind:'text',value:'Saved /api/drafts/D-17/submit',match:'equals'}}})]:[]),
    'print(json.dumps('+command('observe')+'))'].join('\n');
}
function recoveryCode(url,phase){
  const base='article[data-id="SYN-17"]';
  return ['import json','from zeus_browser import call',command('navigate',{url}),
    phase==='note'?command('fill',{target:{css:base+' input[aria-label="New note"]'},value:'Verified original request'}):command('select_option',{target:{css:base+' select'},value:'Resolved'}),
    command('click',{target:{css:base+' button:has-text("'+(phase==='note'?'Append note':'Save status')+'")'},expect:{target:{css:'[role=status]'},condition:{kind:'text',value:'Saved /api/tickets/SYN-17/'+phase,match:'equals'}}}),
    'print(json.dumps('+command('observe')+'))'].join('\n');
}

test.afterEach(async()=>{await stopTauri();await stopMockServer();});
for(const id of ['B02','B03','C03','M01','M02','R01'])test(id+' actual bridge workflow records independent outcomes (scripted, not capability)',async()=>{
  await startMockServer();let portal=null;
  try{
    let app=await launchTauri(false,{managedBrowser:true,evaluationLimits:limits});
    await expect(app.page.locator('#app-container')).toBeVisible();
    if(['B02','B03','M02'].includes(id))portal=await startCorePortal(id);
    const controls=new Set(),writes=new Map();
    const action=code=>{controls.add(hashBytes(code));queueMockResponse(reply({type:'run_action',action:{language:'python',code,timeout_secs:40},success_criteria:'Execute the declared synthetic UI control and inspect its real state.'}));};
    const write=(name,text)=>{writes.set(hashBytes(name+'\n'+text),true);queueMockResponse(reply({type:'write_file',path:name,content:text}));};
    const adapter=createCoreWorkflow({id,app,portal,limits,restart:async(old,remaining)=>{
      await stopTauri();app=await launchTauri(false,{managedBrowser:true,reuseWorkspace:old.workspace,evaluationLimits:remaining});
      await expect(app.page.locator('#app-container')).toBeVisible();return app;
    }});
    const output=path.resolve('.zeus/evaluations','core-runtime-'+id+'-'+crypto.randomUUID());
    const result=await runMissionTrial({id,page:app.page,appWorkspace:app.workspace,output,experimentId:path.basename(output),
      models:{master:'phase1-mock',browserService:'managed-v1'},evaluationLimits:limits,portal,stopActor:stopTauri,
      runWorkflow:adapter.runWorkflow,browserObservation:adapter.browserObservation,collectionTimeoutMs:45000,
      scriptedFiles:id==='C03'?{'index.html':hashBytes(fs.readFileSync(path.join(mission(id).dir,'reference/index.html')))}:{},
      decide:async card=>{
        const d=card.body.blocked_directive;
        const approved=d?.type==='run_action'?controls.has(hashBytes(d.action.code)):d?.type==='write_file'?writes.has(hashBytes(d.path+'\n'+d.content)):false;
        return {approved,source:'exact-scripted-control',note:'Only the predeclared synthetic control is approved; this is not an agent capability run.'};
      },
      beforeSend:async()=>{
        if(id==='B02'){
          action(['import json','from pathlib import Path','from zeus_browser import call',command('navigate',{url:portal.url}),
            command('fill',{target:{css:'[aria-label="From date"]'},value:'2026-02-01'}),
            command('fill',{target:{css:'[aria-label="Through date"]'},value:'2026-02-28'}),
            command('select_option',{target:{css:'[aria-label="Status"]'},value:'paid'}),
            command('select_option',{target:{css:'[aria-label="Currency"]'},value:'EUR'}),
            command('click',{target:{text:'Apply filters'},expect:{target:{css:'[role=status]'},condition:{kind:'text',value:'4 orders',match:'equals'}}}),
            'download='+command('download',{target:{text:'Export CSV'}}),
            'Path("orders.csv").write_bytes(Path(download["download"]["path"]).read_bytes())',
            'print(json.dumps('+command('observe')+'))'].join('\n'));
          write('orders_summary.json',fs.readFileSync(path.join(mission(id).dir,'reference/orders_summary.json'),'utf8'));done('Actual downloaded orders retained.');
        }else if(id==='B03'){
          action(draftCode(portal.url,'Mina','standard'));done('The draft is saved; awaiting your correction.');
          action(draftCode(portal.url,'Ivo','express',true));done('The revised draft was submitted once.');
        }else if(id==='M01'){
          write('project.json',JSON.stringify(projectInitial));done('Initial project saved.');
          write('project.json',JSON.stringify(projectCorrected));done('Correction saved.');
          done('The revised project retains all original constraints.');
        }else if(id==='M02'){
          action(recoveryCode(portal.url,'note'));done('The note is saved; waiting before changing status.');
          action(recoveryCode(portal.url,'status'));done('The remaining status change is saved.');
        }else{
          const name=mission(id).task.artifacts[0];write(name,fs.readFileSync(path.join(mission(id).dir,'reference',name),'utf8'));done('Reference output saved.');
        }
      }});
    expect(result.row.execution_status,JSON.stringify(result.row.error)).toBe('succeeded');
    expect(result.row.outcome_status,JSON.stringify(result.outcome)).toBe('passed');
    expect(result.row.evaluation_kind).toBe('scripted_runtime');expect(result.row.passed).toBe(false);
    expect(result.row.usage.unknown_requests).toBe(0);
    expect(result.row.measurements.context.payload_samples.length).toBeGreaterThan(0);
    expect(result.row.measurements.root_runs).toBe(id==='M01'?3:['B03','M02'].includes(id)?2:1);
    if(id==='M02'){
      expect(result.row.evaluation_limits.limits.max_requests).toBe(limits.max_requests-2);
      expect([...new Set(result.row.measurements.context.payload_samples.map(s=>s.process_index))]).toEqual([0,1]);
    }
  }finally{if(portal)await portal.close();}
});
