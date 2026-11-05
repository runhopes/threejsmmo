// selection cards + hero damage / death / revive states in the HUD
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const base = pathToFileURL(path.resolve(import.meta.dirname, '..', 'index.html')).href;
const browser = await chromium.launch({ channel: 'msedge', args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
let errs = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => { errs++; console.log('pageerror: ' + e.message); });
  await page.goto(base, { waitUntil: 'load' }); await page.waitForTimeout(1200);
  await page.screenshot({ path: 'shots/v3/sel_cards.png' });
  await page.goto(base + '?cls=archer', { waitUntil: 'load' }); await page.waitForTimeout(900);
  await page.keyboard.press('e'); await page.waitForTimeout(150); await page.keyboard.press('e'); await page.waitForTimeout(250);
  console.log('after 2 hits', await page.evaluate(() => document.getElementById('hpTxt').textContent));
  await page.screenshot({ path: 'shots/v3/hurt.png' });
  await page.keyboard.press('x'); await page.waitForTimeout(1500);
  await page.keyboard.press('2'); await page.waitForTimeout(300);
  console.log('dead msg', await page.evaluate(() => document.getElementById('msg').textContent), 'hp', await page.evaluate(() => document.getElementById('hpTxt').textContent));
  await page.screenshot({ path: 'shots/v3/dead.png' });
  await page.keyboard.press('r'); await page.waitForTimeout(400);
  console.log('revived', await page.evaluate(() => document.getElementById('hpTxt').textContent), 'dead', await page.evaluate(() => window.__knight.dead));
} finally { await browser.close(); }
console.log('page errors', errs);
