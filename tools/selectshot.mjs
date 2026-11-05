// Class selection screen: idle, then click each card and capture the preview move.   node tools/selectshot.mjs <outPrefix>
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const out = process.argv[2] || 'shots/v3/select';
const url = pathToFileURL(path.resolve(import.meta.dirname, '..', 'index.html')).href;
const browser = await chromium.launch({ channel: 'msedge', args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
let errs = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => { errs++; console.log('pageerror: ' + e.message); });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: out + '_0.png' });
  await page.click('.card[data-cls=mage]'); await page.waitForTimeout(420);
  await page.screenshot({ path: out + '_mage.png' });
  await page.click('#enter'); await page.waitForTimeout(800);
  console.log('cls after start', await page.evaluate(() => window.__knight.cls));
  await page.screenshot({ path: out + '_ingame.png' });
} finally { await browser.close(); }
console.log('page errors', errs);
