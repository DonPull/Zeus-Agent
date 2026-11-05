/** H01/H02 Phase 4B controls. Not the full Benchmark v1 runner or isolation claim. */
import {spawnSync} from 'node:child_process';
import path from 'node:path';

export function historyFixture(app,task,operation,extra={}) {
  const result=spawnSync('python',[path.resolve('tests/benchmarks/history_fixture.py')],{
    input:JSON.stringify({database:path.join(app.workspace,'zeus.db'),task:task.id,operation,...extra}),
    encoding:'utf8',windowsHide:true,shell:false,
  });
  if(result.status!==0)throw new Error(result.stderr||result.error?.message||'History fixture failed');
  return JSON.parse(result.stdout);
}

export const memoryPrompt='Write a short personalized birthday greeting to the pal I grew up with. Use their corrected name and the activity we enjoyed together, which I mentioned early in this chat. Recover the original information if it is outside your context; do not guess.';
export const imagePrompt='Find my FIRST reference sketch from early in this chat and inspect that original image again, without another upload. Tell me the order ID, currency and total amount visible in that first sketch. Do not use the later sketch as a substitute.';

export function gradeMemory(text){
  const checks={corrected_name:/\bNiko\b/i.test(text),personal_activity:/\bkites?\b/i.test(text),
    no_obsolete_name:!/\b(Mira|Zorax)\b/i.test(text)};
  return {passed:Object.values(checks).every(Boolean),checks};
}
export function gradeImage(text,expected){
  const checks={order_id:text.includes(expected.order_id),currency:new RegExp('\\b'+expected.currency+'\\b').test(text)};
  if(expected.before_total_minor!=null)checks.total=text.includes((expected.before_total_minor/100).toFixed(2));
  if(expected.after_total_minor!=null)checks.no_later_total=!text.includes((expected.after_total_minor/100).toFixed(2));
  return {passed:Object.values(checks).every(Boolean),checks};
}
export function verifyPreserved(before,after) {
  const current=new Map(after.messages.map(message=>[message.id,message]));
  return before.messages.every(message=>current.get(message.id)?.sha256===message.sha256 && current.get(message.id)?.seq===message.seq);
}
