"""Trusted, opt-in extension-mode experiment, not product configuration.

Copies the prepared upstream package into this experiment's folder, explicitly
grants host access in that copy, and tests upstream Complete filtering. Never
changes the original package/integrity data or the user's browser/profile.
Runs on a private Win32 desktop; no model calls or hidden game answers.
"""
import argparse
import asyncio
import json
from pathlib import Path
import shutil
import sys
import uuid
from probe_windows_visibility import parent


async def worker(folder):
    from playwright.async_api import async_playwright
    root=Path(__file__).resolve().parents[2]
    original=root/'.zeus/browser-runtime/extensions/ubol-2026.1026.1812'
    extension=folder/'experimental-extension'
    shutil.copytree(original,extension)
    manifest=json.loads((extension/'manifest.json').read_text(encoding='utf8'))
    manifest['host_permissions']=['<all_urls>']
    (extension/'manifest.json').write_text(json.dumps(manifest),encoding='utf8')
    report={'kind':'trusted modified-manifest experiment only','model_requests':0,'grant':'all-url host permission in isolated copy','filtering_level':3}
    async with async_playwright() as p:
        context=await p.chromium.launch_persistent_context(str(folder/'profile'),channel='chromium',headless=False,viewport={'width':1600,'height':900},args=['--window-position=-30000,-30000','--mute-audio',f'--disable-extensions-except={extension}',f'--load-extension={extension}'])
        try:
            worker=context.service_workers[0] if context.service_workers else await context.wait_for_event('serviceworker',timeout=5000)
            extension_id=worker.url.split('/')[2]
            options=await context.new_page()
            await options.goto(f'chrome-extension://{extension_id}/dashboard.html')
            report['configuration']=await options.evaluate("chrome.runtime.sendMessage({what:'setFilteringMode',hostname:'all-urls',level:3})")
            page=await context.new_page();report['page_errors']=[]
            page.on('pageerror',lambda error:report['page_errors'].append(str(error)[:600]))
            await page.goto('https://wordlegame.org/unlimited',wait_until='domcontentloaded',timeout=15000)
            await page.locator('.Game-keyboard-button:text-is("c")').click(timeout=5000)
            await page.wait_for_function('document.querySelector(".game_rows .Row")?.innerText.trim().toLowerCase()==="c"',timeout=15000)
            report['completed']=True
        except Exception as error:report['completed']=False;report['error']=str(error)
        finally:
            try:await page.screenshot(path=str(folder/'page.jpg'));report['text']=(await page.locator('body').inner_text())[:4000]
            except Exception:pass
            await context.close()
    (folder/'report.json').write_text(json.dumps(report,indent=2),encoding='utf8')


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--live-site',action='store_true');parser.add_argument('--worker',action='store_true');parser.add_argument('--output',type=Path);args=parser.parse_args()
    if not args.live_site:parser.error('Requires explicit --live-site')
    folder=(args.output or Path('.zeus/evaluations')/('adblock-mode-'+uuid.uuid4().hex)).resolve();folder.mkdir(parents=True,exist_ok=True)
    if args.worker:
        with (folder/'worker.log').open('w',encoding='utf8') as log:sys.stdout=sys.stderr=log;asyncio.run(worker(folder))
    else:sys.exit(parent(folder,False,Path(__file__).resolve(),('--live-site',)))
