import React from 'react';

export default function ManagedBrowserSessionCard({message,onOpenLiveView,onOpenReplay}) {
    let data;
    try {data=JSON.parse(message.content);} catch {return <div className="chat-message event"><div className="chat-bubble event">Browser session details are unavailable.</div></div>;}
    const labels={starting:'Preparing browser',active:'Browser active',finalizing:'Closing browser',completed:'Browser closed',cancelled:'Browser stopped',failed:'Browser error',interrupted:'Browser interrupted'};
    return <div className="chat-message event"><div className="browser-session-card column gap-10" role="status" aria-label="Managed browser session">
        <strong>{labels[data.status]||'Browser session'}</strong>
        {data.terminal_reason&&<span className="browser-session-subtext">{data.terminal_reason}</span>}
        <div className="align-center gap-10">
            {['starting','active','finalizing'].includes(data.status)&&<button className="replay-nav-btn" onClick={()=>onOpenLiveView?.(data.session_id,data.task_id)}>Watch</button>}
            <button className="replay-nav-btn" onClick={()=>onOpenReplay?.(data.session_id,data.task_id)}>Replay</button>
        </div>
    </div></div>;
}
