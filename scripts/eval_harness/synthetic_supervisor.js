/** Controller-owned, one-time decisions for declared native fixture operations. */
import fs from 'node:fs';
import path from 'node:path';

export function createSyntheticSupervisor({taskId,workspace,files,maxWriteBytes=2*1024*1024}){
    const root=path.resolve(workspace),allowed=new Set(files.map(name=>path.resolve(root,name)));
    const key=value=>process.platform==='win32'?value.toLowerCase():value;
    const identities=new Set([...allowed].map(key));
    return async card=>{
        const deny=reason=>({approved:false,source:'external-synthetic-supervisor-v1',note:reason});
        const directive=card.body?.blocked_directive;
        if(card.task_id!==taskId||card.kind!=='approval'||!directive)return deny('No matching declared task/action.');
        if(!['read_file','write_file'].includes(directive.type))return deny('This native synthetic trial permits declared read_file/write_file operations only. Use those tools; unrestricted commands, scripts, publication and external effects need separate review.');
        if(typeof directive.path!=='string'||!directive.path||/^[a-z]:[^\\/]/i.test(directive.path))return deny('Invalid or drive-relative fixture path.');
        const target=path.resolve(root,directive.path),relative=path.relative(root,target);
        if(relative.startsWith('..')||path.isAbsolute(relative)||!identities.has(key(target)))return deny('Path is outside the exact declared fixture-file set.');
        let current=root;
        for(const part of ['',...relative.split(path.sep)]){
            if(part)current=path.join(current,part);
            try{const metadata=fs.lstatSync(current);if(metadata.isSymbolicLink())return deny('Fixture path contains a link/reparse point.');}
            catch(error){if(error.code!=='ENOENT')return deny('Fixture path could not be verified.');}
        }
        if(directive.type==='write_file'&&(typeof directive.content!=='string'||Buffer.byteLength(directive.content)>maxWriteBytes))return deny('Write content exceeds the declared bounded text-file operation.');
        return {approved:true,source:'external-synthetic-supervisor-v1',note:`One-time ${directive.type} of declared synthetic file ${relative}. No persistent rule; output correctness was not considered.`};
    };
}
