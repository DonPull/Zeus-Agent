import test from 'node:test';
import assert from 'node:assert/strict';
import {formatDebugReport} from '../../src/debugReport.js';

test('debug report retains complete visible and hidden task histories with routing/attachment evidence',()=>{
    const base={task_id:'t',conversation:'master',created_at:'now',attachments:[],visible:true,kind:'chat',model:null};
    const long='Full user content '.repeat(6000);
    const messages=[{...base,id:'worker',seq:3,conversation:'worker-1',role:'assistant',visible:false,model:'actual-worker',content:'Worker internal history'},
        {...base,id:'answer',seq:2,role:'assistant',content:'Visible answer'},
        {...base,id:'input',seq:1,role:'user',content:long,attachments:[{id:'a',task_id:'t',filename:'screen.png',mime_type:'image/png',byte_count:5802409,width:2560,height:1440,sha256:'hash',status:'ready',last_delivery:{state:'interrupted'},previewUrl:'do-not-export-preview',data_url:'do-not-export-bytes'}]}];
    const report=formatDebugReport({taskId:'t',messages,backendLog:'tool started',run:{status:'interrupted'},usage:{unknown_requests:1},exportedAt:'fixed'});
    assert.ok(report.includes(long));assert.ok(report.includes('Visible answer'));assert.ok(report.includes('Worker internal history'));
    assert.ok(report.indexOf('id=input')<report.indexOf('id=answer'));assert.ok(report.indexOf('id=answer')<report.indexOf('id=worker'));
    const visible=report.split('--- FULL VISIBLE MASTER CHAT ---')[1].split('--- RAW MESSAGES')[0];
    assert.ok(visible.includes(long));assert.ok(!visible.includes('Worker internal history'));
    assert.match(report,/conversation=worker-1.*model=actual-worker/);assert.match(report,/"byte_count":5802409/);
    assert.match(report,/"unknown_requests": 1/);assert.match(report,/"status": "interrupted"/);
    assert.ok(!report.includes('do-not-export-preview'));assert.ok(!report.includes('do-not-export-bytes'));
});

test('missing backend events are explicitly unavailable and cannot be mistaken for a complete crash trace',()=>{
    const report=formatDebugReport({taskId:'t',messages:[],exportedAt:'fixed'});
    assert.match(report,/Restart loses these events/);assert.match(report,/previous-process events are not retained/);
    assert.match(report,/--- LATEST RUN ---\nnull/);assert.match(report,/RAW MESSAGES.*\n\(empty\)/);
});
