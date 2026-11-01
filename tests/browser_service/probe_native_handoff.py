"""Native production-service smoke. Default is a private non-input desktop.
--interactive requires a separately agreed ten-second foreground interval.
"""
import argparse
import asyncio
import importlib.util
import json
import os
import subprocess
import sys
import uuid
from pathlib import Path
from probe_windows_visibility import parent, windows_api

async def worker(directory,interactive):
    root=Path(__file__).resolve().parents[2]
    spec=importlib.util.spec_from_file_location('zeus_service',root/'src-tauri/browser_service/service.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    report={'modes':[]};service=None;user=windows_api();original=user.GetForegroundWindow()
    def phase(name):(directory/'phase.txt').write_text(name)
    try:
        config={'session_id':str(uuid.uuid4()),'generation':1,'token':uuid.uuid4().hex,'window_mode':'offscreen','profile_dir':str(directory/'profile'),'artifact_dir':str(directory/'artifacts'),'frame_dir':str(directory/'frames')}
        (directory/'frames').mkdir()
        phase('background_launch');service=module.Service(config);ready=await service.start()
        report['browser_pid']=service.window.pid
        (directory/'identity.json').write_text(json.dumps({'browser_pid':service.window.pid}))
        report['runtime']=ready
        page=service.pages[service.selected]
        await page.set_content('<title>Zeus synthetic handoff check</title><input id="note"><button onclick="window.saved=note.value">Save</button>')
        await page.evaluate(module.HUMAN_OBSERVER)
        await page.locator('#note').fill('Unsaved synthetic draft')
        cdp=await service.context.new_cdp_session(page);target=(await cdp.send('Target.getTargetInfo'))['targetInfo']['targetId']
        await asyncio.sleep(.5)
        epoch=str(uuid.uuid4());await service.human_control('_human_begin',{'epoch':epoch},{})
        phase('requested_human_open');await service.human_control('_human_open',{'epoch':epoch},{})
        await asyncio.sleep(1)
        await page.locator('#note').fill('Human synthetic draft');await page.get_by_text('Save',exact=True).click()
        if interactive:
            # Resume is normally clicked in Zeus, so Zeus already owns focus.
            # Restore the pre-test window to model that explicit user action.
            user.SetForegroundWindow.argtypes=[module.OwnedWindow(service.window.pid).types.HWND]
            user.SetForegroundWindow(original)
        phase('background_resume');ended=await service.human_control('_human_end',{'epoch':epoch},{})
        await asyncio.sleep(.5)
        report['same_target']=(await cdp.send('Target.getTargetInfo'))['targetInfo']['targetId']==target
        report['draft_preserved']=await page.locator('#note').input_value()=='Human synthetic draft'
        report['submission_preserved']=await page.evaluate('window.saved')=='Human synthetic draft'
        report['human_events']=ended['events']
        image=await service.screenshot(page,'native-proof.jpg');report['capture_ms']=image['ended_ms']-image['started_ms']
        report['completed']=report['same_target'] and report['draft_preserved'] and report['submission_preserved']
    except Exception as error:
        report['error']=str(error)
    finally:
        if service:await service.close()
        if interactive:
            user.SetForegroundWindow(original)
        (directory/'report.json').write_text(json.dumps(report,indent=2))

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--worker',action='store_true');parser.add_argument('--interactive',action='store_true');parser.add_argument('--output',type=Path);parser.add_argument('--e2e',action='store_true')
    args=parser.parse_args();directory=(args.output or Path('.zeus/evaluations')/('native-handoff-'+uuid.uuid4().hex)).resolve();directory.mkdir(parents=True,exist_ok=True)
    if args.worker:
        with (directory/'worker.log').open('w') as log:
            sys.stdout=sys.stderr=log
            if args.e2e:
                env={**os.environ,'ZEUS_NATIVE_HANDOFF_DESKTOP':'private','ZEUS_OFFLINE_TEST':'1','ZEUS_TEST_OUTPUT_DIR':str(directory/'ui')}
                result=subprocess.run(['node','node_modules/@playwright/test/cli.js','test','--config=playwright.offline.config.js','browser_handoff.spec.js'],env=env,stdout=log,stderr=log,cwd=Path(__file__).resolve().parents[2],timeout=560,creationflags=subprocess.CREATE_NO_WINDOW)
                (directory/'report.json').write_text(json.dumps({'completed':result.returncode==0,'exit_code':result.returncode,'modes':[],'note':'Native Tauri/browser E2E on a private desktop; no input desktop switch'}))
            else:asyncio.run(worker(directory,args.interactive))
    else:
        if args.e2e and args.interactive:parser.error('E2E must stay on a private desktop')
        sys.exit(parent(directory,args.interactive,Path(__file__).resolve(),('--e2e',) if args.e2e else (),600 if args.e2e else 120))
