import {useLayoutEffect,useEffect,useRef,useState} from 'react';
import {formatCredits} from '../utils';

export default function ChatHeader({title,spend,spendRatio,actions}){
    const root=useRef(null),measure=useRef(null),menu=useRef(null),more=useRef(null);
    const [layout,setLayout]=useState({compact:false,count:actions.length,hideBar:false}),[open,setOpen]=useState(false);
    const units=`${formatCredits(spend.spent_credits)} / ${spend.budget_credits} units`;
    useLayoutEffect(()=>{
        const recalculate=()=>{
            const width=root.current.clientWidth-48,nodes=measure.current.children;
            const titleWidth=nodes[0].getBoundingClientRect().width,unitWidth=nodes[1].getBoundingClientRect().width;
            const widths=Array.from(nodes).slice(2).map(node=>node.getBoundingClientRect().width);
            const controls=unitWidth+130+widths.reduce((a,b)=>a+b,0)+actions.length*10;
            const compact=titleWidth+24+controls>width,hideBar=compact&&width<650;
            let count=actions.length;
            const need=n=>unitWidth+(hideBar?0:130)+widths.slice(0,n).reduce((a,b)=>a+b,0)+(n+(n<actions.length?1:0))*10+(n<actions.length?34:0);
            while(count>0&&need(count)>width)count--;
            const next={compact,count,hideBar};setLayout(old=>JSON.stringify(old)===JSON.stringify(next)?old:next);
        };
        recalculate();const observer=new ResizeObserver(recalculate);observer.observe(root.current);observer.observe(measure.current);
        return()=>observer.disconnect();
    },[title,units,actions]);
    useEffect(()=>{
        if(!open)return;const dismiss=event=>{if(event.type==='keydown'&&event.key==='Escape'){setOpen(false);more.current?.focus();}else if(event.type==='pointerdown'&&!menu.current?.contains(event.target)&&!more.current?.contains(event.target))setOpen(false);};
        window.addEventListener('pointerdown',dismiss);window.addEventListener('keydown',dismiss);return()=>{window.removeEventListener('pointerdown',dismiss);window.removeEventListener('keydown',dismiss);};
    },[open]);
    const button=(action,inMenu=false)=><button key={action.label} id={action.id} role={inMenu?'menuitem':undefined} className={`settings-button ${action.active?'active':''}`} title={action.title} onClick={()=>{setOpen(false);action.onClick();}}>{action.label}</button>;
    return <div ref={root} id="chat-top-bar" className={layout.compact?'compact':''}>
        <span id="chat-task-title" title={title}>{title}</span>
        <div className="chat-header-controls">
            <div id="chat-spend-container" className="align-center gap-10 no-user-select" title="Units spent on this task vs. its budget">
                <span id="chat-spend-label">{units}</span>{!layout.hideBar&&<div id="chat-spend-bar"><div id="chat-spend-bar-fill" style={{width:`${Math.min(100,spendRatio*100)}%`,background:spendRatio>=0.8?'#ff5c5c':''}}/></div>}
            </div>
            {actions.slice(0,layout.count).map(action=>button(action))}
            {layout.count<actions.length&&<div className="chat-header-overflow">
                <button ref={more} className="dialog-icon-button" aria-label="More chat actions" aria-haspopup="menu" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>•••</button>
                {open&&<div ref={menu} className="chat-header-menu" role="menu" onKeyDown={event=>{if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();const items=[...event.currentTarget.querySelectorAll('[role=menuitem]')],current=items.indexOf(document.activeElement);items[(current+(event.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus();}}}>{actions.slice(layout.count).map(action=>button(action,true))}</div>}
            </div>}
        </div>
        <div ref={measure} className="chat-header-measure" aria-hidden="true" inert=""><span className="title-measure">{title}</span><span className="units-measure">{units}</span>{actions.map(action=><button key={action.label} className="settings-button" tabIndex={-1}>{action.label}</button>)}</div>
    </div>;
}
