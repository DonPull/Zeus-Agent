/** Deterministic controller calibration, explicitly excluded from capability scores. */
import {PROVIDER_IDENTITY} from './provider_relay.mjs';
export function scriptedProvider(replies){
  if(!Array.isArray(replies)||!replies.length||replies.length>32)throw Error('Invalid scripted provider control');
  let used=0;
  return async({method,path,body})=>{
    if(method==='GET'&&path==='/models')return {status:200,content_type:'application/json',body:Buffer.from(JSON.stringify({data:[{id:PROVIDER_IDENTITY.model}]}))};
    if(method!=='POST'||path!=='/chat/completions')throw Error('Undeclared scripted provider route');
    const reply=replies[used++];if(!reply)throw Error('Scripted provider replies exhausted');
    const content='```zeus-directive\n'+JSON.stringify(reply)+'\n```',usage={prompt_tokens:5,completion_tokens:5,total_tokens:10};
    const streaming=JSON.parse(body).stream===true;
    return {status:200,content_type:streaming?'text/event-stream':'application/json',body:Buffer.from(streaming?
      'data: '+JSON.stringify({choices:[{delta:{content}}],usage})+'\n\ndata: [DONE]\n\n':JSON.stringify({choices:[{message:{role:'assistant',content},finish_reason:'stop'}],usage}))};
  };
}
