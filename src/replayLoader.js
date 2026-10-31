import * as bridge from './bridge/index.js';

export function replayFrame(frames=[],relation='after'){
    const usable=frames.filter(frame=>['available','unverified'].includes(frame.status));
    return usable.find(frame=>frame.relation===relation)||usable.find(frame=>frame.relation==='after')||usable[0]||frames[0];
}
export function imageStep(rows,current,delta){
    const candidates=rows.filter(row=>row.has_image&&(delta>0?row.seq>current:row.seq<current));
    if(delta<0)candidates.reverse();return candidates[Math.min(Math.abs(delta)-1,candidates.length-1)]?.seq??current;
}

// Bounded lookahead, not an unbounded recording download. Every image still
// uses the native owned-file/hash/decoder validation before browser decoding.
export class ReplayLoader {
    constructor(task,session){this.task=task;this.session=session;this.records=new Map();this.pages=new Map();this.images=new Map();this.jobs=new Map();this.queue=[];this.active=0;this.bytes=0;this.closed=false;this.displayed=null;this.version=0;}
    async page(seq){
        if(this.records.has(seq))return {...this.header,actions:[this.records.get(seq)]};
        const after=Math.floor((seq-1)/20)*20;
        if(!this.pages.has(after))this.pages.set(after,bridge.getBrowserRecordingPage(this.task,this.session,after,20).then(page=>{
            if(this.closed)throw Error('Viewer closed');const {actions,...header}=page;this.header=header;
            for(const action of actions)this.records.set(action.seq,action);
            while(this.records.size>120)this.records.delete(this.records.keys().next().value);
            return page;
        }).finally(()=>this.pages.delete(after)));
        const page=await this.pages.get(after);
        if(this.records.has(seq))return {...page,actions:[this.records.get(seq)]};
        const exact=await bridge.getBrowserRecordingPage(this.task,this.session,seq-1,1);if(this.closed)throw Error('Viewer closed');
        for(const action of exact.actions)this.records.set(action.seq,action);
        while(this.records.size>120)this.records.delete(this.records.keys().next().value);
        return exact;
    }
    image(frame,priority=false){
        const cached=this.images.get(frame.id);if(cached){this.images.delete(frame.id);this.images.set(frame.id,cached);return Promise.resolve(cached);}
        if(this.jobs.has(frame.id)){if(priority){const index=this.queue.findIndex(job=>job.frame.id===frame.id);if(index>0)this.queue.unshift(...this.queue.splice(index,1));}return this.jobs.get(frame.id);}
        const promise=new Promise((resolve,reject)=>{const job={frame,resolve,reject};if(priority)this.queue.unshift(job);else this.queue.push(job);});
        this.jobs.set(frame.id,promise);this.pump();return promise;
    }
    pump(){
        while(!this.closed&&this.active<3&&this.queue.length){
            const job=this.queue.shift();this.active++;
            (async()=>{let url;try{
                const bytes=await bridge.readBrowserRecordingImage(this.task,this.session,job.frame.id);if(this.closed)throw Error('Viewer closed');
                const blob=new Blob([bytes instanceof ArrayBuffer?bytes:new Uint8Array(bytes)],{type:job.frame.metadata?.mime||'image/jpeg'});
                url=URL.createObjectURL(blob);const decoded=new Image();decoded.src=url;await decoded.decode();if(this.closed)throw Error('Viewer closed');
                const value={url,decoded,bytes:blob.size+decoded.naturalWidth*decoded.naturalHeight*4};this.images.set(job.frame.id,value);this.bytes+=value.bytes;this.trim(job.frame.id);job.resolve(value);url=null;
            }catch(error){if(url)URL.revokeObjectURL(url);job.reject(error);}finally{this.jobs.delete(job.frame.id);this.active--;this.pump();}})();
        }
    }
    trim(candidate){for(const [id,value] of this.images){if(this.images.size<=12&&this.bytes<=64*1024*1024)break;if(id===this.displayed||id===candidate)continue;this.images.delete(id);this.bytes-=value.bytes;URL.revokeObjectURL(value.url);}}
    show(id){this.displayed=id;this.trim();}
    prefetch(rows,selected,relation){
        const version=++this.version,upcoming=rows.filter(row=>row.has_image&&row.seq>selected).slice(0,6);
        // Three workers also bound queued metadata reads during rapid seeks.
        let cursor=0;const work=async()=>{while(!this.closed&&version===this.version&&cursor<upcoming.length){const row=upcoming[cursor++];try{const page=await this.page(row.seq);if(version!==this.version||this.closed)return;const frame=replayFrame(page.actions[0]?.frames,relation);if(frame&&['available','unverified'].includes(frame.status))await this.image(frame);}catch{/* A selected frame reports its own error; lookahead never fabricates evidence. */}}};
        for(let i=0;i<3;i++)work();
    }
    clearImages(){this.version++;for(const value of this.images.values())URL.revokeObjectURL(value.url);this.images.clear();this.bytes=0;this.records.clear();}
    close(){this.closed=true;this.clearImages();for(const job of this.queue)job.reject(Error('Viewer closed'));this.queue=[];}
}
