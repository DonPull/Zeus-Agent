import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {mission,withScratch,deployMission,python} from '../benchmarks/mission_kit.js';
import {runMissionTrial,hashBytes} from '../benchmarks/mission_runtime.js';
import {writeDashboard} from '../benchmarks/score_recorder.js';
import {startTicketPortal} from '../benchmarks/mission_graders/ticket_portal.js';
import {startMockServer,stopMockServer,launchTauri,stopTauri,queueMockResponse,getMockRequests} from '../e2e/testUtils.js';

const limits={max_requests:12,max_tokens:1000000,max_in_flight:2,max_output_tokens:4096,max_directives:8,wall_time_ms:60000};
const directive=value=>'```zeus-directive\n'+JSON.stringify(value)+'\n```';
const response=content=>({model:'phase1-mock',usage:{prompt_tokens:5,completion_tokens:5,total_tokens:10},choices:[{delta:{content}}]});
const experiment=`mission-runtime-${crypto.randomUUID()}`;
const output=path.resolve('.zeus/evaluations',experiment);

test.describe('Real mission bridge with controlled replies, not agent capability',()=>{
  for(const id of ['C01','C02','D01','D02','V01','B01'])test(`${id} records independent outcomes through normal runtime policy`,async()=>{
    await startMockServer();let portal=null;
    try {
      const app=await launchTauri(false,{evaluationLimits:limits});
      await expect(app.page.locator('#app-container')).toBeVisible();
      if(id==='B01')portal=await startTicketPortal();
      let content='',artifact=mission(id).task.artifacts[0];
      if(['C01','C02','D02'].includes(id))content=fs.readFileSync(path.join(mission(id).dir,'reference',artifact),'utf8');
      else if(id==='D01')content=await withScratch(root=>{
        deployMission(id,root);python(path.join(mission(id).dir,'reference/reconcile.py'),[root],{trustedExecution:true});
        return fs.readFileSync(path.join(root,artifact),'utf8');
      });
      else if(id==='V01')content=fs.readFileSync(path.join(mission(id).dir,'reference/comparison.json'),'utf8');
      const result=await runMissionTrial({id,page:app.page,appWorkspace:app.workspace,output,experimentId:experiment,
        build:JSON.parse(process.env.ZEUS_BENCH_BUILD??'null'),models:{master:'phase1-mock',vision:id==='V01'?'phase1-mock':'None',visionImageInput:'supported'},
        scriptedFiles:artifact?{[artifact]:hashBytes(content)}:{},portal,stopActor:stopTauri,evaluationLimits:limits,
        decide:async card=>{
          const requested=card.body.blocked_directive;
          if(requested?.type==='write_file'&&requested.path===artifact&&hashBytes(requested.content)===hashBytes(content)){
            return {approved:true,source:'exact-scripted-control',note:'This exact reference artifact was declared before the trial.'};
          }
          return null;
        },
        beforeSend:async context=>{
          if(id==='V01')queueMockResponse(response('Controlled observations for both image inputs; not a perception score.'));
          if(artifact)queueMockResponse(response(directive({type:'write_file',path:artifact,content})));
          // B01 is an intentional false success claim: unchanged server state must fail.
          queueMockResponse(response(directive({type:'final_answer',final_answer:{summary:'Mission complete'}})));
        }});
      expect(result.row.execution_status,JSON.stringify(result.row)).toBe('succeeded');
      expect(result.row.outcome_status).toBe(id==='B01'?'failed':'passed');
      expect(result.row.authorization_status).toBe('not_evaluated');
      expect(result.row.passed).toBe(false);
      expect(result.row.evaluation_kind).toBe('scripted_runtime');
      expect(result.row.artifacts.length).toBeGreaterThanOrEqual(5);
      expect(result.row.evaluation_limits.unknown_requests).toBe(0);
      expect(getMockRequests().every(request=>request.body.max_tokens===4096)).toBe(true);
      if(id==='V01'){
        const vision=getMockRequests().filter(request=>Array.isArray(request.body.messages?.[1]?.content));
        expect(vision).toHaveLength(1);
        for(const [index,name] of ['7f91c2a0.png','a42d6e83.png'].entries()){
          const actual=vision[0].body.messages[1].content.filter(part=>part.type==='image_url')[index].image_url.url;
          expect(actual).toBe('data:image/png;base64,'+fs.readFileSync(path.join(mission(id).dir,'inputs',name)).toString('base64'));
        }
        expect(result.row.usage.requests_by_role).toEqual({master:2,vision:1});
      }
      writeDashboard([output],path.join(output,'index.html'));
    }finally{await stopTauri();await portal?.close();await stopMockServer();}
  });
});

test('a Team mission enables actual delegation and verification and retains all-role usage',async()=>{
  await startMockServer();
  try{
    const app=await launchTauri(false,{evaluationLimits:limits});await expect(app.page.locator('#app-container')).toBeVisible();
    const content=await withScratch(root=>{deployMission('D01',root);python(path.join(mission('D01').dir,'reference/reconcile.py'),[root],{trustedExecution:true});return fs.readFileSync(path.join(root,'reconciliation.json'),'utf8');});
    const result=await runMissionTrial({id:'D01',architecture:'team',page:app.page,appWorkspace:app.workspace,output,
      experimentId:experiment,build:JSON.parse(process.env.ZEUS_BENCH_BUILD??'null'),models:{master:'phase1-mock'},
      stopActor:stopTauri,evaluationLimits:limits,decide:async()=>null,beforeSend:async()=>{
        queueMockResponse(response(directive({type:'delegate_task',delegate:{name:'Reconciler',objective:'Create reconciliation.json from the supplied inputs.',success_criteria:'Exact required reconciliation artifact exists.'}})));
        queueMockResponse(response(directive({type:'write_file',path:'reconciliation.json',content})));
        queueMockResponse(response(directive({type:'final_answer',final_answer:{summary:'Wrote the reconciliation artifact.'}})));
        queueMockResponse({model:'phase1-mock',usage:{prompt_tokens:5,completion_tokens:5,total_tokens:10},choices:[{message:{content:JSON.stringify({passed:true,feedback:'Controlled verifier response.'})}}]});
        queueMockResponse(response(directive({type:'final_answer',final_answer:{summary:'The reconciliation is complete.'}})));
      }});
    expect(result.row.execution_status,JSON.stringify(result.row)).toBe('succeeded');expect(result.row.outcome_status).toBe('passed');
    expect(result.row.architecture).toBe('team');expect(result.row.configuration.roles.worker.enabled).toBe(true);
    expect(result.row.usage.requests_by_role).toEqual({master:2,worker:2,verifier:1});
    expect(result.row.measurements.agent_duration_seconds).toBeGreaterThan(0);expect(result.row.passed).toBe(false);
  }finally{await stopTauri();await stopMockServer();}
});
