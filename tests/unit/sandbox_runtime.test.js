import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import {withScratch} from '../benchmarks/mission_kit.js';

test('runtime catalogue reads embedded JSON as data and accepts only exact Microsoft x64 cabinet routes',()=>{
  const valid='https://msedge.sf.dl.delivery.mp.microsoft.com/filestreamingservice/files/'+'a'.repeat(36)+'/Microsoft.WebView2.FixedVersionRuntime.157.0.1.2.x64.cab';
  const invalid=[valid.replace('msedge.sf.dl.delivery.mp.microsoft.com','example.invalid'),valid.replace('.x64.cab','.arm64.cab'),
    valid.replace('https://','https://password@'),valid.replace('/filestreamingservice/','/unexpected/'),valid+'?track=1',valid.replace('.com/','.com:443/')];
  const embedded=JSON.stringify([valid,...invalid]).replaceAll('/','\\u002F');
  const input='<script>throw new Error("Never evaluate webpage code");</script><script id="data" type="application/json">'+embedded+'</script>';
  const code='import importlib.util,sys,json; spec=importlib.util.spec_from_file_location("runtime_preparer",sys.argv[1]); module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module); print(json.dumps([module.parse_catalogue(value.encode("utf8")) for value in json.loads(sys.argv[2])]))';
  const result=spawnSync('python',['-I','-B','-c',code,path.resolve('scripts/eval_harness/sandbox/prepare_runtime.py'),JSON.stringify([input,...invalid])],{encoding:'utf8',windowsHide:true,timeout:10000});
  assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),[[valid],...invalid.map(()=>[])]);
});

test('public runtime copying excludes host site packages, startup customizations and credential files',()=>withScratch(root=>{
  const source=path.join(root,'source'),destination=path.join(root,'bundle');
  for(const [name,content] of Object.entries({'Lib/os.py':'public stdlib','Lib/site-packages/private.py':'private package',
    'Lib/sitecustomize.py':'private startup','Lib/usercustomize.py':'private startup','Lib/__pycache__/cached.pyc':'cache',
    '.npmrc':'private token','.env':'private environment','public/LICENSE':'public license'})){
    const file=path.join(source,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,content);
  }
  const code='import importlib.util,sys,json,pathlib; spec=importlib.util.spec_from_file_location("runtime_preparer",sys.argv[1]); module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module); module.copy_public_tree(pathlib.Path(sys.argv[2]),pathlib.Path(sys.argv[3])); print(json.dumps([x["path"] for x in module.tree_inventory(pathlib.Path(sys.argv[3]))]))';
  const result=spawnSync('python',['-I','-B','-c',code,path.resolve('scripts/eval_harness/sandbox/prepare_runtime.py'),source,destination],{encoding:'utf8',windowsHide:true,timeout:10000});
  assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),['Lib/os.py','public/LICENSE']);
}));
