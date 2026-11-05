// per-sample tip / hand speed along an attack (deterministic), prints the top spikes with context
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const names = (process.argv[2] || 'attack1').split(',');
const url = pathToFileURL(path.resolve(import.meta.dirname, '..', 'preview.html')).href;
const browser = await chromium.launch({ channel: 'msedge', args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
page.on('pageerror', (e) => console.log('pageerror: ' + e.message));
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true);
for (const n of names) {
  const r = await page.evaluate((n) => {
    const K = window.__knight, d = KNIGHT_DEFS[n], N = 600;
    K.revive(); K.root.position.set(0, 0, 0); K.root.rotation.y = 0;
    const s = K.sampleTrajectory(n, N), dt = d.dur / N, out = [];
    for (let i = 1; i <= N; i++) out.push({ u: +s[i].u.toFixed(3), tip: +(s[i].tip.distanceTo(s[i - 1].tip) / dt).toFixed(1), hand: +(s[i].hand.distanceTo(s[i - 1].hand) / dt).toFixed(1), tipY: +s[i].tip.y.toFixed(2) });
    const top = out.slice().sort((a, b) => b.tip - a.tip).slice(0, 6);
    // coarse profile every 0.025u
    const prof = out.filter((o, i) => i % 15 === 0).map((o) => o.u.toFixed(2) + ':' + o.tip + '/' + o.hand).join(' ');
    return { top, prof };
  }, n);
  console.log(n, JSON.stringify(r.top));
  console.log('  u:tip/hand m/s  ' + r.prof);
}
await browser.close();
