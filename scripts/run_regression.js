#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sourceBuild } from './eval_harness/runner.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requested = process.argv.slice(2);
let uiFiles=[];
const filterIndex=requested.indexOf('--ui-files');
if(filterIndex>=0){
  const value=requested[filterIndex+1];
  if(!value||!/^[a-z0-9_,]+$/i.test(value)){console.error('--ui-files requires comma-separated regression filenames');process.exit(1);}
  uiFiles=value.split(',');requested.splice(filterIndex,2);
  if(uiFiles.some(name=>!fs.existsSync(path.join(root,'tests/regression',`${name}.spec.js`)))){console.error('Unknown requested regression file');process.exit(1);}
  if(!requested.includes('--ui'))requested.push('--ui');
}
if (requested.some(arg => !['--unit', '--backend', '--ui', '--missions', '--release'].includes(arg))) {
  console.error('Usage: node scripts/run_regression.js [--unit] [--backend] [--ui] [--missions] [--release] [--ui-files filename,filename]'); process.exit(1);
}
const env = { ...process.env, ZEUS_OFFLINE_TEST: '1' };
for (const key of ['ZEUS_ALLOW_LIVE_EVAL', 'ZEUS_API_BASE_URL', 'ZEUS_EVAL_MODE', 'ZEUS_UNLIMITED_BUDGET',
  'ZEUS_UNLIMITED_ITERATIONS', 'ZEUS_AUTO_ALLOW_COMMANDS', 'ZEUS_AUTO_ALLOW_NEW_FILES', 'ZEUS_BENCH_MATRIX',
  'ZEUS_BENCH_OVERRIDES', 'ZEUS_BENCH_SELECTED_IDS', 'ZEUS_BENCH_RESULTS_DIR', 'ZEUS_BENCH_PROFILE', 'ZEUS_BENCH_ARCH', 'ZEUS_EVALUATION_LIMITS']) delete env[key];
env.ZEUS_BENCH_BUILD = JSON.stringify(sourceBuild(root));
let code = 0;
const selected = group => !requested.length || requested.includes(`--${group}`);
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit', shell: false, windowsHide: true });
  if (result.error) console.error(result.error.message);
  code ||= result.status ?? 1;
}
if (selected('unit')) run(process.execPath, ['--test', ...fs.readdirSync(path.join(root, 'tests/unit')).filter(f => f.endsWith('.test.js')).map(f => `tests/unit/${f}`)]);
if (selected('missions')) run(process.execPath, ['--test', 'tests/missions/graders.test.js']);
if (selected('backend')) run('cargo', ['test', '--lib', '--locked'], path.join(root, 'src-tauri'));
if (selected('ui')) {
  env.ZEUS_CAPTURE_METRICS_PATH=path.join(root,'.zeus/evaluations/browser-capture-measurements.json');
  const browserPython=path.join(root,'.zeus/browser-runtime/venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
  if(!fs.existsSync(browserPython)){console.error('Prepare the isolated browser runtime explicitly: python scripts/browser_service/setup_runtime.py --destination .zeus/browser-runtime/venv --install');code||=1;}
  else if(!uiFiles.length)run(browserPython,['tests/browser_service/test_service.py']);
  run(process.execPath, [path.join(root, 'node_modules/@playwright/test/cli.js'), 'test', '--config=playwright.offline.config.js',...uiFiles.map(name=>`${name}.spec.js`)]);
}
if (requested.includes('--release')) {
  env.ZEUS_TEST_RELEASE='1';
  run('cargo',['build','--release','--locked','--bin','zeus-evaluation','--features','evaluation-runner'],path.join(root,'src-tauri'));
  if(!code)run(process.execPath,[path.join(root,'node_modules/@playwright/test/cli.js'),'test','--config=playwright.offline.config.js',
    'attachments','browser_capture','browser_ownership','browser_recordings','browser_visuals','browser_readiness','message_links','viewer_layout','--grep',
    'large valid image|one root-owned browser|Stop during navigation|ordinary fresh launch|production collector and live viewer|real before/after evidence|explicit worker screenshot|readiness checks preserve|task files reveal|live and replay viewers use']);
}
process.exitCode = code;
