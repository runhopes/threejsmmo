// Deterministic animation analysis via preview.html's window.__analyze.
//   node tools/analyze.mjs [attack1,attack2,attack3,attack4,combo] [--target=2.7]
// Reports foot slide while planted, IK target errors, wrist-limit corrections, kinetic-chain peak order, tip speed, hits.
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const args = process.argv.slice(2);
const names = (args.find((a) => !a.startsWith('--')) || 'attack1,attack2,attack3,attack4,combo').split(',');
const tgt = args.find((a) => a.startsWith('--target='));
const url = pathToFileURL(path.resolve(import.meta.dirname, '..', 'preview.html')).href;
const browser = await chromium.launch({ channel: 'msedge', args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
let bad = false;
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
  page.on('pageerror', (e) => { bad = true; console.log('pageerror: ' + e.message); });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 15000 });
  for (const n of names) {
    const r = await page.evaluate(([n, t]) => window.__analyze(n, { target: t }), [n, tgt ? parseFloat(tgt.split('=')[1]) : 0]);
    console.log(JSON.stringify(r));
  }
} finally { await browser.close(); }
process.exit(bad ? 1 : 0);
