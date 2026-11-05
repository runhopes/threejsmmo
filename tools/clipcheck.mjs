// Penetration of the blade and the shield into the torso capsule / head sphere during the run cycle (and idle).
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const url = pathToFileURL(path.resolve(import.meta.dirname, '..', 'preview.html')).href;
const browser = await chromium.launch({ channel: 'msedge', args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
page.on('pageerror', (e) => console.log('pageerror: ' + e.message));
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true);
for (const mode of ['run', 'idle']) {
  console.log(mode, JSON.stringify(await page.evaluate((mode) => {
    const K = window.__knight, J = K.J, V = THREE.Vector3, dt = 1 / 240;
    K.revive(); K.root.position.set(0, 0, 0); K.root.rotation.y = 0; K.hitTargets.length = 0;
    const shield = J.shieldPivot.children[0] && J.shieldPivot.children[0].children[0];   // no shield on the warrior
    const shPts = [[-0.3, 0.4], [0.3, 0.4], [-0.3, 0], [0.3, 0], [0, -0.52], [0, 0.1]].map((p) => new V(p[0], p[1], 0));
    const R = { bladeTorso: 0, bladeHead: 0, bladeShoulders: 0, bladeThighs: 0, shieldTorso: 0, shieldShoulders: 0, worstBladeU: -1, worstShieldU: -1 };
    const segDist = (p, a, b) => { const ab = b.clone().sub(a), t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / ab.lengthSq())); return p.distanceTo(a.clone().addScaledVector(ab, t)); };
    for (let i = 0; i < 240 * 2.2; i++) {
      if (mode === 'run') K.root.position.z += 3.6 * dt;
      K.update(dt, { move: mode === 'run' ? 1 : 0 });
      if (i < 240) continue;
      K.root.updateMatrixWorld(true);
      const a = J.hips.getWorldPosition(new V()), b = J.head.getWorldPosition(new V()), hc = b.clone().add(new V(0, 0.22, 0));
      const ph = ((K.runPhase / (2 * Math.PI)) % 1).toFixed(2);
      // shoulder bar through both pauldrons, thighs hip->knee
      const sL = J.chest.localToWorld(new V(0.36, 0.42, 0)), sR = J.chest.localToWorld(new V(-0.36, 0.42, 0));
      const tL = [J.thL.getWorldPosition(new V()), J.knL.getWorldPosition(new V())], tR = [J.thR.getWorldPosition(new V()), J.knR.getWorldPosition(new V())];
      for (let y = 0.2; y <= 1.18; y += 0.07) {
        const p = K.sword.localToWorld(new V(0, y, 0));
        const pen = 0.25 - segDist(p, a, b), penH = 0.22 - p.distanceTo(hc);
        if (pen > R.bladeTorso) { R.bladeTorso = pen; R.worstBladeU = ph; }
        R.bladeHead = Math.max(R.bladeHead, penH);
        R.bladeShoulders = Math.max(R.bladeShoulders, 0.17 - segDist(p, sL, sR));
        R.bladeThighs = Math.max(R.bladeThighs, 0.11 - segDist(p, tL[0], tL[1]), 0.11 - segDist(p, tR[0], tR[1]));
      }
      if (shield) for (const q of shPts) {
        const p = shield.localToWorld(q.clone());
        const pen = 0.25 - segDist(p, a, b);
        if (pen > R.shieldTorso) { R.shieldTorso = pen; R.worstShieldU = ph; }
        const sL2 = J.chest.localToWorld(new V(0.36, 0.42, 0)), sR2 = J.chest.localToWorld(new V(-0.36, 0.42, 0));
        R.shieldShoulders = Math.max(R.shieldShoulders, 0.17 - segDist(p, sL2, sR2));
      }
    }
    for (const k of ['bladeTorso', 'bladeHead', 'bladeShoulders', 'bladeThighs', 'shieldTorso', 'shieldShoulders']) R[k] = (R[k] * 100).toFixed(1) + 'cm';
    return R;
  }, mode)));
}
await browser.close();
