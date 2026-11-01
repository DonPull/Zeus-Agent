"""Opt-in Windows feasibility diagnostic. Default uses a private desktop and
never switches the user's input desktop. No user profile or live website is used.
--interactive must only be run during an agreed foreground test window.
"""
import argparse
import asyncio
import ctypes
from ctypes import wintypes
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import uuid


def windows_api():
    user = ctypes.WinDLL('user32', use_last_error=True)
    user.GetForegroundWindow.restype = wintypes.HWND
    user.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    user.IsWindowVisible.argtypes = [wintypes.HWND]
    user.IsIconic.argtypes = [wintypes.HWND]
    user.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
    user.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
    user.SetWindowPos.argtypes = [wintypes.HWND, wintypes.HWND, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, wintypes.UINT]
    return user


def window_for_title(user, title):
    found = []
    callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def visit(hwnd, _):
        text = ctypes.create_unicode_buffer(1024)
        user.GetWindowTextW(hwnd, text, len(text))
        if title in text.value:
            found.append(hwnd)
        return True
    callback = callback_type(visit)
    user.EnumWindows(callback, 0)
    if len(found) != 1:
        raise RuntimeError(f'Expected one owned browser window, got {len(found)}')
    return found[0]


async def worker(directory):
    from playwright.async_api import async_playwright
    user = windows_api()
    report = {'platform': sys.platform, 'input': 'synthetic page only', 'modes': []}
    marker = 'ZeusVisibility-' + uuid.uuid4().hex
    async with async_playwright() as playwright:
        context = await playwright.chromium.launch_persistent_context(
            str(directory / 'profile'), headless=False,
            viewport={'width': 1280, 'height': 720},
            args=['--window-position=-30000,-30000'],
        )
        try:
            page = context.pages[0]
            await page.set_content('''<title>MARKER</title><input id="draft"><button id="action" onclick="window.clicks++">Increment</button>
<canvas id="canvas" width="400" height="200"></canvas><div id="counter"></div>
<script>window.marker='MARKER';window.clicks=0;window.probeFrames=0;window.ticks=0;
setInterval(()=>{window.ticks++;document.querySelector('#counter').textContent=window.ticks},50);
function animate(){window.probeFrames++;const c=document.querySelector('#canvas').getContext('2d');
c.fillStyle=`hsl(${window.probeFrames*9%360},80%,50%)`;c.fillRect(0,0,400,200);requestAnimationFrame(animate)}animate();</script>'''.replace('MARKER', marker))
            await page.locator('#draft').fill('Unsaved synthetic draft')
            # DOM title changes may precede the native window title on the
            # active desktop. Wait for that propagation instead of sampling once.
            deadline=time.monotonic()+5
            while True:
                try:
                    hwnd = window_for_title(user, marker)
                    break
                except RuntimeError:
                    if time.monotonic()>=deadline:raise
                    await asyncio.sleep(.05)
            pid = wintypes.DWORD()
            user.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
            report['browser_pid'] = pid.value
            report['hwnd'] = int(hwnd)
            (directory / 'identity.json').write_text(json.dumps({'browser_pid': pid.value}), encoding='utf8')
            cdp = await context.new_cdp_session(page)
            target = (await cdp.send('Target.getTargetInfo'))['targetInfo']['targetId']
            report['target_id'] = target
            for mode in ['normal', 'minimized', 'hidden', 'offscreen', 'restored']:
                # These APIs target only the uniquely titled window on this
                # worker's desktop. Neither path injects desktop input.
                user.ShowWindow(hwnd, 4)  # SW_SHOWNOACTIVATE
                user.SetWindowPos(hwnd, None, 50, 50, 1300, 800, 0x0010 | 0x0004)
                if mode == 'minimized':
                    user.ShowWindow(hwnd, 7)  # SW_SHOWMINNOACTIVE
                elif mode == 'hidden':
                    user.ShowWindow(hwnd, 0)
                elif mode == 'offscreen':
                    user.SetWindowPos(hwnd, None, -30000, -30000, 1300, 800, 0x0010 | 0x0004)
                await asyncio.sleep(.4)
                initial = await page.evaluate('({probeFrames,ticks,marker,clicks})')
                state_before = {'visible': bool(user.IsWindowVisible(hwnd)), 'minimized': bool(user.IsIconic(hwnd))}
                await page.locator('#action').click(timeout=3000)
                await page.locator('#draft').press('End', timeout=3000)
                hashes, durations = [], []
                started = time.monotonic()
                for index in range(16):
                    tick = time.monotonic()
                    image = await page.screenshot(type='jpeg', quality=80, timeout=4000)
                    durations.append(round((time.monotonic() - tick) * 1000, 2))
                    hashes.append(hashlib.sha256(image).hexdigest())
                    if index in (0, 15):
                        (directory / f'{mode}-{index}.jpg').write_bytes(image)
                    await asyncio.sleep(max(0, (index + 1) * .125 - (time.monotonic() - started)))
                final = await page.evaluate('({probeFrames,ticks,marker,clicks})')
                report['modes'].append({
                    'mode': mode, 'state_before': state_before,
                    'state_after': {'visible': bool(user.IsWindowVisible(hwnd)), 'minimized': bool(user.IsIconic(hwnd))},
                    'elapsed_seconds': round(time.monotonic() - started, 3), 'samples': len(hashes),
                    'distinct_images': len(set(hashes)), 'capture_ms': durations,
                    'animation_frames': final['probeFrames'] - initial['probeFrames'], 'timer_ticks': final['ticks'] - initial['ticks'],
                    'clicked': final['clicks'] == initial['clicks'] + 1,
                    'draft_preserved': await page.locator('#draft').input_value() == 'Unsaved synthetic draft',
                    'memory_preserved': final['marker'] == marker,
                    'same_target': (await cdp.send('Target.getTargetInfo'))['targetInfo']['targetId'] == target,
                })
            report['completed'] = True
        except Exception as error:
            report['error'] = str(error)
        finally:
            await context.close()
    (directory / 'report.json').write_text(json.dumps(report, indent=2), encoding='utf8')


def parent(directory, interactive, worker_script=None, worker_options=(), timeout=120):
    user, kernel = windows_api(), ctypes.WinDLL('kernel32', use_last_error=True)
    class STARTUPINFO(ctypes.Structure):
        _fields_ = [('cb', wintypes.DWORD), ('lpReserved', wintypes.LPWSTR), ('lpDesktop', wintypes.LPWSTR),
                    ('lpTitle', wintypes.LPWSTR), ('dwX', wintypes.DWORD), ('dwY', wintypes.DWORD),
                    ('dwXSize', wintypes.DWORD), ('dwYSize', wintypes.DWORD), ('dwXCountChars', wintypes.DWORD),
                    ('dwYCountChars', wintypes.DWORD), ('dwFillAttribute', wintypes.DWORD), ('dwFlags', wintypes.DWORD),
                    ('wShowWindow', wintypes.WORD), ('cbReserved2', wintypes.WORD), ('lpReserved2', ctypes.c_void_p),
                    ('hStdInput', wintypes.HANDLE), ('hStdOutput', wintypes.HANDLE), ('hStdError', wintypes.HANDLE)]
    class PROCESSINFO(ctypes.Structure):
        _fields_ = [('hProcess', wintypes.HANDLE), ('hThread', wintypes.HANDLE), ('dwProcessId', wintypes.DWORD), ('dwThreadId', wintypes.DWORD)]
    class BASICLIMITS(ctypes.Structure):
        _fields_ = [('process_time', ctypes.c_longlong), ('job_time', ctypes.c_longlong), ('flags', wintypes.DWORD),
                    ('minimum', ctypes.c_size_t), ('maximum', ctypes.c_size_t), ('active', wintypes.DWORD),
                    ('affinity', ctypes.c_size_t), ('priority', wintypes.DWORD), ('scheduling', wintypes.DWORD)]
    class JOBLIMITS(ctypes.Structure):
        _fields_ = [('basic', BASICLIMITS), ('io', ctypes.c_ulonglong * 6), ('process_memory', ctypes.c_size_t),
                    ('job_memory', ctypes.c_size_t), ('peak_process', ctypes.c_size_t), ('peak_job', ctypes.c_size_t)]
    user.CreateDesktopW.argtypes = [wintypes.LPCWSTR, wintypes.LPCWSTR, ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD, ctypes.c_void_p]
    user.CreateDesktopW.restype = wintypes.HANDLE
    user.CloseDesktop.argtypes = [wintypes.HANDLE]
    kernel.CreateProcessW.argtypes = [wintypes.LPCWSTR, wintypes.LPWSTR, ctypes.c_void_p, ctypes.c_void_p, wintypes.BOOL, wintypes.DWORD, ctypes.c_void_p, wintypes.LPCWSTR, ctypes.POINTER(STARTUPINFO), ctypes.POINTER(PROCESSINFO)]
    kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
    kernel.CreateJobObjectW.restype = wintypes.HANDLE
    kernel.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
    kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
    kernel.TerminateJobObject.argtypes = [wintypes.HANDLE, wintypes.UINT]
    kernel.TerminateProcess.argtypes = [wintypes.HANDLE, wintypes.UINT]
    kernel.ResumeThread.argtypes = [wintypes.HANDLE]
    desktop_name = 'ZeusProbe-' + uuid.uuid4().hex
    desktop = None if interactive else user.CreateDesktopW(desktop_name, None, None, 0, 0x10000000, None)
    if not interactive and not desktop:
        raise ctypes.WinError(ctypes.get_last_error())
    startup, process = STARTUPINFO(), PROCESSINFO()
    startup.cb = ctypes.sizeof(startup)
    startup.lpDesktop = None if interactive else 'WinSta0' + chr(92) + desktop_name
    startup.dwFlags, startup.wShowWindow = 1, 0
    command = ctypes.create_unicode_buffer(subprocess.list2cmdline([sys.executable, str(worker_script or Path(__file__).resolve()), '--worker', '--output', str(directory)]+(['--interactive'] if interactive else [])+list(worker_options)))
    foreground_owned = False
    foreground_samples=[]
    job = kernel.CreateJobObjectW(None, None)
    try:
        limits = JOBLIMITS()
        limits.basic.flags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        if not job or not kernel.SetInformationJobObject(job, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
            raise ctypes.WinError(ctypes.get_last_error())
        if not kernel.CreateProcessW(None, command, None, None, False, 0x08000004, None, None, ctypes.byref(startup), ctypes.byref(process)):
            raise ctypes.WinError(ctypes.get_last_error())
        if not kernel.AssignProcessToJobObject(job, process.hProcess):
            kernel.TerminateProcess(process.hProcess, 1)
            raise ctypes.WinError(ctypes.get_last_error())
        kernel.ResumeThread(process.hThread)
        deadline = time.monotonic() + timeout
        while kernel.WaitForSingleObject(process.hProcess, 20) == 258:
            pid=wintypes.DWORD();user.GetWindowThreadProcessId(user.GetForegroundWindow(),ctypes.byref(pid))
            try:phase=(directory/'phase.txt').read_text()
            except OSError:phase='starting'
            sample={'pid':pid.value,'phase':phase}
            if not foreground_samples or foreground_samples[-1]!=sample:
                foreground_samples.append(sample)
            identity = directory / 'identity.json'
            if identity.is_file():
                pid = wintypes.DWORD()
                user.GetWindowThreadProcessId(user.GetForegroundWindow(), ctypes.byref(pid))
                foreground_owned |= pid.value == json.loads(identity.read_text())['browser_pid']
            if time.monotonic() > deadline:
                raise TimeoutError('Owned visibility probe exceeded 120 seconds')
    finally:
        if job:
            kernel.TerminateJobObject(job, 1)
            kernel.CloseHandle(job)
        for handle in (process.hThread, process.hProcess):
            if handle:
                kernel.CloseHandle(handle)
        if desktop:
            user.CloseDesktop(desktop)
    report = json.loads((directory / 'report.json').read_text(encoding='utf8'))
    report['private_desktop'] = not interactive
    report['owned_browser_became_foreground'] = foreground_owned
    report['owned_foreground_phases']=sorted({sample['phase'] for sample in foreground_samples if sample['pid']==report.get('browser_pid')})
    report['note'] = 'Private desktop results are not proof of behavior on the active game/user desktop.' if not interactive else 'Interactive experiment explicitly scheduled with user.'
    (directory / 'report.json').write_text(json.dumps(report, indent=2), encoding='utf8')
    print(json.dumps({'directory': str(directory), **report}))
    return 0 if report.get('completed') else 1


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--interactive', action='store_true')
    parser.add_argument('--worker', action='store_true', help=argparse.SUPPRESS)
    parser.add_argument('--output', type=Path)
    arguments = parser.parse_args()
    if sys.platform != 'win32':
        parser.error('Windows only')
    destination = (arguments.output or Path('.zeus/evaluations') / ('windows-visibility-' + uuid.uuid4().hex)).resolve()
    destination.mkdir(parents=True, exist_ok=True)
    if arguments.worker:
        with (destination / 'worker.log').open('w', encoding='utf8') as log:
            sys.stdout = sys.stderr = log
            asyncio.run(worker(destination))
    else:
        sys.exit(parent(destination, arguments.interactive))
