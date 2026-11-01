import {useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';
import Modal from './Modal';
import ModalCloseButton,{ModalIconButton} from './ModalCloseButton';
import BrowserActionOverlay from './BrowserActionOverlay';
import * as bridge from '../bridge';
import {fitBrowserImage} from '../utils';
import {browserTerminal as terminal,browserBadge,browserTime,browserDuration,browserActor,replaySpeed} from '../browserView';
import {ReplayLoader,replayFrame,imageStep} from '../replayLoader';

const PILL=116,JUMPS=[-100,-75,-50,-25,-5,-1,1,5,25,50,75,100];

export default function BrowserViewer({isOpen,onClose,taskId,sessionId,mode='replay'}){
    const [record,setRecord]=useState(null),[snapshot,setSnapshot]=useState(null),[selected,setSelected]=useState(1),[catalogue,setCatalogue]=useState([]);
    const [relation,setRelation]=useState('after'),[error,setError]=useState(''),[notice,setNotice]=useState(''),[src,setSrc]=useState(null),[shown,setShown]=useState(null);
    const [zoom,setZoom]=useState('fit'),[scale,setScale]=useState({scaleX:1,scaleY:1}),[clock,setClock]=useState(Date.now()),[deleting,setDeleting]=useState(false),[full,setFull]=useState(false);
    const [playing,setPlaying]=useState(false),[rate,setRate]=useState(2),[rateDraft,setRateDraft]=useState('2'),[imageReady,setImageReady]=useState(false),[stripScroll,setStripScroll]=useState(0),[stripWidth,setStripWidth]=useState(800);
    const [displayAction,setDisplayAction]=useState(null),[unavailable,setUnavailable]=useState(new Set());
    const [showActions,setShowActions]=useState(false);
    const replay=useRef(null),deadline=useRef(0);
    const stage=useRef(null),img=useRef(null),viewer=useRef(null),strip=useRef(null),url=useRef(null),imageRequest=useRef(null),pending=useRef(null),imageEpoch=useRef(0);
    const live=mode==='live',older=sessionId?.startsWith('sess_'),modernLive=live&&!older;
    const action=record?.actions?.find(row=>row.seq===selected),total=record?.total_actions||0;
    const frames=action?.frames||[],frame=replayFrame(frames,relation);
    const playable=catalogue.map(row=>({...row,has_image:row.has_image&&!unavailable.has(row.seq)}));
    const updateScale=useCallback(()=>{
        const image=img.current,viewport=stage.current;if(!image||!viewport)return;
        if(zoom==='fit'){const next=fitBrowserImage(image,viewport);if(next)setScale(next);}
        else if(image.naturalWidth){const factor=Number(zoom);image.style.width=`${image.naturalWidth*factor}px`;image.style.height=`${image.naturalHeight*factor}px`;setScale({scaleX:factor,scaleY:factor});}
    },[zoom]);
    useEffect(()=>{if(!isOpen||!stage.current)return;const observer=new ResizeObserver(updateScale);observer.observe(stage.current);return()=>observer.disconnect();},[isOpen,updateScale]);
    useEffect(()=>{updateScale();},[zoom,src,updateScale]);
    useEffect(()=>{if(!isOpen)return;const timer=setInterval(()=>setClock(Date.now()),500);return()=>clearInterval(timer);},[isOpen]);
    useEffect(()=>{
        imageEpoch.current++;pending.current=null;if(url.current)URL.revokeObjectURL(url.current);url.current=null;
        setSrc(null);setShown(null);setSnapshot(null);setRecord(null);setCatalogue([]);setSelected(1);setError('');setNotice('');setDeleting(false);setFull(false);setPlaying(false);setImageReady(false);setClock(Date.now());
        setDisplayAction(null);setUnavailable(new Set());
        if(isOpen&&!modernLive)replay.current=new ReplayLoader(taskId,sessionId);
        return()=>{imageEpoch.current++;pending.current=null;replay.current?.close();replay.current=null;if(url.current)URL.revokeObjectURL(url.current);url.current=null;};
    },[isOpen,taskId,sessionId,modernLive]);
    const loadImage=useCallback(request=>{
        pending.current=request;if(imageRequest.current)return;
        const drain=async()=>{
            while(pending.current){
                const next=pending.current;pending.current=null;const epoch=imageEpoch.current;
                let candidate;
                try{
                    const bytes=next.kind==='live'?await bridge.readBrowserLiveImage(next.task,next.session,next.seq):await bridge.readBrowserRecordingImage(next.task,next.session,next.frame);
                    if(epoch!==imageEpoch.current)continue;
                    candidate=URL.createObjectURL(new Blob([bytes instanceof ArrayBuffer?bytes:new Uint8Array(bytes)],{type:next.metadata?.mime||'image/jpeg'}));
                    // Decode offscreen, keeping the previous decoded image mounted.
                    // Only an owned, current request may replace it after decoding.
                    const decoded=new Image();decoded.src=candidate;await decoded.decode();
                    if(epoch!==imageEpoch.current){URL.revokeObjectURL(candidate);continue;}
                    if(url.current)URL.revokeObjectURL(url.current);url.current=candidate;candidate=null;
                    setSrc(url.current);setShown(next);setImageReady(true);setError('');
                }catch(reason){if(candidate)URL.revokeObjectURL(candidate);if(epoch===imageEpoch.current&&!pending.current){setError(String(reason));if(!next.keep){if(url.current)URL.revokeObjectURL(url.current);url.current=null;setSrc(null);setShown(null);}}}
            }
        };
        imageRequest.current=drain().finally(()=>{imageRequest.current=null;if(pending.current)loadImage(pending.current);});
    },[]);
    useEffect(()=>{
        if(!isOpen||!taskId||!sessionId)return;
        let disposed=false,busy=false,again=false,unsubscribe,timer,revision=-1,version=-1,lastKey='';
        const refresh=async()=>{
            if(busy){again=true;return;}busy=true;
            try{do{
                again=false;
                if(modernLive){
                    const next=await bridge.getBrowserCapture(taskId,sessionId);if(disposed)break;
                    if(next.capture.revision<revision||next.session.version<version)continue;
                    revision=next.capture.revision;version=next.session.version;setSnapshot(next);
                    const ended=terminal(next.session.status),image=ended?next.last_retained_frame:next.capture.frame;
                    const key=image?(ended?`retained:${image.id}`:`live:${image.seq}`):'';
                    if(image&&key!==lastKey){lastKey=key;loadImage({kind:ended?'recorded':'live',task:taskId,session:sessionId,seq:image.seq,frame:image.id,metadata:image,keep:true});}
                }else{
                    const page=await replay.current.page(selected);if(disposed)break;setRecord(page);
                }
            }while(again&&!disposed);}catch(reason){if(!disposed)setError(String(reason));}finally{busy=false;}
        };
        const start=async()=>{
            if(modernLive){unsubscribe=await bridge.onManagedBrowserCapture(event=>{if(event.task_id===taskId&&event.session_id===sessionId)refresh();});if(disposed){unsubscribe();return;}await bridge.heartbeatBrowserViewer(taskId,sessionId);}
            await refresh();
            if(!disposed&&modernLive)timer=setInterval(()=>{bridge.heartbeatBrowserViewer(taskId,sessionId).catch(()=>{});refresh();},1000);
        };start().catch(reason=>{if(!disposed)setError(String(reason));});
        return()=>{disposed=true;clearInterval(timer);unsubscribe?.();};
    },[isOpen,taskId,sessionId,modernLive,selected,loadImage]);
    useEffect(()=>{
        if(!isOpen||live||!taskId||!sessionId)return;let disposed=false;
        (async()=>{const rows=[];let after=0;do{const page=await bridge.getBrowserRecordingIndex(taskId,sessionId,after);if(disposed)return;rows.push(...page.actions);after=page.next_after;}while(after!=null&&after<5000);if(!disposed)setCatalogue(rows);})().catch(reason=>{if(!disposed)setNotice(`Action list unavailable: ${reason}`);});
        return()=>{disposed=true;};
    },[isOpen,taskId,sessionId,live]);
    useEffect(()=>{
        if(!isOpen||modernLive)return;
        const epoch=++imageEpoch.current;pending.current=null;setError('');setImageReady(false);
        if(!action)return;
        if(frame&&['available','unverified'].includes(frame.status)){
            const loader=replay.current;
            loader.image(frame,true).then(image=>{if(epoch!==imageEpoch.current)return;loader.show(frame.id);setSrc(image.url);setShown({frame:frame.id,actionSeq:selected,metadata:frame.metadata,box:older?action.bounding_box:null});setDisplayAction(action);setImageReady(true);setError('');}).catch(reason=>{if(epoch===imageEpoch.current){setError(String(reason));setSrc(null);setShown(null);setDisplayAction(action);setUnavailable(old=>new Set([...old,selected]));}});
        }else{setSrc(null);setShown(null);setDisplayAction(action);}
        return()=>{imageEpoch.current++;};
    },[isOpen,taskId,sessionId,selected,relation,record,modernLive,older,loadImage]);
    const go=useCallback((value,manual=true)=>{if(manual)setPlaying(false);setSelected(Math.max(1,Math.min(total||1,value)));},[total]);
    const advance=delta=>go(imageStep(playable,selected,delta));
    useEffect(()=>{if(isOpen&&!live&&catalogue.length)replay.current?.prefetch(playable,selected,relation);},[isOpen,live,catalogue,selected,relation,unavailable]);
    useEffect(()=>{
        if(!isOpen||live)return;const key=event=>{if(['INPUT','SELECT','TEXTAREA'].includes(event.target.tagName))return;if(event.key==='ArrowLeft'){event.preventDefault();go(imageStep(playable,selected,-1));}if(event.key==='ArrowRight'){event.preventDefault();go(imageStep(playable,selected,1));}};
        window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
    },[isOpen,live,go,selected,catalogue,unavailable]);
    useEffect(()=>{deadline.current=performance.now()+1000/rate;},[playing,rate]);
    useEffect(()=>{
        if(!isOpen||!playing||!action)return;
        const available=frame&&['available','unverified'].includes(frame.status);
        if(available&&!(imageReady&&shown?.frame===frame.id)&&!error)return;
        const next=imageStep(playable,selected,1);if(next===selected){setPlaying(false);return;}
        const timer=setTimeout(()=>{deadline.current+=1000/rate;go(next,false);},Math.max(0,deadline.current-performance.now()));return()=>clearTimeout(timer);
    },[isOpen,playing,action,frame,imageReady,shown,error,selected,total,rate,go,catalogue,unavailable]);
    useEffect(()=>{if(!isOpen||!strip.current)return;const element=strip.current,observer=new ResizeObserver(()=>setStripWidth(element.clientWidth));observer.observe(element);return()=>observer.disconnect();},[isOpen,live]);
    useLayoutEffect(()=>{
        if(!isOpen||!strip.current)return;const element=strip.current,left=Math.max(0,Math.min((selected-.5)*PILL-element.clientWidth/2,total*PILL-element.clientWidth));
        // A direct seek keeps the selected action present in the virtual strip,
        // including hidden windows where animated scrolling may be suspended.
        element.scrollTo({left,behavior:'instant'});setStripScroll(left);
    },[isOpen,selected,total,stripWidth,playing]);
    const close=()=>{setPlaying(false);if(document.fullscreenElement===viewer.current)document.exitFullscreen().catch(()=>{});onClose();};
    useEffect(()=>{
        if(!isOpen)return;const changed=()=>setFull(document.fullscreenElement===viewer.current);
        const escape=event=>{if(event.key==='Escape'&&document.fullscreenElement===viewer.current){event.preventDefault();event.stopImmediatePropagation();document.exitFullscreen().catch(()=>{});}};
        document.addEventListener('fullscreenchange',changed);window.addEventListener('keydown',escape,true);return()=>{document.removeEventListener('fullscreenchange',changed);window.removeEventListener('keydown',escape,true);};
    },[isOpen]);
    const toggleFull=async()=>{try{if(document.fullscreenElement===viewer.current)await document.exitFullscreen();else await viewer.current.requestFullscreen();}catch(reason){setNotice(`Full screen is unavailable: ${reason}`);}};
    const removeImages=async()=>{
        setPlaying(false);if(!deleting){setDeleting(true);return;}
        try{const result=await bridge.deleteBrowserRecordingImages(taskId,sessionId);imageEpoch.current++;replay.current?.close();replay.current=new ReplayLoader(taskId,sessionId);setSrc(null);setShown(null);setNotice(`Deleted ${result.deleted} images; ${result.failed} could not be deleted.`);setUnavailable(new Set(catalogue.map(row=>row.seq)));setRecord(await replay.current.page(selected));}
        catch(reason){setNotice(String(reason));}finally{setDeleting(false);}
    };
    const togglePlayback=()=>{if(playing){setPlaying(false);return;}if(imageStep(playable,selected,1)===selected)go(playable.find(row=>row.has_image)?.seq||1,false);setPlaying(true);};
    const commitRate=()=>{const next=replaySpeed(rateDraft);if(next!==null)setRate(next);setRateDraft(String(next??rate));};
    if(!isOpen)return null;
    const info=snapshot?.session||record?.session,status=info?.status,badge=browserBadge(status,snapshot?.capture,shown?.metadata?.ended_ms,clock,error),duration=browserDuration(info,clock);
    const box=shown?.box,active=status&&!terminal(status),first=Math.max(0,Math.floor(stripScroll/PILL)-6),last=Math.min(total,first+Math.ceil(stripWidth/PILL)+14),bySeq=new Map(catalogue.map(row=>[row.seq,row]));
    const actionLabel=value=>value?value.replaceAll('_',' ').replace(/^./,letter=>letter.toUpperCase()):'—';
    const visibleFrames=displayAction?.frames||[],visibleFrame=replayFrame(visibleFrames,relation);
    const jumpButton=delta=><button key={delta} id={delta===-1?'replay-prev-button':delta===1?'replay-next-button':undefined} className="replay-nav-btn" aria-label={`${delta>0?'Forward':'Back'} ${Math.abs(delta)} ${Math.abs(delta)===1?'action':'actions'}`} disabled={!total||imageStep(playable,selected,delta)===selected} onClick={()=>advance(delta)}>{delta>0?'+':'−'}{Math.abs(delta)}</button>;
    return <Modal isOpen={isOpen} onClose={close} className={`${mode}-modal-window`}>
        <div ref={viewer} className={`${mode}-modal-container column browser-viewer`}>
            <div className="modal-header align-center justify-space-between"><strong>{live?'Live Browser View':'Browser Session Replay'}</strong><div className="browser-viewer-window-controls"><ModalIconButton label={full?'Exit full screen':'Full screen'} onClick={toggleFull}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={full?'M3 8h5V3m8 0v5h5M3 16h5v5m8 0v-5h5':'M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5'}/></svg></ModalIconButton><ModalCloseButton id={`${mode}-modal-close-button`} onClick={close} label="Close browser viewer"/></div></div>
            <div className="browser-viewer-status" role="status"><span className={`browser-viewer-badge ${older?'closed':badge.tone}`}><span className="browser-status-dot"/>{older?'Older recording':badge.label}</span>{duration&&<span className="browser-session-duration">Duration {duration}</span>}{info?.terminal_reason&&<span className="browser-terminal-reason" title={info.terminal_reason}>{info.terminal_reason}</span>}</div>
            <div className="browser-viewer-toolbar"><span className="browser-viewer-address mono" title={shown?.metadata?.url||displayAction?.arguments?.url||''}>{shown?.metadata?.url||displayAction?.arguments?.url||''}</span><label className="browser-actions-toggle"><input type="checkbox" checked={showActions} onChange={event=>setShowActions(event.target.checked)}/>Show actions</label><label>Size <select aria-label="Browser image size" value={zoom} onChange={event=>setZoom(event.target.value)}><option value="fit">Fit</option><option value="1">100%</option><option value="1.5">150%</option><option value="2">200%</option></select></label></div>
            {!live&&<div className="browser-viewer-action"><div className="browser-action-description"><span>Action:</span><strong>{actionLabel(displayAction?.op)}</strong><span aria-hidden="true">·</span><span className="browser-action-outcome">{actionLabel(displayAction?.status)}</span></div><time>{displayAction?browserTime(displayAction.created_at??displayAction.timestamp):'—'}</time><label>Image <select aria-label="Action image timing" disabled={visibleFrames.length<2} value={visibleFrame?.relation||''} onChange={event=>{setPlaying(false);setRelation(event.target.value);}}>{visibleFrames.length?visibleFrames.map(row=><option key={row.id} value={row.relation}>{actionLabel(row.relation)} · {row.status}</option>):<option value="">Not retained</option>}</select></label></div>}
            {!live&&<details className="browser-viewer-details"><summary>Action details</summary><pre>{displayAction?.presentation_truncated?'Long details are shortened here.\n':''}{displayAction?JSON.stringify({actor:browserActor(displayAction.caller),caller:displayAction.caller,created_at:displayAction.created_at,arguments:displayAction.arguments,outcome:displayAction.outcome},null,2):'—'}</pre></details>}
            <div ref={stage} className={`${mode}-viewport-wrapper browser-viewer-viewport ${zoom==='fit'?'fit':'zoomed'}`}>
                {src?<div className={`${mode}-image-box browser-viewer-image`}><img ref={img} id={live?'live-viewport-img':'replay-screenshot-img'} src={src} data-action-seq={shown?.actionSeq} className={`${mode}-screenshot-img`} alt="Recorded browser pixels" onLoad={event=>{updateScale();if(event.currentTarget.complete&&event.currentTarget.naturalWidth)setImageReady(true);}} onError={()=>{setError('The image could not be displayed.');setSrc(null);setShown(null);}}/>{showActions&&box&&<div className="replay-bounding-box" style={{left:box.x*scale.scaleX,top:box.y*scale.scaleY,width:box.width*scale.scaleX,height:box.height*scale.scaleY}}/>}{showActions&&<BrowserActionOverlay annotation={shown?.metadata?.annotation} scale={scale} sequence={shown?.actionSeq??shown?.metadata?.seq} rate={rate} playing={playing}/>}</div>:<div className="browser-viewer-empty">{error||(!modernLive?(action?'No image retained for this action.':'Loading action…'):'Waiting for the first browser image…')}</div>}
            </div>
            {error&&src&&<div className="browser-viewer-notice">Last available image shown. {error}</div>}
            {!live&&<section className="replay-controls" aria-label="Replay navigation">
                <div className="replay-jumps"><div className="replay-jump-group">{JUMPS.filter(delta=>delta<0).map(jumpButton)}</div><strong className="replay-position" aria-live="polite">{total?`Action ${selected} of ${total}`:'No actions'}</strong><div className="replay-jump-group">{JUMPS.filter(delta=>delta>0).map(jumpButton)}</div></div>
                <div ref={strip} className="replay-actions-strip" aria-label="Recorded actions" onScroll={event=>setStripScroll(event.currentTarget.scrollLeft)}><div style={{width:total*PILL,height:44,position:'relative'}}>{Array.from({length:Math.max(0,last-first)},(_,i)=>{const seq=first+i+1,row=bySeq.get(seq);return <button key={seq} style={{left:(seq-1)*PILL}} className={`replay-step-pill ${seq===selected?'active':''}`} aria-current={seq===selected?'step':undefined} aria-label={`Action ${seq}${row?`: ${row.op}`:''}`} title={row?`${row.op}: ${row.status}`:`Action ${seq}`} onClick={()=>go(seq)}>{seq} {row?.op?.replaceAll('_',' ')||'Action'}</button>;})}</div></div>
                <div className="replay-playback"><button className="replay-nav-btn" disabled={!playable.some(row=>row.has_image)} onClick={togglePlayback}>{playing?'Pause':'Play replay'}</button><label>Speed <input type="number" inputMode="decimal" min="0.1" step="0.1" aria-label="Replay speed" value={rateDraft} onChange={event=>{setRateDraft(event.target.value);const next=replaySpeed(event.target.value);if(next!==null)setRate(next);}} onBlur={commitRate} onKeyDown={event=>{if(event.key==='Enter'){commitRate();event.currentTarget.blur();}}}/><span>steps/s</span></label></div>
            </section>}
            <div className="browser-viewer-footer"><span>{record?.coverage||'Live preview · Read only'}{snapshot?.coverage?.length>0||record?.coverage_gaps?.length>0?' · Recording gaps are present.':''}</span>{!older&&!live&&!active&&<><button className="replay-nav-btn" onClick={removeImages}>{deleting?'Confirm delete images':'Delete images'}</button>{deleting&&<button className="replay-nav-btn" onClick={()=>setDeleting(false)}>Keep images</button>}</>}</div>
            {(snapshot?.coverage?.length>0||record?.coverage_gaps?.length>0)&&<details className="browser-viewer-details"><summary>Recording coverage</summary><pre>{JSON.stringify(snapshot?.coverage||record.coverage_gaps,null,2)}</pre></details>}{notice&&<div className="browser-viewer-notice" role="status">{notice}</div>}
        </div>
    </Modal>;
}
