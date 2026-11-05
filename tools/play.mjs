// Drive the real game page with the keyboard and grab screenshots. Prints any page errors.
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
const out = process.argv[2] || 'shots/play';
fs.mkdirSync(out, { recursive: true });
const url = pathToFileURL(path.resolve(import.meta.dirname, '..', 'index.html')).href + '?cls=' + (process.env.CLS || 'warrior');
const browser = await chromium.launch({ channel: 'msedge', args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
let bad = false;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => { bad = true; console.log('pageerror: ' + e.message); });
  page.on('console', (m) => { if (m.type() === 'error') { bad = true; console.log('console error: ' + m.text()); } });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: out + '/1_idle.png' });
  for (let i = 0; i < 3; i++) {            // 3-hit combo (presses are buffered), grab frames during swings 2-3
    await page.mouse.click(640, 300);
    await page.waitForTimeout(i >= 2 ? 420 : 260);
    if (i > 0) await page.screenshot({ path: out + `/2_swing${i + 1}.png` });
    await page.waitForTimeout(i >= 2 ? 420 : 260);
  }
  await page.waitForTimeout(800);
  await page.keyboard.down('d'); await page.waitForTimeout(900);
  await page.screenshot({ path: out + '/3_run.png' });
  await page.keyboard.up('d');
  await page.keyboard.down('Shift'); await page.waitForTimeout(500);
  await page.screenshot({ path: out + '/4_block.png' });
  await page.keyboard.up('Shift');
  await page.keyboard.press('q'); await page.waitForTimeout(450);
  await page.screenshot({ path: out + '/5_special.png' });
  await page.waitForTimeout(900);
  await page.keyboard.press('x'); await page.waitForTimeout(1900);
  await page.screenshot({ path: out + '/6_dead.png' });
  await page.keyboard.press('r'); await page.waitForTimeout(600);
  await page.screenshot({ path: out + '/7_revived.png' });
  console.log(bad ? 'FINISHED WITH ERRORS' : 'no page errors');
} finally { await browser.close(); }
process.exit(bad ? 1 : 0);
