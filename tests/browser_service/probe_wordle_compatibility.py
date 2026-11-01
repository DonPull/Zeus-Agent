"""Opt-in public-site compatibility smoke, not an agent capability benchmark.

Loads a fresh managed browser with the prepared ad blocker, uses the Unlimited
link, submits one ordinary guess, and checks actual rendered feedback. No
answers, internal game state, user profile or model inference are accessed.
"""
import argparse
import asyncio
from collections import Counter
import importlib.util
import json
from pathlib import Path
import sys
from urllib.parse import urlsplit
import uuid


async def check(directory, adblock=True, offscreen=False):
    root=Path(__file__).resolve().parents[2]
    spec=importlib.util.spec_from_file_location('zeus_site_service',root/'src-tauri/browser_service/service.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    config={'session_id':str(uuid.uuid4()),'generation':1,'token':uuid.uuid4().hex,'profile_dir':str(directory/'profile'),'artifact_dir':str(directory/'artifacts'),
            'adblock_dir':str(root/'.zeus/browser-runtime/extensions/ubol-2026.1026.1812') if adblock else None,
            'window_mode':'offscreen' if offscreen else 'headless'}
    service=module.Service(config);report={'kind':'trusted reference site-compatibility smoke, not agent capability','model_requests':0}
    async def call(op,**params):
        response=await service.action({'protocol':1,'session_id':config['session_id'],'generation':1,'token':config['token'],'id':str(uuid.uuid4()),'op':op,'params':params})
        if not response['ok']:raise RuntimeError(str(response['error']))
        return response['result']
    try:
        report['runtime']=await service.start();blocked=Counter()
        report['page_errors']=[];report['http_errors']=[]
        page=service.pages[service.selected]
        page.on('pageerror',lambda error:report['page_errors'].append(str(error)[:1000]) if len(report['page_errors'])<10 else None)
        page.on('response',lambda response:report['http_errors'].append({'status':response.status,'host':urlsplit(response.url).hostname,'path':urlsplit(response.url).path[:250]}) if response.status>=400 and len(report['http_errors'])<20 else None)
        page.on('requestfailed',lambda request:blocked.update([urlsplit(request.url).hostname]) if 'BLOCKED_BY_CLIENT' in (request.failure or '') else None)
        await call('navigate',url='https://wordlegame.org/',timeout_ms=15000)
        await call('click',target={'role':'link','name':'Unlimited'},timeout_ms=5000)
        await page.locator('.game_rows .Row-letter').first.wait_for(state='visible',timeout=5000)
        # Use visible controls and verify that the first key has taken effect;
        # visible SSR markup alone does not establish ready keyboard handlers.
        for index,letter in enumerate('crane'):
            await call('click',target={'css':f'.Game-keyboard-button:text-is("{letter}")'},timeout_ms=5000)
            await page.wait_for_function('(expected)=>document.querySelector(".game_rows .Row")?.innerText.replace(/\\s/g,"").toLowerCase()===expected',arg='crane'[:index+1],timeout=15000)
        await call('click',target={'css':'.Game-keyboard-button:text-is("Enter")'},timeout_ms=5000)
        await page.locator('.game_rows .Row-locked-in').first.wait_for(timeout=5000)
        report['feedback']=await page.locator('.game_rows .Row-locked-in .Row-letter').evaluate_all("els=>els.slice(0,5).map(e=>({letter:e.innerText,classes:e.className}))")
        report['url']=page.url;report['blocked_request_hosts']=dict(blocked)
        report['image']=await service.screenshot(page,'compatibility.jpg')
        report['completed']=len(report['feedback'])==5 and '/unlimited' in page.url
    except Exception as error:
        report['error']=str(error);report['completed']=False
        try:
            observation=await call('observe')
            report['failure_observation']={key:observation.get(key) for key in ('url','title','text','semantic')}
            report['image']=await service.screenshot(service.pages[service.selected],'failure.jpg')
            report['active_element']=await service.pages[service.selected].evaluate('({tag:document.activeElement?.tagName,id:document.activeElement?.id})')
            report['blocked_request_hosts']=dict(blocked)
        except Exception as diagnostic_error:report['collection_error']=str(diagnostic_error)
    finally:
        await service.close()
        (directory/'report.json').write_text(json.dumps(report,indent=2),encoding='utf8')
    print(json.dumps(report,indent=2));return 0 if report['completed'] else 1


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--live-site',action='store_true');parser.add_argument('--no-adblock',action='store_true');parser.add_argument('--offscreen',action='store_true');parser.add_argument('--worker',action='store_true');parser.add_argument('--output',type=Path);args=parser.parse_args()
    if not args.live_site:parser.error('External website access requires explicit --live-site')
    directory=(args.output or Path('.zeus/evaluations')/('wordle-compatibility-'+uuid.uuid4().hex)).resolve();directory.mkdir(parents=True,exist_ok=True)
    if args.offscreen and not args.worker:
        from probe_windows_visibility import parent
        sys.exit(parent(directory,False,Path(__file__).resolve(),('--live-site','--offscreen',*(['--no-adblock'] if args.no_adblock else []))))
    if args.worker:
        with (directory/'worker.log').open('w',encoding='utf8') as log:
            sys.stdout=sys.stderr=log
            asyncio.run(check(directory,not args.no_adblock,args.offscreen))
    else:sys.exit(asyncio.run(check(directory,not args.no_adblock,args.offscreen)))
