/** Trusted synthetic guest-only control. No paid inference or host paths. */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';

const control=path.dirname(fileURLToPath(import.meta.url));
const root='C:\\Zeus\\Runtime';
const protectedActor=process.env.ZEUS_GUEST_ACTOR_LAUNCHER;
const reportFile=protectedActor?'C:\\Zeus\\GraderPrivate\\actor-runtime.json':'C:\\Zeus\\runtime-report.json';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
if(process.env.USERNAME!=='WDAGUtilityAccount'||control!=='C:\\Zeus\\Input')throw Error('Run this control only from the readonly disposable guest input');
let app,browser,frontend,provider,fixture,stderr='',stdout='',providerRequests=0,fixtureRequests=0;
const result={kind:'scripted-guest-runtime-control',status:'failed',provider_inference_requests:0,physical_input:false};
const deadline=Date.now()+90000;
const job=JSON.parse(fs.readFileSync(path.join(control,'job.json'),'utf8'));
const watchdog=setTimeout(()=>{fs.writeFileSync(reportFile,JSON.stringify({...result,error:'Guest runtime deadline expired'}));process.exit(1);},95000);
function assert(condition,message){if(!condition)throw Error(message);}
async function listen(server,port){await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});return server;}
try{
  if(protectedActor&&protectedActor!=='C:\\Zeus\\GraderPrivate\\candidate-python.exe')throw Error('Unexpected actor launcher');
  if(job.runtime_smoke.deny_test){
    // Deliberately bypass the client validator to test the actual host boundary.
    fs.writeFileSync('C:\\Zeus\\Output\\rpc-request-000001.json',JSON.stringify({schema_version:1,nonce:job.nonce,id:1,channel:'provider',method:'POST',path:'https://example.invalid/',body_base64:''}),{flag:'wx'});
    await pause(5000);throw Error('Deliberate invalid-route control must not pass');
  }
  let rpc=null;
  if(job.runtime_smoke.transport==='synthetic-file-v1'){
    const {createFileClient}=await import('./file_rpc.mjs');
    const client=job.runtime_smoke.fixture_mission?(await import('./mission_rpc.mjs')).createMissionFileClient:createFileClient;
    const read=(folder,name,limit)=>{
      const file=path.join(folder,name),stat=fs.lstatSync(file);
      if(!stat.isFile()||stat.isSymbolicLink()||stat.size>limit)throw Error('Invalid readonly response');
      const bytes=fs.readFileSync(file);if(bytes.length>limit)throw Error('Oversized readonly response');return bytes;
    };
    rpc=client({input:control,output:'C:\\Zeus\\Output',nonce:job.nonce,read,mission:job.runtime_smoke.fixture_mission});
  }
  const forward=async(channel,req,res)=>{
    try{
      const chunks=[];let length=0;
      for await(const chunk of req){length+=chunk.length;if(length>1024*1024)throw Error('Loopback request exceeds its allowance');chunks.push(chunk);}
      const response=await rpc(channel,req.method,req.url,Buffer.concat(chunks));
      res.writeHead(response.status,{'Content-Type':response.content_type,...(response.content_disposition?{'Content-Disposition':response.content_disposition}:{})});res.end(response.body);
    }catch(error){res.writeHead(502,{'Content-Type':'application/json'});res.end(JSON.stringify({error:String(error.message).slice(0,500)}));}
  };
  result.python_imports=execFileSync(path.join(root,'browser/venv/Scripts/python.exe'),['-I','-c','import sys, asyncio, greenlet, pyee; from playwright.async_api import async_playwright; print(sys.version); print("Browser dependencies imported")'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],windowsHide:true,timeout:10000}).trim();
  const {chromium}=await import(pathToFileURL(path.join(root,'node_modules/playwright-core/index.mjs')));
  const frontendRoot=path.join(root,'frontend');
  frontend=await listen(http.createServer((req,res)=>{
    const name=new URL(req.url,'http://fixture').pathname;
    const relative=name==='/'?'index.html':name.slice(1);
    const file=path.resolve(frontendRoot,relative);
    if(!file.startsWith(frontendRoot+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404).end();return;}
    const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.ttf':'font/ttf'}[path.extname(file)]??'application/octet-stream';
    res.writeHead(200,{'Content-Type':mime});fs.createReadStream(file).pipe(res);
  }),1420);
  fixture=await listen(http.createServer((req,res)=>{
    if(rpc&&job.runtime_smoke.fixture_mission){fixtureRequests++;void forward('fixture',req,res);return;}
    if(req.url!=='/'){res.writeHead(404).end();return;}fixtureRequests++;
    if(rpc){void forward('fixture',req,res);return;}
    res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><title>Runtime fixture</title><main><h1>Managed browser is working</h1></main>');
  }),19222);
  const code='import json\nfrom zeus_browser import call\n'+(protectedActor?'from pathlib import Path\nPath("actor-output.txt").write_bytes(Path("actor-input.txt").read_bytes())\n':'')+'print(json.dumps(call("navigate",url="http://127.0.0.1:19222/")))';
  const replies=[{type:'run_action',action:{language:'python',code,timeout_secs:30},success_criteria:'Inspect the synthetic local browser fixture.'},
    {type:'final_answer',final_answer:{summary:'Synthetic isolated runtime control completed.'}}];
  provider=await listen(http.createServer(async(req,res)=>{
    if(rpc){providerRequests++;await forward('provider',req,res);return;}
    if(req.method==='GET'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({data:[{id:'phase1-mock'}]}));return;}
    let length=0;for await(const chunk of req){length+=chunk.length;if(length>1024*1024){res.writeHead(413).end();return;}}
    const reply=replies[providerRequests++];
    if(!reply){res.writeHead(429).end();return;}
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    res.end('data: '+JSON.stringify({choices:[{delta:{content:'```zeus-directive\n'+JSON.stringify(reply)+'\n```'}}],usage:{prompt_tokens:5,completion_tokens:5,total_tokens:10}})+'\n\ndata: [DONE]\n\n');
  }),19221);
  const workspace=protectedActor?'C:\\Zeus\\CandidateScratch\\App':'C:\\Zeus\\ActorSmoke';
  const env={...process.env,PATH:path.join(root,'browser/venv/Scripts')+';'+process.env.PATH,
    PLAYWRIGHT_BROWSERS_PATH:path.join(root,'browsers'),WEBVIEW2_BROWSER_EXECUTABLE_FOLDER:path.join(root,'webview'),
    WEBVIEW2_USER_DATA_FOLDER:path.join(workspace,'webview'),WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=19223 --disable-background-timer-throttling --disable-renderer-backgrounding',
    ZEUS_TEST_WORKSPACE_ROOT:workspace,ZEUS_TEST_HIDE_WINDOW:'1',ZEUS_TEST_LINK_OPENER:'1',ZEUS_BROWSER_WINDOW_MODE:'headless',
    ZEUS_API_BASE_URL:'http://127.0.0.1:19221',ZEUS_OFFLINE_TEST:'1',
    ZEUS_EVALUATION_LIMITS:JSON.stringify({max_requests:4,max_tokens:100000,max_output_tokens:4096,max_in_flight:1,max_directives:6,wall_time_ms:60000})};
  for(const key of ['ZEUS_EVAL_MODE','ZEUS_AUTO_ALLOW_COMMANDS','ZEUS_AUTO_ALLOW_NEW_FILES','ZEUS_UNLIMITED_BUDGET','ZEUS_UNLIMITED_ITERATIONS'])delete env[key];
  fs.mkdirSync(workspace,{recursive:true});
  app=spawn(protectedActor??path.join(root,'app/zeus-evaluation.exe'),protectedActor?['-I','-B','C:\\Zeus\\PublicTools\\actor_bootstrap.py']:[],{cwd:workspace,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  app.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-16000);});
  app.stdout.on('data',chunk=>{stdout=(stdout+chunk).slice(-16000);
    if(protectedActor&&!result.actor_start){const match=/^ZEUS_ACTOR_STARTED:(.+)$/m.exec(stdout);if(match)try{result.actor_start=JSON.parse(match[1]);}catch{}}
  });
  let startupError=null;app.on('error',error=>{startupError=error;});
  const startupStarted=Date.now();
  while(Date.now()<deadline&&!browser){
    if(startupError)throw startupError;
    if(app.exitCode!==null)throw Error('Zeus exited during startup: '+app.exitCode+' '+stderr);
    try{browser=await chromium.connectOverCDP('http://127.0.0.1:19223',{timeout:1000});}
    catch(error){result.last_control_error=String(error.message).slice(-4000);await pause(200);}
    if(!browser&&!result.startup_diagnostics&&Date.now()-startupStarted>30000){
      try{result.startup_diagnostics=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','RemoteSigned','-File',path.join(control,'guest_diagnostics.ps1')],{env:{...env,ZEUS_RUNTIME_ACTOR_PID:String(app.pid)},encoding:'utf8',windowsHide:true,timeout:10000}));}
      catch(error){result.startup_diagnostics={error:String(error.message).slice(-2000)};}
      try{const response=await fetch('http://127.0.0.1:19223/json/version',{signal:AbortSignal.timeout(1500)});result.control_http={status:response.status,body:(await response.text()).slice(0,3000)};}
      catch(error){result.control_http={error:String(error.cause??error.message)};}
      try{result.frontend_http_status=(await fetch('http://127.0.0.1:1420/',{signal:AbortSignal.timeout(1500)})).status;}catch(error){result.frontend_http_status=String(error.message);}
    }
  }
  assert(browser,'WebView2 did not expose the guest control connection');
  if(protectedActor)assert(result.actor_start?.username?.toLowerCase()==='zeuscandidate'&&result.actor_start.is_admin===false&&Number.isSafeInteger(result.actor_start.pid)&&result.actor_start.pid>0,'Actual non-admin actor startup was not confirmed');
  result.webview2_version=browser.version();
  result.node_version=process.version;
  result.python_version=execFileSync(path.join(root,'browser/venv/Scripts/python.exe'),['-I','-c','import sys; print(sys.version.split()[0])'],{encoding:'utf8',windowsHide:true}).trim();
  const page=browser.contexts()[0].pages()[0];assert(page,'Missing application page');
  await page.locator('#app-container').waitFor({state:'visible',timeout:15000});
  const task=await page.evaluate(async python=>{
    const bridge=window.__ZEUS_BRIDGE__,settings=await bridge.getSettings();
    await bridge.saveSettings({...settings,browser_python_path:python,browser_block_ads:true,browser_agent_audio:false,watcher_model:'None'});
    const task=await bridge.createTask('Isolated runtime smoke');
    await bridge.updateTaskSettings(task.id,{master_model:'phase1-mock',worker_model:'None',verifier_model:'None',watcher_model:'None',vision_model:'None',budget_credits:100000,model_bindings:{}});
    return task;
  },path.join(root,'browser/venv/Scripts/python.exe'));
  if(protectedActor){
    assert(/^[a-f0-9-]{36}$/.test(task.id),'Invalid owned task identity');
    result.actor_workspace=path.join(workspace,'tasks',task.id,'workspace');
    fs.mkdirSync(result.actor_workspace,{recursive:true});
    fs.copyFileSync(path.join(control,'challenge.txt'),path.join(result.actor_workspace,'actor-input.txt'));
  }
  let settled=false,error=null;
  const sent=page.evaluate(id=>window.__ZEUS_BRIDGE__.sendUserMessage(id,'Open and inspect the supplied synthetic local browser fixture.',crypto.randomUUID()),task.id)
    .catch(reason=>{error=String(reason);}).finally(()=>{settled=true;});
  const approved=new Set();
  while(!settled&&Date.now()<deadline){
    const messages=await page.evaluate(id=>window.__ZEUS_BRIDGE__.getTaskDebugMessages(id),task.id);
    for(const message of messages.filter(m=>m.kind==='approval')){
      const body=JSON.parse(message.content);if(body.status!=='pending'||approved.has(message.id))continue;
      const directive=body.blocked_directive;
      assert(directive?.type==='run_action'&&hash(directive.action.code)===hash(code),'Unexpected permission request in synthetic control');
      approved.add(message.id);
      await page.evaluate(({task,id})=>window.__ZEUS_BRIDGE__.resolvePendingApprovals(task,true,id,'Exact declared synthetic guest control.'),{task:task.id,id:message.id});
    }
    await pause(50);
  }
  assert(settled,'Synthetic app run did not finish before its deadline');await sent;assert(!error,error);
  const observed=await page.evaluate(async id=>({run:await window.__ZEUS_BRIDGE__.getTaskRunState(id),spend:await window.__ZEUS_BRIDGE__.getTaskSpend(id),sessions:await window.__ZEUS_BRIDGE__.getManagedBrowserSessions(id)}),task.id);
  result.observed=observed;
  const messages=await page.evaluate(id=>window.__ZEUS_BRIDGE__.getTaskDebugMessages(id),task.id);
  result.messages=messages.slice(-8).map(({role,kind,content})=>({role,kind,content:content.slice(-2000)}));
  assert(observed.run?.status==='completed','The real app run did not complete');
  assert(observed.sessions.length===1&&observed.sessions[0].status==='completed','Managed browser session did not complete');
  assert(observed.sessions[0].runtime?.cleanup?.owned_processes_remaining===0,'Managed browser cleanup did not confirm zero owned processes');
  const action=messages.filter(message=>message.kind==='action').map(message=>JSON.parse(message.content)).find(value=>value.code===code);
  assert(action?.exit_code===0&&fixtureRequests>0,'The declared Python browser action did not reach its fixture');
  const navigation=JSON.parse(action.stdout.trim());
  assert(navigation.url==='http://127.0.0.1:19222/'&&navigation.http_status===200,'Navigation did not confirm the exact local fixture');
  assert(observed.spend.usage.requests===2&&observed.spend.usage.unknown_requests===0&&providerRequests===2,'Scripted request accounting mismatch');
  result.status='passed';result.mock_requests=providerRequests;result.approvals=approved.size;
  result.navigation={url:navigation.url,http_status:navigation.http_status};result.fixture_requests=fixtureRequests;
  result.browser_runtime=observed.sessions[0].runtime;result.usage=observed.spend.usage;
}catch(error){result.error=String(error.stack??error).slice(-16000);}
finally{
  if(browser)await browser.close().catch(()=>{});
  if(app?.exitCode===null)app.kill();
  for(const server of [frontend,provider,fixture])if(server){server.closeAllConnections();server.close();}
  clearTimeout(watchdog);result.stderr=stderr;result.stdout=stdout;
  fs.writeFileSync(reportFile,JSON.stringify(result));
}
process.exitCode=result.status==='passed'?0:1;
