// Build one self-contained report from persisted data; never read image bytes.
export function formatDebugReport({taskId,messages=[],backendLog='',run=null,usage=null,exportedAt=new Date().toISOString()}) {
    const ordered=[...messages].sort((a,b)=>a.seq-b.seq);
    const attachmentMetadata=file=>({id:file.id,task_id:file.task_id,filename:file.filename,mime_type:file.mime_type,
        byte_count:file.byte_count,sha256:file.sha256,width:file.width,height:file.height,status:file.status,last_delivery:file.last_delivery});
    const raw=ordered.map(message=>
        `[${message.created_at}] seq=${message.seq} id=${message.id} conversation=${message.conversation} role=${message.role} kind=${message.kind} visible=${message.visible} model=${message.model??'(none)'}\n${message.content}`+
        (message.attachments?.length?`\nATTACHMENTS (metadata only): ${JSON.stringify(message.attachments.map(attachmentMetadata))}`:'')
    ).join('\n----------------------------------------\n');
    const visible=ordered.filter(message=>message.conversation==='master'&&message.visible)
        .map(message=>`[${message.created_at}] ${message.role==='user'?'YOU':message.role==='assistant'?'ZEUS':message.kind.toUpperCase()}\n${message.content}`)
        .join('\n----------------------------------------\n');
    return `===== ZEUS DEBUG LOG (task ${taskId}) =====\nExported: ${exportedAt}\n`+
        `Coverage: all persisted task conversations, including hidden messages, ordered by database sequence. No export text truncation. Original image bytes/previews are not included.\n`+
        `Backend events: process-local ring buffer, at most 2000 entries/task. Restart loses these events; an empty buffer does not mean no backend activity.\n`+
        `Run and usage are export-time snapshots; provider credits and interrupted billed usage may be unknown. This report can contain private chat/tool content.\n\n`+
        `--- LATEST RUN ---\n${JSON.stringify(run,null,2)}\n\n`+
        `--- USAGE SNAPSHOT ---\n${JSON.stringify(usage,null,2)}\n\n`+
        `--- BACKEND EVENTS (volatile, current process only) ---\n${backendLog||'(unavailable/empty; previous-process events are not retained)'}\n\n`+
        `--- FULL VISIBLE MASTER CHAT ---\n${visible||'(empty)'}\n\n`+
        `--- RAW MESSAGES (all conversations, incl. hidden) ---\n${raw||'(empty)'}`;
}
