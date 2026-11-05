/* =====================================================================================================
 *  vfx/conform.js  -  VfxConform: flat ground decals follow the terrain (open-world slopes / hills).
 *
 *  The game authors every ground effect as a flat quad / ring at a small height above "the ground" (y = 0 in the
 *  hero's vertical frame, see village/scene.js). On walkable relief that plane cuts into the slope (half buried) or
 *  floats over it. attach() swaps the decal's geometry for a subdivided copy (same UVs, same shape, same local
 *  transform) and update() - called ONCE per frame right before renderer.render - moves every vertex along the
 *  decal's normal so it sits `lift` above the rendered terrain (the exact 2 m terrain triangles of world/terrain.js).
 *
 *    VfxConform.attach(mesh, { lift?, seg?, segY?, radial?, transient? }) -> mesh
 *        lift      fixed height above the terrain (for decals the caller already puts on fY(x, z) + k: pass k).
 *                  Omitted: the decal's own world y is its lift ("authored at y = 0" effects: 0.022, 0.03 ...).
 *        seg/segY  Plane subdivisions (default 12), radial = Ring/Circle radial rings (default 6).
 *        transient the entry is dropped (and its geometry disposed) once the mesh has left the scene.
 *    VfxConform.enable(mesh, on)   pooled meshes that are sometimes not lying on the ground (oriented shock rings,
 *                                  camera-facing beams): off restores the flat geometry.
 *    VfxConform.groundY(x, z)      frame height of the rendered terrain (0 without the open world).
 *    VfxConform.update()           per frame. Only visible decals whose transform / frame moved are recomputed.
 *
 *  ?conform=0 turns it off (A/B). Without the open world (village.html, magefx.html, archer-vfx.html, index.html?world=arena) attach() is a no-op and
 *  nothing changes. No per-frame allocations.
 * ===================================================================================================== */
(function (global) {
  'use strict';
  const T = global.THREE;
  const list = [];
  let Wc = null;
  const OFF = !!(global.location && /[?&]conform=0\b/.test(global.location.search));   // ?conform=0: old flat decals (A/B)
  function world() {
    if (Wc || OFF) return Wc;
    const V = global.Village, W = V && V.World;
    if (W && W.on && W.hgrid && W.bounds && W.G) Wc = W;
    return Wc;
  }
  /* true height of the RENDERED terrain: world/terrain.js triangulates each 2 m cell with the (i+1, j) - (i, j+1) diagonal */
  function trueY(W, x, z) {
    const B = W.bounds, G = W.G, NX = W.NX, NZ = W.NZ, h = W.hgrid;
    if (W.deck) { const i = Math.round((x - B.minX) / G), j = Math.round((z - B.minZ) / G); if (i >= 0 && i < NX && j >= 0 && j < NZ && W.deck[j * NX + i]) return 0; }
    let fx = (x - B.minX) / G, fz = (z - B.minZ) / G;
    if (fx < 0) fx = 0; else if (fx > NX - 1.001) fx = NX - 1.001;
    if (fz < 0) fz = 0; else if (fz > NZ - 1.001) fz = NZ - 1.001;
    const ix = fx | 0, iz = fz | 0, tx = fx - ix, tz = fz - iz, k = iz * NX + ix;
    const a = h[k], b = h[k + 1], c = h[k + NX], d = h[k + NX + 1];
    return tx + tz <= 1 ? a + (b - a) * tx + (c - a) * tz : d + (c - d) * (1 - tx) + (b - d) * (1 - tz);
  }
  function groundY(x, z) { const W = world(); return W ? trueY(W, x, z) - (W.yBase || 0) : 0; }

  /* subdivided twin of a Plane / Ring / Circle geometry, with the same rotateX / translate the caller applied */
  const ROTS = [0, -Math.PI / 2, Math.PI / 2, Math.PI];
  function rebuild(g, o) {
    const p = g.parameters; if (!p) return null;
    let make, fine;
    if (g.type === 'PlaneGeometry') {
      make = () => new T.PlaneGeometry(p.width, p.height, p.widthSegments, p.heightSegments);
      const sx = Math.max(p.widthSegments, o.seg || 12), sy = Math.max(p.heightSegments, o.segY || o.seg || 12);
      fine = () => new T.PlaneGeometry(p.width, p.height, sx, sy);
    } else if (g.type === 'RingGeometry') {
      make = () => new T.RingGeometry(p.innerRadius, p.outerRadius, p.thetaSegments, p.phiSegments, p.thetaStart, p.thetaLength);
      const rad = Math.max(p.phiSegments, o.radial || Math.max(1, Math.round((p.outerRadius - p.innerRadius) / p.outerRadius * 6)));
      fine = () => new T.RingGeometry(p.innerRadius, p.outerRadius, Math.max(p.thetaSegments, o.theta || 0), rad, p.thetaStart, p.thetaLength);
    } else if (g.type === 'CircleGeometry') {
      make = () => new T.CircleGeometry(p.radius, p.segments, p.thetaStart, p.thetaLength);
      fine = () => new T.RingGeometry(0, p.radius, Math.max(p.segments, o.theta || 0), o.radial || 6, p.thetaStart, p.thetaLength);   // same uv mapping as the circle
    } else return null;
    const src = g.attributes.position, ref = make(), rp = ref.attributes.position;
    if (rp.count !== src.count) { ref.dispose(); return null; }
    const tmp = new T.Vector3();
    for (const r of ROTS) {                                      // which rotateX + translate turns the parametric shape into g?
      tmp.set(rp.getX(0), rp.getY(0), rp.getZ(0)); if (r) tmp.applyAxisAngle(XA, r);
      const tx = src.getX(0) - tmp.x, ty = src.getY(0) - tmp.y, tz = src.getZ(0) - tmp.z;
      let ok = true;
      for (let i = 0; i < rp.count && ok; i += Math.max(1, (rp.count / 24) | 0)) {
        tmp.set(rp.getX(i), rp.getY(i), rp.getZ(i)); if (r) tmp.applyAxisAngle(XA, r);
        ok = Math.abs(tmp.x + tx - src.getX(i)) + Math.abs(tmp.y + ty - src.getY(i)) + Math.abs(tmp.z + tz - src.getZ(i)) < 1e-4;
      }
      if (!ok) continue;
      ref.dispose();
      const f = fine(); if (r) f.rotateX(r); if (tx || ty || tz) f.translate(tx, ty, tz);
      const n = new T.Vector3(0, 0, 1); if (r) n.applyAxisAngle(XA, r);
      return { geo: f, n };
    }
    ref.dispose(); return null;
  }
  const XA = new T.Vector3(1, 0, 0);

  function attach(mesh, o) {
    o = o || {};
    if (!world() || !mesh || mesh.userData.conform) return mesh;
    const r = rebuild(mesh.geometry, o); if (!r) return mesh;
    const pos = r.geo.attributes.position; pos.setUsage(T.DynamicDrawUsage);
    const e = { mesh, geo: r.geo, base: Float32Array.from(pos.array), nx: r.n.x, ny: r.n.y, nz: r.n.z,
      lift: o.lift === undefined ? null : o.lift, transient: !!o.transient, on: true, flat: true, key: new Float64Array(14).fill(NaN) };
    mesh.geometry = r.geo; mesh.userData.conform = e;
    mesh.frustumCulled = false;                                  // displaced vertices leave the flat bounding sphere
    const M = mesh.material;
    if (M && !M.polygonOffset) { M.polygonOffset = true; M.polygonOffsetFactor = -2; M.polygonOffsetUnits = -4; }
    list.push(e);
    return mesh;
  }
  function flatten(e) {
    if (e.flat) return;
    e.geo.attributes.position.array.set(e.base); e.geo.attributes.position.needsUpdate = true;
    e.flat = true; e.key[0] = NaN;
  }
  function enable(mesh, on) {
    const e = mesh && mesh.userData.conform; if (!e) return;
    e.on = !!on; if (!on) flatten(e); else e.key[0] = NaN;
  }
  function shown(m) { for (let o = m; o; o = o.parent) if (!o.visible) return false; return true; }

  const KI = [0, 1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14];
  let lastN = 0;
  function update() {
    const W = world(); if (!W) return;
    const yb = W.yBase || 0;
    lastN = 0;
    for (let li = list.length - 1; li >= 0; li--) {
      const e = list[li], m = e.mesh;
      if (!m.parent) {
        if (e.transient) { list.splice(li, 1); m.userData.conform = null; e.geo.dispose(); }
        continue;
      }
      if (!e.on || m.geometry !== e.geo || !shown(m)) continue;
      m.updateWorldMatrix(true, false);
      const me = m.matrixWorld.elements, K = e.key;
      const lift = e.lift === null ? me[13] : e.lift;
      let same = K[12] === yb && K[13] === lift;
      for (let k = 0; k < 12 && same; k++) same = K[k] === me[KI[k]];
      if (same) continue;
      for (let k = 0; k < 12; k++) K[k] = me[KI[k]];
      K[12] = yb; K[13] = lift;
      const nx = e.nx, ny = e.ny, nz = e.nz;
      const wnx = me[0] * nx + me[4] * ny + me[8] * nz, wny = me[1] * nx + me[5] * ny + me[9] * nz, wnz = me[2] * nx + me[6] * ny + me[10] * nz;
      if (wny * wny < 0.8 * (wnx * wnx + wny * wny + wnz * wnz)) { flatten(e); continue; }   // not lying on the ground
      const B = e.base, P = e.geo.attributes.position.array, inv = 1 / wny;
      for (let i = 0, n = B.length; i < n; i += 3) {
        const bx = B[i], by = B[i + 1], bz = B[i + 2];
        const wx = me[0] * bx + me[4] * by + me[8] * bz + me[12];
        const wy = me[1] * bx + me[5] * by + me[9] * bz + me[13];
        const wz = me[2] * bx + me[6] * by + me[10] * bz + me[14];
        const t = (trueY(W, wx, wz) - yb + lift - wy) * inv;
        P[i] = bx + t * nx; P[i + 1] = by + t * ny; P[i + 2] = bz + t * nz;
      }
      e.geo.attributes.position.needsUpdate = true; e.flat = false; lastN++;
    }
  }
  function stats() { let on = 0; for (const e of list) if (e.mesh.parent && e.on && shown(e.mesh)) on++; return { entries: list.length, live: on, updated: lastN, active: !!world() }; }

  global.VfxConform = { attach, enable, update, groundY, stats, get active() { return !!world(); } };
})(typeof window !== 'undefined' ? window : globalThis);
