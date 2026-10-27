import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const testRoot = path.join(root, 'tests/e2e/.test_workspace');
let tauriProcess, mockServer, mockServerPort = 0, mockResponses = [], requests = [];
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

export function queueMockResponse(response) { mockResponses.push(response); }
export function getMockRequests() { return structuredClone(requests); }

export async function startMockServer() {
  if (mockServer) throw new Error('A mock server is already active');
  mockResponses = []; requests = [];
  mockServer = http.createServer((request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
    let body = '';
    request.on('data', chunk => { body += chunk; if (body.length > 2 * 1024 * 1024) request.destroy(); });
    request.on('end', () => {
      let parsed;
      try { parsed = body ? JSON.parse(body) : {}; }
      catch { response.writeHead(400); response.end('{}'); return; }
      requests.push({ url: request.url, body: parsed });
      const queued = mockResponses.shift();
      if (!queued) { response.writeHead(503, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ error: { message: 'No mock response queued' } })); return; }
      const send = () => {
        if (response.destroyed) return;
        const { _http_status = 200, _delay_ms, ...next } = queued;
        if (_http_status !== 200 || !parsed.stream) {
          response.writeHead(_http_status, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify(next)); return;
        }
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        if (request.url.endsWith('/responses')) {
          const content = next.choices?.[0]?.delta?.content ?? '';
          response.write(`event: response.output_text.delta\ndata: ${JSON.stringify({ type: 'response.output_text.delta', delta: content })}\n\n`);
          response.write(`event: response.completed\ndata: ${JSON.stringify({ type: 'response.completed', response: {
            id: next.id ?? crypto.randomUUID(), model: next.model ?? parsed.model, usage: next.usage } })}\n\n`);
        } else response.write(`data: ${JSON.stringify(next)}\n\n`);
        response.end('data: [DONE]\n\n');
      };
      if (queued._delay_ms) {
        const timer = setTimeout(send, queued._delay_ms);
        response.on('close', () => clearTimeout(timer));
      } else send();
    });
  });
  await new Promise((resolve, reject) => { mockServer.once('error', reject); mockServer.listen(0, '127.0.0.1', resolve); });
  mockServerPort = mockServer.address().port;
}

export async function stopMockServer() {
  const server = mockServer;
  mockServer = null; mockServerPort = 0; mockResponses = [];
  if (server) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

export async function launchTauri(useRealApi = false) {
  if (tauriProcess && tauriProcess.exitCode === null) throw new Error('A test app is already running');
  const offline = process.env.ZEUS_OFFLINE_TEST === '1';
  if (offline && useRealApi) throw new Error('Offline tests cannot launch a live-provider runtime');
  if (!useRealApi && !mockServerPort) throw new Error('Start the mock server before launching an offline app');
  const workspace = path.join(testRoot, crypto.randomUUID());
  fs.mkdirSync(workspace, { recursive: true });
  const cdpPort = 15000 + Math.floor(Math.random() * 20000);
  const env = { ...process.env, ZEUS_TEST_WORKSPACE_ROOT: workspace,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${cdpPort}`,
    WEBVIEW2_USER_DATA_FOLDER: path.join(workspace, 'webview'), ZEUS_TEST_HIDE_WINDOW: '1' };
  if (!useRealApi) {
    env.ZEUS_API_BASE_URL = `http://127.0.0.1:${mockServerPort}`;
    env.ZEUS_OFFLINE_TEST = '1';
    // Offline regression must not inherit eval privilege/iteration bypasses.
    delete env.ZEUS_EVAL_MODE; delete env.ZEUS_AUTO_ALLOW_COMMANDS; delete env.ZEUS_AUTO_ALLOW_NEW_FILES;
  } else env.ZEUS_EVAL_MODE = '1'; // Historical live suite policy is recorded, not called production policy.
  process.env.ZEUS_TEST_WORKSPACE_ROOT = workspace;
  let stderr = '', spawnError;
  tauriProcess = spawn('cargo', ['run'], { cwd: path.join(root, 'src-tauri'), env, shell: false, windowsHide: true });
  tauriProcess.once('error', error => { spawnError = error; });
  tauriProcess.stdout.on('data', data => { if (process.env.ZEUS_TEST_VERBOSE) process.stdout.write(data); });
  tauriProcess.stderr.on('data', data => { stderr = (stderr + data).slice(-12000); });
  const deadline = Date.now() + 120000;
  try {
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError;
      if (tauriProcess.exitCode !== null) throw new Error(`Test app exited ${tauriProcess.exitCode}: ${stderr}`);
      try {
        const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`, { timeout: 1000 });
        const page = browser.contexts()[0]?.pages()[0];
        if (page) return { browser, page, workspace };
        await browser.close();
      } catch { /* Bounded wait for the test app's own CDP listener. */ }
      await pause(250);
    }
    throw new Error(`Timeout starting test app: ${stderr}`);
  } catch (error) { await stopTauri(); throw error; }
}

export async function stopTauri() {
  const child = tauriProcess;
  tauriProcess = null;
  if (!child || child.exitCode !== null || !child.pid) return;
  await new Promise((resolve, reject) => {
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/f', '/t'], { windowsHide: true });
      killer.once('error', reject); killer.once('exit', resolve);
    } else { child.kill('SIGTERM'); child.once('exit', resolve); }
  });
}

export async function cleanupTasks(page) {
  if (!page || page.isClosed()) return;
  await page.evaluate(async () => {
    const bridge = window.__ZEUS_BRIDGE__;
    if (!bridge) throw new Error('Missing test bridge');
    for (const task of await bridge.listTasks()) await bridge.deleteTask(task.id);
  });
}
