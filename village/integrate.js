/* =====================================================================================================
 *  village/integrate.js  -  glue between the castle village and the game page (index.html)
 *
 *    const VW = Village.forGame({ renderer, scene, camera, sun, rim })   // builds the zone, sets sky / fog / lights
 *    VW.spawn('plaza' | 'training' | 'gate_inner' | 'gate_outer')        // { position, yaw }
 *    VW.collide(pos)                                                     // slide the hero out of buildings / walls / props
 *    VW.findPath(from, to)                                               // A* waypoints for right-click movement
 *    VW.clampMove(from, to)                                              // last free point on a straight move (blink)
 *    VW.projectileHit(p0, p1)                                            // arrows / fireballs stop on walls, roofs, props
 *    VW.addTrainingTargets(heroes)                                       // dummies #2..#4 + three archery butts as hit targets
 *    VW.creatureZones(zones), VW.creatureObstacles()                     // hunting zones moved outside the south gate
 *    VW.region, VW.mapMarkers()                                          // minimap region + points of interest
 *    VW.update(dt, camera, heroPos, sun)                                 // occluder fade, clutter LOD, shadow-camera snapping
 *  Everything the village needs from the game is passed in; the page keeps owning input, combat and HUD.
 * ===================================================================================================== */
(function () {
  'use strict';
  const T = THREE;
  const V = window.Village;

  V.forGame = function (ctx) {
    const hemi = ctx.hemi || ctx.scene.children.find((o) => o.isHemisphereLight);
    const W = V.create({ renderer: ctx.renderer, scene: ctx.scene, camera: ctx.camera, lights: { hemi, sun: ctx.sun, rim: ctx.rim } });
    const reg = W.registry, cfg = W.config;
    const walk = W.terrain.walk;

    const WD = W.World || null;                                    // world/*.js: the open world (null with ?wild=0)
    W.region = WD ? { name: 'Taşkale Diyarı', bounds: WD.region } : { name: 'Taşkale', bounds: { minX: walk.minX, maxX: walk.maxX, minZ: walk.minZ, maxZ: walk.maxZ } };

    /* straight-line move clamp (blink / teleports): stop before the first blocked nav cell */
    W.clampMove = function (from, to) {
      const out = from.clone(), n = Math.ceil(from.distanceTo(to) / 0.2);
      for (let i = 1; i <= n; i++) {
        const t = i / n, x = from.x + (to.x - from.x) * t, z = from.z + (to.z - from.z) * t;
        if (!W.nav.free(x, z)) break;
        out.set(x, 0, z);
      }
      return out;
    };

    /* creature hunting zones: same species / counts / radii as the game's table, re-sited in the meadow and
       woods south of the gate (the starter town itself stays peaceful) */
    const SITES = {
      meadow: [-17, 105], warren: [18, 99], reeds: [-58, 121], oakwood: [66, 120],
      steppe: [-82, 104], camp: [83, 105], den: [-9, 138],
    };
    // relocated IN PLACE: the zone table is shared (the creature world's zoneAt / region names read it too)
    W.creatureZones = function (zones) {
      if (WD) {                                                    // the open world's own camps replace the table (in place: zoneAt reads it too)
        const out = WD.camps.filter((c) => !window.CreatureKit || window.CreatureKit.SPECIES[c.species]).map((c) => Object.assign({}, c));
        if (window.CREATURE_DEFS) { const Z = window.CREATURE_DEFS.ZONES; Z.length = 0; for (const z of out) Z.push(z); }
        return out;
      }
      let k = 0;
      for (const z of zones) { const s = SITES[z.id] || [-60 + (k++) * 24, 132]; z.cx = s[0]; z.cz = s[1]; }
      if (window.CREATURE_DEFS) for (const z of window.CREATURE_DEFS.ZONES) if (SITES[z.id]) { z.cx = SITES[z.id][0]; z.cz = SITES[z.id][1]; }
      return zones;
    };
    W.creatureObstacles = function () {
      const out = [];
      if (WD) return out;                                          // the collide hook (colliders + valley floor) does the work
      for (const s of W.collision.shapes) {
        if (s.tag === 'bounds') continue;
        if (s.t === 1) { if (s.z > cfg.half + 2) out.push({ x: s.x, z: s.z, r: s.r }); }
        else if (s.z > cfg.half + 2 && Math.max(s.hx, s.hz) < 6) out.push({ x: s.x, z: s.z, r: Math.min(s.hx, s.hz) + 0.2 });
      }
      return out;
    };

    /* minimap: points of interest (drawn as diamonds, labelled on the big map) */
    W.mapMarkers = function () {
      const out = [];
      const L = { blacksmith: 'Demirci', healer: 'Şifacı', quest_giver: 'İlan Panosu', trainer: 'Eğitmen', innkeeper: 'Han' };
      for (const n of reg.npcs) if (L[n.role]) out.push({ id: 'poi_' + n.id, x: n.position.x, z: n.position.z, kind: 'npc', label: L[n.role] });
      out.push({ id: 'poi_market', x: 36, z: -2, kind: 'poi', label: 'Pazar' });
      out.push({ id: 'poi_keep', x: 0, z: -cfg.half + 26, kind: 'poi', label: 'Kale' });
      out.push({ id: 'poi_gate', x: 0, z: cfg.half + cfg.wallThick / 2, kind: 'poi', label: 'Güney Kapısı' });
      if (WD) for (const m of WD.markers) if (m[0] !== 'Taşkale') out.push({ id: 'poi_w_' + m[0], x: m[1], z: m[2], kind: 'poi', label: m[0] });
      if (reg.waypoint) out.push({ id: 'poi_waystone', x: 0, z: 0, kind: 'poi', label: 'Yol Taşı' });
      return out;
    };

    /* training yard: dummies #2..#4 and the three archery butts become real hit targets.
       Dummy #1 stays the page's own dummy (HP, target frame, tools rely on it). */
    const targets = [];
    W.addTrainingTargets = function (heroes) {
      reg.dummies.slice(1).forEach((d, i) => {
        const D = V.Props.makeDummy();
        D.g.position.set(d.x, 0, d.z); D.g.rotation.y = d.yaw || 0; ctx.scene.add(D.g);
        const t = { id: 'vdummy' + (i + 2), name: 'Eğitim Kuklası', pos: D.g.position, radius: 0.42, height: 2.25, piv: D.piv, D, th: 0, om: 0, axis: new T.Vector3(1, 0, 0), flash: 0 };
        t.onHit = (from, power) => {
          const dx = t.pos.x - from.x, dz = t.pos.z - from.z, l = Math.hypot(dx, dz) || 1;
          t.axis.set(dz / l, 0, -dx / l).normalize(); t.om += 4.5 * (power || 1) * (t.th > 0 ? 0.8 : 1); t.flash = 1;
        };
        targets.push(t);
      });
      reg.targets.forEach((a, i) => {
        // the straw boss: capsule centred on the butt face; arrows stick in a pivot placed at the boss
        const piv = new T.Group(); piv.position.set(a.x - 0.12 * Math.sin(-a.yaw), 0, a.z); ctx.scene.add(piv);
        const t = { id: 'vbutt' + (i + 1), name: 'Okçuluk Hedefi', pos: new T.Vector3(a.x, a.cy - 0.75, a.z), radius: 0.62, height: 1.5, piv, static: true };
        t.onHit = () => {};
        targets.push(t);
      });
      for (const k in heroes) for (const t of targets) heroes[k].hitTargets.push(t);
      return targets;
    };
    /* engage / target-frame API (keys 'vt:<id>'): same rules as the page's own dummy - 20 000 HP, regenerates
       after 4 s without hits, refills at zero */
    const byKey = new Map();
    W.trainingTarget = (key) => byKey.get(key) || null;
    const _cp = new T.Vector3(), _ca = new T.Vector3(), _a0 = new T.Vector3(), _a1 = new T.Vector3();
    W.pickTrainingTarget = function (ray) {
      ray = ray.ray || ray;                                        // accepts a Raycaster or a Ray
      let best = null, bd = 1e9;
      for (const t of targets) {
        _a0.set(t.pos.x, t.static ? t.pos.y : 0, t.pos.z); _a1.copy(_a0); _a1.y += t.height;
        const d2 = ray.distanceSqToSegment(_a0, _a1, _cp, _ca);
        const r = t.radius + 0.15, dist = _cp.distanceTo(ray.origin);
        if (d2 < r * r && dist < bd) { bd = dist; best = t.vkey; }
      }
      return best;
    };
    W.targetInfo = function (key) {
      const t = byKey.get(key); if (!t) return null;
      return { id: key, name: t.name, level: 1, type: 'Talim hedefi', disposition: 'neutral', rank: 'normal', hp: t.hp, maxHp: t.max, effects: [] };
    };
    const _addTargets = W.addTrainingTargets;
    W.addTrainingTargets = function (heroes) {
      const out = _addTargets(heroes);
      for (const t of out) {
        t.vkey = 'vt:' + t.id; t.hp = t.max = 20000; t.idle = 99;
        t.aimY = t.static ? reg.targets[+t.id.replace('vbutt', '') - 1].cy : 1.4;
        const wobble = t.onHit;
        t.onHit = (from, power, dmg) => { wobble(from, power); if (dmg) { t.hp = Math.max(0, t.hp - dmg); t.idle = 0; } };
        byKey.set(t.vkey, t);
      }
      return out;
    };
    W.updateTargets = function (dt) {
      for (const t of targets) {
        if (t.hp !== undefined) { t.idle += dt; if (t.hp <= 0) t.hp = t.max; else if (t.idle > 4) t.hp = Math.min(t.max, t.hp + t.max * 0.3 * dt); }
        if (!t.D) continue;
        t.om += (-70 * t.th - 5.5 * t.om) * dt; t.th += t.om * dt;
        t.D.piv.quaternion.setFromAxisAngle(t.axis, t.th);
        if (t.flash > 0 || t.lastFlash) { t.flash = Math.max(0, t.flash - dt * 5); for (const m of t.D.mats) m.emissive.setRGB(t.flash * 0.5, t.flash * 0.4, t.flash * 0.25); t.lastFlash = t.flash > 0; }
      }
    };
    W.trainingTargets = targets;

    /* path following for right-click moves: returns the steering point (or null when arrived) */
    W.steer = function (path, pos) {
      while (path.length) {
        const p = path[0];
        if (Math.hypot(p.x - pos.x, p.z - pos.z) < (path.length > 1 ? 0.45 : 0.15)) { path.shift(); continue; }
        // skip ahead when the next waypoint is already in straight sight
        if (path.length > 1 && W.nav.los(pos.x, pos.z, path[1].x, path[1].z)) { path.shift(); continue; }
        return p;
      }
      return null;
    };

    if (WD) {
      // region names for the HUD / world map, quick-start spawns per zone / camp (?cls=warrior&spawn=z_creek or c_wolf_a)
      W.zoneName = function (x, z) {
        if (x > walk.minX && x < walk.maxX && z > walk.minZ && z < walk.maxZ && z < cfg.half + 6) return 'Taşkale';
        const zn = WD.zoneAt(x, z); return zn ? zn.name : 'Taşkale Diyarı';
      };
      W.zoneInfo = function (x, z) { const zn = WD.zoneAt(x, z); return zn ? { id: zn.id, name: zn.name, lv: zn.lv } : null; };
      for (const zn of WD.zones) { const p = new T.Vector3(zn.label[0], 0, zn.label[1]); reg.spawns['z_' + zn.id] = { id: 'z_' + zn.id, position: p, yaw: Math.PI, note: zn.name }; }
      for (const c of WD.camps) reg.spawns['c_' + c.id] = { id: 'c_' + c.id, position: new T.Vector3(c.cx, 0, c.cz + c.r + 4), yaw: Math.PI, note: c.name };
    }
    if (new URLSearchParams(location.search).get('vdebug') === '1') W.setDebug(true);   // dev overlay from the start
    window.__village = W;
    return W;
  };
})();
