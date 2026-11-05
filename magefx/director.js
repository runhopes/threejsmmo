/* =====================================================================================================
 *  magefx/director.js  -  MageFX.create(): wires the systems together and is the only API pages use.
 *
 *    const fx = MageFX.create({ scene, camera, renderer, quality: 'high', lights: [pl1, pl2] (optional, shared),
 *                               feel: (shake, punch) => {}, onEvent: (name, info) => {} });
 *    fx.attach(knight)                 observe the caster: anticipation starts by itself when a spell animation starts
 *                                      (action.tag = skill id, or the basic 'cast' = fireball) and is cancelled if the
 *                                      animation is interrupted; the staff orb is tinted to the spell's school
 *    fx.telegraph(id, point, radius)   ground indicator, call right after the cast animation starts (fills to impact)
 *    fx.release(id, args)              the animation's contact moment: fire the spell (args documented in spells.js)
 *    fx.shieldHit(dirX, dirZ)          shield absorbed a hit coming from that direction
 *    fx.update(dt)                     once per frame, after the caster's update
 *    fx.stats(), fx.setQuality(q), fx.tuning (live object), fx.clear()
 * ===================================================================================================== */
(function (global) {
  'use strict';
  const T = global.THREE, MFX = global.MageFX, M = MFX.math, PAL = MFX.PAL;

  function deepCopy(o) { return JSON.parse(JSON.stringify(o)); }

  MFX.create = function (o) {
    const scene = o.scene, camera = o.camera;
    let qName = MFX.QUALITY[o.quality] ? o.quality : 'high', Q = MFX.QUALITY[qName];
    const tex = MFX.textures(o.renderer);
    const capacity = MFX.QUALITY.high.maxParticles;              // allocate once for the top preset; lower presets cap via density
    const ps = new MFX.Particles(scene, tex.atlas, capacity);
    const trails = new MFX.Trails(scene, camera, MFX.QUALITY.high.trailPts);
    const ground = new MFX.Ground(scene, tex);
    const flames = new MFX.mesh.FlameSurfaces(scene);
    const lights = new MFX.mesh.LightPool(scene, o.lights || null, o.lights ? o.lights.length : 2);
    const tuning = o.tuning || deepCopy(MFX.TUNING_DEFAULT);
    const specs = MFX._buildSpecs();
    // instanced shards: ice fragments / splinters, rock debris
    const ice = new MFX.mesh.ShardBurst(scene, MFX.mesh.shardGeometry(), MFX.mesh.crystalMaterial(PAL.frost), 96, { stretch: 1.6, order: 27 });
    const rockMatShared = MFX.mesh.rockMaterial(PAL.fire); rockMatShared.uniforms.uDir.value.set(0, 1, 0); rockMatShared.uniforms.uHeat.value = 1.2;
    const rockBits = new MFX.mesh.ShardBurst(scene, MFX.mesh.rockGeometry(9), rockMatShared, 96, { cool: true, order: 26 });
    // pooled meshes: ice spears, meteor rocks, lightning ribbons, the shield dome
    const spearGeo = MFX.mesh.spearGeometry(), spearMat = MFX.mesh.crystalMaterial(PAL.frost), rockGeo = MFX.mesh.rockGeometry(4);
    const pools = { spear: [], rock: [], bolt: [] };
    const shieldMesh = MFX.mesh.shieldMesh(PAL.ward); scene.add(shieldMesh);

    const runs = [], projectiles = [];
    const c = {
      projectiles,
      scene, camera, ps, trails, ground, flames, lights, tex, ice, rockBits, shieldMesh,
      kit: specs.kit, sp: specs.sp, T: tuning, Q, time: 0, density: Q.density,
      A: { orb: ps.anchor(), body: ps.anchor() },
      run(fn) { runs.push({ fn, t: 0 }); },
      after(delay, fn) { runs.push({ fn: (dt, t) => { if (t >= delay) { fn(); return false; } return true; }, t: 0 }); },
      feel(shake, punch) { if (o.feel) o.feel(shake, punch); },
      event(name, info) { if (o.onEvent) o.onEvent(name, info); },
      getSpear() { const m = pools.spear.pop() || new T.Mesh(spearGeo, spearMat); m.renderOrder = 27; m.frustumCulled = false; scene.add(m); return m; },
      putSpear(m) { scene.remove(m); pools.spear.push(m); },
      getRock() { const m = pools.rock.pop() || new T.Mesh(rockGeo, MFX.mesh.rockMaterial(PAL.fire)); m.frustumCulled = false; scene.add(m); return m; },
      putRock(m) { scene.remove(m); pools.rock.push(m); },
      getBolt() { const b = pools.bolt.pop() || new MFX.mesh.BoltMesh(160); b.uni.uAlpha.value = 1; scene.add(b.mesh); return b; },
      putBolt(b) { b.mesh.visible = false; scene.remove(b.mesh); pools.bolt.push(b); },
    };
    c.shield = MFX._shieldController(c);

    /* ---------- caster observation: anticipation phase ---------- */
    let caster = null, track = { a: null, h: null }, pendingTele = null, staff = null;
    const tint = { k: 0, target: 0, school: 'fire' };
    const orbPos = new T.Vector3();
    function idFor(a) {
      if (!a) return null;
      if (a.tag && MFX.SPELLS[a.tag]) return a.tag;
      if (a.def && a.def.spell === 'fireball') return 'fireball';
      if (a.def && a.def.spell === 'meteor' && !a.tag) return 'meteor';
      return null;
    }
    function endCast(released) {
      const h = track.h; if (!h) return;
      const S = MFX.SPELLS[h.id];
      if (S.castEnd) S.castEnd(c, h, released);
      if (!released && h.tele) h.tele.cancel();
      track.h = null; tint.target = 0;
    }
    function trackCaster(dt) {
      if (!caster) return;
      const a = caster.action;
      if (a !== track.a) {
        if (track.h) endCast(false);
        track = { a, h: null };
        const id = idFor(a);
        if (id && MFX.SPELLS[id].cast) {
          track.h = { id, t: 0, k: 0, left: 0, dt: 0, orb: new T.Vector3(), pos: caster.root.position.clone(), dir: new T.Vector3(), aim: new T.Vector3(), data: {} };
          if (pendingTele && pendingTele.id === id) { track.h.tele = pendingTele; pendingTele = null; }
          tint.school = MFX.SPELLS[id].school; tint.target = 1;
          c.event('cast', { spell: id });
        }
      }
      if (pendingTele && (pendingTele._age = (pendingTele._age || 0) + dt) > 0.25) { pendingTele.cancel(); pendingTele = null; }   // nobody adopted it
      const h = track.h;
      if (h && a) {
        const d = a.def, sp = (d.attack ? caster.attackSpeed : 1) * (a.rate || 1), imp = d.impact || d.dur * 0.5;
        h.dt = dt; h.t += dt; h.k = M.clamp01(a.t / imp); h.left = Math.max(0, (imp - a.t) / sp);
        h.orb.copy(orbPos);
        const yaw = caster.root.rotation.y; h.dir.set(Math.sin(yaw), 0, Math.cos(yaw)); h.aim.copy(h.dir);
        MFX.SPELLS[h.id].cast(c, h);
      }
    }
    // staff orb + charge motes take the colour of the spell's school while casting (fire = the staff's own colour)
    function tintStaff(dt) {
      if (!staff) return;
      tint.k += (tint.target - tint.k) * Math.min(1, dt * (tint.target ? 14 : 4));
      const P = PAL[tint.school] || PAL.fire, k = tint.school === 'fire' ? 0 : tint.k;
      staff.glow.material.color.copy(staff.def.glow).lerp(new T.Color(P.flame), k);
      staff.orb.material.emissive.copy(staff.def.emissive).lerp(new T.Color(P.flame), k);
      staff.motes.forEach((m, i) => m.material.color.copy(staff.def.motes[i]).lerp(new T.Color(i % 3 ? P.flame : P.core), k));
    }

    /* ---------- public API ---------- */
    const api = {
      tuning,
      context: c,
      projectiles,                                                  // live projectiles ({ pos, vel, ... }) for tools
      get quality() { return qName; },
      setQuality(q) { if (MFX.QUALITY[q]) { qName = q; Q = c.Q = MFX.QUALITY[q]; } },
      attach(k) {
        caster = k; track = { a: k ? k.action : null, h: null };
        const S = k && k._staff;
        staff = S ? { glow: S.glow, orb: S.orb, motes: S.motes, def: { glow: S.glow.material.color.clone(), emissive: S.orb.material.emissive.clone(), motes: S.motes.map((m) => m.material.color.clone()) } } : null;
      },
      orb() { return orbPos.clone(); },
      telegraph(id, point, radius) {
        const S = MFX.SPELLS[id]; if (!S) return null;
        let lead = 0.8;
        const a = caster && caster.action;
        if (a && idFor(a) === id) { const d = a.def, sp = (d.attack ? caster.attackSpeed : 1) * (a.rate || 1); lead = Math.max(0, ((d.impact || 0) - a.t) / sp); }
        lead += S.lead ? S.lead(c) : 0;
        const tg = MFX._telegraph(c, id, point, radius, lead);
        // adopt only into the track of the CURRENT action (a quick recast must not hand it to the previous cast)
        if (track.h && a && track.a === a && track.h.id === id && !track.h.tele) track.h.tele = tg;
        else { if (pendingTele) pendingTele.cancel(); pendingTele = tg; }
        return tg;
      },
      release(id, args) {
        const S = MFX.SPELLS[id]; if (!S) return null;
        args = args || {};
        if (track.h && track.h.id === id) {
          if (args.telegraph === undefined) args.telegraph = track.h.tele || null;
          endCast(true);
        }
        if (args.from === undefined && caster) args.from = orbPos.clone();
        c.event('release', { spell: id });
        return S.release(c, args);
      },
      shieldHit(dirX, dirZ) { c.shield.hit(dirX, dirZ); },
      shieldStop() { c.shield.stop(false); },
      clear() { runs.length = 0; ps.clear(); c.shield.stop(true); },
      update(dt) {
        c.time += dt;
        c.density = Q.density * tuning.global.density;
        ps.uniforms.uBright.value = tuning.global.brightness;
        lights.k = tuning.global.lights * 0.55;                    // point lights stay subtle: the bright sand washes out fast

        if (caster) {
          const L = caster.staffLaunch && caster.staffLaunch();
          if (L) { orbPos.copy(L.pos); ps.setAnchor(c.A.orb, L.pos.x, L.pos.y, L.pos.z); }
          const p = caster.root.position; ps.setAnchor(c.A.body, p.x, p.y + 1, p.z);
        }
        trackCaster(dt);
        tintStaff(dt);
        for (let i = 0; i < runs.length; i++) {                   // spell runtimes (may add new runs while iterating)
          const R = runs[i]; R.t += dt;
          if (R.fn(dt, R.t) === false) { runs.splice(i, 1); i--; }
        }
        c.shield.update(dt, c.time);
        ps.update(dt);
        trails.update(dt, c.time);
        ground.update(dt, c.time);
        flames.update(c.time);
        ice.update(dt); rockBits.update(dt);
        lights.update(dt, Q.lights);
      },
      stats() {
        return { particles: ps.count, capacity: Math.round(capacity * Q.density), trails: trails.count, decals: ground.count, runs: runs.length,
          shards: ice.count + rockBits.count, flames: flames.list.length, quality: qName };
      },
    };
    return api;
  };
})(typeof window !== 'undefined' ? window : globalThis);
