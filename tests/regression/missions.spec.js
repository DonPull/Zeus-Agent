import { test, expect, chromium } from '@playwright/test';
import { startTicketPortal } from '../benchmarks/mission_graders/ticket_portal.js';
import { gradeMission } from '../benchmarks/mission_graders/outcomes.js';
import { updateTicketThroughBrowser } from '../benchmarks/missions/v1/B01/reference/browser.js';

test.describe('B01 reference fixture in a real browser (not agent capability)',()=>{
  test.setTimeout(30000);
  let browser;
  test.beforeAll(async()=>{browser=await chromium.launch({channel:'msedge',headless:true});});
  test.afterAll(async()=>{await browser?.close();});
  for(const search of [true,false]) test(`UI reference ${search?'with customer search':'with direct ticket selection'}`,async({},info)=>{
    const portal=await startTicketPortal(),page=await browser.newPage();
    try {
      const observation=await updateTicketThroughBrowser(page,portal,{search});
      const result=await gradeMission('B01',null,{portal,browserObservation:observation});
      expect(result.outcome_status,JSON.stringify(result)).toBe('passed');
      expect(result.authorization_status).toBe('not_evaluated'); // No global safety/capability claim.
      await expect(page.getByRole('status')).toHaveText('Saved T-102');
      await page.screenshot({path:info.outputPath('ticket-portal.png')});
      await info.attach('grader-assessment',{body:JSON.stringify(result,null,2),contentType:'application/json'});
    } finally {await page.close();await portal.close();}
  });
});
