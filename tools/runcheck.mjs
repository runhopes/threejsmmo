// Run-cycle check in the real update loop: foot slide while in ground contact, flight share, pelvis bob, IK reach.
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const url = pathToFileURL(path.resolve(import.meta.dirname, '..', 'preview.html')).href;
const browser = await chromium.launch({ channel: 'msedge', args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
page.on('pageerror', (e) => console.log('pageerror: ' + e.message));
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true);
for (const SPEED of (process.argv[2] || '3.6').split(',').map(Number)) console.log('speed', SPEED, JSON.stringify(await page.evaluate((SPEED) => {
  const K = window.__knight, J = K.J, V = THREE.Vector3, dt = 1 / 240;
  K.revive(); K.root.position.set(0, 0, 0); K.root.rotation.y = 0; K.hitTargets.length = 0;
  const F = { L: { pl: false, a: new V(), max: 0 }, R: { pl: false, a: new V(), max: 0 } };
  let flight = 0, n = 0, ymin = 9, ymax = -9, err = 0;
  for (let i = 0; i < 240 * 2.5; i++) {
    K.root.position.z += SPEED * dt;
    K.update(dt, { move: 1, speed: SPEED });
    if (i < 240) continue;
    n++;
    K.root.updateMatrixWorld(true);
    let any = false;
    for (const k of ['L', 'R']) {
      const an = J['an' + k].getWorldPosition(new V()), c = K.cur['f' + k + '.c'] > 0.5;
      if (c && !F[k].pl) F[k].a.set(an.x, 0, an.z);
      if (c) F[k].max = Math.max(F[k].max, Math.hypot(an.x - F[k].a.x, an.z - F[k].a.z));
      F[k].pl = c; any = any || c;
      const tgt = J.spin.localToWorld(new V(K.cur['f' + k + '.x'], K.cur['f' + k + '.y'] + 0.095, K.cur['f' + k + '.z']));
      err = Math.max(err, tgt.distanceTo(an));
    }
    if (!any) flight++;
    const hy = J.hips.getWorldPosition(new V()).y; ymin = Math.min(ymin, hy); ymax = Math.max(ymax, hy);
  }
  return { slideL: (F.L.max * 100).toFixed(1) + 'cm', slideR: (F.R.max * 100).toFixed(1) + 'cm', flightShare: (flight / n).toFixed(2), pelvisBob: ((ymax - ymin) * 100).toFixed(1) + 'cm', ikFootErr: err.toFixed(3) };
}, SPEED)));
await browser.close();
