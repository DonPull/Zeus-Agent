import {useEffect,useRef,useState} from 'react';
import ReactMarkdown,{defaultUrlTransform} from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Modal from './Modal';
import ModalCloseButton from './ModalCloseButton';
import * as bridge from '../bridge';

const fileSize=bytes=>bytes<1024?`${bytes} B`:bytes<1024*1024?`${(bytes/1024).toFixed(1)} KB`:`${(bytes/(1024*1024)).toFixed(1)} MB`;

// No anchor is allowed to replace the privileged chat webview. Local file
// contents are not rendered or executed; the OS action only reveals a file.
export default function MessageMarkdown({children,taskId,messageId}){
    const [file,setFile]=useState(null),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
    const epoch=useRef(0);
    useEffect(()=>{epoch.current++;setFile(null);setNotice('');setBusy(false);return()=>{epoch.current++;};},[taskId,messageId]);
    const activate=async href=>{
        const current=++epoch.current;setNotice('');
        if(!messageId||!taskId){setNotice('Links are available when this message finishes.');return;}
        setBusy(true);
        try{
            const result=await bridge.resolveMessageLink(taskId,messageId,href);
            if(current!==epoch.current)return;
            if(result.kind==='file')setFile({...result,href});
            else await bridge.openMessageLink(taskId,messageId,href);
        }catch(error){if(current===epoch.current)setNotice(String(error));}
        finally{if(current===epoch.current)setBusy(false);}
    };
    const reveal=async()=>{
        const current=++epoch.current;setBusy(true);setNotice('');
        try{await bridge.openMessageLink(taskId,messageId,file.href);if(current===epoch.current)setNotice('The file was shown in your file manager.');}
        catch(error){if(current===epoch.current)setNotice(String(error));}
        finally{if(current===epoch.current)setBusy(false);}
    };
    return <>
        <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={(value,key)=>key==='href'?value:defaultUrlTransform(value)} components={{a:({href,children})=><button type="button" role="link" className="message-link" title={href} aria-busy={busy} onClick={()=>activate(href||'')}>{children}</button>}}>{children}</ReactMarkdown>
        {!file&&notice&&<div className="message-link-notice" role="status">{notice}</div>}
        <Modal isOpen={!!file} onClose={()=>{epoch.current++;setFile(null);setNotice('');setBusy(false);}} className="file-link-modal">
            {file&&<div className="column gap-15"><div className="align-center justify-space-between"><strong>Saved file</strong><ModalCloseButton label="Close saved file" onClick={()=>{epoch.current++;setFile(null);setNotice('');setBusy(false);}}/></div>
                <strong className="file-link-name">{file.name}</strong><span>{file.extension?file.extension.toUpperCase():'File'} · {fileSize(file.bytes)}</span>
                <span>This file is already saved on your computer.</span><span className="file-link-path">{file.path}</span>
                <button className="settings-button" disabled={busy} onClick={reveal}>{busy?'Opening folder…':'Show in folder'}</button>
                {notice&&<span role="status">{notice}</span>}
            </div>}
        </Modal>
    </>;
}
