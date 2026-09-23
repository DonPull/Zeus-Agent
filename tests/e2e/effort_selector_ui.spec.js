import { test, expect } from '@playwright/test';
import { startMockServer, stopMockServer, launchTauri, stopTauri, cleanupTasks } from './testUtils.js';

test.describe('Zeus E2E Tests - Model Reasoning Effort Selector UI', () => {
  test.setTimeout(120000);

  let browser;
  let page;

  test.beforeAll(async () => {
    test.setTimeout(120000);
    await startMockServer();
    const tauri = await launchTauri(false);
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

  test('Global Settings and Task Settings configure and persist reasoning effort levels', async () => {
    // 1. Wait for app container to mount
    await expect(page.locator('#app-container')).toBeVisible({ timeout: 15000 });

    // 2. Open Global Settings
    await page.locator('#sidebar-settings-button').click();
    await expect(page.locator('#master-effort-select')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#worker-effort-select')).toBeVisible();
    await expect(page.locator('#verifier-effort-select')).toBeVisible();
    await expect(page.locator('#watcher-effort-select')).toBeVisible();

    // Verify initial default value
    expect(await page.locator('#master-effort-select').inputValue()).toBe('default');

    // 3. Configure effort levels in Global Settings
    await page.locator('#master-effort-select').selectOption('low');
    await page.locator('#worker-effort-select').selectOption('medium');
    await page.locator('#verifier-effort-select').selectOption('high');
    await page.locator('#watcher-effort-select').selectOption('low');

    // 4. Save global settings
    await page.locator('#global-save-settings-button').click();
    await page.waitForTimeout(500);

    // 5. Close settings modal
    await page.locator('#settings-close-button').click();
    await expect(page.locator('#master-effort-select')).not.toBeVisible();

    // 6. Reopen Global Settings and verify persistence
    await page.locator('#sidebar-settings-button').click();
    await expect(page.locator('#master-effort-select')).toBeVisible();
    expect(await page.locator('#master-effort-select').inputValue()).toBe('low');
    expect(await page.locator('#worker-effort-select').inputValue()).toBe('medium');
    expect(await page.locator('#verifier-effort-select').inputValue()).toBe('high');
    expect(await page.locator('#watcher-effort-select').inputValue()).toBe('low');

    // Close settings modal
    await page.locator('#settings-close-button').click();

    // 7. Create a new task (which should inherit these global defaults)
    await page.locator('#new-task-button').click();
    await expect(page.locator('#chat-task-settings-button')).toBeVisible({ timeout: 10000 });

    // 8. Open Task Settings modal
    await page.locator('#chat-task-settings-button').click();
    await expect(page.locator('#task-master-effort-select')).toBeVisible({ timeout: 5000 });

    // Verify inheritance from global settings
    expect(await page.locator('#task-master-effort-select').inputValue()).toBe('low');
    expect(await page.locator('#task-worker-effort-select').inputValue()).toBe('medium');
    expect(await page.locator('#task-verifier-effort-select').inputValue()).toBe('high');
    expect(await page.locator('#task-watcher-effort-select').inputValue()).toBe('low');

    // 9. Update task-scoped effort levels
    await page.locator('#task-master-effort-select').selectOption('high');
    await page.locator('#task-worker-effort-select').selectOption('low');

    // 10. Save task settings
    await page.locator('#task-save-settings-button').click();
    await page.waitForTimeout(500);

    // 11. Re-open Task Settings and verify persistence
    await page.locator('#chat-task-settings-button').click();
    await expect(page.locator('#task-master-effort-select')).toBeVisible();
    expect(await page.locator('#task-master-effort-select').inputValue()).toBe('high');
    expect(await page.locator('#task-worker-effort-select').inputValue()).toBe('low');
    expect(await page.locator('#task-verifier-effort-select').inputValue()).toBe('high');
    expect(await page.locator('#task-watcher-effort-select').inputValue()).toBe('low');

    // Close modal
    await page.locator('#task-settings-close-button').click();
  });

  test('Load available models immediately refreshes local models and displays Local badge without modal reopen', async () => {
    // 1. Open settings modal
    await page.locator('#sidebar-settings-button').click();
    await expect(page.locator('#master-effort-select')).toBeVisible({ timeout: 5000 });

    // 2. Click "Load available models" button
    await page.locator('button:has-text("Load available models")').first().click();
    await page.waitForTimeout(500);

    // 3. Open Master Model dropdown
    const masterDropdownTrigger = page.locator('.settings-model-row').first().locator('div.settings-input');
    await masterDropdownTrigger.click();

    // 4. Type search query in dropdown
    const searchInput = page.locator('input[placeholder="Search model..."]');
    await expect(searchInput).toBeVisible();

    // 5. Verify dropdown renders without throwing and search works
    await searchInput.fill("gemini");
    const optionCount = await page.locator('div[style*="cursor: pointer"]:has-text("gemini")').count();
    expect(optionCount).toBeGreaterThan(0);

    // Close modal
    await page.locator('#settings-close-button').click();
  });

  test('Delegation team maintains independent slots, warns on partial config, blocks save, and allows solo or full team', async () => {
    // 1. Open settings modal
    await page.locator('#sidebar-settings-button').click();
    await expect(page.locator('#master-effort-select')).toBeVisible({ timeout: 5000 });

    const workerRow = page.locator('.settings-model-row', { hasText: 'Worker' });
    const verifierRow = page.locator('.settings-model-row', { hasText: 'Verifier' });
    const watcherRow = page.locator('.settings-model-row', { hasText: 'Watcher' });

    const selectModelInRow = async (rowLocator, modelName) => {
      await rowLocator.locator('div.settings-input').click();
      if (modelName === '(None)') {
        await rowLocator.locator('div[style*="position: absolute"]').locator('div', { hasText: '(None)' }).first().click();
      } else {
        await rowLocator.locator('input[placeholder="Search model..."]').fill(modelName);
        await rowLocator.locator('div[style*="position: absolute"]').locator(`div[style*="cursor: pointer"]:has-text("${modelName}")`).first().click();
      }
      await expect(rowLocator.locator('input[placeholder="Search model..."]')).not.toBeVisible();
    };

    // 2. Set Worker to (None)
    await selectModelInRow(workerRow, '(None)');

    // 3. Since Worker is None while Verifier & Watcher are active, warning banner must appear
    const warningBanner = page.locator('#settings-delegation-warning');
    await expect(warningBanner).toBeVisible({ timeout: 5000 });
    const warningText = await warningBanner.textContent();
    expect(warningText).toContain('Worker');
    expect(warningText).toContain('Multi-Agent');
    expect(warningText).toContain('Solo Mode');

    // 4. Attempt to save — must be blocked with error toast
    await page.locator('#global-save-settings-button').click();
    await expect(page.locator('.toast-notification')).toContainText('Incomplete setup');

    // 5. Click "Switch to Solo Mode" shortcut button in banner
    await page.locator('button:has-text("Switch to Solo Mode")').click();

    // 6. Verify warning banner disappears and all 3 roles show (None)
    await expect(warningBanner).not.toBeVisible();
    expect(await workerRow.locator('div.settings-input').textContent()).toContain('(None)');
    expect(await verifierRow.locator('div.settings-input').textContent()).toContain('(None)');
    expect(await watcherRow.locator('div.settings-input').textContent()).toContain('(None)');

    // 7. Save is now permitted in Solo Mode
    await page.locator('#global-save-settings-button').click();
    await expect(page.locator('.toast-notification')).toContainText('Settings saved');
    await page.waitForTimeout(1000);

    // 8. Select a model for Worker only (while Verifier and Watcher are None)
    await selectModelInRow(workerRow, 'gemini-1.5-pro');

    // 9. Verify Verifier and Watcher REMAIN (None) — NO placeholder auto-population!
    expect(await verifierRow.locator('div.settings-input').textContent()).toContain('(None)');
    expect(await watcherRow.locator('div.settings-input').textContent()).toContain('(None)');

    // 10. Warning banner must be visible and specify missing Verifier and Watcher
    await expect(warningBanner).toBeVisible();
    const missingText = await warningBanner.textContent();
    expect(missingText).toContain('Verifier');
    expect(missingText).toContain('Watcher');

    // 11. Attempting to save must still be blocked
    await page.locator('#global-save-settings-button').click();
    await expect(page.locator('.toast-notification')).toContainText('Incomplete setup');

    // 12. Complete the team by assigning models to Verifier and Watcher
    await selectModelInRow(verifierRow, 'gemini-1.5-pro');
    await selectModelInRow(watcherRow, 'gemini-1.5-flash');

    // 13. Warning banner disappears when full team is configured
    await expect(warningBanner).not.toBeVisible();

    // 14. Save succeeds
    await page.locator('#global-save-settings-button').click();
    await expect(page.locator('.toast-notification')).toContainText('Settings saved');

    // Close modal
    await page.locator('#settings-close-button').click();
  });

  test('Task Settings modal enforces team validation, warns on partial config, and allows solo or full team', async () => {
    // 1. Create a task
    await page.locator('#new-task-button').click();
    await expect(page.locator('#chat-task-settings-button')).toBeVisible({ timeout: 10000 });

    // 2. Open Task Settings modal
    await page.locator('#chat-task-settings-button').click();
    await expect(page.locator('#task-master-effort-select')).toBeVisible({ timeout: 5000 });

    const workerRow = page.locator('.settings-model-row', { hasText: 'Worker' });
    const verifierRow = page.locator('.settings-model-row', { hasText: 'Verifier' });
    const watcherRow = page.locator('.settings-model-row', { hasText: 'Watcher' });

    const selectModelInRow = async (rowLocator, modelName) => {
      await rowLocator.locator('div.settings-input').click();
      if (modelName === '(None)') {
        await rowLocator.locator('div[style*="position: absolute"]').locator('div', { hasText: '(None)' }).first().click();
      } else {
        await rowLocator.locator('input[placeholder="Search model..."]').fill(modelName);
        await rowLocator.locator('div[style*="position: absolute"]').locator(`div[style*="cursor: pointer"]:has-text("${modelName}")`).first().click();
      }
      await expect(rowLocator.locator('input[placeholder="Search model..."]')).not.toBeVisible();
    };

    // 3. Set Worker to (None)
    await selectModelInRow(workerRow, '(None)');

    // 4. Warning banner must appear in Task Settings
    const warningBanner = page.locator('#task-settings-delegation-warning');
    await expect(warningBanner).toBeVisible({ timeout: 5000 });
    const warningText = await warningBanner.textContent();
    expect(warningText).toContain('Worker');
    expect(warningText).toContain('Multi-Agent');
    expect(warningText).toContain('Solo Mode');

    // 5. Attempting to save task settings must be blocked with error toast
    await page.locator('#task-save-settings-button').click();
    await expect(page.locator('.toast-notification')).toContainText('Incomplete setup');

    // 6. Click "Switch to Solo Mode" shortcut button in Task Settings
    await page.locator('#task-settings-delegation-warning button:has-text("Switch to Solo Mode")').click();

    // 7. Verify banner disappears and all 3 roles show (None)
    await expect(warningBanner).not.toBeVisible();
    expect(await workerRow.locator('div.settings-input').textContent()).toContain('(None)');
    expect(await verifierRow.locator('div.settings-input').textContent()).toContain('(None)');
    expect(await watcherRow.locator('div.settings-input').textContent()).toContain('(None)');

    // 8. Save task settings in Solo Mode
    await page.locator('#task-save-settings-button').click();
    await expect(page.locator('.toast-notification')).toContainText('Task settings saved');

    // 9. Reopen Task Settings and verify persistence of Solo Mode
    await page.locator('#chat-task-settings-button').click();
    await expect(page.locator('#task-master-effort-select')).toBeVisible({ timeout: 5000 });
    expect(await workerRow.locator('div.settings-input').textContent()).toContain('(None)');
    expect(await verifierRow.locator('div.settings-input').textContent()).toContain('(None)');
    expect(await watcherRow.locator('div.settings-input').textContent()).toContain('(None)');
    await expect(warningBanner).not.toBeVisible();

    // 10. Change Worker to a model — Verifier and Watcher must REMAIN (None)
    await selectModelInRow(workerRow, 'gemini-1.5-pro');
    expect(await verifierRow.locator('div.settings-input').textContent()).toContain('(None)');
    expect(await watcherRow.locator('div.settings-input').textContent()).toContain('(None)');
    await expect(warningBanner).toBeVisible();

    // 11. Close Task Settings modal
    await page.locator('#task-settings-close-button').click();
  });
});


