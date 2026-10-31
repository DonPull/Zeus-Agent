import {test,expect} from '@playwright/test';
import http from 'node:http';
import {startMockServer,stopMockServer,launchTauri,stopTauri,queueMockResponse} from '../e2e/testUtils.js';

const reply=value=>({choices:[{delta:{content:'```zeus-directive\n'+JSON.stringify(value)+'\n```'}}],usage:{prompt_tokens:5,completion_tokens:5,total_tokens:10}});
test('replay keeps decoded images and stable geometry across mixed actions, delayed decoding and arbitrary speeds',async({},info)=>{
    const server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end('<body style="background:#e8f5ff"><h1>Replay acceptance</h1><label>Note<input id="note"></label><button onclick="document.body.style.background=\'#fff1dc\'">Save</button></body>');});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    try{
        await startMockServer();const app=await launchTauri(false,{managedBrowser:true});const page=app.page;
        await expect(page.locator('#app-container')).toBeVisible();await page.setViewportSize({width:1320,height:960});
        const task=await page.evaluate(async()=>{
            const settings=await window.__ZEUS_BRIDGE__.getSettings();await window.__ZEUS_BRIDGE__.saveSettings({...settings,watcher_model:'phase1-mock',model_bindings:{}});
            const task=await window.__ZEUS_BRIDGE__.createTask('Replay polish');await window.__ZEUS_BRIDGE__.updateTaskSettings(task.id,{master_model:'phase1-mock',worker_model:'None',verifier_model:'None',watcher_model:'None',vision_model:'None',budget_credits:1000000,model_bindings:{}});return task;
        });
        const url=`http://127.0.0.1:${server.address().port}/`;
        for(const command of [
            {op:'navigate',params:{url}},
            {op:'fill',params:{target:{css:'#note'},value:'Preserved note'}},
            {op:'observe',params:{}},
            {op:'click',params:{target:{text:'Save'}}},
            {op:'navigate',params:{url:url+'long-page-address-'.repeat(80)}},
            {op:'press',params:{target:{css:'#note'},key:'ArrowRight'}},
        ])queueMockResponse(reply({type:'browser_action',...command}));
        queueMockResponse(reply({type:'final_answer',final_answer:{summary:'The controlled browser sequence completed.'}}));
        await page.evaluate(id=>window.__ZEUS_BRIDGE__.sendUserMessage(id,'Exercise the controlled replay sequence.',crypto.randomUUID()),task.id);
        await page.evaluate(()=>window.__ZEUS_REFRESH_TASKS__?.());await page.locator('.sidebar-task').filter({has:page.locator('.sidebar-task-title[title="Replay polish"]')}).click();
        await page.getByRole('button',{name:'Replay',exact:true}).click();
        const modal=page.locator('.replay-modal-window'),image=modal.locator('#replay-screenshot-img'),viewport=modal.locator('.browser-viewer-viewport');
        await expect.poll(()=>image.evaluate(img=>img.naturalWidth)).toBe(1280);
        await modal.evaluate(el=>Promise.all(el.getAnimations().map(animation=>animation.finished)));
        const baseline=await viewport.boundingBox();
        const stable=async()=>{const current=await viewport.boundingBox();expect(Math.abs(current.y-baseline.y)).toBeLessThan(1);expect(Math.abs(current.height-baseline.height)).toBeLessThan(1);};
        const seek=async seq=>{await modal.getByRole('button',{name:new RegExp(`^Action ${seq}:`)}).click();await expect(modal.locator('.replay-position')).toHaveText(`Action ${seq} of 6`);};
        const loaded=async seq=>{await expect.poll(()=>image.getAttribute('data-action-seq')).toBe(String(seq));await expect(modal.locator('.browser-image-progress')).toHaveCount(0);};
        await page.evaluate(()=>{
            // Real native reads and real decoding still run. Hold the decoded
            // candidate to reproduce a slow consumer without changing backend policy.
            const Image=window.Image;
            window.__HELD_REPLAY_READS__=[];window.__HOLD_REPLAY_IMAGES__=false;
            window.Image=function(...args){const image=new Image(...args),decode=image.decode.bind(image);image.decode=async()=>{await decode();if(window.__HOLD_REPLAY_IMAGES__)await new Promise(resolve=>window.__HELD_REPLAY_READS__.push(resolve));};return image;};
            window.__RELEASE_REPLAY_READS__=()=>{window.__HOLD_REPLAY_IMAGES__=false;window.__HELD_REPLAY_READS__.splice(0).forEach(resolve=>resolve());};
            window.__REPLAY_GAPS__=0;
            window.__REPLAY_IMAGE_OBSERVER__=new MutationObserver(()=>{const img=document.querySelector('#replay-screenshot-img');if(!img||!img.getAttribute('src'))window.__REPLAY_GAPS__++;});
            window.__REPLAY_IMAGE_OBSERVER__.observe(document.querySelector('.browser-viewer-viewport'),{childList:true,subtree:true,attributes:true,attributeFilter:['src']});
        });
        const before=await image.getAttribute('src');await page.evaluate(()=>window.__HOLD_REPLAY_IMAGES__=true);await seek(2);
        await expect.poll(()=>page.evaluate(()=>window.__HELD_REPLAY_READS__.length)).toBe(1);
        await expect(image).toHaveAttribute('src',before);await expect(modal.locator('.browser-image-progress')).toContainText('Previous image shown');await stable();
        await page.screenshot({path:info.outputPath('retained-image-while-loading.png')});
        await page.evaluate(()=>window.__RELEASE_REPLAY_READS__());await loaded(2);await stable();
        expect(await page.evaluate(()=>{window.__REPLAY_IMAGE_OBSERVER__.disconnect();return window.__REPLAY_GAPS__;})).toBe(0);
        // Obsolete decodes must not replace the final selection after a rapid seek.
        await page.evaluate(()=>window.__HOLD_REPLAY_IMAGES__=true);await seek(5);
        await expect.poll(()=>page.evaluate(()=>window.__HELD_REPLAY_READS__.length)).toBe(1);await seek(6);
        await page.evaluate(()=>window.__RELEASE_REPLAY_READS__());await loaded(6);await stable();
        for(const seq of [1,2,3,4,5,6]){
            await seek(seq);
            if(seq===3){await expect(image).toHaveCount(0);await expect(viewport).toContainText('No image retained');await expect(modal.getByRole('combobox',{name:'Action image timing'})).toBeDisabled();}
            else await loaded(seq);
            await stable();
        }
        await modal.locator('summary').filter({hasText:'Action details'}).click();
        const expanded=await viewport.boundingBox();
        for(const seq of [2,5,6]){await seek(seq);await loaded(seq);const box=await viewport.boundingBox();expect(box.y).toBe(expanded.y);expect(box.height).toBe(expanded.height);}
        await modal.locator('summary').filter({hasText:'Action details'}).click();await stable();
        const speed=modal.getByRole('spinbutton',{name:'Replay speed'});
        await speed.fill('0.44');await speed.blur();await expect(speed).toHaveValue('0.4');
        for(const value of ['0','-2','']){await speed.fill(value);await speed.blur();await expect(speed).toHaveValue('0.4');}
        await speed.fill('25.6');await speed.blur();await expect(speed).toHaveValue('25.6');
        await speed.fill('4');await speed.blur();await seek(4);
        await page.evaluate(()=>{window.__REPLAY_GAPS__=0;window.__REPLAY_IMAGE_OBSERVER__.observe(document.querySelector('.browser-viewer-viewport'),{childList:true,subtree:true,attributes:true,attributeFilter:['src']});window.__HOLD_REPLAY_IMAGES__=true;});
        await modal.getByRole('button',{name:'Play replay',exact:true}).click();
        await expect.poll(()=>page.evaluate(()=>window.__HELD_REPLAY_READS__.length)).toBe(1);await expect(image).toBeVisible();
        await page.evaluate(()=>window.__RELEASE_REPLAY_READS__());await loaded(6);await expect(modal.getByRole('button',{name:'Play replay',exact:true})).toBeVisible();
        expect(await page.evaluate(()=>{window.__REPLAY_IMAGE_OBSERVER__.disconnect();return window.__REPLAY_GAPS__;})).toBe(0);
        await page.screenshot({path:info.outputPath('replay-mixed-actions-1320.png')});
        await page.setViewportSize({width:1000,height:760});await page.screenshot({path:info.outputPath('replay-mixed-actions-1000.png')});
        // The fixed counter must be centered between the adjacent -1/+1 controls.
        const left=await modal.locator('#replay-prev-button').boundingBox(),right=await modal.locator('#replay-next-button').boundingBox(),counter=await modal.locator('.replay-position').boundingBox();
        expect(Math.abs(counter.x+counter.width/2-(left.x+left.width+right.x)/2)).toBeLessThan(1);
        const close=modal.getByRole('button',{name:'Close browser viewer'}),full=modal.getByRole('button',{name:'Full screen',exact:true});
        const closeBox=await close.boundingBox(),fullBox=await full.boundingBox(),iconBox=await close.locator('svg').boundingBox();
        expect(fullBox.x).toBeLessThan(closeBox.x);expect(fullBox.height).toBe(closeBox.height);expect(Math.abs(iconBox.x+iconBox.width/2-closeBox.x-closeBox.width/2)).toBeLessThan(1);expect(Math.abs(iconBox.y+iconBox.height/2-closeBox.y-closeBox.height/2)).toBeLessThan(1);
        await page.setViewportSize({width:3200,height:2100});
        for(const factor of ['1','1.5','2']){
            await modal.getByRole('combobox',{name:'Browser image size'}).selectOption(factor);
            await expect.poll(()=>image.evaluate(img=>img.clientWidth)).toBe(1280*Number(factor));
            await expect.poll(async()=>{const a=await image.boundingBox(),b=await viewport.boundingBox();return Math.max(Math.abs(a.x+a.width/2-b.x-b.width/2),Math.abs(a.y+a.height/2-b.y-b.height/2));}).toBeLessThan(2);
        }
        await page.setViewportSize({width:1000,height:760});
        await expect.poll(()=>viewport.evaluate(el=>el.scrollWidth>el.clientWidth&&el.scrollHeight>el.clientHeight)).toBe(true);
        const oversized=await image.boundingBox(),pane=await viewport.boundingBox();expect(oversized.x).toBeGreaterThanOrEqual(pane.x);expect(oversized.y).toBeGreaterThanOrEqual(pane.y);
        await close.click();await expect(modal).toHaveCount(0);
    }finally{await stopTauri();await stopMockServer();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
