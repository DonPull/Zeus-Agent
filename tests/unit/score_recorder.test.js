import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateScores, buildScoreRecord, checkGaiaAnswer, scoreFromHarnessObservation } from '../benchmarks/score_recorder.js';

const record = (overrides = {}) => ({
  suite: 'first', suite_version: '1', prompt_id: 1, architecture: 'solo',
  experiment_id: 'experiment', configuration_fingerprint: 'config', trial_id: 'trial',
  passed: true, total_score: null, categories: ['code'], scores: {}, ...overrides,
});

test('aggregation retains different suites, architectures, and repeated trials', () => {
  const rows = [record(), record({ suite: 'second', trial_id: 'second' }),
    record({ architecture: 'team', trial_id: 'team' }), record({ trial_id: 'repeat', passed: false })];
  const aggregate = aggregateScores(rows);
  assert.equal(aggregate.overall.count, 4);
  assert.equal(aggregate.by_architecture.solo.count, 3);
  assert.equal(aggregate.by_architecture.team.count, 1);
  assert.equal(aggregate.pass_rate, 0.75);
});

test('unobserved metrics remain unknown and cannot produce perfect scores', () => {
  const result = scoreFromHarnessObservation({ pythonCheckPassed: true });
  assert.equal(result.scores.tools, null);
  assert.equal(result.scores.safety, null);
  assert.equal(result.scores.efficiency, null);
  assert.equal(result.total, null);
});

test('no outcome checks means ungraded, never passed', () => {
  const result = buildScoreRecord({ suiteTitle: 'fixture', suiteDir: 'fixture', promptSpec: { id: 1 } });
  assert.equal(result.passed, false);
  assert.equal(result.outcome_status, 'not_evaluated');
});

test('execution failure cannot become a passed trial even with a passed check', () => {
  const result = buildScoreRecord({ suiteTitle: 'fixture', suiteDir: 'fixture', promptSpec: { id: 1 },
    runMeta: { status: 'timed_out' }, pythonCheckPassed: true });
  assert.equal(result.passed, false);
});

test('a correct permission denial is not automatically a safety penalty', () => {
  assert.equal(scoreFromHarnessObservation({ pythonCheckPassed: true, gatekeeperBlocks: 5 }).scores.safety, null);
});

test('answer checking rejects wrong numbers, numeric prefixes, and negated answers', () => {
  assert.equal(checkGaiaAnswer('100', '100.9').passed, false);
  assert.equal(checkGaiaAnswer('100 unrelated things', '100').passed, false);
  assert.equal(checkGaiaAnswer('not Julia Roberts', 'Julia Roberts').passed, false);
  assert.equal(checkGaiaAnswer('**3,505.62**', '3505.62').passed, true);
  assert.equal(checkGaiaAnswer('9007199254740993', '9007199254740992').passed, false);
  assert.equal(checkGaiaAnswer('1e309', '2e309').passed, false);
  assert.equal(checkGaiaAnswer('1,2', '12').passed, false);
});
