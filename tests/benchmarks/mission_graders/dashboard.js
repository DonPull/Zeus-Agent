/** Trusted external browser probes. Agent HTML must use an isolated grader;
 * reference/control execution is explicit and never inferred from a filename.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright-core';
import {mission,readArtifact,safeFile,SubmissionError} from '../mission_kit.js';
import {check} from './outcomes.js';
import {inputsPreserved} from './core_outcomes.js';

export async function probeDashboard(page,url,{screenshotDirectory=null}={}){
  const results=[];
  const probe=async(id,work)=>{
    try{const evidence=await work();results.push(check(id,true,evidence??null));}
    catch(error){results.push(check(id,false,{error:String(error.message).slice(0,1500)}));}
  };
  page.setDefaultTimeout(2500);
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:5000});
  const box=id=>page.getByRole('checkbox',{name:'Complete '+id,exact:true});
  const edit=id=>page.getByRole('button',{name:'Edit '+id,exact:true});
  const filter=page.getByRole('combobox',{name:'Filter tasks',exact:true});
  const assert=(condition,reason)=>{if(!condition)throw Error(reason);};
  await probe('bootstrap',async()=>{
    await box('T-09').waitFor({state:'visible'});
    assert(await page.getByRole('checkbox').count()===4,'All supplied rows, including a fresh fixture row, must be loaded');
    assert(await box('T-03').isChecked(),'Initial completed value was lost');
    assert(await page.getByText('Fresh import row',{exact:true}).count()===1,'Fresh task title was lost');
  });
  await probe('filters',async()=>{
    await filter.selectOption({label:'Active'});
    assert(await page.getByRole('checkbox').count()===3,'Active filter includes completed tasks or drops active rows');
    assert(await box('T-03').count()===0,'Completed task remains in active view');
    await filter.selectOption({label:'Completed'});
    assert(await page.getByRole('checkbox').count()===1&&await box('T-03').count()===1,'Completed filter is incorrect');
    await filter.selectOption({label:'All'});
    assert(await page.getByRole('checkbox').count()===4,'All filter did not restore rows');
  });
  await probe('toggle_and_persist',async()=>{
    await filter.selectOption({label:'All'});await box('T-01').check();
    await filter.selectOption({label:'Completed'});await page.reload({waitUntil:'domcontentloaded'});
    await box('T-01').waitFor({state:'visible'});
    assert(await box('T-01').isChecked(),'Toggled value did not survive reload');
    assert((await filter.locator('option:checked').textContent())==='Completed','Filter did not survive reload');
    assert(await page.getByRole('checkbox').count()===2,'Persisted completed view has incorrect rows');
    await filter.selectOption({label:'All'});
  });
  await probe('edit_and_persist',async()=>{
    await edit('T-02').click();const input=page.getByRole('textbox',{name:'Task title',exact:true});
    assert(await input.evaluate(e=>e===document.activeElement),'Editor did not focus its textbox');
    await input.fill('Edited via keyboard');await input.press('Enter');
    await page.getByText('Edited via keyboard',{exact:true}).waitFor();
    await page.reload({waitUntil:'domcontentloaded'});
    await page.getByText('Edited via keyboard',{exact:true}).waitFor();
    assert(await box('T-02').count()===1,'Editing changed task identity');
  });
  await probe('keyboard_cancel',async()=>{
    await edit('T-03').click();const input=page.getByRole('textbox',{name:'Task title',exact:true});
    await input.fill('Must not persist');await input.press('Escape');
    assert(await page.getByText('Must not persist',{exact:true}).count()===0,'Escape saved the draft');
    await page.reload({waitUntil:'domcontentloaded'});
    await page.getByText('Archive the draft',{exact:true}).waitFor();
    assert(await box('T-03').isChecked(),'Cancel changed completion');
  });
  await probe('empty_title',async()=>{
    await edit('T-02').click();const input=page.getByRole('textbox',{name:'Task title',exact:true});
    await input.fill('   ');await input.press('Enter');
    if(await input.count())await input.press('Escape');
    await page.reload({waitUntil:'domcontentloaded'});
    await page.getByText('Edited via keyboard',{exact:true}).waitFor();
  });
  await probe('unrelated_preserved',async()=>{
    assert(await page.getByRole('checkbox').count()===4,'Task count changed');
    assert(!await box('T-09').isChecked(),'Unrelated task completion changed');
    assert(await page.getByText('Fresh import row',{exact:true}).count()===1,'Unrelated task title changed');
    assert(await box('T-01').isChecked()&&await box('T-03').isChecked(),'Earlier values were lost');
  });
  await probe('responsive_layout',async()=>{
    for(const width of [1100,420]){
      await page.setViewportSize({width,height:800});
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Dashboard overflows its viewport');
      if(screenshotDirectory){fs.mkdirSync(screenshotDirectory,{recursive:true});await page.screenshot({path:path.join(screenshotDirectory,'dashboard-'+width+'.png')});}
    }
  });
  return results;
}

export async function gradeDashboard(root,options={}){
  if(!options.trustedExecution)throw Error('Untrusted dashboard requires the isolated executable grader; host execution is unavailable');
  const bytes=fs.readFileSync(safeFile(root,'index.html'));
  const seed=[...readArtifact(path.join(mission('C03').dir,'inputs'),'tasks.json'),{id:'T-09',title:'Fresh import row',completed:false}];
  const server=http.createServer((req,res)=>{
    if(req.method!=='GET'){res.writeHead(405);res.end();return;}
    const route=new URL(req.url,'http://fixture').pathname;
    const data=route==='/'?bytes:route==='/tasks.json'?Buffer.from(JSON.stringify(seed)):null;
    if(!data){res.writeHead(404);res.end();return;}
    res.writeHead(200,{'Content-Type':route==='/'?'text/html; charset=utf-8':'application/json','Content-Length':data.length,'Cache-Control':'no-store'});res.end(data);
  });
  let browser;
  try{
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    browser=await chromium.launch({headless:true,channel:'chromium'});
    const page=await browser.newPage(),origin='http://127.0.0.1:'+server.address().port;
    await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
    const checks=await probeDashboard(page,origin,{screenshotDirectory:options.screenshotDirectory});
    return [...checks,check('inputs_unchanged',inputsPreserved('C03',root))];
  }catch(error){if(error instanceof SubmissionError)throw error;throw Error('Dashboard probe infrastructure: '+error.message);}
  finally{if(browser)await browser.close();server.closeAllConnections();if(server.listening)await new Promise(resolve=>server.close(resolve));}
}
