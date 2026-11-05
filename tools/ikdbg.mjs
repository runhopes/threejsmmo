import { chromium } from 'playwright-core';
const [name, us] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'msedge', args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
await page.goto('file:///C:/Users/BORA/Desktop/tdsmoba/preview.html', { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true);
const r = await page.evaluate(([name, us]) => {
  const K = window.__knight, d = KNIGHT_DEFS[name], I = K._ik, out = [];
  K.revive(); K.root.position.set(0, 0, 0); K.root.rotation.y = 0;
  const f = (v) => [v.x, v.y, v.z].map((x) => x.toFixed(2)).join(',');
  for (const u of us.split(',').map(Number)) {
    const p = K.evalPose(name, u * d.dur);
    K._applyPose(p); K._applyIK(p);
    const tgtB = new THREE.Vector3(p['ik.bx'], p['ik.by'], p['ik.bz']).normalize();
    out.push(`u=${u} tgtB=${f(tgtB)} f=${f(I.f)} B=${f(I.B)} pole=${f(I.pole)} h=${f(I.h)} ang=${(Math.acos(I.f.dot(I.B))*57.3).toFixed(0)} tip=${f(K.sword.localToWorld(new THREE.Vector3(0,1.17,0)))}`);
  }
  return out.join('\n');
}, [name, us]);
console.log(r);
await browser.close();
