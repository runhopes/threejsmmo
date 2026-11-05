// Real-gameplay HUD states: skill spam next to the dummy (cooldowns, mana drain, buffs, XP, level-up), the windows,
// the combat log tab, death. node tools/hudstates.mjs <outPrefix> [cls]   env: W, H
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
const out = process.argv[2] || 'shots/hud/st';
const cls = process.argv[3] || 'warrior';
const W = +process.env.W || 1920, H = +process.env.H || 1080;
fs.mkdirSync(path.dirname(out), { recursive: true });
const url = pathToFileURL(path.resolve(import.meta.dirname, '..', 'index.html')).href + '?cls=' + cls;
const browser = await chromium.launch({ channel: 'msedge', args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
let bad = false;
try {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on('pageerror', (e) => { bad = true; console.log('pageerror: ' + e.message); });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  const dummyAt = (y) => page.evaluate((y) => { const p = window.__dummy.position.clone(); p.y = y; const v = p.project(window.__camera); return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight }; }, y);
  const shot = async (tag) => { await page.screenshot({ path: `${out}_${tag}.png` }); console.log(`${out}_${tag}.png`); };
  let d = await dummyAt(0);
  await page.mouse.click(d.x - 70, d.y + 30, { button: 'right' });
  await page.waitForTimeout(1700);
  // spam: every skill, with basic attacks in between, aiming at the dummy
  for (let round = 0; round < 2; round++) {
    for (const k of ['7', '1', '3', '4', '6', '5', '2', '8']) {
      d = await dummyAt(1.3); await page.mouse.move(d.x, d.y);
      await page.keyboard.press(k); await page.waitForTimeout(650);
      await page.mouse.click(d.x, d.y, { button: 'right' }); await page.waitForTimeout(350);
    }
  }
  await shot('1_spam');
  for (let i = 0; i < 6; i++) { d = await dummyAt(1.3); await page.mouse.click(d.x, d.y, { button: 'right' }); await page.waitForTimeout(380); }
  await page.waitForTimeout(300);
  await shot('2_after');
  await page.keyboard.press('p'); await page.waitForTimeout(400); await shot('3_char');
  await page.keyboard.press('Escape'); await page.keyboard.press('m'); await page.waitForTimeout(500); await shot('4_map');
  await page.keyboard.press('Escape');
  // chat: open the input with Enter, type a line, send it (Atherion chat part; local echo only)
  await page.keyboard.press('Enter'); await page.waitForTimeout(250);
  await page.keyboard.type('selam'); await page.keyboard.press('Enter'); await page.waitForTimeout(400);
  await shot('5_log');
  await page.mouse.move(W / 2, H / 3);
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.waitForTimeout(400); await shot('6_menu');
  await page.keyboard.press('Escape');
  await page.keyboard.press('x'); await page.waitForTimeout(1500); await shot('7_dead');
  await page.keyboard.press('r'); await page.waitForTimeout(300);
} finally { await browser.close(); }
console.log(bad ? 'ERRORS' : 'ok');
