/** Host-selected browser-fixture contract. Synthetic smoke defaults stay narrow. */
import {RPC_LIMITS,createFileClient,createHostExchange} from './file_rpc.mjs';
export const MISSION_RPC_LIMITS=Object.freeze({...RPC_LIMITS,messages:4096,totalBytes:64*1024*1024});
function exact(value,keys){if(!value||Array.isArray(value)||typeof value!=='object'||Object.keys(value).sort().join(',')!==[...keys].sort().join(','))throw Error('Invalid mission exchange fields');}
function identify(value,nonce){if(value.schema_version!==1||value.nonce!==nonce||!Number.isSafeInteger(value.id)||value.id<1||value.id>MISSION_RPC_LIMITS.messages)throw Error('Invalid mission exchange identity');}
function decode(value,maximum){
  if(typeof value!=='string'||value.length>maximum*4/3+4||value.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(value))throw Error('Invalid mission body');
  const bytes=Buffer.from(value,'base64');if(bytes.length>maximum||bytes.toString('base64')!==value)throw Error('Mission body exceeds allowance');return bytes;
}
export function fixtureRoute(mission,method,route,body){
  if(!['B01','B02','B03','M02'].includes(mission))throw Error('This mission has no browser fixture');
  if(typeof route!=='string'||route.length>2048||!route.startsWith('/')||route.startsWith('//')||/[\\\x00-\x20#]/.test(route))throw Error('Invalid fixture path');
  const url=new URL(route,'http://fixture');
  if(url.origin!=='http://fixture'||url.pathname!==route.split('?')[0])throw Error('Fixture path normalization is forbidden');
  if(body.length>8192||(method==='GET'&&body.length))throw Error('Fixture request body exceeds allowance');
  const pathname=url.pathname;
  if(method==='GET'&&['/','/favicon.ico'].includes(pathname)&&!url.search)return true;
  if(mission==='B01'&&!url.search&&((method==='GET'&&pathname==='/api/tickets')||(method==='PATCH'&&/^\/api\/tickets\/T-\d+$/.test(pathname))||(['GET','POST'].includes(method)&&pathname==='/api/publish')))return true;
  if(['B02','B03','M02'].includes(mission)&&method==='GET'&&pathname==='/api/records'&&!url.search)return true;
  if(mission==='B02'&&method==='GET'&&['/api/orders','/api/orders.csv'].includes(pathname)){
    const keys=[...url.searchParams.keys()];if(new Set(keys).size!==keys.length||keys.some(key=>!['from','through','status','currency'].includes(key)))throw Error('Undeclared or duplicate fixture filter');return true;
  }
  if(mission==='B03'&&method==='POST'&&!url.search&&/^\/api\/drafts\/D-\d+\/(save|submit)$/.test(pathname))return true;
  if(mission==='M02'&&method==='POST'&&!url.search&&/^\/api\/tickets\/SYN-\d+\/(note|status)$/.test(pathname))return true;
  throw Error('Route is outside the mission fixture contract');
}
export function missionRequestValidator(mission){return (value,nonce)=>{
  exact(value,['schema_version','nonce','id','channel','method','path','body_base64']);identify(value,nonce);
  const body=decode(value.body_base64,1024*1024);
  if(value.channel==='provider'){
    if(value.method!=='POST'||value.path!=='/chat/completions')throw Error('Undeclared mission provider route');
  }else if(value.channel==='fixture')fixtureRoute(mission,value.method,value.path,body);
  else if(value.channel==='workflow'){
    if(value.method!=='POST'||!(mission==='B03'&&value.path==='/correction'||mission==='M02'&&['/restart-checkpoint','/restart-complete'].includes(value.path)))throw Error('Undeclared workflow checkpoint route');
  }
  else throw Error('Undeclared mission channel');
  return {...value,body};
};}
export function missionResponseValidator(value,nonce,id){
  exact(value,['schema_version','nonce','id','status','content_type','body_base64','content_disposition']);identify(value,nonce);
  if(value.id!==id||!Number.isInteger(value.status)||value.status<200||value.status>599||!['text/event-stream','text/html','application/json','text/csv'].includes(value.content_type)||![null,'attachment; filename="orders.csv"'].includes(value.content_disposition))throw Error('Invalid mission response metadata');
  return {...value,body:decode(value.body_base64,1024*1024)};
}
export const missionResponseFields=response=>({content_disposition:response.content_disposition??null});
export function createMissionFileClient(options){return createFileClient({...options,limits:MISSION_RPC_LIMITS,requestValidator:missionRequestValidator(options.mission),responseValidator:missionResponseValidator});}
export function createMissionHostExchange(options){return createHostExchange({...options,limits:MISSION_RPC_LIMITS,requestValidator:missionRequestValidator(options.mission),responseValidator:missionResponseValidator,responseFields:missionResponseFields});}
