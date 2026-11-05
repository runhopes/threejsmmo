// Screenshots of compare.html (legacy vs HeroModel v2) with the installed Edge.
// Usage: node tools/cmpshot.mjs "cls=warrior&anim=idle&t=0.5" shots/refactor/x.png [more "query" "out.png" pairs...]
// Env: W=1800 H=900 TIMEOUT=30000. Prints page errors and the console log (build timings etc.).
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const args = process.argv.slice(2);
if (args.length < 2 || args.length % 2) { console.error('usage: node tools/cmpshot.mjs "<query>" <out.png> [...]'); process.exit(2); }
const W = +process.env.W || 1800, H = +process.env.H || 900, TIMEOUT = +process.env.TIMEOUT || 30000;
const url = pathToFileURL(path.resolve(import.meta.dirname, '..', 'compare.html')).href;
const killer = setTimeout(() => { console.error('HARD TIMEOUT'); process.exit(3); }, TIMEOUT * (args.length / 2) + 15000);
const browser = await chromium.launch({ channel: 'msedge', args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
let failed = false;
try {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); else if (process.env.LOG) console.log('  log: ' + m.text()); });
  for (let i = 0; i < args.length; i += 2) {
    errors.length = 0;
    const t0 = Date.now();
    await page.goto(url + '?' + args[i].replace(/^\?/, ''), { waitUntil: 'load', timeout: TIMEOUT });
    await page.waitForFunction(() => document.title === 'ready' || document.title === 'ERR', null, { timeout: TIMEOUT });
    fs.mkdirSync(path.dirname(path.resolve(args[i + 1])), { recursive: true });
    await page.screenshot({ path: args[i + 1] });
    const title = await page.title();
    if (title === 'ERR' || errors.length) failed = true;
    console.log(`${args[i + 1]}  ${Date.now() - t0}ms${title === 'ERR' ? '  [ERR]' : ''}`);
    errors.forEach((e) => console.log('  ' + e));
  }
} catch (e) { console.error(e.message); failed = true; }
finally { await browser.close(); clearTimeout(killer); }
process.exit(failed ? 1 : 0);
