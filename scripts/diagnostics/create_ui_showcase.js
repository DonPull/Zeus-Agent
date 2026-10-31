#!/usr/bin/env node
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const args=process.argv.slice(2);
if(args.includes('--help'))console.log('Usage: node scripts/diagnostics/create_ui_showcase.js [--data-dir ABSOLUTE_DIRECTORY]\nCreates one inert, idempotent UI showcase chat. No existing conversations are edited.');
else{
    const build=spawnSync('cargo',['build','--locked','--bin','zeus-diagnostics'],{cwd:path.join(root,'src-tauri'),windowsHide:true,shell:false,stdio:['ignore','ignore','inherit']});
    if(build.status!==0)process.exitCode=build.status??1;
    else{const result=spawnSync(path.join(root,'src-tauri/target/debug',process.platform==='win32'?'zeus-diagnostics.exe':'zeus-diagnostics'),['create-ui-showcase',...args],{cwd:root,windowsHide:true,shell:false,stdio:'inherit'});if(result.error)console.error(result.error.message);process.exitCode=result.status??1;}
}
