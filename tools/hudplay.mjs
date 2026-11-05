// Drive index.html like a player and capture the HUD in real gameplay.
//   node tools/hudplay.mjs <outPrefix> [cls]        env: W=1920 H=1080
// Steps: walk to the training dummy (right click), select + attack it (left click), cast skills 1-4, take a dev hit (E),
// hover a skill for its tooltip, open the skills (K) and menu (Esc) panels. Saves <outPrefix>_<step>.png.
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
const out = process.argv[2] || 'shots/hud/play';
const cls = process.argv[3] || 'warrior';
const W = +process.env.W || 1920, H = +process.env.H || 1080;
fs.mkdirSync(path.dirname(out), { recursive: true });
const url = pathToFileURL(path.resolve(import.meta.dirname, '..', 'index.html')).href + '?cls=' + cls;
const browser = await chromium.launch({ channel: 'msedge', args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
let bad = false;
try {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on('pageerror', (e) => { bad = true; console.log('pageerror: ' + e.message); });
  page.on('console', (m) => { if (m.type() === 'error') { bad = true; console.log('console: ' + m.text()); } });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  const dummyScreen = (y) => page.evaluate((y) => {
    const p = window.__dummy.position.clone(); p.y = y; const v = p.project(window.__camera);
    return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight };
  }, y);
  const shot = async (tag) => { await page.screenshot({ path: `${out}_${tag}.png` }); console.log(`${out}_${tag}.png`); };
  // walk next to the dummy
  let d = await dummyScreen(0);
  await page.mouse.click(d.x - 60, d.y + 40, { button: 'right' });
  await page.waitForTimeout(1800);
  await shot('0_explore');
  // attack it (left click on its body) a few times
  for (let i = 0; i < 5; i++) { d = await dummyScreen(1.3); await page.mouse.click(d.x, d.y, { button: 'right' }); await page.waitForTimeout(420); }
  for (const k of ['1', '2', '3']) { await page.keyboard.press(k); await page.waitForTimeout(900); }
  await page.keyboard.press('e'); await page.waitForTimeout(160);
  await shot('1_combat');
  await page.waitForTimeout(700);
  // tooltip on the 4th skill slot (if the HUD exposes slots)
  const slot = await page.evaluate(() => { const el = document.querySelector('[data-slot="3"], #slots .slot:nth-child(4)'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  if (slot) { await page.mouse.move(slot.x, slot.y); await page.waitForTimeout(450); await shot('2_tooltip'); await page.mouse.move(W / 2, H / 3); }
  await page.keyboard.press('k'); await page.waitForTimeout(350); await shot('3_skills');
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  await page.keyboard.press('Escape'); await page.waitForTimeout(350); await shot('4_menu');
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
} finally { await browser.close(); }
console.log(bad ? 'ERRORS' : 'ok');
