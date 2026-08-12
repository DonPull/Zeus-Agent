import { _electron as electron, chromium } from '@playwright/test';
import { spawn, execSync } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const testWorkspaceDir = path.join(__dirname, '.test_workspace');

let tauriProcess;
let mockServer;
let mockServerPort = 0; // dynamic port
let mockResponses = [];

// Allows tests to queue up responses for the LLM
function queueMockResponse(responseJson) {
  mockResponses.push(responseJson);
}

// Start the mock LLM server
function startMockServer() {
  return new Promise((resolve) => {
    mockServer = http.createServer((req, res) => {
      // CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }

      let body = '';
      req.on('data', chunk => {
        body += chunk.toString();
      });
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        if (mockResponses.length > 0) {
          const nextResponse = mockResponses.shift();
          // Send it as a stream chunk
          res.write(`data: ${JSON.stringify(nextResponse)}\n\n`);
          res.write("data: [DONE]\n\n");
          res.end();
        } else {
          res.write(`data: ${JSON.stringify({
            choices: [{ delta: { content: "Mock Server Error: No response queued" } }]
          })}\n\n`);
          res.write("data: [DONE]\n\n");
          res.end();
        }
      });
    });

    mockServer.listen(0, () => {
      mockServerPort = mockServer.address().port;
      resolve();
    });
  });
}

// Stop the mock server
function stopMockServer() {
  return new Promise((resolve) => {
    if (mockServer) {
      mockServer.close(() => {
        mockResponses = [];
        resolve();
      });
    } else {
      mockResponses = [];
      resolve();
    }
  });
}

// Launch Tauri using CDP
async function launchTauri(useRealApi = false) {
  return new Promise(async (resolve, reject) => {
    // Robust cleanup: Always clear the test DB before running tests
    if (fs.existsSync(testWorkspaceDir)) {
      fs.rmSync(testWorkspaceDir, { recursive: true, force: true });
    }
    
    const cdpPort = Math.floor(Math.random() * (9999 - 9222 + 1)) + 9222;

    console.log(`Starting cargo run with CDP port ${cdpPort}...`);

    const env = {
      ...process.env,
      ZEUS_TEST_WORKSPACE_ROOT: testWorkspaceDir,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${cdpPort}`, // Ensure WebView2 gets the port
      WEBVIEW2_USER_DATA_FOLDER: path.join(testWorkspaceDir, `wv2_${cdpPort}`)
    };

    if (!useRealApi) {
      env.ZEUS_API_BASE_URL = `http://localhost:${mockServerPort}/`;
    }
    
    // Ensure the Node process also knows the test workspace root so it creates files in the right place
    process.env.ZEUS_TEST_WORKSPACE_ROOT = testWorkspaceDir;

    tauriProcess = spawn('cargo', ['run', '--', '--remote-debugging-port', cdpPort.toString()], {
      cwd: path.join(__dirname, '..', '..', 'src-tauri'),
      env,
      shell: process.platform === 'win32'
    });

    tauriProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log(`[Tauri] ${output.trim()}`);
    });

    tauriProcess.stderr.on('data', (data) => {
      const output = data.toString();
      console.error(`[Tauri ERR] ${output.trim()}`);
    });

    // We have to wait for the port to be open. Polling CDP port.
    let connected = false;
    let attempts = 0;
    
    const interval = setInterval(async () => {
      attempts++;
      if (attempts > 240) { // 120 seconds
        clearInterval(interval);
        if (process.platform === 'win32') {
          spawn('taskkill', ['/pid', tauriProcess.pid, '/f', '/t']);
        } else {
          tauriProcess.kill();
        }
        reject(new Error("Timeout waiting for Tauri WebView2 CDP"));
      }
      try {
        const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
        clearInterval(interval);
        connected = true;
        
        // Find the main window
        const defaultContext = browser.contexts()[0];
        // Wait until at least one page is available
        while (defaultContext.pages().length === 0) {
            await new Promise(r => setTimeout(r, 100));
        }
        const page = defaultContext.pages()[0];
        resolve({ browser, page });
      } catch (e) {
        // Not ready yet
      }
    }, 500);
  });
}
async function stopTauri() {
  if (tauriProcess) {
    if (process.platform === 'win32') {
      await new Promise(resolve => {
        const killer = spawn('taskkill', ['/pid', tauriProcess.pid, '/f', '/t']);
        killer.on('close', resolve);
      });
    } else {
      tauriProcess.kill();
    }
    // Wait a brief moment for the port to actually free up
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}

async function cleanupTasks(page) {
  if (!page) return;
  try {
    await page.evaluate(async () => {
      if (!window.__TAURI__ || !window.__TAURI__.core) return;
      const { invoke } = window.__TAURI__.core;
      const tasks = await invoke('list_tasks');
      for (const t of tasks) {
        await invoke('delete_task', { taskId: t.id });
      }
    });
  } catch (e) {
    console.error("Cleanup failed:", e);
  }
}

export {
  queueMockResponse,
  startMockServer,
  stopMockServer,
  launchTauri,
  stopTauri,
  cleanupTasks
};
