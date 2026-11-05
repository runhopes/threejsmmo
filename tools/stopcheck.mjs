// Run -> stop -> idle in the real update loop (same speed ramp as the game). While a foot is ON THE GROUND it must not
// slide or twist: reports max ground slide (cm) and max in-place yaw change (deg) per foot, plus steps taken.
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const url = pathToFileURL(path.resolve(import.meta.dirname, '..', 'preview.html')).href;
const browser = await chromium.launch({ channel: 'msedge', args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
page.on('pageerror', (e) => console.log('pageerror: ' + e.message));
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true);
for (const runFor of [1.0, 1.13, 1.27, 1.4]) {          // stop at different phases of the gait
  console.log('stop after', runFor, 's', JSON.stringify(await page.evaluate((runFor) => {
    const K = window.__knight, J = K.J, V = THREE.Vector3, dt = 1 / 240;
    K.revive(); K.root.position.set(0, 0, 0); K.root.rotation.y = 0; K.hitTargets.length = 0;
    for (let i = 0; i < 120; i++) K.update(dt, {});
    let speed = 0;
    const R = { L: { slide: 0, twist: 0, steps: 0, yawRate: 0, yawVsBody: 0 }, R: { slide: 0, twist: 0, steps: 0, yawRate: 0, yawVsBody: 0 } }, prev = {}, lastYaw = {};
    const N = Math.round((runFor + 1.6) / dt);
    for (let i = 0; i < N; i++) {
      const want = i * dt < runFor ? 3.6 : 0;
      speed += Math.max(-14 * dt, Math.min(9 * dt, want - speed));
      K.root.position.z += speed * dt;
      K.update(dt, { move: speed > 0.05 ? 1 : 0, speed });
      if (i * dt < runFor - 0.05) continue;                 // measure the stop + idle part
      K.root.updateMatrixWorld(true);
      for (const k of ['L', 'R']) {
        const an = J['an' + k].getWorldPosition(new V()), q = J['an' + k].getWorldQuaternion(new THREE.Quaternion());
        const fwd = new V(0, 0, 1).applyQuaternion(q), yaw = Math.atan2(fwd.x, fwd.z);
        const grounded = an.y < 0.095 + 0.012;
        // any state (air or ground): how fast the foot heading turns, and how far it points away from the body heading
        if (lastYaw[k] !== undefined) R[k].yawRate = Math.max(R[k].yawRate, Math.abs(Math.atan2(Math.sin(yaw - lastYaw[k]), Math.cos(yaw - lastYaw[k]))) * 57.3);
        lastYaw[k] = yaw;
        R[k].yawVsBody = Math.max(R[k].yawVsBody, Math.abs(Math.atan2(Math.sin(yaw), Math.cos(yaw))) * 57.3);
        if (!grounded) { prev[k] = null; continue; }
        if (!prev[k]) { prev[k] = { x: an.x, z: an.z, yaw }; R[k].steps++; continue; }   // touchdown: new anchor
        R[k].slide = Math.max(R[k].slide, Math.hypot(an.x - prev[k].x, an.z - prev[k].z));
        R[k].twist = Math.max(R[k].twist, Math.abs(Math.atan2(Math.sin(yaw - prev[k].yaw), Math.cos(yaw - prev[k].yaw))) * 57.3);
      }
    }
    for (const k of ['L', 'R']) { R[k].slide = (R[k].slide * 100).toFixed(1) + 'cm'; R[k].twist = R[k].twist.toFixed(0) + 'deg'; R[k].yawRate = R[k].yawRate.toFixed(1) + 'deg/frame'; R[k].yawVsBody = R[k].yawVsBody.toFixed(0) + 'deg'; }
    return R;
  }, runFor)));
}
await browser.close();
