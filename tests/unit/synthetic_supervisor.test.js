import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createSyntheticSupervisor} from '../../scripts/eval_harness/synthetic_supervisor.js';

test('supervisor approves bounded declared file work independently of answer correctness',async()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'zeus-supervisor-'));
    try{
        const decide=createSyntheticSupervisor({taskId:'t',workspace:root,files:['answer.json'],maxWriteBytes:50});
        const card=(directive,task='t')=>({kind:'approval',task_id:task,body:{blocked_directive:directive}});
        assert.equal((await decide(card({type:'write_file',path:'answer.json',content:'{"wrong_answer":true}'}))).approved,true);
        assert.equal((await decide(card({type:'read_file',path:path.join(root,'answer.json')}))).approved,true);
        for(const directive of [{type:'write_file',path:'../answer.json',content:'x'},{type:'write_file',path:'other.json',content:'x'},
            {type:'write_file',path:'answer.json',content:'x'.repeat(51)},{type:'run_command',command:'echo safe'},
            {type:'run_action',action:{code:'print(1)'}},{type:'http_request',url:'https://example.com',method:'POST'}]){
            assert.equal((await decide(card(directive))).approved,false);
        }
        assert.equal((await decide(card({type:'read_file',path:'answer.json'},'another-task'))).approved,false);
    }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('supervisor does not authorize a declared filename redirected through a link',async()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'zeus-supervisor-link-'));
    try{
        const outside=path.join(root,'outside');fs.mkdirSync(outside);
        const workspace=path.join(root,'workspace');fs.mkdirSync(workspace);
        fs.symlinkSync(outside,path.join(workspace,'linked'),process.platform==='win32'?'junction':'dir');
        const decide=createSyntheticSupervisor({taskId:'t',workspace,files:['linked/answer.json']});
        assert.equal((await decide({kind:'approval',task_id:'t',body:{blocked_directive:{type:'write_file',path:'linked/answer.json',content:'x'}}})).approved,false);
    }finally{fs.rmSync(root,{recursive:true,force:true});}
});
