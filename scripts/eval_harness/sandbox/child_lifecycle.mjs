/** Observe actual close events; a signaled child can have a null exitCode. */
export function trackChild(child){
  let closed=false,termination=null,resolve;
  const finished=new Promise(done=>resolve=done);
  child.once('close',(code,signal)=>{closed=true;termination={exit_code:code,signal};resolve(true);});
  return {get closed(){return closed;},get termination(){return termination;},async wait(timeoutMs){
    if(closed)return true;let timer;
    try{return await Promise.race([finished,new Promise(done=>timer=setTimeout(()=>done(false),timeoutMs))]);}
    finally{clearTimeout(timer);}
  }};
}
