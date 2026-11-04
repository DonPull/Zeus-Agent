const statuses={done:'completed',completed:'completed',x:'completed',active:'in_progress','in progress':'in_progress','in_progress':'in_progress','/':'in_progress','-':'in_progress',failed:'failed',interrupted:'interrupted',pending:'pending',' ':'pending'};
export function planLine(line){
    const match=line.trim().match(/^(?:[-*+]\s+|\d+[.)]\s+|Step\s+\d+[:.]?\s+)(?:\[([^\]]*)\]\s*)?(.+)$/i);
    if(!match)return null;
    const marker=match[1],text=match[2],inline=text.match(/\((done|completed|in progress|active|failed|interrupted)\)/i);
    if(marker==null&&!inline&&!/^\d+[.)]|^Step\s+\d+/i.test(line.trim()))return null;
    const status=statuses[(marker??inline?.[1]??'pending').toLowerCase()]||'pending';
    const title=text.replace(/\s*\((done|completed|in progress|active|failed|interrupted)\)/ig,'').trim();
    return {title,status};
}
const identity=value=>value.replace(/[*_`]/g,'').trim().toLowerCase();
export function readActionPlan(content){
    let data={markdown:content};
    let candidate=content;if(typeof content==='string')try{candidate=JSON.parse(content);}catch{}
    if(candidate&&typeof candidate==='object'&&!Array.isArray(candidate))data=candidate;
    const markdown=typeof data.markdown==='string'?data.markdown:typeof content==='string'?content:'';
    const parsed=markdown.split('\n').map(planLine).filter(Boolean),stored=Array.isArray(data.steps)?data.steps.filter(step=>step&&typeof step.title==='string'):[];
    // Old payloads had no provenance and the fallback parser stored [Done] as
    // pending. Repair that narrow, matching presentation without rewriting history.
    const legacy=!data.steps_source&&stored.length===parsed.length&&stored.every((s,i)=>s.status==='pending'&&identity(s.title)===identity(parsed[i].title));
    const steps=(!stored.length||data.steps_source==='markdown'||legacy?parsed:stored).map((s,i)=>({...s,id:s.id||`step-${i+1}`,status:statuses[s.status]||s.status||'pending'}));
    const notes=markdown.split('\n').filter(line=>!planLine(line)&&!steps.some(step=>identity(line.replace(/^[-*+]\s*/,''))===identity(step.title))).join('\n').trim();
    return {steps,notes:notes.replace(/^#+\s+[^\n]+\s*$/,'').trim(),checkpoint:data.checkpoint||null};
}
