// Runs inside tools/glbclips.mjs. Retargets a Mixamo-rig clip into the knight's own pose channels (character frame:
// X = left, Y up, Z forward). Output is DATA for our procedural rig - no mesh, no bones, no GLB at runtime.
const CLIP = 'walk', FPS = 60;
const V = THREE.Vector3, Q = THREE.Quaternion, B = {};
gltf.scene.traverse((o) => { if (o.isBone) B[o.name.replace('mixamorig', '')] = o; });
const wp = (n) => B[n].getWorldPosition(new V()), wq = (n) => B[n].getWorldQuaternion(new Q());
gltf.scene.updateMatrixWorld(true);
// rest (bind) pose
const REST = {}; for (const n of ['Hips', 'Spine1', 'Spine2', 'Head', 'LeftFoot', 'RightFoot']) REST[n] = wq(n).invert();
const rf = { L: wp('LeftFoot'), R: wp('RightFoot') }, ru = { L: wp('LeftUpLeg'), R: wp('RightUpLeg') };
const legLen = wp('LeftUpLeg').distanceTo(wp('LeftLeg')) + wp('LeftLeg').distanceTo(wp('LeftFoot'));
const armLen = wp('RightArm').distanceTo(wp('RightForeArm')) + wp('RightForeArm').distanceTo(wp('RightHand'));
const s = 1.0 / legLen, a = 0.68 / armLen;                       // our leg = 1.0, our (authoring) arm = 0.68
const toeRest = { L: wp('LeftToeBase').sub(rf.L), R: wp('RightToeBase').sub(rf.R) };
const pitchOf = (v) => Math.atan2(-v.y, Math.hypot(v.x, v.z));    // toes down = positive
const mixer = new THREE.AnimationMixer(gltf.scene);
const clip = gltf.animations.find((c) => c.name === CLIP);
mixer.clipAction(clip).play();
const n = Math.round(clip.duration * FPS), frames = [];
const A = (name) => wq(name).multiply(REST[name]);                // rest -> current, in world (= character) axes
const eul = (q) => { const e = new THREE.Euler().setFromQuaternion(q, 'YXZ'); return [e.x, e.y, e.z]; };
for (let i = 0; i < n; i++) {
  mixer.setTime((i / n) * clip.duration); gltf.scene.updateMatrixWorld(true);
  const f = {};
  const hip = wp('Hips'), upY = (wp('LeftUpLeg').y + wp('RightUpLeg').y) / 2;
  f.hipX = hip.x; f.hipZ = hip.z;
  f['body.py'] = (upY - rf.L.y) * s + 0.095 - 1.09;
  const aH = A('Hips'), aS = A('Spine1'), aC = A('Spine2'), aHd = A('Head');
  [f['hips.rx'], f['hips.ry'], f['hips.rz']] = eul(aH);
  [f['spine.rx'], f['spine.ry'], f['spine.rz']] = eul(aH.clone().invert().multiply(aS));
  [f['chest.rx'], f['chest.ry'], f['chest.rz']] = eul(aS.clone().invert().multiply(aC));
  [f['head.rx'], f['head.ry'], f['head.rz']] = eul(aC.clone().invert().multiply(aHd));
  for (const [k, side, nm] of [['L', 1, 'Left'], ['R', -1, 'Right']]) {
    const ft = wp(nm + 'Foot'), toe = wp(nm + 'ToeBase').sub(ft);
    f['f' + k + '.x'] = (ft.x - ru[k].x) * s + side * 0.14;        // relative to its own hip joint, on our wider pelvis
    f['f' + k + '.zw'] = ft.z * s;                                  // re-centred below
    f['f' + k + '.y'] = Math.max(0, (ft.y - rf[k].y) * s);
    // foot orientation from the foot bone's full rotation (rest -> now) decomposed like our foot IK: yaw about Y, then
    // pitch about the foot's own X. (The toe vector's heading flips by 180 deg when the foot points down at toe-off.)
    const ef = eul(A(nm + 'Foot'));
    f['f' + k + '.r'] = ef[1];
    f['f' + k + '.p'] = ef[0];
    const toeY = wp(nm + 'ToeBase').y - wp('LeftToeBase').y * 0 - (rf[k].y + toeRest[k].y);
    f['f' + k + '.c'] = ((ft.y - rf[k].y) * s < 0.03 || toeY * s < 0.01) ? 1 : 0;
  }
  // free (left) arm as FK on our shoulder/elbow: upper-arm / forearm directions in the CHEST frame
  const inv = aC.clone().invert();
  const du = wp('LeftForeArm').sub(wp('LeftArm')).normalize().applyQuaternion(inv);
  const df = wp('LeftHand').sub(wp('LeftForeArm')).normalize().applyQuaternion(inv);
  const Y = du.clone().negate(), Z = df.clone().addScaledVector(du, -df.dot(du));
  if (Z.lengthSq() < 1e-6) Z.set(0, 0, 1);
  Z.normalize(); const X = new V().crossVectors(Y, Z);
  const qs = new Q().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
  [f['shL.rx'], f['shL.ry'], f['shL.rz']] = eul(qs);
  f['elL.rx'] = -Math.acos(Math.max(-1, Math.min(1, du.dot(df))));
  // sword hand: offset from the right shoulder (character frame), in 0.68-arm units
  const hv = wp('RightHand').sub(wp('RightArm')).multiplyScalar(a);
  f['ik.hx'] = hv.x; f['ik.hy'] = hv.y; f['ik.hz'] = hv.z;
  frames.push(f);
}
// centre horizontally on the cycle mean, foot z relative to the hips' mean
const mx = frames.reduce((t, f) => t + f.hipX, 0) / n, mz = frames.reduce((t, f) => t + f.hipZ, 0) / n;
for (const f of frames) {
  f['body.px'] = (f.hipX - mx) * s; f['body.pz'] = (f.hipZ - mz) * s;
  f['fL.z'] = f['fL.zw'] - mz * s; f['fR.z'] = f['fR.zw'] - mz * s;
}
// ground speed from the stance foot (in-place clip: the planted foot slides back at the walking speed)
let sp = 0, cnt = 0;
for (let i = 0; i < n; i++) for (const k of ['L', 'R']) {
  const f0 = frames[i], f1 = frames[(i + 1) % n];
  if (f0['f' + k + '.c'] && f1['f' + k + '.c']) { const v = (f0['f' + k + '.z'] - f1['f' + k + '.z']) * FPS; if (v > 0 && v < 6) { sp += v; cnt++; } }
}
// phase 0 = left foot touchdown
let i0 = 0; for (let i = 0; i < n; i++) if (frames[i]['fL.c'] && !frames[(i - 1 + n) % n]['fL.c']) { i0 = i; break; }
const ordered = frames.slice(i0).concat(frames.slice(0, i0));
const keys = ['body.px', 'body.py', 'body.pz', 'hips.rx', 'hips.ry', 'hips.rz', 'spine.rx', 'spine.ry', 'spine.rz', 'chest.rx', 'chest.ry', 'chest.rz',
  'head.rx', 'head.ry', 'head.rz', 'fL.x', 'fL.y', 'fL.z', 'fL.r', 'fL.p', 'fL.c', 'fR.x', 'fR.y', 'fR.z', 'fR.r', 'fR.p', 'fR.c',
  'shL.rx', 'shL.ry', 'shL.rz', 'elL.rx', 'ik.hx', 'ik.hy', 'ik.hz'];
const ch = {}; for (const k of keys) ch[k] = ordered.map((f) => +f[k].toFixed(4));
const duty = ordered.filter((f) => f['fL.c']).length / n;
return { clip: CLIP, source: 'three.js examples Xbot.glb (Mixamo rig) - retargeted motion data only', dur: +clip.duration.toFixed(4), fps: FPS, frames: n,
  speed: +(sp / cnt).toFixed(3), duty: +duty.toFixed(2), legLen: +legLen.toFixed(3), ch };
