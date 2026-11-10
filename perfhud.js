/* Performance overlay for profiling on a real phone. OFF by default; enable with ?perfhud=1 (or localStorage.tdsm_perfhud = '1').
 * Shows: fps, frame time, renderer.render() CPU time (JS submit cost), draw calls, triangles, geometries/textures, visible nodes,
 * JS heap (where available) and the shadow state. renderer.info is reset per render() call, so calls/tris are per frame.
 * ?perfhud=2 also lists the heaviest visible object groups (by name prefix): draws / triangles. Same list: window.__perfBreakdown().
 * Buttons (A/B on the phone, same spot): SH = no shadow pass, TER = hide terrain, CR = hide skinned meshes (creatures / heroes),
 * PR = cycle pixel ratio 1.25/1/.75/.5. 'JS all' = main-thread time spent in requestAnimationFrame callbacks per frame (game logic + render):
 * if frame ms >> JS all the frame is GPU / compositor bound; if they are close it is JS bound.
 * Tap the panel to copy a one-line summary into the console (Safari/Chrome remote inspector). */
(function () {
  'use strict';
  const detail = /[?&]perfhud=2/.test(location.search);
  let on = /[?&]perfhud=[12]/.test(location.search);
  try { if (!on && localStorage.getItem('tdsm_perfhud') === '1') on = true; } catch (e) { /* storage may be blocked */ }
  if (!on) return;

  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;left:calc(env(safe-area-inset-left,0px) + 6px);top:6px;z-index:99999;pointer-events:none;white-space:pre;font:11px/1.35 ui-monospace,Menlo,monospace;' +
    'color:#bff5c9;background:rgba(0,0,0,.62);padding:5px 8px;border-radius:6px;max-width:60vw';
  (document.body || document.documentElement).appendChild(box);

  let lastScene = null;
  /* Visible meshes grouped by name prefix (digits stripped). Instanced meshes count as 1 draw; triangles = per-instance tris * count. */
  window.__perfBreakdown = function (top) {
    const g = new Map();
    if (!lastScene) return [];
    lastScene.traverseVisible((o) => {
      if (!(o.isMesh || o.isPoints || o.isLine) || !o.geometry) return;
      const geo = o.geometry, idx = geo.index ? geo.index.count : (geo.attributes.position ? geo.attributes.position.count : 0);
      const draw = geo.drawRange, n = Math.min(idx, draw.count === Infinity ? idx : draw.count);
      const tris = (o.isMesh ? n / 3 : 0) * (o.isInstancedMesh ? o.count : 1);
      let p = o; while (p && !p.name) p = p.parent;
      const key = ((p && p.name) || o.type).replace(/[0-9_\-.]+$/g, '') + (o.isInstancedMesh ? ' [inst]' : o.isSkinnedMesh ? ' [skin]' : '') + (o.castShadow ? ' ☼' : '');
      const e = g.get(key) || { key, draws: 0, tris: 0 }; e.draws++; e.tris += tris; g.set(key, e);
    });
    return [...g.values()].sort((a, b) => b.tris - a.tris).slice(0, top || 12);
  };
  /* total JS per frame: time inside every requestAnimationFrame callback (installed here; the game re-registers each frame, so it is covered) */
  let jsMs = 0;
  const rafOrig = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = function (cb) {
    return rafOrig(function (t) { const s = performance.now(); try { return cb(t); } finally { jsMs += performance.now() - s; } });
  };
  const flags = { sh: false, ter: false, cr: false }, PRS = [1.25, 1, 0.75, 0.5];
  let prIdx = 0, prevAuto = false;
  const bar = document.createElement('div');
  bar.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);top:4px;z-index:99999;display:flex;gap:6px;font:600 12px ui-monospace,Menlo,monospace';
  function mkBtn(label, fn) {
    const b = document.createElement('button');
    b.style.cssText = 'pointer-events:auto;padding:6px 10px;border-radius:8px;border:1px solid #6a8;background:rgba(0,0,0,.7);color:#bff5c9;font:inherit;touch-action:manipulation';
    b.textContent = label; b.addEventListener('click', (e) => { e.stopPropagation(); fn(b); });
    bar.appendChild(b); return b;
  }
  function mark(b, on, txt) { b.style.background = on ? '#2a7a3a' : 'rgba(0,0,0,.7)'; b.style.color = on ? '#fff' : '#bff5c9'; if (txt) b.textContent = txt; }
  mkBtn('SH', (b) => {
    flags.sh = !flags.sh; mark(b, flags.sh);
    if (flags.sh) { prevAuto = r.shadowMap.autoUpdate; r.shadowMap.autoUpdate = false; } else { r.shadowMap.autoUpdate = prevAuto; r.shadowMap.needsUpdate = true; }
  });
  mkBtn('TER', (b) => { flags.ter = !flags.ter; mark(b, flags.ter); });
  mkBtn('CR', (b) => { flags.cr = !flags.cr; mark(b, flags.cr); });
  mkBtn('PR 1.25', (b) => { prIdx = (prIdx + 1) % PRS.length; r.setPixelRatio(PRS[prIdx]); mark(b, prIdx > 0, 'PR ' + PRS[prIdx]); });
  (document.body || document.documentElement).appendChild(bar);

  let r = null, frames = 0, acc = 0, renderMs = 0, worst = 0, last = performance.now(), visNodes = 0, tNodes = 0, line = '';
  function hook() {
    r = window.__renderer;
    if (!r || !window.THREE) return setTimeout(hook, 200);
    const orig = r.render.bind(r);
    r.render = function (scene, cam) {
      const t0 = performance.now();
      let hid = null;
      if (flags.sh) r.shadowMap.needsUpdate = false;                       // perf.js (phones) re-arms it every 2nd frame
      if ((flags.ter || flags.cr) && scene && scene.isScene) {
        hid = [];
        scene.traverseVisible((o) => {
          if (!o.isMesh) return;
          if ((flags.ter && /^(terrain_|river_|lake_)/.test(o.name || '')) || (flags.cr && o.isSkinnedMesh)) hid.push(o);
        });
        for (const o of hid) o.visible = false;
      }
      orig(scene, cam);
      if (hid) for (const o of hid) o.visible = true;
      if (scene && scene.isScene) lastScene = scene;
      renderMs += performance.now() - t0;
      if (scene && scene.isScene && performance.now() - tNodes > 1000) {   // node count once per second (a traversal is not free)
        tNodes = performance.now(); let n = 0; scene.traverseVisible(() => { n++; }); visNodes = n;
      }
    };
    requestAnimationFrame(loop);
  }
  function loop(now) {
    requestAnimationFrame(loop);
    const dt = now - last; last = now; frames++; acc += dt; if (dt > worst) worst = dt;
    if (acc < 500) return;
    const i = r.info, fps = frames * 1000 / acc;
    const mem = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) + ' MB heap\n' : '';
    line = fps.toFixed(0) + ' fps · ' + (acc / frames).toFixed(1) + ' ms (worst ' + worst.toFixed(0) + ')\n' +
      'JS all ' + (jsMs / frames).toFixed(1) + ' ms · render() ' + (renderMs / frames).toFixed(1) + ' ms\n' +
      'calls ' + i.render.calls + ' · tris ' + (i.render.triangles / 1000).toFixed(0) + 'k\n' +
      'geo ' + i.memory.geometries + ' · tex ' + i.memory.textures + ' · vis nodes ' + visNodes + '\n' + mem +
      'shadow ' + (flags.sh ? 'PASS OFF' : r.shadowMap.enabled ? 'on' : 'off') + (flags.ter ? ' · TER off' : '') + (flags.cr ? ' · CR off' : '') + ' · pr ' + r.getPixelRatio() + ' · ' + innerWidth + 'x' + innerHeight;
    box.textContent = line + (detail ? '\n' + window.__perfBreakdown(8).map((e) => e.key + ' ' + e.draws + 'd ' + (e.tris / 1000).toFixed(0) + 'k').join('\n') : '');
    frames = 0; acc = 0; renderMs = 0; jsMs = 0; worst = 0;
  }
  box.addEventListener('click', () => console.log('[perfhud]', line.replace(/\n/g, ' | ')));
  hook();
})();
