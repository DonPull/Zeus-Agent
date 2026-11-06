import crypto from 'node:crypto';
import { buildScoreRecord } from './score_recorder.js';

/** Finalize even startup failures, preserve their cause, and always release owned resources. */
export async function runTrial({ suiteTitle, suiteDir, promptSpec, runMeta = {}, setup, execute,
  collect = async () => ({}), cleanup = async () => {}, persist, timeoutMs = 600000, collectionTimeoutMs = 10000 }) {
  if(!Number.isSafeInteger(collectionTimeoutMs)||collectionTimeoutMs<1||collectionTimeoutMs>120000)throw new Error('Invalid collection deadline');
  const started = Date.now();
  const meta = { ...runMeta, trial_id: runMeta.trial_id ?? crypto.randomUUID(), started_at: new Date(started).toISOString() };
  const controller = new AbortController();
  const context = { checks: [], authorizationChecks: [], artifacts: [], observation: {}, signal: controller.signal };
  async function bounded(work, milliseconds) {
    let timer;
    try {
      return await Promise.race([work, new Promise((_, reject) => {
        timer = setTimeout(() => { const error = new Error('Trial operation timed out'); error.name = 'TimeoutError';
          controller.abort(error); reject(error); }, milliseconds);
      })]);
    } finally { clearTimeout(timer); }
  }
  let status = 'infrastructure_error', failure = null, observation = {};
  try {
    await bounded((async () => {
      await setup(context);
      if (context.signal.aborted) throw context.signal.reason;
      status = 'failed';
      await execute(context);
      if (!context.signal.aborted) status = 'succeeded';
    })(), timeoutMs);
  } catch (error) {
    failure = error;
    if (/timeout|timed out/i.test(`${error.name} ${error.message}`)) status = 'timed_out';
    else if (error.code === 'RUN_CANCELLED') status = 'cancelled';
    else if (error.code === 'INFRASTRUCTURE_ERROR') status = 'infrastructure_error';
  }
  try { observation = {...context.observation, ...await bounded(collect(context), collectionTimeoutMs)}; }
  catch (error) { observation=context.observation; failure ??= error; status = 'infrastructure_error'; }
  try { await bounded(cleanup(context), 15000); }
  catch (error) { failure ??= error; status = 'infrastructure_error'; }
  const record = buildScoreRecord({ suiteTitle, suiteDir, promptSpec, ...observation,
    pythonCheckDetails: context.checks, authorizationChecks: context.authorizationChecks,
    durationSeconds: (Date.now() - started) / 1000,
    runMeta: { ...meta, ...observation.runMeta, artifacts: context.artifacts, execution_status: status,
      error: failure ? { name: failure.name, message: failure.message, code: failure.code ?? null } : null } });
  // Persistence failures are fatal to the caller, never swallowed as a successful trial.
  await persist(record);
  return record;
}
