// REFERENCE ANALYSIS ONLY: parse an FBX animation in a headless browser and print bone motion as numbers
// (hand path relative to the shoulder, arm extension, pelvis/chest yaw, root motion, feet) so procedural
// attacks can be shaped/timed against it. Nothing from the FBX is shipped or loaded by the game.
//   node tools/fbxref.mjs <file.fbx> [fps=30]
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const [file, fpsArg] = process.argv.slice(2);
const fps = +fpsArg || 30;
const b64 = fs.readFileSync(file).toString('base64');
const browser = await chromium.launch({ channel: 'msedge', args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('console: ' + m.text().slice(0, 200)); });
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
    const bones = {};
    obj.traverse((o) => { if (o.isBone || o.type === 'Bone' || /mixamorig/i.test(o.name)) bones[o.name.replace(/^mixamorig:?/i, '')] = o; });
    const names = Object.keys(bones);
    const B = (n) => bones[n];
    const mixer = new THREE.AnimationMixer(obj);
    mixer.clipAction(clip).play();
    const V = THREE.Vector3, Q = THREE.Quaternion;
    const wp = (n) => B(n).getWorldPosition(new V());
    const yawOf = (n) => { const q = B(n).getWorldQuaternion(new Q()); const f = new V(0, 0, 1).applyQuaternion(q); return Math.atan2(f.x, f.z); };
    const rows = [];
    // scale: arm length (shoulder->elbow->hand) from the rest frame
    mixer.setTime(0); obj.updateMatrixWorld(true);
    const armLen = wp('RightArm').distanceTo(wp('RightForeArm')) + wp('RightForeArm').distanceTo(wp('RightHand'));
    const height = wp('Head').y - Math.min(wp('LeftFoot').y, wp('RightFoot').y);
    const hips0 = wp('Hips');
    const n = Math.round(clip.duration * fps);
    for (let i = 0; i <= n; i++) {
      const t = i / fps;
      mixer.setTime(t); obj.updateMatrixWorld(true);
      const sh = wp('RightArm'), hand = wp('RightHand'), el = wp('RightForeArm'), hips = wp('Hips');
      const hipYaw = yawOf('Hips'), chestYaw = yawOf('Spine2');
      // hand offset from shoulder in the PELVIS-INDEPENDENT character frame (world, X=char left?), normalized by arm length
      const off = hand.clone().sub(sh).multiplyScalar(1 / armLen);
      const ext = hand.distanceTo(sh) / armLen;                 // 1 = fully straight arm
      const elbowAng = new V().subVectors(sh, el).angleTo(new V().subVectors(hand, el)) * 180 / Math.PI;
      const lf = wp('LeftFoot'), rf = wp('RightFoot');
      rows.push({ t: +t.toFixed(3), hx: +off.x.toFixed(2), hy: +off.y.toFixed(2), hz: +off.z.toFixed(2), ext: +ext.toFixed(2), elbow: +elbowAng.toFixed(0),
        hipYaw: +(hipYaw * 57.3).toFixed(0), chestYaw: +(chestYaw * 57.3).toFixed(0), twist: +(((chestYaw - hipYaw + 3 * Math.PI) % (2 * Math.PI) - Math.PI) * 57.3).toFixed(0),
        rootZ: +((hips.z - hips0.z) / height).toFixed(2), rootX: +((hips.x - hips0.x) / height).toFixed(2), rootY: +((hips.y - hips0.y) / height).toFixed(3),
        lfy: +(lf.y / height).toFixed(3), rfy: +(rf.y / height).toFixed(3), lfz: +(lf.z / height).toFixed(2), rfz: +(rf.z / height).toFixed(2),
        handSpd: 0 });
    }
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1], b = rows[i];
      b.handSpd = +(Math.hypot(b.hx - a.hx, b.hy - a.hy, b.hz - a.hz) * fps).toFixed(1);   // arm-lengths / s
    }
    return { clip: clip.name, duration: clip.duration, tracks: clip.tracks.length, bones: names.length, armLen, height, boneNames: names.slice(0, 70), rows };
  }, [b64, fps]);
  console.log(`clip "${out.clip}" ${out.duration.toFixed(2)}s, ${out.tracks} tracks, ${out.bones} bones, armLen ${out.armLen.toFixed(1)}, height ${out.height.toFixed(1)}`);
  console.log('cols: t | hand-from-shoulder (x,y,z)/armLen | ext | elbow deg | hipYaw chestYaw twist | root z,x,y (/height) | foot y L,R | foot z L,R | hand speed (armLen/s)');
  for (const r of out.rows) console.log([r.t, r.hx, r.hy, r.hz, r.ext, r.elbow, r.hipYaw, r.chestYaw, r.twist, r.rootZ, r.rootX, r.rootY, r.lfy, r.rfy, r.lfz, r.rfz, r.handSpd].join('\t'));
} finally { await browser.close(); }
