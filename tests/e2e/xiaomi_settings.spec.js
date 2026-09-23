import { test, expect } from '@playwright/test';
import { startMockServer, stopMockServer, launchTauri, stopTauri, cleanupTasks } from './testUtils.js';

test.describe('Zeus E2E Tests - Xiaomi MiMo Integration', () => {
  test.setTimeout(120000);

  let browser;
  let page;

  test.beforeAll(async () => {
    test.setTimeout(120000);
    await startMockServer();
    const tauri = await launchTauri();
    browser = tauri.browser;
    page = tauri.page;
  });

  test.afterEach(async () => {
    await cleanupTasks(page);
  });

  test.afterAll(async () => {
    await stopTauri();
    await stopMockServer();
  });

  test('Settings modal includes Xiaomi MiMo dedicated base URL, key input, and mimo models', async () => {
    await expect(page.locator('#app-container')).toBeVisible({ timeout: 15000 });

    // Open settings modal
    await page.locator('#sidebar-settings-button').click();

    const modal = page.locator('.modal-content, .settings-modal');
    await expect(modal).toBeVisible({ timeout: 10000 });

    // Check Xiaomi MiMo section
    const xiaomiSection = page.getByText('Xiaomi MiMo (Dedicated Base URL & API Key)');
    await expect(xiaomiSection).toBeVisible();

    // Check dedicated base URL input
    const urlInput = page.locator('input[value="https://token-plan-ams.xiaomimimo.com/v1"]');
    await expect(urlInput).toBeVisible();

    // Check password input placeholder
    const keyInput = page.locator('input[placeholder="Paste your Xiaomi MiMo API key"]');
    await expect(keyInput).toBeVisible();

    // Check test connection button
    const testButton = page.locator('button', { hasText: 'Test Connection' });
    await expect(testButton).toBeVisible();

    // Check that Master model dropdown lists mimo-v2.6-pro
    const masterDropdown = page.locator('.settings-model-row').first().locator('div.settings-input');
    await masterDropdown.click();

    const mimoOption = page.locator('.align-center', { hasText: 'mimo-v2.6-pro' }).first();
    await expect(mimoOption).toBeVisible();

    // Close settings modal
    await page.locator('#settings-close-button').click();
    await expect(modal).not.toBeVisible();
  });

  test('Xiaomi API key and dedicated base URL persist and update UI key status', async () => {
    await page.locator('#sidebar-settings-button').click();
    const modal = page.locator('.modal-content, .settings-modal');
    await expect(modal).toBeVisible({ timeout: 10000 });

    // Fill in Xiaomi API key and save
    const keyInput = page.locator('input[placeholder="Paste your Xiaomi MiMo API key"]');
    await keyInput.fill('test-xiaomi-api-key-999');
    
    // Click Save key for Xiaomi
    const xiaomiSection = page.locator('.settings-section', { hasText: 'Xiaomi MiMo (Dedicated Base URL & API Key)' });
    await xiaomiSection.locator('button', { hasText: 'Save key' }).click();

    // Verify status pill turns to "Key set"
    const statusPill = xiaomiSection.locator('.key-status-pill');
    await expect(statusPill).toHaveText('Key set');
    await expect(statusPill).toHaveClass(/set/);

    // Select mimo-v2.6-pro as Master model
    const masterRow = page.locator('.settings-model-row').first();
    await masterRow.locator('div.settings-input').click();
    await masterRow.locator('input[placeholder="Search model..."]').fill('mimo-v2.6-pro');
    await masterRow.locator('div[style*="position: absolute"]').locator('div[style*="cursor: pointer"]:has-text("mimo-v2.6-pro")').first().click();

    // Save global settings
    await page.locator('#global-save-settings-button').click();
    await expect(page.locator('.toast-notification')).toContainText('Settings saved');

    // Close and reopen modal to verify persistence
    await page.locator('#settings-close-button').click();
    await expect(modal).not.toBeVisible();

    await page.locator('#sidebar-settings-button').click();
    await expect(modal).toBeVisible({ timeout: 10000 });

    // Verify Master model persisted as mimo-v2.6-pro
    const masterText = await page.locator('.settings-model-row').first().locator('div.settings-input').textContent();
    expect(masterText).toContain('mimo-v2.6-pro');

    // Verify key status is still set
    const reloadedPill = page.locator('.settings-section', { hasText: 'Xiaomi MiMo (Dedicated Base URL & API Key)' }).locator('.key-status-pill');
    await expect(reloadedPill).toHaveText('Key set');

    await page.locator('#settings-close-button').click();
  });
});
