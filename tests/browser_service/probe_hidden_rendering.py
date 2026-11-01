"""Opt-in synthetic experiment: native hiding versus virtual page visibility.

Uses the existing owned-process/private-desktop harness. --interactive exposes
only this probe's browser briefly and requires an agreed user test interval.
No physical input, user profiles, real accounts, or external websites are used.
"""
import argparse
import asyncio
import base64
import ctypes
from ctypes import wintypes
import hashlib
import json
from pathlib import Path
import sys
import time
import uuid

from probe_windows_visibility import parent, windows_api, window_for_title


async def worker(directory):
    from playwright.async_api import async_playwright
    user = windows_api()
    report = {'modes': []}
    marker = 'ZeusHidden-' + uuid.uuid4().hex
    async with async_playwright() as playwright:
        context = await playwright.chromium.launch_persistent_context(
            str(directory / 'profile'), headless=False,
            viewport={'width': 1600, 'height': 900},
            args=['--window-position=-30000,-30000'],
        )
        try:
            page = context.pages[0]
            await page.set_content('''<title>MARKER</title><input id="draft"><button id="action" onclick="clicks++">Increment</button>
<canvas id="canvas" width="400" height="200"></canvas><div id="counter"></div>
<script>window.marker='MARKER';window.clicks=0;window.framesSeen=0;window.ticks=0;
setInterval(()=>{ticks++;document.querySelector('#counter').textContent=ticks},50);
function animate(){framesSeen++;let c=document.querySelector('#canvas').getContext('2d');
c.fillStyle=`hsl(${framesSeen*9%360},80%,50%)`;c.fillRect(0,0,400,200);requestAnimationFrame(animate)}animate();</script>'''.replace('MARKER', marker))
            await page.locator('#draft').fill('Unsaved draft')
            deadline = time.monotonic() + 5
            while True:
                try:
                    hwnd = window_for_title(user, marker)
                    break
                except RuntimeError:
                    if time.monotonic() > deadline:
                        raise
                    await asyncio.sleep(.05)
            pid = wintypes.DWORD()
            user.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
            report['browser_pid'] = pid.value
            (directory / 'identity.json').write_text(json.dumps({'browser_pid': pid.value}))
            cdp = await context.new_cdp_session(page)
            original_target = (await cdp.send('Target.getTargetInfo'))['targetInfo']['targetId']
            user.GetWindowLongPtrW.argtypes = [wintypes.HWND, ctypes.c_int]
            user.GetWindowLongPtrW.restype = ctypes.c_ssize_t
            user.SetWindowLongPtrW.argtypes = [wintypes.HWND, ctypes.c_int, ctypes.c_ssize_t]
            user.SetLayeredWindowAttributes.argtypes = [wintypes.HWND, wintypes.DWORD, ctypes.c_ubyte, wintypes.DWORD]
            original_style = user.GetWindowLongPtrW(hwnd, -20)
            modes = [('offscreen', False, 'sdk'), ('hidden', False, 'sdk'),
                     ('hidden', True, 'sdk'), ('minimized', True, 'sdk'),
                     ('hidden', True, 'cdp'), ('hidden', False, 'cdp'),
                     ('transparent', False, 'sdk'), ('transparent-near', False, 'sdk'),
                     ('restored', False, 'sdk')]
            for window_mode, focus, capture in modes:
                name = f'{window_mode}-focus{int(focus)}-{capture}'
                (directory / 'phase.txt').write_text(name)
                user.SetWindowLongPtrW(hwnd, -20, original_style)
                user.ShowWindow(hwnd, 4)
                user.SetWindowPos(hwnd, None, -30000, -30000, 1640, 1000, 0x0010 | 0x0004)
                if window_mode == 'hidden':
                    user.ShowWindow(hwnd, 0)
                elif window_mode == 'minimized':
                    user.ShowWindow(hwnd, 7)
                elif window_mode == 'restored':
                    user.SetWindowPos(hwnd, None, 80, 80, 1640, 1000, 0x0010 | 0x0004)
                elif window_mode.startswith('transparent'):
                    # Layered, click-through, nonactivating tool window. This is
                    # an experiment, never a production launch-mode fallback.
                    user.SetWindowLongPtrW(hwnd, -20, original_style | 0x80000 | 0x20 | 0x80 | 0x08000000)
                    if not user.SetLayeredWindowAttributes(hwnd, 0, 1 if window_mode == 'transparent-near' else 0, 2):
                        raise ctypes.WinError(ctypes.get_last_error())
                    user.SetWindowPos(hwnd, None, 80, 80, 1640, 1000, 0x0010 | 0x0004 | 0x0020)
                await cdp.send('Emulation.setFocusEmulationEnabled', {'enabled': focus})
                await asyncio.sleep(.2)
                initial = await page.evaluate('({framesSeen,ticks,clicks})')
                action_start = time.monotonic()
                await page.locator('#action').click(timeout=3000)
                await page.locator('#draft').press('End', timeout=3000)
                action_ms = (time.monotonic() - action_start) * 1000
                hashes, durations = [], []
                started = time.monotonic()
                for index in range(8):
                    tick = time.monotonic()
                    if capture == 'sdk':
                        pixels = await page.screenshot(type='jpeg', quality=80, timeout=3000)
                    else:
                        result = await asyncio.wait_for(cdp.send('Page.captureScreenshot', {'format': 'jpeg', 'quality': 80, 'fromSurface': True}), 3)
                        pixels = base64.b64decode(result['data'])
                    durations.append(round((time.monotonic()-tick)*1000, 2))
                    hashes.append(hashlib.sha256(pixels).hexdigest())
                    if index in (0, 7):
                        (directory / f'{name}-{index}.jpg').write_bytes(pixels)
                    await asyncio.sleep(max(0, (index+1)*.125-(time.monotonic()-started)))
                final = await page.evaluate('({framesSeen,ticks,clicks,marker,visibility:document.visibilityState,focused:document.hasFocus(),width:innerWidth,height:innerHeight,dpr:devicePixelRatio,scale:visualViewport.scale})')
                report['modes'].append({'mode': name, 'visible': bool(user.IsWindowVisible(hwnd)),
                    'minimized': bool(user.IsIconic(hwnd)), 'capture_ms': durations,
                    'distinct_images': len(set(hashes)), 'action_ms': round(action_ms, 2),
                    'animation_frames': final['framesSeen']-initial['framesSeen'], 'timer_ticks': final['ticks']-initial['ticks'],
                    'clicked': final['clicks'] == initial['clicks']+1,
                    'state_preserved': final['marker'] == marker and await page.locator('#draft').input_value() == 'Unsaved draft',
                    'same_target': original_target == (await cdp.send('Target.getTargetInfo'))['targetInfo']['targetId'],
                    'page_state': final})
                (directory / 'report.json').write_text(json.dumps(report, indent=2), encoding='utf8')
            report['completed'] = True
        except Exception as error:
            report['error'] = str(error)
        finally:
            await context.close()
    (directory / 'report.json').write_text(json.dumps(report, indent=2), encoding='utf8')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--interactive', action='store_true')
    parser.add_argument('--worker', action='store_true', help=argparse.SUPPRESS)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    if sys.platform != 'win32':
        parser.error('Windows only')
    directory = (args.output or Path('.zeus/evaluations') / ('hidden-rendering-' + uuid.uuid4().hex)).resolve()
    directory.mkdir(parents=True, exist_ok=True)
    if args.worker:
        with (directory / 'worker.log').open('w', encoding='utf8') as log:
            sys.stdout = sys.stderr = log
            asyncio.run(worker(directory))
    else:
        sys.exit(parent(directory, args.interactive, worker_script=Path(__file__).resolve()))
