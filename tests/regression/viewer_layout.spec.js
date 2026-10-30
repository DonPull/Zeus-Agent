import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {startMockServer,stopMockServer,launchTauri,stopTauri,getMockRequests} from '../e2e/testUtils.js';

test.afterEach(async()=>{await stopTauri();await stopMockServer();});

test('live and replay viewers use the available window and resize actual images without clipping',async({},testInfo)=>{
    await startMockServer();const {page,workspace}=await launchTauri();
    await expect(page.locator('#app-container')).toBeVisible();
    await page.setViewportSize({width:1920,height:1080});
    // Controller-created display fixture, not evidence of agent execution/capture.
    await page.evaluate(()=>{
        const source=document.createElement('div');source.id='viewer-source';
        Object.assign(source.style,{position:'fixed',left:'0',top:'0',width:'1280px',height:'720px',zIndex:1000,boxSizing:'border-box',background:'#f5f8fc',color:'#123',padding:'40px',font:'24px Arial'});
        source.innerHTML='<h1>Service desk — readable browser view</h1><p>Customer C-204 · Offline printer</p><section style="padding:30px;border:2px solid #369;background:white">Priority: High<br><br>Call after 16:00 Sofia time.</section><p>Saved successfully</p>';
        document.body.append(source);
    });
    const image=await page.locator('#viewer-source').screenshot();
    await page.locator('#viewer-source').evaluate(element=>element.remove());
    const task=await page.evaluate(()=>window.__ZEUS_BRIDGE__.createTask('Viewer size regression'));
    const session=`sess_${crypto.randomUUID()}`,directory=path.join(workspace,'.zeus/browser_history',task.id,session);
    fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,'screen.png'),image);
    fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify({session_id:session,task_id:task.id,started_at:Date.now(),completed_at:null,duration_ms:null,final_url:'https://example.test/',total_steps:1,
        steps:[{step:1,action:'observe',target:null,value:null,url:'https://example.test/',timestamp:Date.now(),bounding_box:{x:40,y:40,width:200,height:40},screenshot_path:'screen.png'}]}));
    for(const kind of ['live','replay']){
        await page.evaluate(async({kind,taskId,sessionId})=>{
            const React=(await import('/node_modules/.vite/deps/react.js')).default;
            const ReactDOM=(await import('/node_modules/.vite/deps/react-dom_client.js')).default;
            const {default:Viewer}=await import(kind==='live'?'/src/components/BrowserLiveViewModal.jsx':'/src/components/BrowserSessionReplayModal.jsx');
            const host=document.createElement('div');host.id='viewer-layout-host';document.body.append(host);
            const root=ReactDOM.createRoot(host);
            function Harness(){
                const [isOpen,setOpen]=React.useState(false);
                React.useEffect(()=>{window.__OPEN_LAYOUT_VIEWER__=()=>setOpen(true);return()=>{delete window.__OPEN_LAYOUT_VIEWER__;};},[]);
                return React.createElement(Viewer,{isOpen,taskId,sessionId,onClose:()=>{root.unmount();host.remove();}});
            }
            root.render(React.createElement(Harness));
        },{kind,taskId:task.id,sessionId:session});
        await page.waitForFunction(()=>typeof window.__OPEN_LAYOUT_VIEWER__==='function');
        await page.evaluate(()=>window.__OPEN_LAYOUT_VIEWER__());
        const modal=page.locator(`.modal-container.${kind}-modal-window`),image=modal.locator('img'),stage=modal.locator(`.${kind}-viewport-wrapper`);
        await expect(modal).toBeVisible();
        await expect.poll(()=>image.evaluate(element=>element.naturalWidth)).toBe(1280);
        for(const size of [{width:1920,height:1080},{width:1320,height:840},{width:1000,height:760}]){
            await page.setViewportSize(size);
            await expect.poll(async()=>Math.round((await modal.boundingBox()).width)).toBe(size.width-32);
            await expect.poll(async()=>{
                const frame=await image.boundingBox(),viewport=await stage.boundingBox();
                return frame.width>0&&frame.height>0&&frame.x>=viewport.x&&frame.y>=viewport.y&&frame.x+frame.width<=viewport.x+viewport.width+1&&frame.y+frame.height<=viewport.y+viewport.height+1;
            }).toBe(true);
            const box=await modal.boundingBox(),frame=await image.boundingBox(),viewport=await stage.boundingBox();
            expect(box.height).toBeGreaterThan(size.height*0.9);
            expect(box.x).toBeGreaterThanOrEqual(0);expect(box.y).toBeGreaterThanOrEqual(0);
            expect(box.x+box.width).toBeLessThanOrEqual(size.width);expect(box.y+box.height).toBeLessThanOrEqual(size.height);
            expect(Math.max(frame.width/viewport.width,frame.height/viewport.height)).toBeGreaterThan(0.9);
            expect(frame.width/frame.height).toBeCloseTo(1280/720,2);
            await expect.poll(async()=>{
                const actual=await modal.locator('.replay-bounding-box').boundingBox(),current=await image.boundingBox();
                return Math.max(Math.abs(actual.x-current.x-40*current.width/1280),Math.abs(actual.y-current.y-40*current.height/720),Math.abs(actual.width-200*current.width/1280));
            }).toBeLessThanOrEqual(2);
            const close=modal.locator(`#${kind}-modal-close-button`),closeBox=await close.boundingBox();
            expect(closeBox.x+closeBox.width).toBeLessThanOrEqual(size.width);
            await page.screenshot({path:testInfo.outputPath(`${kind}-${size.width}.png`)});
        }
        await modal.locator(`#${kind}-modal-close-button`).click();
        await expect(modal).toHaveCount(0);
    }
    expect(getMockRequests()).toEqual([]);
});
