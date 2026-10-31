import React,{useEffect,useState} from 'react';
import Modal from './Modal';
import * as bridge from '../bridge';

export default function BrowserHistoryModal({isOpen,onClose,taskId,onOpenReplay}){
    const [data,setData]=useState(null),[offset,setOffset]=useState(0),[error,setError]=useState('');
    useEffect(()=>{setOffset(0);setData(null);setError('');},[isOpen,taskId]);
    useEffect(()=>{
        if(!isOpen||!taskId)return;let disposed=false;
        bridge.listBrowserRecordings(taskId,offset).then(value=>{if(!disposed){setData(value);setError('');}}).catch(reason=>{if(!disposed)setError(String(reason));});
        return()=>{disposed=true;};
    },[isOpen,taskId,offset]);
    return <Modal isOpen={isOpen} onClose={onClose} className="browser-history-window">
        <div className="column gap-15"><div className="align-center justify-space-between"><strong>Browser history</strong><button className="modal-close-button" onClick={onClose} aria-label="Close browser history">✕</button></div>
            <span>Recorded actions and available images. Older recordings have limited evidence.</span>
            {error?<span role="alert">{error}</span>:!data?'Loading recordings…':!data.recordings.length?'No browser recordings for this task.':<div className="column gap-10">{data.recordings.map(item=><button className="browser-history-row" key={item.session_id} onClick={()=>onOpenReplay(item.session_id,taskId)}><strong>{item.kind==='older'?'Older recording':item.status}</strong><span>{item.time_source==='recording_file_modified'?'File updated: ':''}{item.created_at} · {item.session_id.slice(0,8)}</span><span>Replay →</span></button>)}</div>}
            {data?.older_scan_truncated&&<span>Only the first 1,000 older entries were scanned.</span>}
            <div className="align-center gap-10"><button className="replay-nav-btn" disabled={offset===0} onClick={()=>setOffset(value=>Math.max(0,value-50))}>Previous recordings</button><button className="replay-nav-btn" disabled={data?.next_offset==null} onClick={()=>setOffset(data.next_offset)}>More recordings</button></div>
        </div>
    </Modal>;
}
