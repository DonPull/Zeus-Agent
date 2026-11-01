import React,{useEffect,useState} from 'react';
import * as bridge from '../bridge';
export default function BrowserRuntimeSettings({settings,onChange}){
    const [status,setStatus]=useState(null),[error,setError]=useState('');
    useEffect(()=>{let disposed=false;bridge.getManagedBrowserStatus().then(value=>{if(!disposed)setStatus(value);}).catch(reason=>{if(!disposed)setError(String(reason));});return()=>{disposed=true;};},[]);
    const retired=settings.browser_mode==='main'||settings.browser_executable_path;
    return <div className="settings-section column gap-10">
        <label className="settings-section-label">Browser</label>
        <span>Zeus uses its own browser profile. Agents working on the same task share one browser, with tabs when needed.</span>
        {retired&&<div className="column gap-10"><span>Your saved personal/custom-browser preference is inactive. It will not attach or copy personal browser data.</span><button className="settings-button" onClick={()=>{onChange('browser_mode','sandboxed');onChange('browser_executable_path',null);}}>Use Zeus’s dedicated browser</button></div>}
        <label className="settings-model-row align-center gap-10">Browser runtime Python<input aria-label="Browser runtime Python" className="settings-input" style={{flex:1}} value={settings.browser_python_path||''} placeholder={status?.setup?.python||'Absolute path to the prepared runtime Python executable'} onChange={event=>onChange('browser_python_path',event.target.value)}/></label>
        <label className="align-center gap-10"><input type="checkbox" checked={settings.browser_block_ads!==false} onChange={event=>onChange('browser_block_ads',event.target.checked)}/>Block ads with uBlock Origin Lite</label>
        <label className="align-center gap-10"><input type="checkbox" checked={settings.browser_agent_audio===true} onChange={event=>onChange('browser_agent_audio',event.target.checked)}/>Allow sound while Zeus controls the browser</label>
        <span className="settings-hint">Sound is allowed when you open a browser handoff, then returns to this preference when you resume Zeus. Changes apply to new browser sessions. Ad blocking requires the prepared extension package; you can disable it if a website has compatibility problems.</span>
        <span className="settings-hint">{status?.readiness||error||'Checking saved browser setup…'}{status?.setup?.source==='prepared_development_runtime'?' · Using the explicitly prepared development runtime.':''}</span>
        <span className="settings-hint">Save to apply a custom path. The runtime must contain Playwright 1.62.0 and its matching Chromium. Zeus does not install or update them automatically. A separate profile is not an operating-system sandbox.</span>
    </div>;
}
