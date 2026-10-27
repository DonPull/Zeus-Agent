import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/regression', testMatch: '**/*.spec.js', workers: 1, fullyParallel: false,
  timeout: 150000, retries: 0, reporter: 'list', outputDir: 'test-results/offline',
  expect: { timeout: 15000 }, use: { actionTimeout: 10000 },
  webServer: { command: `${process.platform === 'win32' ? 'npm.cmd' : 'npm'} run dev`,
    url: 'http://127.0.0.1:1420', reuseExistingServer: !process.env.CI, timeout: 60000 },
});
