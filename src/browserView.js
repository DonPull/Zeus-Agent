export const browserTerminal=status=>!!status&&!['starting','active','finalizing'].includes(status);
export const browserLabels={starting:'Preparing browser',active:'Live',finalizing:'Closing browser',completed:'Browser closed',cancelled:'Browser stopped',failed:'Browser error',interrupted:'Browser interrupted',historical:'Older recording'};
export function browserBadge(status,capture,endedMs,now,error){
    if(browserTerminal(status))return {label:browserLabels[status]||'Browser closed',tone:status==='failed'?'error':'closed'};
    if(error||capture?.state==='capture_error')return {label:'Capture unavailable',tone:'error'};
    if(capture?.state==='no_tab')return {label:'No open tab',tone:'waiting'};
    if(!endedMs)return {label:'Waiting for image',tone:'waiting'};
    const age=Math.max(0,now-endedMs);
    return age>=3000?{label:`Outdated · ${Math.floor(age/1000)}s`,tone:'outdated'}:{label:'Live',tone:'live'};
}
export function browserTime(value){
    if(value==null)return 'Time unavailable';const date=new Date(value);if(!Number.isFinite(date.getTime()))return 'Time unavailable';
    const pad=n=>String(n).padStart(2,'0');
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())} · ${pad(date.getDate())}/${pad(date.getMonth()+1)}/${date.getFullYear()}`;
}
export function browserDuration(session,now=Date.now()){
    if(!session)return null;let ms=session.duration_ms;
    if(!Number.isFinite(ms)){
        if(session.created_at==null||(browserTerminal(session.status)&&session.updated_at==null))return null;
        const start=new Date(session.created_at).getTime(),end=browserTerminal(session.status)?new Date(session.updated_at).getTime():now;ms=end-start;
    }
    if(!Number.isFinite(ms)||ms<0)return null;
    const seconds=Math.floor(ms/1000),hours=Math.floor(seconds/3600),minutes=Math.floor(seconds%3600/60);
    return `${hours?`${hours}h `:''}${hours||minutes?`${minutes}m `:''}${seconds%60}s`;
}
export const browserActor=caller=>caller==='master'?'Zeus':caller?.startsWith('worker:')?'Worker':caller==='observer'?'Observer':caller?.includes('/script:')?'Script':'Agent';

export function replaySpeed(value){
    if(!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(String(value).trim()))return null;
    const number=Number(value),rounded=Math.round((number+Number.EPSILON)*10)/10;
    return Number.isFinite(rounded)&&rounded>=0.1?rounded:null;
}
