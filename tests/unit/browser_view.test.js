import test from 'node:test';
import assert from 'node:assert/strict';
import {browserBadge,browserDuration,browserTime,browserActor} from '../../src/browserView.js';
test('displayed-frame freshness distinguishes live, stale, error, waiting and terminal states',()=>{
    assert.deepEqual(browserBadge('active',{state:'live'},1000,2500),{label:'Live',tone:'live'});
    assert.deepEqual(browserBadge('active',{state:'live'},1000,6000),{label:'Outdated · 5s',tone:'outdated'});
    assert.equal(browserBadge('completed',{state:'live'},1000,6000).label,'Browser closed');
    assert.equal(browserBadge('active',{state:'capture_error'},1000,2500).tone,'error');
    assert.equal(browserBadge('active',{state:'no_tab'},1000,2500).label,'No open tab');
    assert.equal(browserBadge('active',{state:'waiting'},null,2500).label,'Waiting for image');
});
test('replay durations and local action times are readable without opaque actor identifiers',()=>{
    assert.equal(browserDuration({duration_ms:42000}),'42s');
    assert.equal(browserDuration({duration_ms:402000}),'6m 42s');
    assert.equal(browserDuration({duration_ms:4002000}),'1h 6m 42s');
    assert.equal(browserDuration({status:'historical',created_at:null,updated_at:null}),null);
    const date=new Date(2026,9,31,17,25,22);assert.equal(browserTime(date.getTime()),'17:25:22 · 31/10/2026');
    assert.equal(browserActor('worker:opaque-id/script:another-uuid'),'Worker');assert.equal(browserActor('master'),'Zeus');
});
