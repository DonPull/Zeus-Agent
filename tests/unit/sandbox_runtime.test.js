import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

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
