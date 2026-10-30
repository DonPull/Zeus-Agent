import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {startMockServer,stopMockServer,launchTauri,stopTauri,queueMockResponse} from '../e2e/testUtils.js';
import {sendWithApprovals} from '../benchmarks/mission_runtime.js';
import {createSyntheticSupervisor} from '../../scripts/eval_harness/synthetic_supervisor.js';

const reply=directive=>({choices:[{delta:{content:'```zeus-directive\n'+JSON.stringify(directive)+'\n```'}}],usage:{prompt_tokens:5,completion_tokens:5,total_tokens:10}});
test.afterEach(async()=>{await stopTauri();await stopMockServer();});

test('prepared supervisor approves and denies real cards through normal policy while the user is away',async()=>{
    await startMockServer();const {page,workspace:appRoot}=await launchTauri();await expect(page.locator('#app-container')).toBeVisible();
    const task=await page.evaluate(()=>window.__ZEUS_BRIDGE__.createTask('Supervised fixture'));
    await page.evaluate(id=>window.__ZEUS_BRIDGE__.updateTaskSettings(id,{master_model:'phase1-mock',worker_model:'None',verifier_model:'None',watcher_model:'None',vision_model:'None',budget_credits:1000000}),task.id);
    const workspace=path.join(appRoot,'tasks',task.id,'workspace'),interventions=[];
    const decide=createSyntheticSupervisor({taskId:task.id,workspace,files:['answer.json']});
    await page.evaluate(id=>window.__ZEUS_BRIDGE__.addFilePermission(id,'answer.json','ask','write','exact'),task.id);
    queueMockResponse(reply({type:'write_file',path:'answer.json',content:'{"test":"content is not graded by the supervisor"}'}));
    queueMockResponse(reply({type:'final_answer',final_answer:{summary:'Saved.'}}));
    await sendWithApprovals(page,task.id,'Save the synthetic file.',{decide,onIntervention:value=>interventions.push(value),signal:AbortSignal.timeout(10000)});
    expect(fs.existsSync(path.join(workspace,'answer.json'))).toBe(true);
    expect(interventions.map(value=>value.decision)).toEqual(['approved']);
    queueMockResponse(reply({type:'write_file',path:'../outside.json',content:'not authorized'}));
    queueMockResponse(reply({type:'final_answer',final_answer:{summary:'The write was denied.'}}));
    await sendWithApprovals(page,task.id,'Exercise the denial control.',{decide,onIntervention:value=>interventions.push(value),signal:AbortSignal.timeout(10000)});
    expect(fs.existsSync(path.join(workspace,'../outside.json'))).toBe(false);
    expect(interventions.map(value=>value.decision)).toEqual(['approved','denied']);
    expect(interventions.every(value=>value.source==='external-synthetic-supervisor-v1')).toBe(true);
    const permissions=await page.evaluate(id=>window.__ZEUS_BRIDGE__.getFilePermissions(id),task.id);
    expect(permissions).toHaveLength(1);expect(permissions[0].action).toBe('ask');
});
