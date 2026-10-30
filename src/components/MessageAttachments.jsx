import {useEffect,useState} from 'react';
import * as bridge from '../bridge';

function Attachment({file,onReuse}) {
    const [preview,setPreview]=useState(null);
    const [error,setError]=useState(null);
    useEffect(()=>{
        let active=true;
        if(file.mime_type.startsWith('image/'))bridge.getAttachmentPreview(file.task_id,file.id)
            .then(value=>{if(active)setPreview(value);}).catch(error=>{if(active)setError(String(error));});
        return ()=>{active=false;};
    },[file.id,file.task_id,file.mime_type]);
    const delivery=file.last_delivery;
    const label=delivery?.state==='succeeded'?'Delivered to model':delivery?.state==='dispatched'?'Processing image':delivery?`Image delivery ${delivery.state}`:'Stored input';
    return <div className="attachment-chip" data-attachment-id={file.id} style={{display:'inline-flex',flexDirection:'column',alignItems:'flex-start',padding:8,gap:5,maxWidth:240}}>
        {preview&&<img src={preview} alt={file.filename} style={{maxWidth:180,maxHeight:100,objectFit:'contain'}}/>}
        <span>{file.filename}</span><small title={delivery?.error||error||file.id}>{error?'Preview unavailable':label}</small>
        {delivery?.error&&<small role="status">{delivery.error}</small>}
        {onReuse&&<button type="button" onClick={()=>onReuse({...file,previewUrl:preview})}>Use in next message</button>}
    </div>;
}
export default function MessageAttachments({files=[],onReuse}) {
    if(!files.length)return null;
    return <div className="message-attachments" style={{display:'flex',flexWrap:'wrap',gap:8}}>
        {files.map(file=><Attachment key={file.id} file={file} onReuse={onReuse}/>)}
    </div>;
}
