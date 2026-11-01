import React,{useEffect,useState} from 'react';
import * as bridge from '../bridge';

export default function ManagedBrowserSessionCard({message,onOpenLiveView,onOpenReplay,preview=false}) {
    let data;try {data=JSON.parse(message.content);} catch {data=null;}
    const [runStatus,setRunStatus]=useState(null);
    const [historicalActions,setHistoricalActions]=useState(false);
    useEffect(()=>{
        setHistoricalActions(false);if(preview||!data||['starting','active','finalizing'].includes(data.status)||data.action_count!=null)return;
        let disposed=false;bridge.getBrowserRecordingIndex(data.task_id,data.session_id).then(page=>{if(!disposed)setHistoricalActions(page.actions.length>0);}).catch(()=>{});
        return()=>{disposed=true;};
    },[preview,data?.task_id,data?.session_id,data?.status,data?.action_count]);
    useEffect(()=>{
        if(preview||!data)return;let disposed=false,unsubscribe;
        let latest='';const accept=run=>{if(!disposed&&run?.id===data.run_id&&(run.updated_at||'')>=latest){latest=run.updated_at||'';setRunStatus(run.status);}};
        bridge.onTaskEvent(event=>{if(event.task_id===data.task_id)accept(event.run);}).then(stop=>{if(disposed)stop();else{unsubscribe=stop;bridge.getTaskRunState(data.task_id).then(accept).catch(()=>{});}}).catch(()=>{});
        return()=>{disposed=true;unsubscribe?.();};
    },[preview,data?.run_id,data?.task_id]);
    if(!data)return <div className="chat-message event"><div className="chat-bubble event">Browser session details are unavailable.</div></div>;
    const active=['starting','active','finalizing'].includes(data.status),waiting=active&&(data.handoff_pending||['waiting_for_approval','waiting_for_user'].includes(runStatus??data.run_status));
    const labels={starting:'Preparing',active:'In progress',finalizing:'Finishing',completed:'Finished',cancelled:'Stopped',failed:'Error',interrupted:'Interrupted'};
    return <div className="chat-message event"><div className="browser-session-card column gap-10" role="status" aria-label="Managed browser session">
        <div className={`browser-card-heading ${waiting?'waiting':data.status}`}><span className={`browser-status-dot ${active&&!waiting?'working':''}`} aria-hidden="true"/><strong>Browser session</strong><span className="browser-card-status">{waiting?'Waiting for you':labels[data.status]||'Unknown status'}</span></div>
        {data.terminal_reason&&<span className="browser-session-subtext">{data.terminal_reason}</span>}
        <div className="align-center gap-10">
            {active&&<button className="replay-nav-btn" onClick={()=>onOpenLiveView?.(data.session_id,data.task_id)}>Watch</button>}
            {!active&&(data.action_count>0||historicalActions)&&<button className="replay-nav-btn" onClick={()=>onOpenReplay?.(data.session_id,data.task_id)}>View replay</button>}
        </div>
    </div></div>;
}
