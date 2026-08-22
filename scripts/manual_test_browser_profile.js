/**
 * Manual Standalone Test: Parent Profile Cloning & Real Edge Spawn
 * 
 * Usage:
 *   node scripts/manual_test_browser_profile.js
 * 
 * This test replicates the EXACT native mechanism of Zeus Agent:
 * 1. Clones .zeus/parent_browser_profile into the task workspace.
 * 2. Spawns the real Microsoft Edge process using --user-data-dir and --remote-debugging-port.
 * 3. Connects via CDP (Playwright connectOverCDP) to navigate to edge://extensions and bot.sannysoft.com.
 * 4. Leaves Edge open for 30 seconds for your manual inspection (Dark theme, Extensions, Logins).
 */

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { chromium } from '@playwright/test';

function copyDirRecursive(src, dst) {
  if (!fs.existsSync(dst)) {
    fs.mkdirSync(dst, { recursive: true });
  }
  for (const item of fs.readdirSync(src)) {
    const srcPath = path.join(src, item);
    const dstPath = path.join(dst, item);
    const stat = fs.statSync(srcPath);
    if (stat.isDirectory()) {
      copyDirRecursive(srcPath, dstPath);
    } else {
      const lower = item.toLowerCase();
      if (!lower.includes('lock') && !lower.endsWith('.tmp')) {
        try {
          fs.copyFileSync(srcPath, dstPath);
        } catch (e) { }
      }
    }
  }
}

async function run() {
  console.log('================================================================');
  console.log('🔍 Testing Parent Profile Cloning & Native Edge Browser Launch');
  console.log('================================================================\n');

  const rootDir = process.cwd();
  const zeusDir = path.join(rootDir, '.zeus');
  const parentProfileDir = path.join(zeusDir, 'parent_browser_profile');
  const taskWorkspaceDir = path.join(rootDir, 'tests', '.test_workspace', 'manual_browser_test');
  const taskBrowserProfileDir = path.join(taskWorkspaceDir, '.zeus', 'browser_profiles', 'test_task_live');

  if (!fs.existsSync(parentProfileDir)) {
    console.error(`❌ Error: Parent profile directory not found at: ${parentProfileDir}`);
    process.exit(1);
  }

  // 1. Clone parent profile into task workspace
  console.log(`[Source Profile]      : ${parentProfileDir}`);
  console.log(`[Task Target Profile] : ${taskBrowserProfileDir}\n`);
  console.log('⏳ Cloning full parent profile into task workspace...');

  if (fs.existsSync(taskBrowserProfileDir)) {
    try {
      fs.rmSync(taskBrowserProfileDir, { recursive: true, force: true });
    } catch (e) { }
  }
  copyDirRecursive(parentProfileDir, taskBrowserProfileDir);

  const extensionsDir = path.join(taskBrowserProfileDir, 'Default', 'Extensions');
  if (fs.existsSync(extensionsDir)) {
    const extFolders = fs.readdirSync(extensionsDir);
    console.log(`✅ Success: Cloned ${extFolders.length} store extension folder(s) into task profile!`);
  }

  // 2. Locate Microsoft Edge executable
  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const edgePath64 = 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe';
  const executable = fs.existsSync(edgePath) ? edgePath : edgePath64;

  if (!fs.existsSync(executable)) {
    console.error(`❌ Microsoft Edge executable not found at: ${executable}`);
    process.exit(1);
  }

  const port = 9333;
  console.log(`\n[Launching Native Edge Process] Port: ${port}`);
  console.log(`Command: "${executable}" --remote-debugging-port=${port} --user-data-dir="${taskBrowserProfileDir}"`);

  // 3. Spawn the native Edge browser process exactly like Zeus Agent's Rust backend
  const edgeProcess = spawn(executable, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${taskBrowserProfileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-blink-features=AutomationControlled',
    '--disable-infobars',
    '--disable-sync'
  ], {
    stdio: 'ignore',
    detached: true
  });

  // Wait for CDP port to open
  console.log('⏳ Waiting for Edge to initialize CDP port...');
  let connected = false;
  let browser = null;

  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      browser = await chromium.connectOverCDP(`http://localhost:${port}`);
      connected = true;
      break;
    } catch (e) { }
  }

  if (!connected || !browser) {
    console.error('❌ Failed to connect to Edge over CDP.');
    if (edgeProcess && edgeProcess.pid) {
      try { process.kill(edgeProcess.pid); } catch (e) { }
    }
    process.exit(1);
  }

  console.log('✅ Successfully connected to native Edge via CDP!');
  const defaultContext = browser.contexts()[0] || (await browser.newContext());
  const page = await defaultContext.newPage();

  console.log('\n----------------------------------------------------------------');
  console.log('🌐 Native Edge is now open!');
  console.log('Notice:');
  console.log('1. Your Dark Theme is active.');
  console.log('2. Your Extensions & Logins are preserved.');
  console.log('----------------------------------------------------------------\n');

  try {
    await page.goto('edge://extensions').catch(() => { });
  } catch (e) { }

  const page2 = await defaultContext.newPage();
  await page2.goto('https://bot.sannysoft.com/').catch(() => { });

  const cleanup = () => {
    try {
      if (edgeProcess && edgeProcess.pid) {
        process.kill(edgeProcess.pid);
      }
    } catch (e) {}

    try {
      if (fs.existsSync(taskWorkspaceDir)) {
        fs.rmSync(taskWorkspaceDir, { recursive: true, force: true });
        console.log('🧹 Cleaned up temporary test profile directory.');
      }
    } catch (e) {}
  };

  process.on('SIGINT', () => {
    console.log('\n[Interrupted] Ctrl+C received. Cleaning up and exiting...');
    cleanup();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    cleanup();
    process.exit(0);
  });

  try {
    console.log('The browser will remain open for 60 seconds for your manual inspection...');
    await new Promise((resolve) => setTimeout(resolve, 60000));
  } finally {
    await browser.close().catch(() => {});
    cleanup();
    console.log('✅ Manual test complete. Edge closed and temporary profile directory deleted.');
  }
}

run().catch((err) => {
  console.error('[Error during test]:', err);
  process.exit(1);
});
