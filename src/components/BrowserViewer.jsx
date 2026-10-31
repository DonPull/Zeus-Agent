import React,{useCallback,useEffect,useRef,useState} from 'react';
import Modal from './Modal';
import * as bridge from '../bridge';
import {fitBrowserImage} from '../utils';

const terminal=status=>!['starting','active','finalizing'].includes(status);
const labels={starting:'Preparing browser',active:'Live',finalizing:'Closing browser',completed:'Browser closed',cancelled:'Browser stopped',failed:'Browser error',interrupted:'Browser interrupted'};

// Image reads are serialized; events carry identity/version metadata only.
export default function BrowserViewer({isOpen,onClose,taskId,sessionId,mode='replay',onOpenReplay}){
    const [record,setRecord]=useState(null),[snapshot,setSnapshot]=useState(null),[index,setIndex]=useState(0),[after,setAfter]=useState(0);
    const [relation,setRelation]=useState('after'),[error,setError]=useState(''),[notice,setNotice]=useState(''),[src,setSrc]=useState(null),[shown,setShown]=useState(null);
    const [zoom,setZoom]=useState('fit'),[scale,setScale]=useState({scaleX:1,scaleY:1}),[clock,setClock]=useState(Date.now()),[deleting,setDeleting]=useState(false),[full,setFull]=useState(false);
    const stage=useRef(null),img=useRef(null),viewer=useRef(null),url=useRef(null),imageRequest=useRef(null),pending=useRef(null),imageEpoch=useRef(0);
    const pageTrail=useRef([]),pageSelection=useRef(null);
    const older=sessionId?.startsWith('sess_'),live=mode==='live',actions=record?.actions||[],action=actions[index];
    const updateScale=useCallback(()=>{
        const image=img.current,viewport=stage.current;if(!image||!viewport)return;
        if(zoom==='fit'){const next=fitBrowserImage(image,viewport);if(next)setScale(next);}
        else if(image.naturalWidth){const factor=Number(zoom);image.style.width=`${image.naturalWidth*factor}px`;image.style.height=`${image.naturalHeight*factor}px`;setScale({scaleX:factor,scaleY:factor});}
    },[zoom]);
    useEffect(()=>{if(!isOpen||!stage.current)return;const observer=new ResizeObserver(updateScale);observer.observe(stage.current);return()=>observer.disconnect();},[isOpen,updateScale]);
    useEffect(()=>{updateScale();},[zoom,src,updateScale]);
    useEffect(()=>{if(!isOpen)return;setClock(Date.now());const timer=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(timer);},[isOpen,taskId,sessionId]);

    const loadImage=useCallback(request=>{
        pending.current=request;if(imageRequest.current)return;
        const drain=async()=>{
            while(pending.current){
                const next=pending.current;pending.current=null;const epoch=imageEpoch.current;
                try{
                    const bytes=next.kind==='live'?await bridge.readBrowserLiveImage(next.task,next.session,next.seq):await bridge.readBrowserRecordingImage(next.task,next.session,next.frame);
                    if(epoch!==imageEpoch.current||pending.current)continue;
                    const object=URL.createObjectURL(new Blob([bytes instanceof ArrayBuffer?bytes:new Uint8Array(bytes)],{type:'image/jpeg'}));
                    if(url.current)URL.revokeObjectURL(url.current);url.current=object;setSrc(object);setShown(next);setError('');
                }catch(reason){if(epoch===imageEpoch.current&&!pending.current){setError(String(reason));if(!next.keep){if(url.current)URL.revokeObjectURL(url.current);url.current=null;setSrc(null);setShown(null);}}}
            }
        };
        imageRequest.current=drain().finally(()=>{imageRequest.current=null;if(pending.current)loadImage(pending.current);});
    },[]);
    useEffect(()=>{
        imageEpoch.current++;pending.current=null;if(url.current)URL.revokeObjectURL(url.current);url.current=null;
        pageTrail.current=[];pageSelection.current=null;
        setSrc(null);setShown(null);setSnapshot(null);setRecord(null);setIndex(0);setAfter(0);setError('');setNotice('');setDeleting(false);setFull(false);
        return()=>{imageEpoch.current++;pending.current=null;if(url.current)URL.revokeObjectURL(url.current);url.current=null;};
    },[isOpen,taskId,sessionId]);

    useEffect(()=>{
        if(!isOpen||!taskId||!sessionId)return;
        let disposed=false,busy=false,again=false,unsubscribe,timer;
        let revision=-1,sessionVersion=-1,lastKey='';
        const refresh=async()=>{
            if(busy){again=true;return;}busy=true;
            try{
                do{
                    again=false;
                    if(live&&!older){
                        const next=await bridge.getBrowserCapture(taskId,sessionId);if(disposed)break;
                        if(next.capture.revision<revision||next.session.version<sessionVersion)continue;
                        revision=next.capture.revision;sessionVersion=next.session.version;setSnapshot(next);
                        const ended=terminal(next.session.status),frame=ended?next.last_retained_frame:next.capture.frame;
                        const key=frame?(ended?`retained:${frame.id}`:`live:${frame.seq}`):'';
                        if(frame&&key!==lastKey){lastKey=key;loadImage({kind:ended?'recorded':'live',task:taskId,session:sessionId,seq:frame.seq,frame:frame.id,metadata:frame,keep:true});}
                        if(!ended)await bridge.heartbeatBrowserViewer(taskId,sessionId);
                    }else{
                        const page=await bridge.getBrowserRecordingPage(taskId,sessionId,after,50);if(disposed)break;
                        setRecord(page);if(live)setIndex(Math.max(0,page.actions.length-1));
                        else {const wanted=pageSelection.current;setIndex(i=>wanted===-1?Math.max(0,page.actions.length-1):Math.min(wanted??i,Math.max(0,page.actions.length-1)));pageSelection.current=null;}
                    }
                }while(again&&!disposed);
            }catch(reason){if(!disposed)setError(String(reason));}finally{busy=false;}
        };
        const start=async()=>{
            if(live&&!older){unsubscribe=await bridge.onManagedBrowserCapture(event=>{if(event.task_id===taskId&&event.session_id===sessionId&&event.generation===1)refresh();});if(disposed){unsubscribe();return;}}
            await refresh();
            if(!disposed&&live)timer=setInterval(refresh,1000);
        };start().catch(reason=>{if(!disposed)setError(String(reason));});
        return()=>{disposed=true;clearInterval(timer);unsubscribe?.();};
    },[isOpen,taskId,sessionId,live,older,after,loadImage]);

    const turnPage=useCallback(direction=>{
        if(direction>0&&record?.next_after!=null){pageTrail.current.push(after);pageSelection.current=0;setAfter(record.next_after);}
        else if(direction<0&&pageTrail.current.length){pageSelection.current=-1;setAfter(pageTrail.current.pop());}
    },[after,record?.next_after]);
    const step=useCallback(direction=>{
        if(direction<0&&index<=0)turnPage(-1);
        else if(direction>0&&index>=actions.length-1)turnPage(1);
        else setIndex(i=>Math.max(0,Math.min(actions.length-1,i+direction)));
    },[index,actions.length,turnPage]);
    useEffect(()=>{
        if(!isOpen||(live&&!older))return;
        const epoch=++imageEpoch.current;pending.current=null;
        const frames=action?.frames||[],frame=frames.find(frame=>frame.relation===relation)||frames.find(frame=>frame.relation==='after')||frames[0];
        if(url.current)URL.revokeObjectURL(url.current);url.current=null;setSrc(null);setShown(null);setError('');
        if(frame&&['available','unverified'].includes(frame.status))loadImage({kind:'recorded',task:taskId,session:sessionId,frame:frame.id,metadata:frame.metadata,box:older?action.bounding_box:null,keep:false});
        return()=>{if(imageEpoch.current===epoch)imageEpoch.current++;};
    },[isOpen,taskId,sessionId,index,relation,record,live,older,loadImage]);

    useEffect(()=>{
        if(!isOpen||live)return;
        const key=event=>{if(['INPUT','SELECT','TEXTAREA'].includes(event.target.tagName))return;
            if(event.key==='ArrowLeft')step(-1);if(event.key==='ArrowRight')step(1);};
        window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
    },[isOpen,live,step]);
    const close=()=>{if(document.fullscreenElement===viewer.current)document.exitFullscreen().catch(()=>{});onClose();};
    useEffect(()=>{
        if(!isOpen)return;
        const changed=()=>setFull(document.fullscreenElement===viewer.current);
        const escape=event=>{if(event.key==='Escape'&&document.fullscreenElement===viewer.current){event.preventDefault();event.stopImmediatePropagation();document.exitFullscreen().catch(()=>{});}};
        document.addEventListener('fullscreenchange',changed);window.addEventListener('keydown',escape,true);
        return()=>{document.removeEventListener('fullscreenchange',changed);window.removeEventListener('keydown',escape,true);};
    },[isOpen]);
    const toggleFull=async()=>{try{if(document.fullscreenElement===viewer.current)await document.exitFullscreen();else await viewer.current.requestFullscreen();setFull(!!document.fullscreenElement);}catch(reason){setNotice(`Full screen is unavailable: ${reason}`);}};
    const exportRecording=async()=>{try{const result=await bridge.exportBrowserRecording(taskId,sessionId);setNotice(`Export saved to ${result.path}`);}catch(reason){setNotice(String(reason));}};
    const removeImages=async()=>{
        if(!deleting){setDeleting(true);return;}
        try{const result=await bridge.deleteBrowserRecordingImages(taskId,sessionId);setNotice(`Deleted ${result.deleted} images; ${result.failed} could not be deleted.`);imageEpoch.current++;pending.current=null;if(url.current)URL.revokeObjectURL(url.current);url.current=null;setSrc(null);setShown(null);
            setRecord(await bridge.getBrowserRecordingPage(taskId,sessionId,after,50));
        }catch(reason){setNotice(String(reason));}finally{setDeleting(false);}
    };
    if(!isOpen)return null;
    const info=snapshot?.session||record?.session,status=info?.status;
    const age=shown?.metadata?.ended_ms?Math.max(0,Math.floor((clock-shown.metadata.ended_ms)/1000)):null;
    const stale=live&&!older&&!terminal(status)&&age!==null&&age>6;
    const label=older?'Older recording — limited evidence':status&&terminal(status)?labels[status]||'Browser closed':stale?'Preview stale':snapshot?.capture.state==='capture_error'?'Capture unavailable':snapshot?.capture.state==='no_tab'?'No open tab':labels[status]||'Waiting for browser';
    const box=shown?.box,frames=action?.frames||[],active=status&&!terminal(status);
    return <Modal isOpen={isOpen} onClose={close} className={`${mode}-modal-window`}>
        <div ref={viewer} className={`${mode}-modal-container column browser-viewer`}>
            <div className="modal-header align-center justify-space-between"><strong>{live?'Live Browser View':'Browser Session Replay'}</strong><button id={`${mode}-modal-close-button`} className="modal-close-button" onClick={close} aria-label="Close browser viewer">✕</button></div>
            <div className="browser-viewer-status" role="status"><strong>{label}</strong>{age!==null&&<span> · Captured {age}s ago</span>}{info?.terminal_reason&&<span> · {info.terminal_reason}</span>}</div>
            <div className="browser-viewer-toolbar">
                {!live&&<><button id="replay-prev-button" className="replay-nav-btn" disabled={index<=0&&after===0} onClick={()=>step(-1)}>◀ Prev</button><span className="mono">{action?`Action ${action.seq} of ${record.total_actions}`:'No actions'}</span><button id="replay-next-button" className="replay-nav-btn" disabled={index>=actions.length-1&&record?.next_after==null} onClick={()=>step(1)}>Next ▶</button></>}
                <span className="browser-viewer-address mono" title={shown?.metadata?.url||action?.arguments?.url||''}>{shown?.metadata?.url||action?.arguments?.url||''}</span>
                {shown?.metadata?.tab_id&&<span className="mono" title={shown.metadata.tab_id}>Tab {shown.metadata.tab_id.slice(0,8)}</span>}
                <label>Size <select aria-label="Browser image size" value={zoom} onChange={event=>setZoom(event.target.value)}><option value="fit">Fit</option><option value="1">100%</option><option value="1.5">150%</option><option value="2">200%</option></select></label><button className="replay-nav-btn" onClick={toggleFull}>{full?'Exit full screen':'Full screen'}</button>
            </div>
            {!live&&action&&<div className="browser-viewer-action"><strong>{action.op}</strong> · {action.status}{action.caller&&` · ${action.caller}`}<span className="mono"> {action.created_at||''}</span>{frames.length>1&&<label> Image <select aria-label="Action image timing" value={relation} onChange={event=>setRelation(event.target.value)}>{frames.map(frame=><option key={frame.id} value={frame.relation}>{frame.relation} · {frame.status}</option>)}</select></label>}</div>}
            {!live&&action&&<details className="browser-viewer-details"><summary>Action details{action.outcome?.error?.code?` · ${action.outcome.error.code}`:''}</summary>{action.presentation_truncated&&<span>Long details are shortened here. The full managed journal is available in the recording export.</span>}<pre>{JSON.stringify({arguments:action.arguments,outcome:action.outcome},null,2)}</pre></details>}
            <div ref={stage} className={`${mode}-viewport-wrapper browser-viewer-viewport ${zoom==='fit'?'fit':'zoomed'}`}>
                {src?<div className={`${mode}-image-box browser-viewer-image`}><img ref={img} id={live?'live-viewport-img':'replay-screenshot-img'} src={src} className={`${mode}-screenshot-img`} alt="Recorded browser pixels" onLoad={updateScale} onError={()=>{setError('The image could not be displayed.');setSrc(null);setShown(null);}}/>{box&&<div className="replay-bounding-box" style={{left:box.x*scale.scaleX,top:box.y*scale.scaleY,width:box.width*scale.scaleX,height:box.height*scale.scaleY}}/>}</div>:<div className="browser-viewer-empty">{error||(!live&&action?'No image retained for this action.':older?'No image available in this older recording.':'Waiting for the first browser image…')}</div>}
            </div>
            {error&&src&&<div className="browser-viewer-notice">Last available image shown. {error}</div>}
            {!live&&<div className="replay-timeline-bar align-center gap-8">{actions.map((item,i)=><button key={item.id} className={`replay-step-pill ${i===index?'active':''}`} onClick={()=>setIndex(i)} title={`${item.op}: ${item.status}`}>{item.seq} {item.op} · {item.status}</button>)}</div>}
            <div className="browser-viewer-footer">
                <span>{record?.coverage||'Sampled, read-only view. Closing the browser does not verify the user goal.'}{snapshot?.coverage?.length>0||record?.coverage_gaps?.length>0?' · Recording gaps are present.':''}</span>
                {!live&&after>0&&<button className="replay-nav-btn" onClick={()=>turnPage(-1)}>Earlier actions</button>}{!live&&record?.next_after!=null&&<button className="replay-nav-btn" onClick={()=>turnPage(1)}>Later actions</button>}
                {live&&onOpenReplay&&<button className="replay-nav-btn" onClick={()=>{close();onOpenReplay(sessionId,taskId);}}>Replay</button>}
                {!older&&!live&&!active&&<><button className="replay-nav-btn" onClick={exportRecording}>Export recording</button><button className="replay-nav-btn" onClick={removeImages}>{deleting?'Confirm delete images':'Delete images'}</button>{deleting&&<button className="replay-nav-btn" onClick={()=>setDeleting(false)}>Keep images</button>}</>}
            </div>
            {(snapshot?.coverage?.length>0||record?.coverage_gaps?.length>0)&&<details className="browser-viewer-details"><summary>Recording coverage</summary><pre>{JSON.stringify(snapshot?.coverage||record.coverage_gaps,null,2)}</pre></details>}
            {notice&&<div className="browser-viewer-notice" role="status">{notice}</div>}
        </div>
    </Modal>;
}
