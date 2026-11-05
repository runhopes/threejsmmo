// angle between forearm (elbow->hand) and blade for a set of times of an action. node tools/angle.mjs attack1 0.2,0.3
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const [anim, list] = process.argv.slice(2);
const url = pathToFileURL(path.resolve(import.meta.dirname, '..', 'index.html')).href;
const browser = await chromium.launch({ channel: 'msedge', args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
for (const t of list.split(',')) {
  await page.goto(url + `?anim=${anim}&sim=1&t0=${t}&t1=${t}`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.title === 'ready');
  const r = await page.evaluate(() => {
    const k = window.__knight, J = k.J, V = THREE.Vector3;
    const e = J.elR.getWorldPosition(new V()), h = J.wristR.getWorldPosition(new V());
    const fore = h.clone().sub(e).normalize();
    const b0 = k.sword.localToWorld(new V(0, 0.3, 0)), b1 = k.sword.localToWorld(new V(0, 1.15, 0));
    const blade = b1.sub(b0).normalize();
    return { angle: +(Math.acos(Math.max(-1, Math.min(1, fore.dot(blade)))) * 180 / Math.PI).toFixed(0), reach: +h.clone().sub(J.shR.getWorldPosition(new V())).length().toFixed(2) };
  });
  console.log(`t=${t}  forearm-blade angle ${r.angle}deg  shoulder-hand ${r.reach}`);
}
await browser.close();
