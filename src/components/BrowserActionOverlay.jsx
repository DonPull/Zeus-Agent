import {useLayoutEffect,useRef,useState,useEffect} from 'react';
import {actionFeed} from '../browserActionFeed';
// Geometry belongs to the displayed capture, never a neighboring replay frame.
export default function BrowserActionOverlay({annotation,scale,sequence,rate,playing}) {
    const [feed,setFeed]=useState([]),previous=useRef(null),lastId=useRef(null);
    useLayoutEffect(()=>{
        const jumped=previous.current!=null&&sequence!=null&&(sequence<previous.current||(!playing&&Math.abs(sequence-previous.current)>1));
        previous.current=sequence;
        const identity=annotation?.action_id;
        if(jumped)lastId.current=null;
        const next=identity&&identity!==lastId.current?annotation:null;
        if(identity)lastId.current=identity;
        setFeed(old=>actionFeed(jumped?[]:old,next,performance.now(),rate,playing));
    },[annotation,sequence,rate,playing]);
    useEffect(()=>{if(!feed.length)return;const timer=setTimeout(()=>setFeed(old=>old.filter(entry=>entry.expires>performance.now())),Math.max(0,Math.min(...feed.map(entry=>entry.expires))-performance.now()));return()=>clearTimeout(timer);},[feed]);
    const current=annotation&&['Agent','Human'].includes(annotation.actor)?annotation:null;
    if(!current&&!feed.length)return null;
    const box=current?.box,valid=box&&['x','y','width','height'].every(key=>Number.isFinite(box[key]))&&box.width>0&&box.height>0;
    const rows=feed.length?feed:current&&!current.action_id?[{id:'current',annotation:current}]:[];
    return <div className="browser-action-overlay" aria-label="Browser action annotation">
        {valid&&current.geometry==='target_at_capture'&&<div className="browser-action-target" style={{left:box.x*scale.scaleX,top:box.y*scale.scaleY,width:box.width*scale.scaleX,height:box.height*scale.scaleY}}><span>Target</span></div>}
        <div className="browser-action-feed" aria-label="Recent browser actions">{rows.map(({id,annotation:item})=><div key={id} className="browser-action-caption"><strong>{item.actor}</strong><span>{String(item.op||'').slice(0,80).replaceAll('_',' ')}</span>{typeof item.text==='string'&&item.text&&<span className="browser-action-input">{item.text.slice(0,200)}</span>}</div>)}</div>
    </div>;
}
