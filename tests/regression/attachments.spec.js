import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import {startMockServer,stopMockServer,launchTauri,stopTauri,queueMockResponse,getMockRequests} from '../e2e/testUtils.js';

const images=['7f91c2a0.png','a42d6e83.png'].map(name=>fs.readFileSync(path.resolve('tests/benchmarks/missions/v1/V01/inputs',name)));
const limits={max_requests:12,max_tokens:1000000,max_in_flight:1,max_output_tokens:4096,max_directives:12,wall_time_ms:120000};
const reply=(content,extra={})=>({choices:[{delta:{content}}],usage:{prompt_tokens:5,completion_tokens:5,total_tokens:10},...extra});
const finish=()=>reply('```zeus-directive\n'+JSON.stringify({type:'final_answer',final_answer:{summary:'Controlled image answer'}})+'\n```');
async function fixture(settings={},evaluationLimits=limits,transport={},runtime={}){
    await startMockServer(transport);const app=await launchTauri(false,{evaluationLimits,...runtime});
    await expect(app.page.locator('#app-container')).toBeVisible();
    const task=await app.page.evaluate(()=>window.__ZEUS_BRIDGE__.createTask('Image regression'));
    await app.page.evaluate(({id,settings})=>window.__ZEUS_BRIDGE__.updateTaskSettings(id,{
        master_model:'gpt-5-nano',worker_model:'None',verifier_model:'None',watcher_model:'None',vision_model:'None',budget_credits:1000000,...settings,
    }),{id:task.id,settings});
    const upload=(bytes=images[0],name='screenshot.png')=>app.page.evaluate(({id,data,name})=>window.__ZEUS_BRIDGE__.saveTaskAttachment(id,name,data),{id:task.id,data:bytes.toString('base64'),name});
    const send=(files,prompt='Describe the supplied images inline.',requestId=crypto.randomUUID())=>app.page.evaluate(({id,ids,prompt,requestId})=>window.__ZEUS_BRIDGE__.sendUserMessage(id,prompt,requestId,ids),{id:task.id,ids:files.map(file=>file.id),prompt,requestId});
    const messages=()=>app.page.evaluate(id=>window.__ZEUS_BRIDGE__.getTaskMessages(id,true),task.id);
    const spend=()=>app.page.evaluate(id=>window.__ZEUS_BRIDGE__.getTaskSpend(id),task.id);
    const select=async()=>{
        await app.page.evaluate(async()=>window.__ZEUS_REFRESH_TASKS__?.());
        await app.page.locator('.sidebar-task').filter({has:app.page.locator('.sidebar-task-title[title="Image regression"]')}).click();
    };
    return {...app,task,upload,send,messages,spend,select};
}
test.afterEach(async()=>{await stopTauri();await stopMockServer();});

test('same-name uploads retain distinct bytes and both reach Responses input',async()=>{
    const app=await fixture();const files=[await app.upload(),await app.upload(images[1])];
    expect(files[0].id).not.toBe(files[1].id);expect(files[0].storage_key).not.toBe(files[1].storage_key);expect(files[0].sha256).not.toBe(files[1].sha256);
    for(let index=0;index<2;index++)expect(fs.readFileSync(path.join(app.workspace,'tasks',app.task.id,'workspace',files[index].storage_key))).toEqual(images[index]);
    queueMockResponse(finish());await app.send(files);
    const request=getMockRequests()[0];expect(request.url).toContain('/responses');
    const parts=request.body.input.flatMap(message=>Array.isArray(message.content)?message.content:[]).filter(part=>part.type==='input_image');
    expect(parts.map(part=>part.image_url)).toEqual(images.map(bytes=>'data:image/png;base64,'+bytes.toString('base64')));
    const user=(await app.messages()).find(message=>message.role==='user'&&message.kind==='chat');
    expect(user.attachments.map(file=>file.id)).toEqual(files.map(file=>file.id));
    expect(user.attachments.every(file=>file.last_delivery.state==='succeeded')).toBe(true);
    expect(user.content).not.toContain('base64');expect((await app.spend()).usage.requests_by_connection).toEqual({abacus:1});
});

test('direct Chat image input and local/hosted duplicate IDs retain declared connection identity',async()=>{
    const binding={connection:'local',model_id:'gpt-5-nano',protocol:'chat',image_input:'supported',source:'explicit'};
    const app=await fixture({model_bindings:{master:binding}});const file=await app.upload();queueMockResponse(finish());await app.send([file]);
    const request=getMockRequests()[0];expect(request.url).toContain('/chat/completions');
    const parts=request.body.messages.flatMap(message=>Array.isArray(message.content)?message.content:[]);
    expect(parts.find(part=>part.type==='image_url').image_url.url).toBe('data:image/png;base64,'+images[0].toString('base64'));
    expect((await app.spend()).usage.requests_by_connection).toEqual({local:1});
});

test('a text-only actor deterministically receives configured helper observations',async()=>{
    const app=await fixture({master_model:'text-model',vision_model:'gpt-4o-mini'});const file=await app.upload();
    queueMockResponse(reply('Observed order facts from pixels'));queueMockResponse(finish());await app.send([file]);
    const requests=getMockRequests();expect(requests).toHaveLength(2);
    expect(requests[0].body.model).toBe('gpt-4o-mini');expect(requests[0].body.messages[1].content.some(part=>part.type==='image_url')).toBe(true);
    expect(requests[1].body.model).toBe('text-model');expect(requests[1].body.messages.some(message=>String(message.content).includes('Observed order facts'))).toBe(true);
    expect(requests[1].body.messages.every(message=>typeof message.content==='string')).toBe(true);
    expect((await app.spend()).usage.requests_by_role).toEqual({master:1,vision:1});
});

test('an explicitly selected helper is used even when the actor supports images',async()=>{
    const app=await fixture({image_delivery:'helper',vision_model:'gpt-4o-mini'});const file=await app.upload();
    queueMockResponse(reply('Helper observations'));queueMockResponse(finish());await app.send([file]);
    expect(getMockRequests().map(request=>request.body.model)).toEqual(['gpt-4o-mini','gpt-5-nano']);
    expect(getMockRequests()[1].body.input.every(message=>typeof message.content==='string')).toBe(true);
});

test('stale model bindings reject the whole settings update without partial changes',async()=>{
    const app=await fixture();
    const before=await app.page.evaluate(async id=>(await window.__ZEUS_BRIDGE__.listTasks()).find(task=>task.id===id),app.task.id);
    await expect(app.page.evaluate(({id,before})=>window.__ZEUS_BRIDGE__.updateTaskSettings(id,{...before,budget_credits:123,image_delivery:'helper',model_bindings:{master:{...before.model_bindings.master,model_id:'wrong-id'}}}),{id:app.task.id,before})).rejects.toThrow('stale master binding');
    const after=await app.page.evaluate(async id=>(await window.__ZEUS_BRIDGE__.listTasks()).find(task=>task.id===id),app.task.id);
    expect(after.model_bindings).toEqual(before.model_bindings);expect(after.budget_credits).toBe(before.budget_credits);expect(after.image_delivery).toBe('auto');
});

test('task settings persist explicit provider, capability and helper preference through reload',async()=>{
    const app=await fixture();await app.select();await app.page.locator('#chat-task-settings-button').click();
    await expect(app.page.getByLabel('master provider',{exact:true})).toHaveValue('abacus');
    await app.page.getByLabel('master provider',{exact:true}).selectOption('local');
    await app.page.getByText('Model input settings',{exact:true}).click();
    await app.page.getByLabel('master image input',{exact:true}).selectOption('supported');
    await app.page.getByLabel('Image delivery',{exact:true}).selectOption('helper');
    await app.page.locator('#task-save-settings-button').click();
    await expect.poll(()=>app.page.evaluate(async id=>(await window.__ZEUS_BRIDGE__.listTasks()).find(task=>task.id===id).image_delivery,app.task.id)).toBe('helper');
    await app.page.reload();await app.select();await app.page.locator('#chat-task-settings-button').click();
    await expect(app.page.getByLabel('master provider',{exact:true})).toHaveValue('local');
    await expect(app.page.getByLabel('Image delivery',{exact:true})).toHaveValue('helper');
    await app.page.getByText('Model input settings',{exact:true}).click();
    await expect(app.page.getByLabel('master image input',{exact:true})).toHaveValue('supported');
});

test('saved attachment handles support deliberate follow-up inspection without re-upload',async()=>{
    const app=await fixture();const file=await app.upload();queueMockResponse(finish());await app.send([file]);
    const inspect='```zeus-directive\n'+JSON.stringify({type:'analyze_visual',image_path:'attachment:'+file.id,query:'Inspect the same image again'})+'\n```';
    queueMockResponse(reply(inspect));queueMockResponse(reply('Fresh inspection of stored pixels'));queueMockResponse(finish());
    await app.send([],'Inspect the image from my earlier message, using its attachment handle.');
    const requests=getMockRequests();expect(requests).toHaveLength(4);
    const inspection=requests[2];expect(inspection.body.input.flatMap(message=>Array.isArray(message.content)?message.content:[]).some(part=>part.type==='input_image')).toBe(true);
    expect((await app.spend()).usage.requests_by_role).toEqual({master:3,vision:1});
});

function largeSyntheticPng(){
    const width=2560,height=1440,raw=Buffer.alloc(height*(width*3+1));let seed=0x85e4d267;
    for(let y=0;y<height;y++)for(let x=0;x<width*3;x++){
        seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;raw[y*(width*3+1)+1+x]=(seed&15)<<4;
    }
    const chunk=(type,data)=>{
        const tag=Buffer.from(type),bytes=Buffer.concat([tag,data]);let crc=0xffffffff;
        for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=crc&1?(crc>>>1)^0xedb88320:crc>>>1;}
        const length=Buffer.alloc(4),tail=Buffer.alloc(4);length.writeUInt32BE(data.length);tail.writeUInt32BE((~crc)>>>0);
        return Buffer.concat([length,bytes,tail]);
    };
    const header=Buffer.alloc(13);header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
    return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(raw,{level:1})),chunk('IEND',Buffer.alloc(0))]);
}

test('large valid image survives helper, manual inspection and repeated text-only follow-ups',async({},testInfo)=>{
    const app=await fixture({master_model:'text-model',vision_model:'gemini-3.8-flash'},{...limits,max_requests:16,max_tokens:60000000},{tls:true,freshConnections:true},
        {buildProfile:process.env.ZEUS_TEST_RELEASE==='1'?'release':'debug'});
    try {
        const bytes=largeSyntheticPng();expect(bytes.length).toBeGreaterThan(5000000);expect(bytes.length).toBeLessThan(10*1024*1024);
        const file=await app.upload(bytes,'large-screen.png');expect([file.width,file.height]).toEqual([2560,1440]);
        const inspect=reply('```zeus-directive\n'+JSON.stringify({type:'analyze_visual',image_path:'attachment:'+file.id,query:'Inspect the stored image again'})+'\n```');
        queueMockResponse(reply('Initial helper facts'));queueMockResponse(inspect);queueMockResponse(reply('Verified facts'));queueMockResponse(finish());
        await app.send([file]);
        for(let turn=0;turn<3;turn++){
            queueMockResponse(inspect);queueMockResponse(reply('Fresh follow-up facts'));queueMockResponse(finish());
            await app.send([],`Another question about the same image: ${turn}`);
        }
        expect(app.processEvidence().exit_code).toBeNull();expect((await app.messages()).filter(message=>message.attachments?.length)).toHaveLength(1);
        expect((await app.spend()).usage.unknown_requests).toBe(0);
    }finally{
        await new Promise(resolve=>setTimeout(resolve,150));
        const evidence=JSON.stringify(app.processEvidence(),null,2);
        fs.writeFileSync(testInfo.outputPath('native-process.json'),evidence);
        await testInfo.attach('native-process-evidence',{body:evidence,contentType:'application/json'});
        console.log(evidence);
    }
});

test('disabled helper and unsupported actor reject before accepting an incomplete message',async()=>{
    const app=await fixture({master_model:'text-only-model'});const file=await app.upload();
    await expect(app.send([file])).rejects.toThrow('ATTACHMENT_CAPABILITY');expect(getMockRequests()).toHaveLength(0);
    expect((await app.messages()).filter(message=>message.role==='user')).toHaveLength(0);
});

test('a stored image remains inspectable after a full app restart without reattachment',async()=>{
    const app=await fixture();const file=await app.upload();queueMockResponse(finish());await app.send([file]);await stopTauri();
    const restarted=await launchTauri(false,{evaluationLimits:limits,reuseWorkspace:app.workspace});
    await expect(restarted.page.locator('#app-container')).toBeVisible();
    queueMockResponse(reply('```zeus-directive\n'+JSON.stringify({type:'analyze_visual',image_path:'attachment:'+file.id,query:'Inspect persisted pixels'})+'\n```'));
    queueMockResponse(reply('Persisted image facts'));queueMockResponse(finish());
    await restarted.page.evaluate(id=>window.__ZEUS_BRIDGE__.sendUserMessage(id,'Inspect the original image again.',crypto.randomUUID()),app.task.id);
    const messages=await restarted.page.evaluate(id=>window.__ZEUS_BRIDGE__.getTaskMessages(id,true),app.task.id);
    expect(messages.filter(message=>message.attachments?.length).map(message=>message.attachments[0].id)).toEqual([file.id]);
    const inspection=getMockRequests()[2];
    expect(inspection.body.input.flatMap(message=>Array.isArray(message.content)?message.content:[]).find(part=>part.type==='input_image').image_url).toBe('data:image/png;base64,'+images[0].toString('base64'));
});

test('image picker accepts image-only input and hydrates persisted previews after reload',async()=>{
    const app=await fixture();await app.select();
    await app.page.locator('input[type=file]').setInputFiles({name:'screen.png',mimeType:'image/png',buffer:images[0]});
    queueMockResponse({...finish(),_delay_ms:500});await app.page.locator('#chat-send-button').click();
    await expect(app.page.locator('#attachment-tray')).toHaveCount(0);
    await expect(app.page.locator('#chat-messages')).toContainText('Controlled image answer');
    await app.page.reload();await app.select();
    const preview=app.page.locator('.message-attachments img');await expect(preview).toHaveAttribute('src',/^data:image\/png;base64,/);
    await expect(app.page.locator('.message-attachments')).toContainText('Delivered to model');
    await app.page.getByRole('button',{name:'Use in next message'}).click();await expect(app.page.locator('#attachment-tray')).toContainText('screen.png');
});

test('invalid upload keeps the draft and tray and never starts inference',async()=>{
    const app=await fixture();await app.select();
    await app.page.locator('#chat-input').fill('Do not send this without its image');
    await app.page.locator('input[type=file]').setInputFiles({name:'broken.png',mimeType:'image/png',buffer:Buffer.from('not an image')});
    await app.page.locator('#chat-send-button').click();
    await expect(app.page.locator('#attachment-tray')).toContainText('Upload failed');
    await expect(app.page.locator('#chat-input')).toHaveValue('Do not send this without its image');expect(getMockRequests()).toHaveLength(0);
    expect((await app.messages()).filter(message=>message.role==='user')).toHaveLength(0);
});

test('pasting a screenshot sends its exact pixels and clears the accepted tray',async()=>{
    const app=await fixture();await app.select();
    await app.page.locator('#chat-input').evaluate((input,bytes)=>{
        const clipboardData=new DataTransfer();
        clipboardData.items.add(new File([new Uint8Array(bytes)],'clipboard.png',{type:'image/png'}));
        input.dispatchEvent(new ClipboardEvent('paste',{clipboardData,bubbles:true,cancelable:true}));
    },Array.from(images[1]));
    await expect(app.page.locator('#attachment-tray img')).toHaveCount(1);
    queueMockResponse(finish());await app.page.locator('#chat-send-button').click();
    await expect(app.page.locator('#chat-messages')).toContainText('Controlled image answer');
    await expect(app.page.locator('#attachment-tray')).toHaveCount(0);
    const parts=getMockRequests()[0].body.input.flatMap(message=>Array.isArray(message.content)?message.content:[]);
    expect(parts.find(part=>part.type==='input_image').image_url).toBe('data:image/png;base64,'+images[1].toString('base64'));
});

test('actual content type wins over filename and invalid images cannot bypass decoding',async()=>{
    const app=await fixture();expect((await app.upload(images[0],'notes.txt')).mime_type).toBe('image/png');
    await expect(app.upload(Buffer.from('not png'),'fake.png')).rejects.toThrow('ATTACHMENT_MEDIA');
    await expect(app.upload(Buffer.alloc(10*1024*1024+1),'large.png')).rejects.toThrow('ATTACHMENT_QUOTA');
});

test('cross-task references, changed bytes and explicit denials cannot be transmitted',async()=>{
    const app=await fixture();const file=await app.upload();
    const other=await app.page.evaluate(()=>window.__ZEUS_BRIDGE__.createTask('Other task'));
    await expect(app.page.evaluate(({tid,id})=>window.__ZEUS_BRIDGE__.getAttachmentPreview(tid,id),{tid:other.id,id:file.id})).rejects.toThrow('ATTACHMENT_OWNERSHIP');
    const filename=path.join(app.workspace,'tasks',app.task.id,'workspace',file.storage_key);
    fs.writeFileSync(filename,Buffer.alloc(images[0].length));await expect(app.send([file])).rejects.toThrow('ATTACHMENT_CHANGED');fs.writeFileSync(filename,images[0]);
    await app.page.evaluate(({tid,filename})=>window.__ZEUS_BRIDGE__.addFilePermission(tid,filename,'deny','read','exact'),{tid:app.task.id,filename});
    await expect(app.send([file])).rejects.toThrow('ATTACHMENT_DENIED');expect(getMockRequests()).toHaveLength(0);
});

test('reparse points in attachment storage are rejected',async()=>{
    const app=await fixture();const file=await app.upload();const folder=path.dirname(path.join(app.workspace,'tasks',app.task.id,'workspace',file.storage_key));
    const backup=folder+'.original',target=path.join(app.workspace,'outside-task');fs.mkdirSync(target);fs.writeFileSync(path.join(target,file.filename),images[0]);
    fs.renameSync(folder,backup);fs.symlinkSync(target,folder,process.platform==='win32'?'junction':'dir');
    try{await expect(app.send([file])).rejects.toThrow('ATTACHMENT_PATH');expect(getMockRequests()).toHaveLength(0);}
    finally{fs.unlinkSync(folder);fs.renameSync(backup,folder);}
});

test('repeat request IDs never duplicate attachment messages or inference',async()=>{
    const app=await fixture();const file=await app.upload(),id=crypto.randomUUID();queueMockResponse(finish());
    await app.send([file],'Describe input',id);await expect(app.send([file],'Describe input',id)).rejects.toThrow('REQUEST_ALREADY_EXISTS');
    expect(getMockRequests()).toHaveLength(1);expect((await app.messages()).filter(message=>message.role==='user'&&message.kind==='chat')).toHaveLength(1);
});

test('provider rejection retains typed delivery failure and unknown billed usage',async()=>{
    const app=await fixture();const file=await app.upload();queueMockResponse({_http_status:400,error:{message:'Image format rejected by upstream'}});
    await expect(app.send([file])).rejects.toThrow('Image format rejected by upstream');
    const user=(await app.messages()).find(message=>message.role==='user');expect(user.attachments[0].last_delivery.state).toBe('failed');
    expect((await app.spend()).usage.unknown_requests).toBe(1);expect(getMockRequests()).toHaveLength(1);
});

test('Stop cancels automatic helper work and retains cancelled delivery evidence',async()=>{
    const app=await fixture({master_model:'text-model',vision_model:'gpt-4o-mini'});const file=await app.upload();queueMockResponse(reply('late',{_delay_ms:10000}));
    const pending=app.send([file]).then(()=>null,error=>String(error));await expect.poll(()=>getMockRequests().length).toBe(1);
    await app.page.evaluate(id=>window.__ZEUS_BRIDGE__.cancelTaskRun(id),app.task.id);expect(await pending).toContain('RUN_CANCELLED');
    const user=(await app.messages()).find(message=>message.role==='user');expect(user.attachments[0].last_delivery.state).toBe('cancelled');expect((await app.spend()).usage.unknown_requests).toBe(1);
});

test('Stop also cancels a deliberate visual tool call during a follow-up turn',async()=>{
    const app=await fixture();const file=await app.upload();queueMockResponse(finish());await app.send([file]);
    queueMockResponse(reply('```zeus-directive\n'+JSON.stringify({type:'analyze_visual',image_path:'attachment:'+file.id,query:'Inspect again'})+'\n```'));
    queueMockResponse(reply('late',{_delay_ms:10000}));
    const pending=app.send([],'Inspect the previous image again.').then(()=>null,error=>String(error));
    await expect.poll(()=>getMockRequests().length).toBe(3);
    await app.page.evaluate(id=>window.__ZEUS_BRIDGE__.cancelTaskRun(id),app.task.id);
    expect(await pending).toContain('RUN_CANCELLED');expect((await app.spend()).usage.unknown_requests).toBe(1);
    const user=(await app.messages()).find(message=>message.attachments?.length);expect(user.attachments[0].last_delivery.state).toBe('cancelled');
});
