import { _electron as electron, chromium } from '@playwright/test';
import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';

const testWorkspaceDir = path.join(process.cwd(), 'tests', 'e2e', '.test_workspace');

let tauriProcess;
let mockServer;
let mockServerPort = 3000;
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

    mockServer.listen(mockServerPort, () => {
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
async function launchTauri() {
  return new Promise((resolve, reject) => {
    // Robust cleanup: Always clear the test DB before running tests
    if (fs.existsSync(testWorkspaceDir)) {
      fs.rmSync(testWorkspaceDir, { recursive: true, force: true });
    }
    
    console.log("Starting npm run tauri dev...");
    tauriProcess = spawn('npm', ['run', 'tauri', 'dev'], {
      shell: true,
      env: {
        ...process.env,
        // Force test mode and mock URL
        ZEUS_API_BASE_URL: `http://localhost:${mockServerPort}`,
        // Isolated test workspace to prevent polluting real user DB
        ZEUS_TEST_WORKSPACE_ROOT: testWorkspaceDir,
        // Enable WebView2 CDP debugging
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9222'
      }
    });

    tauriProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log(`[Tauri] ${output.trim()}`);
    });

    tauriProcess.stderr.on('data', (data) => {
      const output = data.toString();
      console.error(`[Tauri ERR] ${output.trim()}`);
    });

    // We have to wait for the port to be open. Polling CDP port 9222.
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
        const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
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
      spawn('taskkill', ['/pid', tauriProcess.pid, '/f', '/t']);
    } else {
      tauriProcess.kill();
    }
    // Wait a brief moment for the port to actually free up
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

export {
  queueMockResponse,
  startMockServer,
  stopMockServer,
  launchTauri,
  stopTauri
};
