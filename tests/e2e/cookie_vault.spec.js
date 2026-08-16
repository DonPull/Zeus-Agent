import { test, expect } from '@playwright/test';
import { startMockServer, stopMockServer, launchTauri, stopTauri, queueMockResponse, cleanupTasks } from './testUtils.js';

test.describe('Cookie Vault & Account Switching', () => {
  test.setTimeout(180000);
  let page;

  test.beforeAll(async () => {
    await startMockServer();
    const tauri = await launchTauri();
    page = tauri.page;
  });

  test.afterEach(async () => {
    await cleanupTasks(page);
  });

  test.afterAll(async () => {
    await stopTauri();
    await stopMockServer();
  });

  test('Cookie Vault allows storing and retrieving domain accounts via bridge', async () => {
    await expect(page.locator('#app-container')).toBeVisible({ timeout: 15000 });
    
    // Test vault CRUD via window.__TAURI__.core.invoke through page.evaluate
    const result = await page.evaluate(async () => {
      const invoke = window.__TAURI_INTERNALS__?.invoke || window.__TAURI__?.core?.invoke;
      // 1. Save entry
      await invoke('save_vault_account', {
        entry: {
          id: 'acc_ig_1',
          service: 'instagram',
          domain: 'instagram.com',
          account_identifier: 'zeus_official',
          display_name: 'Zeus Marketing Bot',
          cookies_json: JSON.stringify([{ name: 'sessionid', value: 'secret123', domain: '.instagram.com' }]),
          created_at: new Date().toISOString(),
          last_used_at: null,
        }
      });

      // 2. Fetch by domain
      const accounts = await invoke('get_vault_accounts', { domain: 'instagram.com' });
      
      // 3. Fetch by ID
      const single = await invoke('get_vault_account', { id: 'acc_ig_1' });

      // 4. Delete
      await invoke('delete_vault_account', { id: 'acc_ig_1' });
      const afterDelete = await invoke('get_vault_accounts', { domain: 'instagram.com' });

      return {
        accountsCount: accounts.length,
        firstAccountIdent: accounts[0]?.account_identifier,
        singleIdent: single?.account_identifier,
        afterDeleteCount: afterDelete.length
      };
    });

    expect(result.accountsCount).toBe(1);
    expect(result.firstAccountIdent).toBe('zeus_official');
    expect(result.singleIdent).toBe('zeus_official');
    expect(result.afterDeleteCount).toBe(0);
  });
});
