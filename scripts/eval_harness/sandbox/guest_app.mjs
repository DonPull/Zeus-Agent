/** Launch the production desktop under the prepared standard-user token. */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {spawn,spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {trackChild} from './child_lifecycle.mjs';
const runtime='C:\\Zeus\\Runtime',workspace='C:\\Zeus\\CandidateScratch\\App';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function listen(server,port){await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});return server;}
function processProof(pid){
  if(!Number.isSafeInteger(pid)||pid<1)throw Error('Invalid owned process identity');
  const result=spawnSync('powershell.exe',['-NoProfile','-Command','$ErrorActionPreference="Stop"; try {$actorProcess=Get-Process -Id '+pid+'; @{pid=$actorProcess.Id;started_utc=$actorProcess.StartTime.ToUniversalTime().ToString("o")}|ConvertTo-Json -Compress} catch {if($_.FullyQualifiedErrorId -notlike "NoProcessFoundForGivenId*"){throw}}; exit 0'],{windowsHide:true,encoding:'utf8',timeout:10000});
  if(result.status!==0)throw Error('Cannot inspect owned guest process');return result.stdout.trim()?JSON.parse(result.stdout):null;
}
export async function launchGuestApp({limits,rpc,fixture=false}){
  if(process.env.USERNAME!=='WDAGUtilityAccount'||process.env.ZEUS_GUEST_ACTOR_LAUNCHER!=='C:\\Zeus\\GraderPrivate\\candidate-python.exe')throw Error('Prepared protected actor required');
  let app,lifecycle,browser,frontend,provider,portal,stderr='',stdout='',actorStart=null,proof=null,stopped=null;
  async function stop(){
    if(stopped)return stopped;
    if(browser){await browser.close().catch(()=>{});browser=null;}
    if(app&&!lifecycle.closed){app.kill();await lifecycle.wait(5000);}
    for(const server of [frontend,provider,portal])if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
    if(app&&!lifecycle.closed)throw Error('Owned guest launcher did not exit');
    const current=proof?processProof(proof.pid):null;
    if(proof&&current?.started_utc===proof.started_utc)throw Error('Owned guest app still running');
    stopped={app_process_gone:true,helper_closed:true,termination:lifecycle?.termination??null,process:proof};return stopped;
  }
  try{
    const frontendRoot=path.join(runtime,'frontend');
    frontend=await listen(http.createServer((req,res)=>{
      const relative=new URL(req.url,'http://fixture').pathname.slice(1)||'index.html',file=path.resolve(frontendRoot,relative);
      if(!file.startsWith(frontendRoot+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404).end();return;}
      const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.ttf':'font/ttf'}[path.extname(file)]??'application/octet-stream';
      res.writeHead(200,{'Content-Type':mime});fs.createReadStream(file).pipe(res);
    }),1420);
    provider=await listen(http.createServer(async(req,res)=>{
      try{
        const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>1024*1024)throw Error('Provider request too large');chunks.push(chunk);}
        const reply=await rpc('provider',req.method,req.url,Buffer.concat(chunks));res.writeHead(reply.status,{'Content-Type':reply.content_type});res.end(reply.body);
      }catch(error){res.writeHead(502,{'Content-Type':'application/json'});res.end(JSON.stringify({error:String(error.message).slice(0,500)}));}
    }),19221);
    if(fixture)portal=await listen(http.createServer(async(req,res)=>{
      try{
        const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>8192)throw Error('Fixture body too large');chunks.push(chunk);}
        const reply=await rpc('fixture',req.method,req.url,Buffer.concat(chunks));res.writeHead(reply.status,{'Content-Type':reply.content_type,...(reply.content_disposition?{'Content-Disposition':reply.content_disposition}:{})});res.end(reply.body);
      }catch(error){res.writeHead(502,{'Content-Type':'application/json'}).end(JSON.stringify({error:String(error.message).slice(0,500)}));}
    }),19222);
    fs.mkdirSync(workspace,{recursive:true});
    const env={...process.env,PATH:path.join(runtime,'browser/venv/Scripts')+';'+process.env.PATH,
      PLAYWRIGHT_BROWSERS_PATH:path.join(runtime,'browsers'),WEBVIEW2_BROWSER_EXECUTABLE_FOLDER:path.join(runtime,'webview'),
      WEBVIEW2_USER_DATA_FOLDER:path.join(workspace,'webview'),WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=19223 --disable-background-timer-throttling --disable-renderer-backgrounding',
      ZEUS_TEST_WORKSPACE_ROOT:workspace,ZEUS_TEST_HIDE_WINDOW:'1',ZEUS_TEST_LINK_OPENER:'1',ZEUS_BROWSER_WINDOW_MODE:'headless',
      ZEUS_API_BASE_URL:'http://127.0.0.1:19221',ZEUS_EVALUATION_LIMITS:JSON.stringify(limits)};
    for(const name of ['ZEUS_OFFLINE_TEST','ZEUS_EVAL_MODE','ZEUS_AUTO_ALLOW_COMMANDS','ZEUS_AUTO_ALLOW_NEW_FILES','ZEUS_UNLIMITED_BUDGET','ZEUS_UNLIMITED_ITERATIONS'])delete env[name];
    app=spawn(env.ZEUS_GUEST_ACTOR_LAUNCHER,['-I','-B','C:\\Zeus\\PublicTools\\actor_bootstrap.py'],{cwd:workspace,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
    lifecycle=trackChild(app);
    let startupError=null;app.once('error',error=>startupError=error);
    app.stderr.on('data',chunk=>stderr=(stderr+chunk).slice(-16000));
    app.stdout.on('data',chunk=>{stdout=(stdout+chunk).slice(-16000);if(!actorStart){const match=/^ZEUS_ACTOR_STARTED:(.+)$/m.exec(stdout);if(match)try{actorStart=JSON.parse(match[1]);}catch{}}});
    const {chromium}=await import(pathToFileURL(path.join(runtime,'node_modules/playwright-core/index.mjs')));
    const deadline=Date.now()+60000;
    while(!browser&&Date.now()<deadline){
      if(startupError||lifecycle.closed)throw Error('Actor startup failed: '+(startupError?.message??stderr));
      try{browser=await chromium.connectOverCDP('http://127.0.0.1:19223',{timeout:1000});}catch{await pause(150);}
    }
    if(!browser||actorStart?.username?.toLowerCase()!=='zeuscandidate'||actorStart.is_admin!==false||!Number.isSafeInteger(actorStart.pid))throw Error('Protected desktop startup not confirmed: '+stderr);
    proof=processProof(actorStart.pid);if(!proof)throw Error('Owned app process was not observed');
    const page=browser.contexts()[0].pages()[0];await page.locator('#app-container').waitFor({state:'visible',timeout:15000});
    return {page,workspace,actorStart,processEvidence:()=>structuredClone(proof),versions:{webview2:browser.version(),node:process.version},stop,diagnostics:()=>({stdout,stderr})};
  }catch(error){await stop();throw error;}
}
