import {useState} from 'react';
import '../styles/Completion.css';

const claims={completed:'Reported complete',partial:'Reported partial',blocked:'Reported blocked',unknown:'Completion unknown',unspecified:'Completion not specified'};
const kinds={file_exists:'File exists',file_sha256:'File hash',json_value:'JSON value',process_exit:'Process exit',browser_condition:'Browser condition'};
export default function CompletionCard({message}) {
    const [expanded,setExpanded]=useState(false);
    let data;try{data=JSON.parse(message.content);}catch{return null;}
    if(!data||typeof data!=='object'||Array.isArray(data))return null;
    const {passed=0,failed=0,unknown=0}=data.checks||{};
    const state=failed?'failed':unknown||data.checks_omitted?'unknown':passed?'passed':'unknown';
    const label=failed?'Checks failed':unknown||data.checks_omitted?'Some checks unknown':passed?'Checks passed':'Not verified';
    const review=data.review||{};
    const checked=new Date(data.checked_at);
    const time=Number.isNaN(checked.getTime())?'Time unavailable':checked.toLocaleDateString('en-GB')+' '+checked.toLocaleTimeString('en-GB',{hour12:false});
    return <div className="chat-message event">
        <section className={'chat-bubble completion-card completion-'+state} aria-label="Completion evidence" data-report-id={message.id}>
            <div className="completion-header"><strong>Completion evidence</strong><span className={'completion-badge '+state}>{label}</span></div>
            <p className="completion-claim">{claims[data.claim_status]||'Completion unknown'}</p>
            <div className="completion-counts"><span>{passed} passed</span><span>{failed} failed</span><span>{unknown} unknown</span></div>
            {data.stale&&<p className="completion-warning">This claim uses an earlier version of your requests.</p>}
            {data.checks_omitted&&<p className="completion-warning">Some declared checks exceeded the check limit and were not run.</p>}
            {data.correction_requested&&<p className="completion-warning">Zeus was asked to correct the failed checks before finishing.</p>}
            <p className="completion-review">{review.state==='checking'?'Reviewing evidence…':review.state==='supported'?'Configured model review supports completion.':review.state==='not_supported'?'Configured model review does not support completion.':'The whole goal has not been independently verified.'}</p>
            {review.state==='supported'&&data.goal_status!=='model_supported'&&<p className="completion-warning">The model review does not resolve the remaining evidence gaps.</p>}
            <button type="button" className="action-card-toggle completion-toggle" aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}>{expanded?'Hide evidence details':'Show evidence details'}</button>
            {expanded&&<div className="completion-details">
                {(data.criteria||[]).map((criterion,index)=><div className="completion-criterion" key={criterion.id||index}>
                    <strong>{criterion.description||'Unnamed criterion'}</strong>
                    <p className="completion-source">{criterion.grounding==='linked_human_source_not_semantic_proof'?'Linked to an original user message.':'No available original user source linked.'}</p>
                    {!(criterion.checks||[]).length&&<p>No supported check was supplied for this criterion.</p>}
                    {(criterion.checks||[]).map((check,i)=><div className="completion-check" key={i}>
                        <div className="completion-check-title"><span>{kinds[check.kind]||'Unsupported check'}</span><span className={'completion-badge '+check.state}>{check.state}</span></div>
                        {check.path&&<code className="completion-path">{check.path}</code>}<p>{check.reason}</p>
                    </div>)}
                </div>)}
                {!(data.criteria||[]).length&&<p>No structured completion criteria were supplied. Recorded tool activity alone does not establish goal completion.</p>}
                {review.reason&&<p className="completion-review-reason">{review.reason}</p>}
                <p className="completion-scope">{data.scope}</p><time dateTime={data.checked_at}>{time}</time>
            </div>}
        </section>
    </div>;
}
