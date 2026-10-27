/** Re-render the two synthetic order screenshots; review/version pixel changes. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const dir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../inputs');
fs.mkdirSync(dir,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
  const page=await browser.newPage({viewport:{width:1100,height:700},deviceScaleFactor:1});
  for(const [name,quantity,total] of [['7f91c2a0.png',2,'118.00'],['a42d6e83.png',5,'155.50']]) {
    await page.setContent(`<!doctype html><html lang="en"><meta charset="utf-8"><style>
      *{box-sizing:border-box}body{margin:0;background:#edf2f7;color:#162536;font:20px Arial,sans-serif}
      header{background:#152d48;color:white;padding:26px 50px;font-size:24px}main{margin:30px 50px;background:white;padding:32px;border:1px solid #d1dbe5;border-radius:10px}
      h1{font-size:32px;margin:0 0 15px}p{color:#40566f}table{border-collapse:collapse;width:100%;margin:25px 0}th,td{padding:18px 10px;text-align:left;border-bottom:1px solid #dce3ea}th{font-size:17px;color:#40566f}td:nth-child(n+3),th:nth-child(n+3){text-align:right}.total{text-align:right;font-size:26px;font-weight:bold}footer{margin:20px 50px;color:#53667a;font-size:16px}
      </style><header>Zeus Office Supply / Orders</header><main><h1>Order ZA-7419</h1><p>Customer: Danube Design Studio &nbsp; · &nbsp; Currency: EUR</p>
      <table><thead><tr><th>SKU</th><th>Description</th><th>Quantity</th><th>Unit price</th><th>Line total</th></tr></thead><tbody>
      <tr><td>KEY-110</td><td>Keyboard</td><td>3</td><td>25.00</td><td>75.00</td></tr>
      <tr><td>CAB-240</td><td>USB cable</td><td>${quantity}</td><td>12.50</td><td>${(quantity*12.5).toFixed(2)}</td></tr>
      <tr><td>HUB-315</td><td>USB hub</td><td>1</td><td>18.00</td><td>18.00</td></tr></tbody></table><div class="total">Total: EUR ${total}</div></main><footer>Draft order · No tax or delivery fees</footer></html>`);
    await page.screenshot({path:path.join(dir,name)});
  }
} finally {await browser.close();}
