/** Measurements from actual run/journal evidence; never inferred from narration. */
const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
export function agentDuration(run) {
  if (!run?.started_at || !run?.completed_at) return null;
  const duration = Date.parse(run.completed_at) - Date.parse(run.started_at);
  return finite(duration) ? duration / 1000 : null;
}

export function browserMeasurements(actions, truncated = false) {
  const operations = {};
  let serviceMs = 0, timed = 0;
  for (const action of actions) {
    const key = `${action.op}/${action.status}`;
    const entry = operations[key] ??= {count: 0, service_ms: 0, timed_actions: 0};
    entry.count++;
    let response = action.response;
    try { if (typeof response === 'string') response = JSON.parse(response); } catch { response = null; }
    const duration = response?.timing_ms?.total;
    if (finite(duration)) { entry.service_ms += duration; entry.timed_actions++; serviceMs += duration; timed++; }
  }
  return {actions: actions.length, truncated, operations, service_ms: serviceMs,
    timed_actions: timed, note: 'Service time excludes model/approval/queue time; do not sum it with agent wall time.'};
}

/** Log estimates, not wire bytes, token counts or paid-request counts. Each
 * entry must be the latest ring-buffer snapshot from a distinct actor process.
 */
export function contextMeasurements(processLogs,messages){
  const samples=[];
  for(const [processIndex,log] of processLogs.entries()){
    for(const line of String(log).split(/\r?\n/)){
      const found=/\[(orchestrator|worker)\].*Sending payload to (?:master model '[^']*'|model) \((\d+) messages, ~(\d+) bytes\)/.exec(line);
      if(found)samples.push({process_index:processIndex,role:found[1]==='worker'?'worker':'master',messages:Number(found[2]),estimated_bytes:Number(found[3])});
    }
  }
  const errors=messages.filter(m=>m.role==='user'&&m.kind==='directive_result'&&m.content.startsWith('[DIRECTIVE_ERROR]')).map(m=>m.content);
  return {payload_samples:samples,estimated_payload_bytes:samples.reduce((n,s)=>n+s.estimated_bytes,0),
    format_rejections:{total:errors.length,multiple_directives:errors.filter(text=>text.includes('Multiple ```zeus-directive blocks')).length,
      invalid_json:errors.filter(text=>text.includes('invalid JSON directive')).length},
    coverage:'Partial: process-local bounded logger snapshots. Retries and non-actor roles may have no payload estimate; missing samples are not zero requests.',
    model_latency_ms:null,note:'Payload estimates are not provider usage, subscription credits, network byte counts or context-window token measurements.'};
}
