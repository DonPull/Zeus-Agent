/** Trusted grader routing only. This never relaxes the host execution guard. */
import path from 'node:path';
export function candidateCommand(){
  const launcher=process.env.ZEUS_GRADER_CANDIDATE_LAUNCHER;
  if(!launcher)return 'python';
  if(process.platform!=='win32'||process.env.USERNAME!=='WDAGUtilityAccount'||launcher!=='C:\\Zeus\\GraderPrivate\\candidate-python.exe')throw Error('Candidate launcher is restricted to the disposable grading guest');
  return launcher;
}
export function candidateScript(script){
  if(process.env.ZEUS_GRADER_CANDIDATE_LAUNCHER&&path.basename(script)==='function_probe.py')return 'C:\\Zeus\\PublicTools\\function_probe.py';
  return script;
}
