import fs from 'node:fs';
import path from 'node:path';
const canonical=value=>path.toNamespacedPath(path.resolve(value)).toLowerCase();
export function unlinkedDirectory(location,{create=false}={}){
  const absolute=path.resolve(location),ancestors=[];
  for(let cursor=absolute;;cursor=path.dirname(cursor)){
    ancestors.unshift(cursor);if(path.dirname(cursor)===cursor)break;
  }
  for(const cursor of ancestors){
    if(!fs.existsSync(cursor)){
      if(!create)throw Error('Missing owned directory');
      fs.mkdirSync(cursor);
    }
    const stat=fs.lstatSync(cursor);
    if(!stat.isDirectory()||stat.isSymbolicLink()||canonical(fs.realpathSync(cursor))!==canonical(cursor))throw Error('Linked or redirected directory is not accepted');
  }
  return absolute;
}

/** Read bytes only; no shell, dynamic import, HTML rendering or model-selected path. */
export function readBoundedFile(root,name,limit=1024*1024){
  if(typeof name!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(name)||name.includes(':')||name.endsWith('.')||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))throw Error('Invalid exchange filename');
  if(!Number.isSafeInteger(limit)||limit<1||limit>64*1024*1024)throw Error('Invalid exchange byte limit');
  const base=unlinkedDirectory(root),file=path.join(base,name),before=fs.lstatSync(file);
  if(!before.isFile()||before.isSymbolicLink()||before.size>limit||canonical(fs.realpathSync(file))!==canonical(file))throw Error('Exchange file must be a bounded unlinked regular file');
  const fd=fs.openSync(file,'r');
  try{
    const opened=fs.fstatSync(fd);
    if(opened.dev!==before.dev||opened.ino!==before.ino||!opened.isFile())throw Error('Exchange file changed while opening');
    const buffer=Buffer.alloc(Math.min(limit+1,opened.size+1));let length=0;
    while(length<buffer.length){const n=fs.readSync(fd,buffer,length,buffer.length-length,null);if(!n)break;length+=n;}
    const after=fs.fstatSync(fd);
    if(length!==opened.size||after.size!==opened.size||after.mtimeMs!==opened.mtimeMs)throw Error('Exchange file changed while reading');
    return buffer.subarray(0,length);
  }finally{fs.closeSync(fd);}
}

