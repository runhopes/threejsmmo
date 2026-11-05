// Screenshot preview.html (trajectory overlay, timeline, feet) at a given moment.
//   node tools/pshot.mjs "play=attack1&speed=0.25&cam=front" 1400 out.png ["query" ms out.png ...]
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const a = process.argv.slice(2);
const url = pathToFileURL(path.resolve(import.meta.dirname, '..', 'preview.html')).href;
const browser = await chromium.launch({ channel: 'msedge', args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
let bad = false;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => { bad = true; console.log('pageerror: ' + e.message); });
  for (let i = 0; i < a.length; i += 3) {
    await page.goto(url + '?' + a[i], { waitUntil: 'load' });
    await page.waitForFunction(() => window.__ready === true);
    await page.waitForTimeout(+a[i + 1]);
    await page.screenshot({ path: a[i + 2] });
    console.log(a[i + 2]);
  }
} finally { await browser.close(); }
process.exit(bad ? 1 : 0);
