import test from 'node:test';
import assert from 'node:assert/strict';
import {readActionPlan} from '../../src/actionPlan.js';
import {titleFreeText} from '../../src/taskTitle.js';
import {imageStep,replayFrame} from '../../src/replayLoader.js';
test('legacy Done plans repair matching pending steps and remove duplicate notes',()=>{
    const plan=readActionPlan(JSON.stringify({markdown:'- [Done] Gather inputs\n- [Done] Save report',steps:[{title:'Gather inputs',status:'pending'},{title:'Save report',status:'pending'}]}));
    assert.deepEqual(plan.steps.map(s=>s.status),['completed','completed']);assert.equal(plan.notes,'');
    const explicit=readActionPlan({markdown:'- [Done] Gather inputs',steps_source:'explicit',steps:[{title:'Gather inputs',status:'pending'}]});assert.equal(explicit.steps[0].status,'pending');
    assert.match(readActionPlan('- [x] Work\n\nKeep the original source files.').notes,/Keep the original/);
    assert.deepEqual(readActionPlan('null').steps,[]);
    assert.deepEqual(readActionPlan({steps:[null,{},false]}).steps,[]);
});
test('title metadata stays out of streaming content without truncating normal answers',()=>{
    assert.equal(titleFreeText('[[chat_t'),'');assert.equal(titleFreeText('[[chat_title: Browser research]]\nAnswer'),'Answer');assert.equal(titleFreeText('A normal response.'),'A normal response.');
});

test('runtime plan projection wins over markdown and remains distinct from model claims',()=>{
    const plan=readActionPlan({markdown:'- [Done] Deliver report',steps_source:'checkpoint',
        checkpoint:{state:'interrupted',version:9},steps:[{id:'deliver',title:'Deliver report',status:'interrupted',reported_status:'in_progress'}]});
    assert.equal(plan.steps[0].status,'interrupted');
    assert.equal(plan.steps[0].reported_status,'in_progress');
    assert.equal(plan.checkpoint.state,'interrupted');
    assert.equal(plan.notes,'');
});
test('image navigation counts usable actions and exact strip selection remains separate',()=>{
    const rows=[{seq:1,has_image:true},{seq:2,has_image:false},{seq:3,has_image:true},{seq:4,has_image:false},{seq:5,has_image:true}];
    assert.equal(imageStep(rows,1,1),3);assert.equal(imageStep(rows,1,2),5);assert.equal(imageStep(rows,5,-1),3);assert.equal(imageStep(rows,4,-1),3);assert.equal(imageStep(rows,5,1),5);
    assert.equal(replayFrame([{id:'bad',relation:'after',status:'deleted'},{id:'good',relation:'before',status:'available'}]).id,'good');
});
