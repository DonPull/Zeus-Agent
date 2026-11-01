"""Opt-in active-desktop input test. Sends only 'h' to its own focused Tk entry.

Stops immediately if any other window owns foreground focus. The browser and
sentinel use synthetic local content; the user's browser/profile is never used.
Run only during an explicitly agreed foreground interval.
"""
import argparse
import asyncio
import ctypes
from ctypes import wintypes
import json
import os
from pathlib import Path
import sys
import time
import tkinter as tk
import uuid

from probe_windows_visibility import parent, windows_api, window_for_title


async def worker(directory):
    from playwright.async_api import async_playwright
    user=windows_api()
    user.GetAncestor.argtypes=[wintypes.HWND,wintypes.UINT];user.GetAncestor.restype=wintypes.HWND
    user.SetForegroundWindow.argtypes=[wintypes.HWND]
    user.GetWindowLongPtrW.argtypes=[wintypes.HWND,ctypes.c_int];user.GetWindowLongPtrW.restype=ctypes.c_ssize_t
    user.SetWindowLongPtrW.argtypes=[wintypes.HWND,ctypes.c_int,ctypes.c_ssize_t]
    user.SetLayeredWindowAttributes.argtypes=[wintypes.HWND,wintypes.DWORD,ctypes.c_ubyte,wintypes.DWORD]
    class KEYBOARD(ctypes.Structure):
        _fields_=[('vk',wintypes.WORD),('scan',wintypes.WORD),('flags',wintypes.DWORD),('time',wintypes.DWORD),('extra',ctypes.c_size_t)]
    class MOUSE(ctypes.Structure):
        _fields_=[('x',wintypes.LONG),('y',wintypes.LONG),('data',wintypes.DWORD),('flags',wintypes.DWORD),('time',wintypes.DWORD),('extra',ctypes.c_size_t)]
    class UNION(ctypes.Union):
        _fields_=[('keyboard',KEYBOARD),('mouse',MOUSE)]
    class INPUT(ctypes.Structure):
        _fields_=[('kind',wintypes.DWORD),('value',UNION)]
    user.SendInput.argtypes=[wintypes.UINT,ctypes.POINTER(INPUT),ctypes.c_int]
    original=user.GetForegroundWindow()
    sentinel=tk.Tk();sentinel.title('Zeus owned input-isolation check');sentinel.geometry('460x110+100+100')
    tk.Label(sentinel,text='Click inside the box once, then wait for this window to close.').pack()
    entry=tk.Entry(sentinel);entry.pack();sentinel.update()
    owned=window_for_title(user,'Zeus owned input-isolation check')
    user.ShowWindow(owned,1)
    user.SetWindowPos(owned,-1,100,100,460,110,0x0010|0x0040)
    report={'modes':[],'sentinel_pid':os.getpid()}
    async with async_playwright() as playwright:
        context=await playwright.chromium.launch_persistent_context(str(directory/'profile'),headless=False,viewport={'width':1600,'height':900},args=['--window-position=-30000,-30000'])
        try:
            page=context.pages[0];marker='ZeusInput-'+uuid.uuid4().hex
            await page.set_content(f'<title>{marker}</title><input id="agent"><button id="click" onclick="window.agentClicks++">Synthetic click</button><script>window.keys=[];window.agentClicks=0;addEventListener("keydown",e=>keys.push(e.key))</script>')
            deadline=time.monotonic()+5
            while True:
                try:hwnd=window_for_title(user,marker);break
                except RuntimeError:
                    if time.monotonic()>deadline:raise
                    await asyncio.sleep(.05)
            pid=wintypes.DWORD();user.GetWindowThreadProcessId(hwnd,ctypes.byref(pid));report['browser_pid']=pid.value
            (directory/'identity.json').write_text(json.dumps({'browser_pid':pid.value}))
            style=user.GetWindowLongPtrW(hwnd,-20)
            for mode in ['offscreen','offscreen-noactivate','transparent-noactivate']:
                (directory/'phase.txt').write_text(mode)
                user.SetWindowLongPtrW(hwnd,-20,style|(0x08000000|0x80 if mode!='offscreen' else 0)|(0x80000|0x20 if mode.startswith('transparent') else 0))
                if mode.startswith('transparent'):user.SetLayeredWindowAttributes(hwnd,0,0,2)
                user.ShowWindow(hwnd,4);user.SetWindowPos(hwnd,None,80 if mode.startswith('transparent') else -30000,80 if mode.startswith('transparent') else -30000,1640,1000,0x0010|0x0004|0x0020)
                sentinel.lift();entry.delete(0,'end');entry.focus_force();sentinel.update();user.SetForegroundWindow(owned)
                user.ShowWindow(owned,1);user.SetForegroundWindow(owned)
                sentinel.update();await asyncio.sleep(.1)
                if mode=='offscreen':
                    deadline=time.monotonic()+60
                    while user.GetForegroundWindow()!=owned:
                        sentinel.update()
                        if time.monotonic()>deadline:raise RuntimeError('The owned test window did not receive the manual focus click')
                        await asyncio.sleep(.02)
                    entry.focus_set();sentinel.update()
                await page.evaluate('window.keys=[];window.agentClicks=0')
                sent=0;errors=[];running=True
                async def human():
                    nonlocal sent
                    while running:
                        sentinel.update()
                        if user.GetForegroundWindow()!=owned:
                            errors.append(f'Foreground changed ({user.GetForegroundWindow()} expected {owned}); no further physical input was sent');return
                        inputs=(INPUT*2)()
                        inputs[0].kind=inputs[1].kind=1
                        inputs[0].value.keyboard=KEYBOARD(0,ord('h'),4,0,0)
                        inputs[1].value.keyboard=KEYBOARD(0,ord('h'),6,0,0)
                        if user.SendInput(2,inputs,ctypes.sizeof(INPUT))!=2:raise ctypes.WinError(ctypes.get_last_error())
                        sent+=1;sentinel.update();await asyncio.sleep(.05)
                human_task=asyncio.create_task(human())
                for i in range(20):
                    await page.locator('#click').click(timeout=3000)
                    await page.locator('#agent').fill('')
                    await page.locator('#agent').press_sequentially(f'agent{i}!')
                    if await page.locator('#agent').input_value()!=f'agent{i}!':errors.append('Human input reached the browser')
                    await asyncio.sleep(.025)
                running=False;await human_task;sentinel.update()
                text=entry.get();keys=await page.evaluate('window.keys')
                clicks=await page.evaluate('window.agentClicks')
                if clicks!=20:errors.append('Agent click count differed')
                if sent<5:errors.append('Too few physical-input samples')
                if text!='h'*sent:errors.append('Agent input reached the human entry or human keystrokes were lost')
                if 'h' in keys:errors.append('Human key event reached the browser')
                report['modes'].append({'mode':mode,'human_keystrokes':sent,'human_entry_exact':text=='h'*sent,'agent_turns':20,'agent_clicks':clicks,'browser_received_human_key':'h' in keys,'errors':errors,'passed':not errors})
            report['completed']=all(mode['passed'] for mode in report['modes'])
        except Exception as error:report['error']=str(error)
        finally:
            await context.close();sentinel.destroy();user.SetForegroundWindow(original)
    (directory/'report.json').write_text(json.dumps(report,indent=2),encoding='utf8')


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--worker',action='store_true');parser.add_argument('--interactive',action='store_true');parser.add_argument('--output',type=Path);args=parser.parse_args()
    if not args.interactive:parser.error('Physical-input checks require explicit --interactive and a scheduled test interval')
    directory=(args.output or Path('.zeus/evaluations')/('concurrent-input-'+uuid.uuid4().hex)).resolve();directory.mkdir(parents=True,exist_ok=True)
    if args.worker:
        with (directory/'worker.log').open('w') as log:sys.stdout=sys.stderr=log;asyncio.run(worker(directory))
    else:sys.exit(parent(directory,True,Path(__file__).resolve()))
