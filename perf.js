/* Render-loop performance patches (loaded right after three.min.js; web + mobile).
 * 1) three r128's Scene.updateMatrixWorld walks EVERY node each frame, hidden ones included. The open world shifts the whole world
 *    group by -World.yBase every frame (village/scene.js), which forces a world-matrix multiply on all ~14k descendants although only
 *    ~1k are visible. Hidden subtrees are skipped here and catch up (forced) the frame they are shown again. Code that needs the matrix
 *    of a hidden object calls getWorldPosition / updateWorldMatrix, which is untouched.
 *    Measured (4x CPU throttle, phone viewport): JS 34 → 21 ms / frame, 28 → 43 fps.
 * 2) Phones: the shadow map is re-rendered every 2nd frame (the ~370 shadow-caster draws halve; the hero's shadow lags one frame).
 * 0) vendor/three.min.js is patched (see its header): InstancedMesh draws no longer re-specify all vertex attributes each draw
 *    (GL calls / frame 6.9k → see the bench), the biggest cost on iOS WebKit.
 * Off switch for A/B (1, 2 only): ?perf=0 */
(function () {
  'use strict';
  if (/[?&]perf=0/.test(location.search) || !window.THREE) return;
  const proto = THREE.Object3D.prototype, orig = proto.updateMatrixWorld;
  proto.updateMatrixWorld = function (force) {
    if (!this.visible && this.parent) { this._mwSkip = true; return; }   // hidden subtree: not rendered, not culled → skip
    if (this._mwSkip) { this._mwSkip = false; force = true; }           // shown again: bring the whole subtree up to date
    return orig.call(this, force);
  };
  const mobile = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  if (mobile) (function waitRenderer() {
    const r = window.__renderer;
    if (!r) return setTimeout(waitRenderer, 200);
    r.shadowMap.autoUpdate = false; let n = 0;
    (function tick() { requestAnimationFrame(tick); if ((n++ & 1) === 0) r.shadowMap.needsUpdate = true; })();
    // (an adaptive render resolution was tried and removed 2026-11-05: on a real iPhone 15 Plus it went down to 0.8 without any
    //  fps gain — phones here are CPU / draw-call bound, not fill bound — and only made the picture blurry)
  })();
})();
