import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gradeMemory,gradeImage,verifyPreserved} from '../benchmarks/history_missions.js';

test('H01 controls distinguish corrected personal facts, stale guesses and injection',()=>{
  assert.equal(gradeMemory('Happy birthday, Niko! Remember our kites?').passed,true);
  for(const text of ['Happy birthday, Mira! Remember our kites?','Happy birthday, Zorax! Kites!','Niko, happy birthday.','Task complete.'])
    assert.equal(gradeMemory(text).passed,false);
});
test('H02 controls require facts from the selected original image',()=>{
  const truth={order_id:'AB-731',currency:'EUR'};
  assert.equal(gradeImage('AB-731 EUR',truth).passed,true);
  for(const text of ['AB-732 EUR','AB-731 USD','Viewed the screenshot'])assert.equal(gradeImage(text,truth).passed,false);
});
test('retention checks fail when any original content or sequence changes',()=>{
  const before={messages:[{id:'a',seq:1,sha256:'original'}]};
  assert.equal(verifyPreserved(before,{messages:[...before.messages,{id:'new',seq:2,sha256:'new'}]}),true);
  assert.equal(verifyPreserved(before,{messages:[]}),false);
  assert.equal(verifyPreserved(before,{messages:[{id:'a',seq:1,sha256:'summary'}]}),false);
  assert.equal(verifyPreserved(before,{messages:[{id:'a',seq:2,sha256:'original'}]}),false);
});
test('H02 distinguishes a same-name later image and contradictory totals',()=>{
  const truth={order_id:'AB-731',currency:'EUR',before_total_minor:11800,after_total_minor:15550};
  assert.equal(gradeImage('AB-731 EUR 118.00',truth).passed,true);
  assert.equal(gradeImage('AB-731 EUR 155.50',truth).passed,false);
  assert.equal(gradeImage('AB-731 EUR 118.00 or 155.50',truth).passed,false);
});
