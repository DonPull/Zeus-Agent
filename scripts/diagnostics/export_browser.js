#!/usr/bin/env node
// Explicit internal snapshot, using the same validated exporter as native tests.
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const args=process.argv.slice(2);
if(!args.length||args.includes('--help')){
    console.log('Usage: node scripts/diagnostics/export_browser.js --task UUID --session UUID [--data-dir ABSOLUTE_DIRECTORY]');
}else{
    const build=spawnSync('cargo',['build','--locked','--bin','zeus-diagnostics'],{cwd:path.join(root,'src-tauri'),windowsHide:true,stdio:['ignore','ignore','inherit'],shell:false});
    if(build.status!==0){if(build.error)console.error(build.error.message);process.exitCode=build.status??1;}
    else{
        const result=spawnSync(path.join(root,'src-tauri/target/debug',process.platform==='win32'?'zeus-diagnostics.exe':'zeus-diagnostics'),['export-browser',...args],{cwd:root,windowsHide:true,stdio:'inherit',shell:false});
        if(result.error)console.error(result.error.message);process.exitCode=result.status??1;
    }
}
