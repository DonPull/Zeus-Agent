import test from 'node:test';
import assert from 'node:assert/strict';
import {browserBadge,browserDuration,browserTime,browserActor,replaySpeed} from '../../src/browserView.js';
import {actionFeed} from '../../src/browserActionFeed.js';

test('recent action feed deduplicates live frames, expires and keeps four chronological actions',()=>{
    let feed=[];
    for(let i=1;i<=6;i++)feed=actionFeed(feed,{actor:'Agent',op:'click',action_id:String(i)},i*100,2,true);
    assert.deepEqual(feed.map(entry=>entry.id),['3','4','5','6']);
    const unchanged=actionFeed(feed,{actor:'Agent',action_id:'6'},1000,2,true);
    assert.deepEqual(unchanged,feed);
    assert.equal(actionFeed(feed,null,4700).length,0);
    assert.equal(actionFeed([],{actor:'Page',action_id:'untrusted'},0).length,0);
    assert.equal(actionFeed([],{actor:'Human',action_id:'h'},0,.4,true)[0].expires,10000);
    assert.equal(actionFeed([],{actor:'Agent',action_id:'a'},0,90,true)[0].expires,4000);
});
test('displayed-frame freshness distinguishes live, stale, error, waiting and terminal states',()=>{
    assert.deepEqual(browserBadge('active',{state:'live'},1000,2500),{label:'Live',tone:'live'});
    assert.deepEqual(browserBadge('active',{state:'live'},1000,6000),{label:'Outdated · 5s',tone:'outdated'});
    assert.equal(browserBadge('completed',{state:'live'},1000,6000).label,'Browser closed');
    assert.equal(browserBadge('active',{state:'capture_error'},1000,2500).tone,'error');
    assert.equal(browserBadge('active',{state:'no_tab'},1000,2500).label,'No open tab');
    assert.equal(browserBadge('active',{state:'waiting'},null,2500).label,'Waiting for image');
});

test('replay speed accepts positive decimal rates, rounds to tenths and rejects invalid values',()=>{
    for(const [input,value] of [['0.4',0.4],['.4',0.4],['0.44',0.4],['0.46',0.5],['0.15',0.2],['2',2],['25.6',25.6],['10000',10000]])assert.equal(replaySpeed(input),value);
    for(const value of ['',0,'0.04','-2','Infinity','NaN','1e9','words'])assert.equal(replaySpeed(value),null);
});
test('replay durations and local action times are readable without opaque actor identifiers',()=>{
    assert.equal(browserDuration({duration_ms:42000}),'42s');
    assert.equal(browserDuration({duration_ms:402000}),'6m 42s');
    assert.equal(browserDuration({duration_ms:4002000}),'1h 6m 42s');
    assert.equal(browserDuration({status:'historical',created_at:null,updated_at:null}),null);
    const date=new Date(2026,9,31,17,25,22);assert.equal(browserTime(date.getTime()),'17:25:22 · 31/10/2026');
    assert.equal(browserActor('worker:opaque-id/script:another-uuid'),'Worker');assert.equal(browserActor('master'),'Zeus');
});
