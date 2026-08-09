import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests', // We'll run both e2e and advanced_e2e from here, Playwright finds *.spec.js recursively
  timeout: 5 * 60 * 1000, // 5 minutes for real LLM runs
  expect: {
    timeout: 30000 // 30 seconds for expectations to accommodate UI latency
  },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Must be 1 since they share the same SQLite file
  reporter: 'list',
  use: {
    actionTimeout: 0,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'tauri',
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:1420',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  }
});
