export function titleFreeText(text){
    const prefix='[[chat_title:',trimmed=text.trimStart();
    if(prefix.startsWith(trimmed)||(trimmed.startsWith(prefix)&&!trimmed.includes(']]')))return '';
    return text.replace(/^\s*\[\[chat_title:[^\]\r\n]{1,256}\]\]\r?\n?/,'');
}
