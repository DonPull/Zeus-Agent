"""Opt-in paid diagnostic, on a private non-input Windows desktop."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import uuid
from probe_windows_visibility import parent

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--live',action='store_true');parser.add_argument('--chat',action='store_true');parser.add_argument('--model',default='gpt-6-luna');parser.add_argument('--success-only',action='store_true');parser.add_argument('--cancel-only',action='store_true');parser.add_argument('--worker',action='store_true');parser.add_argument('--output',type=Path);args=parser.parse_args()
    options=(['--chat'] if args.chat else [])+(['--success-only'] if args.success_only else [])+(['--cancel-only'] if args.cancel_only else [])+['--model',args.model]
    if not args.live:
        sys.exit(subprocess.call(['node','scripts/diagnostics/check_browser_handoff.js']+options))
    directory=(args.output or Path('.zeus/evaluations')/('live-handoff-'+uuid.uuid4().hex)).resolve();directory.mkdir(parents=True,exist_ok=True)
    if args.worker:
        with (directory/'worker.log').open('w',encoding='utf8') as log:
            env={**os.environ,'ZEUS_NATIVE_HANDOFF_DESKTOP':'private'};env.pop('ZEUS_OFFLINE_TEST',None)
            result=subprocess.run(['node','scripts/diagnostics/check_browser_handoff.js','--live','--output',str(directory)]+options,env=env,stdout=log,stderr=log,cwd=Path(__file__).resolve().parents[2],timeout=560,creationflags=subprocess.CREATE_NO_WINDOW)
            report_file=directory/'report.json'
            report=json.loads(report_file.read_text(encoding='utf8')) if report_file.is_file() else {}
            report.update({'completed':result.returncode==0,'exit_code':result.returncode,'modes':[]})
            report_file.write_text(json.dumps(report,indent=2),encoding='utf8')
    else:
        sys.exit(parent(directory,False,Path(__file__).resolve(),('--live',*options),600))
