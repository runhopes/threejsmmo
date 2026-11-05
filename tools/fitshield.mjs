// Solve the shield arm's FK angles (shL.rx/ry/rz, elL.rx, shieldPivot.ry) for a wanted shield placement:
// shield centre position + face normal (character frame) + minimum clearance from torso/head/thighs.
// Coordinate descent on the real rig inside preview.html.
//   node tools/fitshield.mjs '<json: [{name, base:"idle"|"run", t, center:[x,y,z], normal:[x,y,z], clear}]>'
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const jobs = JSON.parse(process.argv[2]);
const url = pathToFileURL(path.resolve(import.meta.dirname, '..', 'preview.html')).href;
const browser = await chromium.launch({ channel: 'msedge', args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
page.on('pageerror', (e) => console.log('pageerror: ' + e.message));
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true);
for (const job of jobs) {
  const r = await page.evaluate((job) => {
    const K = window.__knight, J = K.J, V = THREE.Vector3;
    K.revive(); K.root.position.set(0, 0, 0); K.root.rotation.y = 0;
    const shield = J.shieldPivot.children[0].children[0];
    const base = K.evalPose(job.base, job.t || 0);
    const keys = ['shL.rx', 'shL.ry', 'shL.rz', 'elL.rx', 'shieldPivot.ry'];
    const lo = [-3.0, -2.2, -0.4, -2.4, -3.1], hi = [1.8, 1.8, 1.8, 0, 3.1];
    const C = new V(...job.center), N = new V(...job.normal).normalize(), U = new V(...(job.up || [0, 1, 0])).normalize();
    const invSpin = () => new THREE.Matrix4().copy(J.spin.matrixWorld).invert();
    const pts = [[-0.3, 0.4], [0.3, 0.4], [-0.3, 0], [0.3, 0], [0, -0.52], [0, 0.1], [-0.2, -0.3], [0.2, -0.3]].map((p) => new V(p[0], p[1], 0));
    const segDist = (p, a, b) => { const ab = b.clone().sub(a), t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / ab.lengthSq())); return p.distanceTo(a.clone().addScaledVector(ab, t)); };
    const evalP = (x) => {
      const p = Object.assign({}, base);
      keys.forEach((k, i) => (p[k] = x[i]));
      K._applyPose(p); K._applyIK(p); K.root.updateMatrixWorld(true);
      const toChar = (w) => J.spin.worldToLocal(w);
      const c = toChar(shield.localToWorld(new V(0, 0, 0)));
      const n = shield.localToWorld(new V(0, 0, 1)).sub(shield.localToWorld(new V(0, 0, 0))).normalize().transformDirection(new THREE.Matrix4().copy(J.spin.matrixWorld).invert());
      const a = J.hips.getWorldPosition(new V()), b = J.head.getWorldPosition(new V()), hc = b.clone().add(new V(0, 0.22, 0));
      const tL = [J.thL.getWorldPosition(new V()), J.knL.getWorldPosition(new V())];
      let pen = 0, minClear = 9;
      for (const q of pts) {
        const w = shield.localToWorld(q.clone());
        const sL = J.chest.localToWorld(new V(0.36, 0.42, 0)), sR = J.chest.localToWorld(new V(-0.36, 0.42, 0));
        const d = Math.min(segDist(w, a, b) - 0.25, w.distanceTo(hc) - 0.22, segDist(w, tL[0], tL[1]) - 0.11, segDist(w, sL, sR) - 0.17);
        minClear = Math.min(minClear, d);
        pen += Math.max(0, (job.clear || 0.08) - d) ** 2;
      }
      const up = shield.localToWorld(new V(0, 1, 0)).sub(shield.localToWorld(new V(0, 0, 0))).normalize().transformDirection(invSpin());
      const loss = c.distanceToSquared(C) * 20 + (1 - n.dot(N)) * 3 + (1 - up.dot(U)) * (job.upW || 1.5) + pen * 200 + (x[3] + (job.elbow || 1.2)) ** 2 * 0.15;
      return { loss, c, n, up, minClear };
    };
    // start from the current pose values, coordinate descent with shrinking steps
    // deterministic pseudo-random restarts (the landscape has several local minima)
    let seed = 12345; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const descend = (x0) => {
      let x = x0, best = evalP(x), step = 0.4;
      for (let it = 0; it < 600 && step > 0.003; it++) {
        let improved = false;
        for (let i = 0; i < x.length; i++) for (const s of [step, -step]) {
          const y = x.slice(); y[i] = Math.min(hi[i], Math.max(lo[i], y[i] + s));
          const e = evalP(y);
          if (e.loss < best.loss) { x = y; best = e; improved = true; }
        }
        if (!improved) step *= 0.6;
      }
      return { x, best };
    };
    let win = descend(keys.map((k) => base[k] || 0));
    for (let r = 0; r < 24; r++) {
      const res = descend(lo.map((l, i) => l + (hi[i] - l) * rnd()));
      if (res.best.loss < win.best.loss) win = res;
    }
    const x = win.x, best = win.best;
    const f = (v) => [v.x, v.y, v.z].map((q) => q.toFixed(2)).join(',');
    return { name: job.name, params: Object.fromEntries(keys.map((k, i) => [k, +x[i].toFixed(3)])), center: f(best.c), normal: f(best.n), up: f(best.up), minClear: +best.minClear.toFixed(3), loss: +best.loss.toFixed(4) };
  }, job);
  console.log(JSON.stringify(r));
}
await browser.close();
