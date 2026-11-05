// REFERENCE ANALYSIS ONLY: locomotion numbers from an FBX run cycle, expressed in OUR knight's units
// (feet relative to the pelvis scaled by leg length -> our leg = 1.0; hands relative to shoulders scaled by
// arm length -> our arm = 0.68). Nothing from the FBX is shipped or loaded by the game.
//   node tools/fbxrun.mjs <file.fbx> [fps=60]
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const [file, fpsArg] = process.argv.slice(2);
const fps = +fpsArg || 60;
const b64 = fs.readFileSync(file).toString('base64');
const browser = await chromium.launch({ channel: 'msedge', args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('pageerror: ' + e.message));
  await page.setContent(`<html><body>
    <script src="https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/libs/fflate.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/curves/NURBSUtils.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/curves/NURBSCurve.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/FBXLoader.js"></script>
  </body></html>`, { waitUntil: 'load' });
  const out = await page.evaluate(([b64, fps]) => {
    const bin = atob(b64), buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    const obj = new THREE.FBXLoader().parse(buf.buffer, '');
    const clip = obj.animations[0];
    const B = {};
    obj.traverse((o) => { if (/mixamorig/i.test(o.name) || o.isBone) B[o.name.replace(/^mixamorig:?/i, '')] = o; });
    const mixer = new THREE.AnimationMixer(obj); mixer.clipAction(clip).play();
    const V = THREE.Vector3, wp = (n) => B[n].getWorldPosition(new V());
    mixer.setTime(0); obj.updateMatrixWorld(true);
    const legLen = wp('LeftUpLeg').distanceTo(wp('LeftLeg')) + wp('LeftLeg').distanceTo(wp('LeftFoot'));
    const armLen = wp('RightArm').distanceTo(wp('RightForeArm')) + wp('RightForeArm').distanceTo(wp('RightHand'));
    const n = Math.round(clip.duration * fps), rows = [];
    let minFoot = 1e9;
    for (let i = 0; i <= n; i++) { mixer.setTime(i / fps); obj.updateMatrixWorld(true); minFoot = Math.min(minFoot, wp('LeftFoot').y, wp('RightFoot').y, wp('LeftToeBase').y, wp('RightToeBase').y); }
    const h0 = (() => { mixer.setTime(0); obj.updateMatrixWorld(true); return wp('Hips'); })();
    for (let i = 0; i <= n; i++) {
      const t = i / fps; mixer.setTime(t); obj.updateMatrixWorld(true);
      const hips = wp('Hips'), S = 1 / legLen, A = 0.68 / armLen;
      const f = (k) => { const p = wp(k + 'Foot'); return [(p.x - hips.x) * S, (p.y - minFoot) * S, (p.z - hips.z) * S]; };
      const toeY = (k) => (wp(k + 'ToeBase').y - minFoot) * S;
      const hand = (side) => { const s = wp(side + 'Arm'), h = wp(side + 'Hand'); return [(h.x - s.x) * A, (h.y - s.y) * A, (h.z - s.z) * A]; };
      const knee = (k) => new V().subVectors(wp(k + 'UpLeg'), wp(k + 'Leg')).angleTo(new V().subVectors(wp(k + 'Foot'), wp(k + 'Leg'))) * 57.3;
      const elbow = (k) => new V().subVectors(wp(k + 'Arm'), wp(k + 'ForeArm')).angleTo(new V().subVectors(wp(k + 'Hand'), wp(k + 'ForeArm'))) * 57.3;
      const spine = wp('Spine2'), lean = Math.atan2(spine.z - hips.z, spine.y - hips.y) * 57.3;
      // blade direction from the grip: a sword runs through the fist along the knuckle line (pinky -> index side)
      const grip = (side) => { const a = B[side + 'HandPinky1'], b = B[side + 'HandIndex1']; if (!a || !b) return [0, 0, 0]; const d = wp(side + 'HandIndex1').sub(wp(side + 'HandPinky1')).normalize(); return [d.x, d.y, d.z]; };
      // shield: forearm direction (elbow -> wrist) and the back-of-hand normal approximates the shield face
      const fore = (side) => { const d = wp(side + 'Hand').sub(wp(side + 'ForeArm')).normalize(); return [d.x, d.y, d.z]; };
      rows.push({ blade: grip('Right'), foreL: fore('Left'), lHand: (() => { const s0 = wp('LeftArm'), h = wp('LeftHand'); return [(h.x - s0.x) / armLen * 0.68, (h.y - s0.y) / armLen * 0.68, (h.z - s0.z) / armLen * 0.68]; })(), t, L: f('Left'), R: f('Right'), Lt: toeY('Left'), Rt: toeY('Right'), hipY: (hips.y - minFoot) * S, rootZ: (hips.z - h0.z) * S, kL: knee('Left'), kR: knee('Right'), hR: hand('Right'), hL: hand('Left'), eR: elbow('Right'), eL: elbow('Left'), lean });
    }
    return { dur: clip.duration, legLen, armLen, rows };
  }, [b64, fps]);
  const r2 = (v) => (Array.isArray(v) ? v.map((x) => x.toFixed(2)).join(',') : v.toFixed(2));
  console.log(`duration ${out.dur.toFixed(3)}s  legLen ${out.legLen.toFixed(1)}  armLen ${out.armLen.toFixed(1)}  (feet in our leg units; hands in our arm units from the shoulder)`);
  if (process.argv.includes('--grip')) {
    console.log('t | handR (from shoulder) | blade dir (grip) | handL (from shoulder) | left forearm dir');
    for (const r of out.rows) console.log([r.t.toFixed(3), r2(r.hR), r2(r.blade), r2(r.lHand), r2(r.foreL)].join(' | '));
  } else {
  console.log('t | footL x,y,z | footR x,y,z | toeY L,R | hipY | rootZ | knee L,R | handR | handL | elbow R,L | lean');
  for (const r of out.rows) console.log([r.t.toFixed(3), r2(r.L), r2(r.R), r2([r.Lt, r.Rt]), r2(r.hipY), r2(r.rootZ), r.kL.toFixed(0) + ',' + r.kR.toFixed(0), r2(r.hR), r2(r.hL), r.eR.toFixed(0) + ',' + r.eL.toFixed(0), r.lean.toFixed(0)].join(' | '));
  }
} finally { await browser.close(); }
