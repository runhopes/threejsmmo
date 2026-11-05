// Smoke test: load every page that uses village/*.js and report page errors / shader errors.
//   node tools/smoke.mjs [waitMs]
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const wait = +(process.argv[2] || 12000);
const pages = ['village.html', 'magefx.html', 'archer-vfx.html', 'index.html?cls=warrior&spawn=plaza', 'index.html?world=arena', 'index.html?atmo=0&cls=warrior&spawn=plaza', 'index.html?wild=0&cls=warrior&spawn=plaza', 'index.html?cls=mage&spawn=z_hills'];
const browser = await chromium.launch({ channel: 'msedge', args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--use-angle=d3d11'] });
let bad = 0;
try {
  for (const p of pages) {
    const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
    const errs = [];
    page.on('pageerror', (e) => errs.push('pageerror: ' + e.message.slice(0, 200)));
    page.on('console', (m) => { if (m.type() === 'error') errs.push('console.error: ' + m.text().slice(0, 200)); });
    const [f, q] = p.split('?');
    await page.goto(pathToFileURL(path.resolve(import.meta.dirname, '..', f)).href + (q ? '?' + q : ''), { waitUntil: 'load' });
    await page.waitForTimeout(wait);
    console.log((errs.length ? 'FAIL ' : 'ok   ') + p + (errs.length ? '\n   ' + [...new Set(errs)].slice(0, 4).join('\n   ') : ''));
    if (errs.length) bad++;
    await page.close();
  }
} finally { await browser.close(); }
console.log(bad ? bad + ' page(s) with errors' : 'all clean');
