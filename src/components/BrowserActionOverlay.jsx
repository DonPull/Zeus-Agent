// Geometry belongs to the displayed capture, never a neighboring replay frame.
export default function BrowserActionOverlay({annotation,scale}) {
    if(!annotation||!['Agent','Human'].includes(annotation.actor))return null;
    const box=annotation.box,valid=box&&['x','y','width','height'].every(key=>Number.isFinite(box[key]))&&box.width>0&&box.height>0;
    const text=typeof annotation.text==='string'?annotation.text.slice(0,200):'';
    return <div className="browser-action-overlay" aria-label="Browser action annotation">
        {valid&&annotation.geometry==='target_at_capture'&&<div className="browser-action-target" style={{left:box.x*scale.scaleX,top:box.y*scale.scaleY,width:box.width*scale.scaleX,height:box.height*scale.scaleY}}><span>Target</span></div>}
        <div className="browser-action-caption"><strong>{annotation.actor}</strong><span>{String(annotation.op||'').slice(0,80).replaceAll('_',' ')}</span>{text&&<span className="browser-action-input">{text}</span>}</div>
    </div>;
}
