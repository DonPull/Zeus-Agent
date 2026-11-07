/** Known calibration scripts, kept host-private until supplied as fake replies. */
import fs from 'node:fs';
import path from 'node:path';
import {mission} from '../../../tests/benchmarks/mission_kit.js';
import {projectInitial,projectCorrected} from '../../../tests/benchmarks/memory_core_controls.js';
const encoded=value=>'json.loads('+JSON.stringify(JSON.stringify(value))+')';
const call=(op,params={})=>'call('+JSON.stringify(op)+', **'+encoded(params)+')';
const url='http://127.0.0.1:19222/';
const script=lines=>({type:'run_action',action:{language:'python',code:['import json','from zeus_browser import call',...lines,'print(json.dumps('+call('observe')+'))'].join('\n'),timeout_secs:45},success_criteria:'Run the exact declared synthetic browser control and inspect the resulting state.'});
const done=()=>({type:'final_answer',final_answer:{summary:'Scripted workflow phase finished; independent grading determines correctness.'}});
const write=(name,content)=>({type:'write_file',path:name,content:typeof content==='string'?content:JSON.stringify(content)});
function draft(owner,delivery,submit){
  const scope='article[data-id="D-17"]';
  return script([call('navigate',{url}),call('select_option',{target:{css:scope+' select[aria-label="Owner"]'},value:owner}),
    call('select_option',{target:{css:scope+' select[aria-label="Delivery"]'},value:delivery}),call('fill',{target:{css:scope+' input[aria-label="Note"]'},value:'Keep original packaging'}),
    call('click',{target:{css:scope+' button:has-text("Save draft")'},expect:{target:{css:'[role=status]'},condition:{kind:'text',value:'Saved /api/drafts/D-17/save',match:'equals'}}}),
    ...(submit?[call('click',{target:{css:scope+' button:has-text("Submit draft")'},expect:{target:{css:'[role=status]'},condition:{kind:'text',value:'Saved /api/drafts/D-17/submit',match:'equals'}}})]:[])]);
}
function recovery(phase,valid){
  const scope='article[data-id="SYN-17"]';
  return script([call('navigate',{url}),phase==='note'?call('fill',{target:{css:scope+' input[aria-label="New note"]'},value:'Verified original request'}):call('select_option',{target:{css:scope+' select'},value:valid?'Resolved':'Open'}),
    call('click',{target:{css:scope+' button:has-text("'+(phase==='note'?'Append note':'Save status')+'")'},expect:{target:{css:'[role=status]'},condition:{kind:'text',value:'Saved /api/tickets/SYN-17/'+phase,match:'equals'}}})]);
}
export function workflowControlReplies(id,variant){
  const valid=variant==='positive';
  if(!['positive','invalid-output'].includes(variant))throw Error('Unknown workflow control variant');
  if(id==='B01')return [script([call('navigate',{url}),call('select_option',{target:{css:'[data-ticket-id="T-102"] select'},value:valid?'high':'low'}),
    call('fill',{target:{css:'[data-ticket-id="T-102"] textarea'},value:'Call after 16:00 Sofia time.'}),call('click',{target:{css:'[data-ticket-id="T-102"] button'},expect:{target:{css:'[role=status]'},condition:{kind:'text',value:'Saved T-102',match:'equals'}}})]),done()];
  if(id==='B02')return [script(['from pathlib import Path',call('navigate',{url}),call('fill',{target:{css:'[aria-label="From date"]'},value:'2026-02-01'}),call('fill',{target:{css:'[aria-label="Through date"]'},value:'2026-02-28'}),
    call('select_option',{target:{css:'[aria-label="Status"]'},value:'paid'}),call('select_option',{target:{css:'[aria-label="Currency"]'},value:'EUR'}),call('click',{target:{text:'Apply filters'},expect:{target:{css:'[role=status]'},condition:{kind:'text',value:'4 orders',match:'equals'}}}),
    'download='+call('download',{target:{text:'Export CSV'}}),'Path("orders.csv").write_bytes(Path(download["download"]["path"]).read_bytes())']),
    write('orders_summary.json',valid?fs.readFileSync(path.join(mission(id).dir,'reference/orders_summary.json'),'utf8'):'{}'),done()];
  if(id==='B03')return [draft('Mina','standard',false),done(),draft(valid?'Ivo':'Mina','express',true),done()];
  if(id==='M01')return [write('project.json',projectInitial),done(),write('project.json',projectCorrected),done(),...(valid?[]:[write('project.json',projectInitial)]),done()];
  if(id==='M02')return [recovery('note',true),done(),recovery('status',valid),done()];
  throw Error('Unknown workflow control');
}
