// Fast, hang-free screenshots of index.html using the installed Edge (no browser download).
// Usage:
//   node tools/shot.mjs "anim=attack1&t=0.3&cam=q34" shots/attack.png [more "query" "out.png" pairs...]
//   node tools/shot.mjs "" shots/idle.png            (normal mode, no debug pose)
// Options (env): W=1280 H=720 TIMEOUT=15000
// One browser launch handles every pair. Exits non-zero on page errors or timeout.
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const args = process.argv.slice(2);
if (args.length < 2 || args.length % 2) {
  console.error('usage: node tools/shot.mjs "<query>" <out.png> ["<query>" <out.png> ...]');
  process.exit(2);
}
const W = +process.env.W || 1280, H = +process.env.H || 720, TIMEOUT = +process.env.TIMEOUT || 15000;
const page_url = pathToFileURL(path.resolve(import.meta.dirname, '..', 'index.html')).href;

// hard kill switch: never hang longer than this, whatever happens
const killer = setTimeout(() => { console.error('HARD TIMEOUT'); process.exit(3); }, TIMEOUT * (args.length / 2) + 10000);

const browser = await chromium.launch({
  channel: 'msedge',
  args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
});
let failed = false;
try {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  for (let i = 0; i < args.length; i += 2) {
    const query = args[i].replace(/^\?/, ''), out = args[i + 1];
    errors.length = 0;
    const t0 = Date.now();
    await page.goto(page_url + (query ? '?' + query : ''), { waitUntil: 'load', timeout: TIMEOUT });
    if (query.includes('anim=')) {
      // debug mode sets document.title to 'ready' after 5 frames, or 'ERR' on error
      await page.waitForFunction(() => document.title === 'ready' || document.title === 'ERR', null, { timeout: TIMEOUT });
    } else {
      await page.waitForTimeout(800); // normal mode has no ready signal; let a few frames render
    }
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    await page.screenshot({ path: out });
    const title = await page.title();
    if (title === 'ERR' || errors.length) failed = true;
    console.log(`${out}  ${Date.now() - t0}ms${title === 'ERR' ? '  [ERR]' : ''}`);
    errors.forEach((e) => console.log('  ' + e));
  }
} catch (e) {
  console.error(e.message);
  failed = true;
} finally {
  await browser.close();
  clearTimeout(killer);
}
process.exit(failed ? 1 : 0);
