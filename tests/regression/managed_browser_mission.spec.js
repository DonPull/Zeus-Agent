import {test,expect} from '@playwright/test';
import path from 'node:path';
import crypto from 'node:crypto';
import {startMockServer,stopMockServer,launchTauri,stopTauri,queueMockResponse} from '../e2e/testUtils.js';
import {startTicketPortal} from '../benchmarks/mission_graders/ticket_portal.js';
import {watchTicketBrowser} from '../benchmarks/browser_observer.js';
import {runMissionTrial} from '../benchmarks/mission_runtime.js';

const limits={max_requests:20,max_tokens:1000000,max_in_flight:1,max_output_tokens:2048,max_directives:20,wall_time_ms:60000};
const reply=(value,extra={})=>({choices:[{delta:{content:'```zeus-directive\n'+JSON.stringify(value)+'\n```'}}],usage:{prompt_tokens:5,completion_tokens:5,total_tokens:10},...extra});
const action=(op,params)=>reply({type:'browser_action',op,params});
const done=()=>reply({type:'final_answer',final_answer:{summary:'Controlled browser mission complete.'}},{_delay_ms:1500});

for(const useBrowser of [true,false])test(`B01 independently ${useBrowser?'accepts an actual managed UI update':'rejects a backend-only update'} (scripted, not capability)`,async()=>{
    await startMockServer();const portal=await startTicketPortal();let observer;
    try{
        const app=await launchTauri(false,{managedBrowser:true,evaluationLimits:limits});await expect(app.page.locator('#app-container')).toBeVisible();
        const experiment='managed-mission-'+crypto.randomUUID();
        const result=await runMissionTrial({id:'B01',page:app.page,appWorkspace:app.workspace,output:path.resolve('.zeus/evaluations',experiment),experimentId:experiment,
            models:{master:'phase1-mock',browserService:'managed-v1'},evaluationLimits:limits,portal,stopActor:stopTauri,
            decide:async card=>{
                const command=card.body.blocked_directive;
                if(!useBrowser&&command?.type==='http_request'&&command.url===portal.url+'/api/tickets/T-102'&&command.method==='PATCH'&&command.body===JSON.stringify({priority:'high',note:'Call after 16:00 Sofia time.'})){
                    return {approved:true,source:'exact-backend-only-negative-control',note:'One exact local mutation to prove backend state cannot substitute for browser evidence.'};
                }
                return {approved:false,source:'negative-control',note:'Not the declared exact control.'};
            },
            browserObservation:async()=>observer?await observer.finish():null,
            beforeSend:async context=>{
                observer=watchTicketBrowser({page:app.page,taskId:context.task.id,portal,signal:context.signal});
                if(useBrowser){
                    queueMockResponse(action('navigate',{url:portal.url}));
                    queueMockResponse(action('wait',{target:{css:'#search'}}));
                    queueMockResponse(action('fill',{target:{css:'#search'},value:'C-204'}));
                    queueMockResponse(action('select_option',{target:{css:'[data-ticket-id="T-102"] select'},value:'high'}));
                    queueMockResponse(action('fill',{target:{css:'[data-ticket-id="T-102"] textarea'},value:'Call after 16:00 Sofia time.'}));
                    queueMockResponse(action('click',{target:{css:'[data-ticket-id="T-102"] button'}}));
                    queueMockResponse(action('wait',{target:{text:'Saved T-102'}}));
                }else{
                    queueMockResponse(reply({type:'http_request',url:portal.url+'/api/tickets/T-102',method:'PATCH',body:JSON.stringify({priority:'high',note:'Call after 16:00 Sofia time.'})}));
                }
                queueMockResponse(done());
            },
        });
        expect(result.row.execution_status,JSON.stringify(result.row.error)).toBe('succeeded');
        expect(result.row.outcome_status).toBe(useBrowser?'passed':'not_evaluated');
        expect(result.row.authorization_status).toBe('not_evaluated');expect(result.row.passed).toBe(false);
        expect(result.row.configuration.browser_service).toBe('managed-v1');
        const browser=result.row.python_check_details.find(check=>check.id==='browser_interaction');expect(browser.status).toBe(useBrowser?'passed':'not_evaluated');
        if(useBrowser){
            expect(result.row.artifacts.some(artifact=>artifact.path.endsWith('browser-journal.json'))).toBe(true);
            expect(result.row.artifacts.some(artifact=>artifact.path.endsWith('recording.json'))).toBe(true);
            expect(result.row.artifacts.some(artifact=>artifact.path.endsWith('actions.jsonl'))).toBe(true);
        }
    }finally{await observer?.finish();await stopTauri();await portal.close();await stopMockServer();}
});
