// Idle-pose dimensions of every species (CPU-skinned): node tools/crsize.mjs [--scale1]
import { load } from './crnode.mjs';
const { THREE, K, D } = await load(['rat', 'rabbit', 'snake', 'boar', 'wolf', 'goblin']);
const scale1 = process.argv.includes('--scale1');
for (const id of ['rat', 'rabbit', 'snake', 'boar', 'wolf', 'goblin', 'spikeback']) {
  const v = new K.CreatureView(id, scale1 ? { scale: 1e-9 + 1 } : {});
  new THREE.Scene().add(v.root); v.teleport(0, 0, 0);
  for (let t = 0; t < 1.5; t += 1 / 60) v.update(1 / 60, 2);
  v.root.updateMatrixWorld(true);
  const G = K.speciesGeometry(id, 1), inv = v.tpl.inverses, M = v.bones.map((b, i) => new THREE.Matrix4().multiplyMatrices(b.matrixWorld, inv[i]));
  const box = new THREE.Box3(), p = new THREE.Vector3(), q = new THREE.Vector3(), acc = new THREE.Vector3();
  for (const s in G.slots) {
    const g = G.slots[s], P = g.attributes.position, SI = g.attributes.skinIndex.array, SW = g.attributes.skinWeight.array;
    for (let i = 0; i < P.count; i++) { p.fromBufferAttribute(P, i); acc.set(0, 0, 0); for (let j = 0; j < 4; j++) { const w = SW[4 * i + j]; if (w > 0) acc.addScaledVector(q.copy(p).applyMatrix4(M[SI[4 * i + j]]), w); } box.expandByPoint(acc); }
  }
  const sz = box.getSize(new THREE.Vector3());
  console.log(id.padEnd(10), 'scale', v.scale.toFixed(2), ' height', sz.y.toFixed(2), ' length', sz.z.toFixed(2), ' width', sz.x.toFixed(2));
}
