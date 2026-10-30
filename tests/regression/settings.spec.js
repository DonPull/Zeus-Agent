import {test,expect} from '@playwright/test';
import {startMockServer,stopMockServer,launchTauri,stopTauri} from '../e2e/testUtils.js';

test.afterEach(async()=>{await stopTauri();await stopMockServer();});

test('global and task model dropdowns open, select and persist without blanking the application',async({},testInfo)=>{
    await startMockServer();const {page}=await launchTauri(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await expect(page.locator('#app-container')).toBeVisible();
    await page.locator('#sidebar-settings-button').click();
    for(const role of ['master','worker','verifier','watcher','vision']){
        await page.getByRole('combobox',{name:`${role} model`,exact:true}).click();
        await expect(page.getByRole('listbox',{name:`${role} models`,exact:true})).toBeVisible();
        await page.getByRole('listbox',{name:`${role} models`,exact:true}).getByRole('option',{name:'gpt-5-nano',exact:true}).click();
        await expect(page.getByRole('combobox',{name:`${role} model`,exact:true})).toContainText('gpt-5-nano');
    }
    await page.locator('#global-save-settings-button').click();
    await expect.poll(()=>page.evaluate(async()=> (await window.__ZEUS_BRIDGE__.getSettings()).master_model)).toBe('gpt-5-nano');
    await page.reload();await page.locator('#sidebar-settings-button').click();
    for(const role of ['master','worker','verifier','watcher','vision'])await expect(page.getByRole('combobox',{name:`${role} model`,exact:true})).toContainText('gpt-5-nano');
    await page.setViewportSize({width:1000,height:760});
    await page.screenshot({path:testInfo.outputPath('global-model-settings.png')});
    await page.getByRole('combobox',{name:'master model',exact:true}).click();
    await page.screenshot({path:testInfo.outputPath('global-model-dropdown.png')});
    await page.keyboard.press('Escape');await expect(page.locator('#settings-modal-content')).toHaveCount(0);
    const task=await page.evaluate(async()=>{const task=await window.__ZEUS_BRIDGE__.createTask('Settings regression');await window.__ZEUS_REFRESH_TASKS__?.();return task;});
    await page.locator('.sidebar-task').filter({has:page.locator('.sidebar-task-title[title="Settings regression"]')}).click();
    await page.locator('#chat-task-settings-button').click();
    for(const role of ['master','worker','verifier','watcher','vision']){
        await page.getByRole('combobox',{name:`${role} model`,exact:true}).click();
        await page.getByRole('listbox',{name:`${role} models`,exact:true}).getByRole('option',{name:'phase1-mock',exact:true}).click();
    }
    await page.locator('#task-save-settings-button').click();
    await expect.poll(()=>page.evaluate(async id=>(await window.__ZEUS_BRIDGE__.listTasks()).find(task=>task.id===id).master_model,task.id)).toBe('phase1-mock');
    await page.locator('#chat-task-settings-button').click();
    for(const role of ['master','worker','verifier','watcher','vision'])await expect(page.getByRole('combobox',{name:`${role} model`,exact:true})).toContainText('phase1-mock');
    await expect(page.locator('#app-container')).toBeVisible();expect(errors).toEqual([]);
});

test('a recoverable panel render failure leaves the main application visible',async()=>{
    await startMockServer();const {page}=await launchTauri(false,{expectedPageErrors:['controlled-render-test']});await expect(page.locator('#app-container')).toBeVisible();
    await page.evaluate(async()=>{
        const React=(await import('/node_modules/.vite/deps/react.js')).default;
        const ReactDOM=(await import('/node_modules/.vite/deps/react-dom_client.js')).default;
        const {default:Boundary}=await import('/src/components/UiErrorBoundary.jsx');
        const target=document.createElement('div');target.id='controlled-error-fixture';document.body.append(target);
        const root=ReactDOM.createRoot(target);
        function Broken(){throw new Error('controlled-render-test');}
        root.render(React.createElement(Boundary,{onRecover:()=>{root.unmount();target.remove();}},React.createElement(Broken)));
    });
    await expect(page.locator('#controlled-error-fixture')).toContainText('Zeus encountered a display error');
    await expect(page.locator('#app-container')).toBeVisible();
    await page.getByRole('button',{name:'Close panel',exact:true}).click();
    await expect(page.locator('#controlled-error-fixture')).toHaveCount(0);await expect(page.locator('#sidebar-settings-button')).toBeVisible();
});
