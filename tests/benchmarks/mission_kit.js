/** Mission authoring/deployment utilities. No agent or provider is launched here. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { fingerprint } from './benchmark_config.js';

export const missionRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), 'missions/v1');
export const missionIds = Object.freeze(['B01', 'B02', 'B03', 'C01', 'C02', 'C03', 'D01', 'D02', 'M01', 'M02', 'R01', 'V01']);
export class SubmissionError extends Error {}

export function mission(id) {
  if (!missionIds.includes(id)) throw new Error(`Unknown mission: ${id}`);
  const dir = path.join(missionRoot, id), task = JSON.parse(fs.readFileSync(path.join(dir, 'task.json'), 'utf8'));
  if (task.id !== id || task.schema_version !== 1 || !task.version || !task.prompt || !task.required_criteria.length) {
    throw new Error(`Invalid mission contract: ${id}`);
  }
  return { dir, task };
}

export function safeFile(root, relative, limit = 2097152) {
  if (path.isAbsolute(relative) || relative.split(/[\\/]/).some(p => p === '..' || p === '.' || !p)) throw new SubmissionError('Invalid artifact path');
  const base = fs.realpathSync(root);
  let current = base;
  for (const part of relative.split(/[\\/]/)) {
    current = path.join(current, part);
    let stat;
    try { stat = fs.lstatSync(current); }
    catch (error) { if (error.code === 'ENOENT') throw new SubmissionError(`Missing artifact: ${relative}`); throw error; }
    if (stat.isSymbolicLink()) throw new SubmissionError('Links/reparse points are not accepted');
  }
  const stat = fs.statSync(current);
  if (!stat.isFile() || stat.size > limit) throw new SubmissionError('Artifact is not a bounded regular file');
  const resolved = fs.realpathSync(current), rel = path.relative(base, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new SubmissionError('Artifact escapes its root');
  return current;
}

export function readArtifact(root, name) {
  try { return JSON.parse(fs.readFileSync(safeFile(root, name), 'utf8').replace(/^\uFEFF/, '')); }
  catch (error) { if (error instanceof SyntaxError) throw new SubmissionError(`Invalid JSON artifact: ${name}`); throw error; }
}

export function treeHash(root) {
  const files = [];
  function visit(relative = '') {
    for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name, 'en'))) {
      if (entry.isSymbolicLink()) throw new Error('Mission trees must not contain links');
      const name = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) visit(name);
      else {
        const file = safeFile(root, name, 8 * 1024 * 1024);
        if (files.length >= 128) throw new Error('Too many mission files');
        files.push([name, crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')]);
      }
    }
  }
  visit();
  return fingerprint(files);
}

export function python(script, args = [], { input, cwd, trustedExecution = false } = {}) {
  if (!trustedExecution) throw new Error('Phase 2A only executes explicitly trusted reference/control code; an isolated executor is required for agent submissions');
  const result = spawnSync('python', ['-I', '-B', script, ...args], { input, cwd, encoding: 'utf8',
    timeout: 10000, maxBuffer: 1024 * 1024, windowsHide: true, shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new SubmissionError(`Program exited ${result.status}: ${result.stderr.slice(-2000)}`);
  return result.stdout;
}

export function withScratch(work) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-mission-'));
  const cleanup = () => {
    const resolved = fs.realpathSync(root), parent = fs.realpathSync(os.tmpdir());
    if (path.dirname(resolved).toLowerCase() !== parent.toLowerCase() || !path.basename(resolved).startsWith('zeus-mission-')) {
      throw new Error('Refusing cleanup outside owned scratch directory');
    }
    fs.rmSync(resolved, { recursive: true, force: true });
  };
  try {
    const result = work(root);
    if (result?.then) return result.finally(cleanup);
    cleanup(); return result;
  } catch (error) { if (fs.existsSync(root)) cleanup(); throw error; }
}

export function deployMission(id, destination) {
  const { dir, task } = mission(id), inputs = path.join(dir, 'inputs');
  // Hash/validate before copying, and never merge a fixture into existing work.
  const fixtureHash = treeHash(inputs);
  if (fs.existsSync(destination) && fs.lstatSync(destination).isSymbolicLink()) throw new Error('Mission destination must not be a link/reparse point');
  if (fs.existsSync(destination) && fs.readdirSync(destination).length) throw new Error('Mission destination must be empty');
  fs.mkdirSync(destination, { recursive: true });
  fs.cpSync(inputs, destination, { recursive: true, force: false, errorOnExist: true });
  if (id === 'D02') python(path.join(missionRoot, '../../mission_graders/database.py'), ['create',
    path.join(destination, 'feedback.db'), path.join(inputs, 'seed.json')], { trustedExecution: true });
  return { id, version: task.version, task_hash: fingerprint(task), fixture_hash: fixtureHash,
    authoring_hash: treeHash(dir), deployed_hash: treeHash(destination), prompt: task.prompt, artifacts: task.artifacts };
}
