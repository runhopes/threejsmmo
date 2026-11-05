// End-to-end check of the ONLINE build on a phone-sized touch browser: register a throw-away account through the API, create a
// character, open the page, pick the character on the real account screens, enter the world, check that the websocket is up and
// that the hero stands on the plaza. Prints the test username (delete it on the server afterwards: names start with "e2e").
//   node tools/e2e-live.mjs <outDir> <baseUrl>      e.g. https://mmorpg.thebora.dev/
import { chromium } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';
const out = process.argv[2] || 'shots/newmap/e2e', base = process.argv[3] || 'http://localhost:3000/';
fs.mkdirSync(out, { recursive: true });
const rnd = Math.random().toString(36).slice(2, 7), user = 'e2e' + rnd, pass = 'Test-' + rnd + '-9x';
const browser = await chromium.launch({ channel: 'msedge', args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--use-angle=d3d11'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push('pageerror ' + e.message)); page.on('response', (r) => { if (r.status() >= 400) errs.push(r.status() + ' ' + r.url().slice(0, 100)); });
  const api = async (p, body, tok) => { const r = await fetch(new URL(p, base), { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: JSON.stringify(body) }); return r.json(); };
  const reg = await api('api/register', { email: user + '@example.com', username: user, password: pass });
  const tok = reg.token || (reg.session && reg.session.token); if (!tok) throw new Error('register failed: ' + JSON.stringify(reg).slice(0, 200));
  const ch = await api('api/characters', { name: 'E2E ' + rnd.slice(0, 4), cls: 'archer' }, tok);
  await page.addInitScript((t) => { try { localStorage.setItem('tdsm_token', t); } catch (_) {} }, tok);
  const t0 = Date.now();
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForSelector('.at-char', { timeout: 240000 });
  await page.screenshot({ path: path.join(out, '1-characters.png') });
  await page.click('.at-char');
  await page.waitForFunction(() => window.__knight && window.Net && window.Net.ready, null, { timeout: 240000 });
  await page.waitForTimeout(5000);
  const st = await page.evaluate(() => { const k = window.__knight.root.position; return { x: +k.x.toFixed(1), z: +k.z.toFixed(1), net: !!window.Net.ready, mobile: !!document.getElementById('m-joy'), region: window.__village && window.__village.zoneName ? window.__village.zoneName(k.x, k.z) : '' }; });
  await page.screenshot({ path: path.join(out, '2-ingame.png') });
  console.log('user', user, 'enter ms', Date.now() - t0, JSON.stringify(st), errs.length ? 'ISSUES: ' + [...new Set(errs)].slice(0, 5).join(' | ') : 'no errors');
} finally { await browser.close(); }
