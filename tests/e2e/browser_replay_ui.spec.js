import { test, expect } from '@playwright/test';
import { startMockServer, stopMockServer, launchTauri, stopTauri, queueMockResponse, cleanupTasks } from './testUtils.js';

test.describe('Zeus E2E Tests - Browser Session Replay & Live View UI', () => {
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

  test('Old Browser History header button is removed and in-chat Replay & Live View cards function', async () => {
    // 1. Wait for app container to mount
    await expect(page.locator('#app-container')).toBeVisible({ timeout: 15000 });

    // 2. Create a new task
    await page.locator('#new-task-button').click();
    await expect(page.locator('#chat-top-bar')).toBeVisible({ timeout: 10000 });

    // 3. Verify that the old static "Browser History" button is NOT in the header
    const oldHistoryButton = page.locator('#chat-top-bar button', { hasText: 'Browser History' });
    await expect(oldHistoryButton).toHaveCount(0);

    // 4. Fill in a prompt and queue an action directive that simulates browser execution
    await page.locator('#chat-input').fill('Navigate and interact with the browser');

    // 1x1 PNG bytes for valid screenshot files
    const pngHex = "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082";

    const pythonCode = [
      "import os, json, time, binascii",
      `png_bytes = binascii.unhexlify("${pngHex}")`,
      "if _zeus_history_dir:",
      "    os.makedirs(_zeus_history_dir, exist_ok=True)",
      "    with open(os.path.join(_zeus_history_dir, '1_goto.png'), 'wb') as f: f.write(png_bytes)",
      "    with open(os.path.join(_zeus_history_dir, '2_click.png'), 'wb') as f: f.write(png_bytes)",
      "    with open(os.path.join(_zeus_history_dir, '3_fill.png'), 'wb') as f: f.write(png_bytes)",
      "",
      "_zeus_ensure_session_started()",
      "_zeus_record_step(None, 'goto', selector='https://news.ycombinator.com')",
      "_zeus_record_step(None, 'click', selector='a.storylink', pre_box={'x': 100, 'y': 150, 'width': 200, 'height': 30})",
      "_zeus_record_step(None, 'fill', selector=\"input[name='q']\", value='Playwright testing', pre_box={'x': 40, 'y': 60, 'width': 180, 'height': 25})",
      "_zeus_finalize_session()",
      "print('BROWSER_REPLAY_TEST_COMPLETE')"
    ].join("\n");

    const actionDirective = {
      type: "run_action",
      action: {
        language: "python",
        code: pythonCode,
        timeout_secs: 60
      },
      success_criteria: "Browser interaction executed"
    };

    queueMockResponse({
      choices: [{
        delta: {
          content: "```zeus-directive\n" + JSON.stringify(actionDirective) + "\n```"
        }
      }]
    });

    const finalAnswerDirective = {
      type: "final_answer",
      final_answer: {
        summary: "Browser automation completed with 3 steps."
      }
    };

    // Follow-up final answer to finish run
    queueMockResponse({
      choices: [{
        delta: {
          content: "```zeus-directive\n" + JSON.stringify(finalAnswerDirective) + "\n```"
        }
      }]
    });

    // 5. Send message
    await page.locator('#chat-send-button').click();

    // 6. Verify that Browser Session Started card appears
    const startedCard = page.locator('.browser-session-card').filter({ hasText: 'Browser Session Active' }).first();
    await expect(startedCard).toBeVisible({ timeout: 20000 });
    await expect(startedCard.locator('.live-pulse-dot')).toBeVisible();
    await expect(startedCard.locator('#browser-session-live-view-btn')).toBeVisible();

    // 7. Verify that Browser Session Completed card appears
    const completedCard = page.locator('.browser-session-card.completed').filter({ hasText: 'Browser Session Completed' }).first();
    await expect(completedCard).toBeVisible({ timeout: 20000 });
    await expect(completedCard.locator('.browser-badge-completed')).toBeVisible();
    await expect(completedCard.locator('#browser-session-replay-btn')).toBeVisible();
    await expect(completedCard.locator('.browser-metric-pill').first()).toContainText('3');

    // 8. Test Live View Modal
    await startedCard.locator('#browser-session-live-view-btn').click();
    const liveModal = page.locator('.modal-container').filter({ hasText: 'Live Browser View' });
    await expect(liveModal).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.live-notice-banner')).toContainText(/LIVE OBSERVER|SESSION COMPLETED/);
    // Close live view modal
    await page.locator('#live-modal-close-button').click();
    await expect(liveModal).not.toBeVisible();

    // 9. Test Session Replay Modal
    await completedCard.locator('#browser-session-replay-btn').click();
    const replayModal = page.locator('.modal-container').filter({ hasText: 'Browser Session Replay' });
    await expect(replayModal).toBeVisible({ timeout: 5000 });

    // Verify step counter & address bar
    await expect(page.locator('.replay-step-counter')).toContainText('Step 1 of 3');
    await expect(page.locator('.replay-url-text')).toContainText('https://news.ycombinator.com');
    await expect(page.locator('.action-badge')).toHaveText('GOTO');

    // Verify screenshot image is loaded and not broken
    const imgElement = page.locator('#replay-screenshot-img');
    await expect(imgElement).toBeVisible();
    const naturalWidth = await imgElement.evaluate(el => el.naturalWidth);
    expect(naturalWidth).toBeGreaterThan(0);

    // Step to Step 2 (click with bounding box)
    await page.locator('#replay-next-button').click();
    await expect(page.locator('.replay-step-counter')).toContainText('Step 2 of 3');
    await expect(page.locator('.action-badge')).toHaveText('CLICK');
    await expect(page.locator('.action-target')).toHaveText('a.storylink');

    // Verify bounding box overlay is visible
    const boundingBox = page.locator('#replay-bounding-box-overlay');
    await expect(boundingBox).toBeVisible({ timeout: 3000 });

    // Toggle highlight OFF
    await page.locator('#replay-highlight-toggle').click();
    await expect(page.locator('#replay-highlight-toggle')).toContainText('Highlight: OFF');
    await expect(boundingBox).not.toBeVisible();

    // Toggle highlight back ON
    await page.locator('#replay-highlight-toggle').click();
    await expect(page.locator('#replay-highlight-toggle')).toContainText('Highlight: ON');
    await expect(boundingBox).toBeVisible();

    // Step to Step 3 using step pill
    await page.locator('#replay-step-pill-2').click();
    await expect(page.locator('.replay-step-counter')).toContainText('Step 3 of 3');
    await expect(page.locator('.action-badge')).toHaveText('FILL');
    await expect(page.locator('.action-value')).toContainText('Playwright testing');

    // Close Replay Modal
    await page.locator('#replay-modal-close-button').click();
    await expect(replayModal).not.toBeVisible();
  });

  test('Session with 40+ steps does not overflow modal boundaries, timeline scrolls, and live view transitions to replay', async () => {
    // 1. Wait for app container to mount
    await expect(page.locator('#app-container')).toBeVisible({ timeout: 15000 });

    // 2. Create a new task
    await page.locator('#new-task-button').click();
    await expect(page.locator('#chat-top-bar')).toBeVisible({ timeout: 10000 });

    // 3. Queue mock python execution producing 40 steps
    await page.locator('#chat-input').fill('Perform a 40-step browser task');

    const pngHex = "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082";

    const pythonCode = [
      "import os, json, time, binascii",
      `png_bytes = binascii.unhexlify("${pngHex}")`,
      "if _zeus_history_dir:",
      "    os.makedirs(_zeus_history_dir, exist_ok=True)",
      "    for i in range(1, 41):",
      "        with open(os.path.join(_zeus_history_dir, f'{i}_press.png'), 'wb') as f: f.write(png_bytes)",
      "",
      "_zeus_ensure_session_started()",
      "for i in range(1, 41):",
      "    _zeus_record_step(None, 'press', selector=f'cell_{i}', value='Enter', pre_box={'x': 20 + (i % 5) * 40, 'y': 50 + (i // 5) * 40, 'width': 35, 'height': 35})",
      "_zeus_finalize_session()",
      "print('FORTY_STEPS_BROWSER_TEST_COMPLETE')"
    ].join("\n");

    queueMockResponse({
      choices: [{
        delta: {
          content: "```zeus-directive\n" + JSON.stringify({
            type: "run_action",
            action: { language: "python", code: pythonCode, timeout_secs: 60 },
            success_criteria: "40 steps recorded"
          }) + "\n```"
        }
      }]
    });

    queueMockResponse({
      choices: [{
        delta: {
          content: "```zeus-directive\n" + JSON.stringify({
            type: "final_answer",
            final_answer: { summary: "Completed 40 browser actions successfully." }
          }) + "\n```"
        }
      }]
    });

    await page.locator('#chat-send-button').click();

    // 4. Verify completed card with 40 actions appears
    const completedCard = page.locator('.browser-session-card.completed').filter({ hasText: 'Browser Session Completed' }).first();
    await expect(completedCard).toBeVisible({ timeout: 25000 });
    await expect(completedCard.locator('.browser-metric-pill').first()).toContainText('40');

    // 5. Open Replay Modal
    await completedCard.locator('#browser-session-replay-btn').click();
    const replayModal = page.locator('.modal-container.replay-modal-window');
    await expect(replayModal).toBeVisible({ timeout: 5000 });

    // 6. Strict viewport boundary assertions: modal MUST NOT overflow viewport!
    await page.waitForTimeout(350);
    const viewportSize = page.viewportSize() || { width: 1280, height: 800 };
    const modalBox = await replayModal.boundingBox();
    expect(modalBox).not.toBeNull();
    expect(modalBox.x).toBeGreaterThanOrEqual(0);
    expect(modalBox.x + modalBox.width).toBeLessThanOrEqual(viewportSize.width);
    expect(modalBox.width).toBeLessThanOrEqual(1210); // max-width 1200px + padding tolerance

    await page.screenshot({ path: 'tests/benchmarks/suites/wave_2_browser_agentics/visual_artifacts/replay_step_1_fixed.png' });

    // 7. Verify controls are strictly inside the visible viewport and clickable
    const closeBtn = page.locator('#replay-modal-close-button');
    await expect(closeBtn).toBeVisible();
    const closeBtnBox = await closeBtn.boundingBox();
    expect(closeBtnBox.x + closeBtnBox.width).toBeLessThanOrEqual(viewportSize.width);

    const nextBtn = page.locator('#replay-next-button');
    await expect(nextBtn).toBeVisible();
    const nextBtnBox = await nextBtn.boundingBox();
    expect(nextBtnBox.x + nextBtnBox.width).toBeLessThanOrEqual(viewportSize.width);

    // 8. Verify timeline bar has scrollable overflow rather than blowing out width
    const timeline = page.locator('.replay-timeline-bar');
    await expect(timeline).toBeVisible();
    const scrollWidth = await timeline.evaluate(el => el.scrollWidth);
    const clientWidth = await timeline.evaluate(el => el.clientWidth);
    // With 40 pills, scrollWidth (~2800px) must exceed clientWidth (~1100px)
    expect(scrollWidth).toBeGreaterThan(clientWidth);

    // 9. Navigate with next button and verify step pill auto-scroll
    for (let i = 0; i < 5; i++) {
      await nextBtn.click();
    }
    await expect(page.locator('.replay-step-counter')).toContainText('Step 6 of 40');

    // Click step pill 35 and verify it activates and updates
    const pill35 = page.locator('#replay-step-pill-34');
    await pill35.click();
    await expect(page.locator('.replay-step-counter')).toContainText('Step 35 of 40');
    await expect(pill35).toHaveClass(/active/);

    // Close Replay Modal
    await closeBtn.click();
    await expect(replayModal).not.toBeVisible();

    // 10. Test Live View Modal on this session: verify completion banner and transition to replay
    const startedCard = page.locator('.browser-session-card').filter({ hasText: 'Browser Session Active' }).first();
    if (await startedCard.isVisible()) {
      await startedCard.locator('#browser-session-live-view-btn').click();
      const liveModal = page.locator('.modal-container.live-modal-window');
      await expect(liveModal).toBeVisible({ timeout: 5000 });

      // Because this session already finished, Live View should detect completion and show the banner
      await expect(page.locator('.live-notice-banner.completed')).toBeVisible({ timeout: 5000 });
      await expect(page.locator('.live-badge-text.completed')).toHaveText('SESSION COMPLETED');

      await page.waitForTimeout(350);
      await page.screenshot({ path: 'tests/benchmarks/suites/wave_2_browser_agentics/visual_artifacts/live_view_fixed.png' });

      // Click "View Full Replay" CTA inside Live View
      const switchBtn = page.locator('#live-switch-to-replay-btn');
      await expect(switchBtn).toBeVisible();
      await switchBtn.click();

      // Live view closes and Replay opens
      await expect(liveModal).not.toBeVisible();
      await expect(replayModal).toBeVisible({ timeout: 5000 });
      await expect(page.locator('.replay-step-counter')).toContainText('Step 1 of 40');

      // Close Replay
      await page.locator('#replay-modal-close-button').click();
      await expect(replayModal).not.toBeVisible();
    }
  });
});
