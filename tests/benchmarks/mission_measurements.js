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
