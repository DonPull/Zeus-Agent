import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeMessages,reconcileMessageSnapshot} from '../../src/utils.js';

test('delayed events and hydration cannot revive a closed backend-versioned browser projection',()=>{
    const active={id:'browser',seq:8,visible:true,projection_version:2,content:'active'};
    const closed={...active,projection_version:4,content:'closed'};
    assert.equal(mergeMessages([closed],active)[0].content,'closed');
    assert.equal(reconcileMessageSnapshot([closed],[active])[0].content,'closed');
    assert.equal(reconcileMessageSnapshot([closed],[])[0].content,'closed');
    const hidden={...closed,projection_version:5,visible:false};
    assert.equal(mergeMessages([closed],hidden)[0].visible,false);
});

test('ordinary snapshot replacement and authoritative sequence order remain unchanged',()=>{
    const old={id:'a',seq:1,visible:true,content:'old'},fresh={...old,content:'fresh'};
    assert.deepEqual(reconcileMessageSnapshot([old],[fresh]),[fresh]);
    assert.deepEqual(reconcileMessageSnapshot([old],[]),[]);
    assert.deepEqual(mergeMessages([{id:'late',seq:3}],[{id:'first',seq:1},{id:'middle',seq:2}]).map(row=>row.id),['first','middle','late']);
});
