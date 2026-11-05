/* TDS MOBA - CreatureSim: AUTHORITATIVE creature simulation (AI, movement, attacks, damage, death, respawn).
 *
 * Pure JavaScript (no three.js, no DOM, no rendering): the same file can run inside the browser as a local authority
 * (single-player / listen mode, as now) or unchanged on a Node server. Clients never decide creature damage: they
 *   - send damage REQUESTS for their own attacks (applyDamage, validated here: alive, plausible range)
 *   - read creature state (snapshot()) and events (drainEvents()) and only animate them
 * Creature attacks register a hit ONLY inside the attack's active window (defs.js), against the target's position at
 * that moment, with the same reach / facing-arc validation the hero melee uses. Starting an attack never deals damage.
 *
 * Behaviours (defs.behavior.type): skitter (rat), evasive (rabbit), ambush (snake), charger (boar), pack (wolf),
 * skirmisher (goblin), boss (spikeback: telegraphs, enrage, stagger thresholds).
 *
 * Scale (hundreds of creatures on a large map): opts.activeRadius (default Infinity = everything is simulated, as before).
 * When finite, a creature that is alive, idle / roaming (no target, not evading home, no attack, no stun, not alerted) and farther
 * than activeRadius from EVERY player is DORMANT: no AI, movement or separation until a player comes near (it simply resumes,
 * nothing teleports); dead creatures always tick their corpse / respawn timers. Separation uses a spatial hash (cell >= 4 m) and
 * only touches awake creatures. stats() reports { total, active, dormant }.
 */
(function (global) {
  'use strict';
  const DEFS = global.CREATURE_DEFS;
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const angD = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
  // leash / evade (MMO rules, same as Atherion's mob_global_config): a creature that is being hit keeps fighting
  const LEASH_GRACE = 10;      // s since the last damage: inside it the creature never leashes (an active fight drifting out of the camp)
  const LEASH_HARD = 2;        // x leash radius: dragged this far out of its area it leashes even mid-fight
  const RETURN_STALL = 1.5;    // s without getting closer to the spawn point (rock on it, player standing there): the evade ends in place
  const RETURN_TIMEOUT = 12;   // s: a walk home that still has not arrived (stuck behind a wall) snaps to the spawn point
  function rng(seed) {                                        // mulberry32: deterministic per simulation
    let s = seed >>> 0;
    return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  class CreatureSim {
    constructor(opts) {
      opts = opts || {};
      this.R = rng(opts.seed || 1234567);
      this.time = 0;
      this.creatures = [];
      this.byId = new Map();
      this.players = new Map();          // id -> { id, x, z, radius, alive }
      this.events = [];
      this.nextId = 1;
      this.obstacles = opts.obstacles || [];   // [{x, z, r}] static blockers (training dummy...)
      // optional world collision supplied by the host: collide(p = {x, z}, radius) slides p out of walls / fences / props
      this.collide = opts.collide || null; this._cp = { x: 0, z: 0 };
      this.activeRadius = opts.activeRadius > 0 ? opts.activeRadius : Infinity;
      // spatial hash scratch (separation): cell >= the widest pair reach so a 3x3 cell query always finds every neighbour
      let maxR = 1; for (const id in DEFS.SPECIES) maxR = Math.max(maxR, DEFS.SPECIES[id].radius || 0);
      this._cell = Math.max(4, 1.8 * maxR + 1); this._maxR = maxR;
      this._head = new Map(); this._next = new Int32Array(64); this._act = []; this._cand = []; this._pl = [];
      this._obsGrid = null; this._obsN = -1; this._nDormant = 0;
    }
    rnd(a, b) { return a + (b - a) * this.R(); }

    /* ---------------- players (fed by the player authority each tick) ---------------- */
    setPlayer(id, x, z, alive, radius) {
      let p = this.players.get(id);
      if (!p) { p = { id, x, z, radius: radius || 0.4, alive: true }; this.players.set(id, p); }
      p.x = x; p.z = z; p.alive = !!alive; if (radius) p.radius = radius;
    }
    removePlayer(id) { this.players.delete(id); }

    /* ---------------- spawning ---------------- */
    spawnZones(zones) { for (const z of zones) for (let i = 0; i < z.count; i++) this.spawn(z.species, z, i); }
    spawn(sp, zone, slot) {
      const D = DEFS.SPECIES[sp];
      const c = { id: this.nextId++, sp, D, zone, slot, home: { x: zone.cx, z: zone.cz, r: zone.r }, cd: {}, threat: new Map(), flags: {} };
      this._place(c);
      this.creatures.push(c); this.byId.set(c.id, c);
      this.events.push({ type: 'spawn', id: c.id });
      return c;
    }
    _place(c) {
      const D = c.D, zone = c.zone;
      const lv = D.levels[0] + Math.floor(this.R() * (D.levels[1] - D.levels[0] + 1));
      const st = DEFS.statsFor(c.sp, lv);
      // spawn point inside the camp, not on top of another creature (a few tries)
      let px = zone.cx, pz = zone.cz;
      for (let k = 0; k < 12; k++) {
        const a = this.R() * TAU, r = zone.count > 1 ? Math.sqrt(this.R()) * zone.r * 0.85 : 0;
        px = zone.cx + Math.cos(a) * r; pz = zone.cz + Math.sin(a) * r;
        if (!this.creatures.some((o) => o !== c && o.alive && Math.hypot(o.x - px, o.z - pz) < (o.D.radius + D.radius) * 1.3)) break;
      }
      // the spawn point is where a walk home ends: never inside a rock / tree / fence (or the creature can never arrive)
      for (const o of this.obstacles) { const dx = px - o.x, dz = pz - o.z, d = Math.hypot(dx, dz), r = D.radius + o.r; if (d < r && d > 1e-6) { px = o.x + dx / d * r; pz = o.z + dz / d * r; } }
      if (this.collide) { const p = this._cp; p.x = px; p.z = pz; this.collide(p, D.radius * 0.8); px = p.x; pz = p.z; }
      Object.assign(c, {
        level: lv, maxHp: st.maxHp, hp: st.maxHp, exp: st.exp,
        x: px, z: pz, yaw: this.R() * TAU,
        st: 'idle', mode: 'walk', speed: 0, vx: 0, vz: 0, target: null, act: null, stun: 0, aiT: this.rnd(0.5, 3),
        dest: null, deadT: 0, alive: true, despawned: false, respawnAt: 0, staggered: 0, enraged: false, lastHitT: -99,
        orbitDir: this.R() < 0.5 ? 1 : -1, evadeT: 0, alert: 0, seq: (c.seq || 0) + 1,
      });
      c.cd = {}; c.threat.clear(); c.flags = {};
      c.spawnX = c.x; c.spawnZ = c.z;
    }

    /* ---------------- damage requests from players (validated) ---------------- */
    applyDamage(id, amount, src) {
      const c = this.byId.get(id);
      if (!c || !c.alive) return { ok: false, reason: 'dead' };
      src = src || {};
      if (src.x !== undefined && Math.hypot(src.x - c.x, src.z - c.z) > (src.maxRange || 30)) return { ok: false, reason: 'range' };
      // evading home: immune (MMO leash rule). Refused openly - the client shows no damage, and a 0-damage "hit" must not
      // flinch / stun the creature or refresh its combat timer (that froze it in place on the way home)
      if (c.st === 'return') return { ok: false, reason: 'evade' };
      amount = Math.max(0, Math.round(amount));
      c.hp = Math.max(0, c.hp - amount);
      c.lastHitT = this.time;
      if (src.pid !== undefined) {
        c.threat.set(src.pid, (c.threat.get(src.pid) || 0) + amount);
        if (!c.target || !this._validTarget(c.target)) this._aggro(c, src.pid, true);
      }
      const dx = src.x !== undefined ? c.x - src.x : -Math.sin(c.yaw), dz = src.z !== undefined ? c.z - src.z : -Math.cos(c.yaw), dl = Math.hypot(dx, dz) || 1;
      const ev = { type: 'damaged', id, amount, hp: c.hp, dirX: dx / dl, dirZ: dz / dl, interrupted: false, stagger: false, crit: !!src.crit };
      if (c.hp <= 0) { this._kill(c, src, ev.dirX, ev.dirZ); this.events.push(ev); return { ok: true, amount, killed: true, exp: c.exp }; }
      // boss stagger thresholds
      if (c.D.staggerAt) for (const th of c.D.staggerAt) if (!c.flags['st' + th] && c.hp / c.maxHp <= th) { c.flags['st' + th] = true; this._interrupt(c, 1.6); ev.stagger = true; ev.interrupted = true; }
      // poise: light creatures get knocked out of their wind-up
      if (!ev.stagger && c.act && !c.act.def.heavy) {
        const u = c.act.t / c.act.def.dur;
        if (u < c.act.def.active[0] && this.R() > c.D.poise) { this._interrupt(c, 0.35); ev.interrupted = true; }
      } else if (!ev.stagger && !c.act && this.R() > c.D.poise) c.stun = Math.max(c.stun, 0.18);
      this.events.push(ev);
      // social aggro: nearby members of the same camp join (rats, wolves, goblins)
      if (c.D.behavior.assist && src.pid !== undefined) for (const o of this.creatures) {
        if (o === c || !o.alive || (o.D.group || o.sp) !== (c.D.group || c.sp) || o.target || o.st === 'return') continue;
        if (Math.hypot(o.x - c.x, o.z - c.z) < c.D.behavior.assist) this._aggro(o, src.pid, false);
      }
      return { ok: true, amount, killed: false };
    }
    _interrupt(c, stun) {
      if (c.act) { this.events.push({ type: 'interrupt', id: c.id, attack: c.act.id }); c.act = null; }
      c.stun = Math.max(c.stun, stun);
      if (stun > 1) this.events.push({ type: 'stagger', id: c.id, dur: stun });
    }
    _kill(c, src, dx, dz) {
      c.alive = false; c.st = 'dead'; c.act = null; c.deadT = 0; c.speed = 0; c.vx = c.vz = 0; c.target = null;
      const loot = (c.D.loot || []).filter((l) => this.R() < l.p).map((l) => ({ id: l.id, name: l.name }));
      this.events.push({ type: 'death', id: c.id, killer: src.pid, exp: c.exp, level: c.level, loot, dirX: dx, dirZ: dz });
    }
    _validTarget(pid) { const p = this.players.get(pid); return !!(p && p.alive); }
    _aggro(c, pid, direct) {
      if (!c.alive || c.st === 'return') return;
      const was = c.target;
      c.target = pid;
      if (!was) { c.st = 'chase'; c.aiT = 0; this.events.push({ type: 'aggro', id: c.id, target: pid, direct }); }
    }

    /* ---------------- main tick ---------------- */
    tick(dt) {
      this.time += dt;
      const ps = this._pl; ps.length = 0; for (const p of this.players.values()) ps.push(p);
      const finite = this.activeRadius < Infinity, R2 = this.activeRadius * this.activeRadius;
      let dormant = 0;
      for (const c of this.creatures) {
        if (!c.alive) { c.dormant = false; this._tickDead(c, dt); continue; }
        if (finite && this._isDormant(c, ps, R2)) {
          if (!c.dormant) { c.dormant = true; c.speed = 0; c.vx = c.vz = 0; }
          dormant++; continue;
        }
        c.dormant = false;
        if (c.stun > 0) { c.stun -= dt; c.speed = 0; c.vx = c.vz = 0; continue; }
        if (c.act) this._tickAttack(c, dt);
        else this._think(c, dt);
        for (const k in c.cd) if (c.cd[k] > 0) c.cd[k] -= dt;
      }
      this._nDormant = dormant;
      this._separate(dt);
    }
    // alive, calm (idle / roaming, nothing to react to) and out of every player's range -> not simulated
    _isDormant(c, ps, R2) {
      if (c.target || c.act || c.stun > 0 || c.alert > 0 || (c.st !== 'idle' && c.st !== 'roam')) return false;
      for (let i = 0; i < ps.length; i++) { const dx = ps[i].x - c.x, dz = ps[i].z - c.z; if (dx * dx + dz * dz <= R2) return false; }
      return true;
    }
    stats() { const total = this.creatures.length, dormant = this._nDormant; return { total, active: total - dormant, dormant }; }
    _tickDead(c, dt) {
      c.deadT += dt;
      if (!c.despawned && c.deadT >= c.D.corpse) { c.despawned = true; c.respawnAt = this.time + this.rnd(c.D.respawn[0], c.D.respawn[1]); this.events.push({ type: 'despawn', id: c.id }); }
      if (c.despawned && this.time >= c.respawnAt) { this._place(c); this.events.push({ type: 'respawn', id: c.id }); }
    }

    _think(c, dt) {
      const B = c.D.behavior;
      c.aiT -= dt;
      // drop invalid targets (dead / gone) -> go home
      if (c.target && !this._validTarget(c.target)) { c.target = null; this._goHome(c); }
      // leash (evade): only when the fight has left the camp AND nobody has hurt the creature for LEASH_GRACE s, or when it
      // has been dragged clearly out of its area. Measured from the camp centre; the radius never ends inside the camp's own
      // aggro reach (snakes at the camp edge used to leash ~1 s after engaging, while being shot).
      const dh = Math.hypot(c.x - c.home.x, c.z - c.home.z), leash = Math.max(B.leash, c.home.r + B.aggro + 0.5);
      if (c.target && dh > leash && (this.time - c.lastHitT > LEASH_GRACE || dh > leash * LEASH_HARD)) { c.target = null; this._goHome(c); }
      if (c.st === 'return') {
        c.retT += dt;
        const ds = Math.hypot(c.x - c.spawnX, c.z - c.spawnZ);
        if (ds < c.retBest - 0.05) { c.retBest = ds; c.retStall = 0; } else c.retStall += dt;
        let home = this._moveTo(c, c.spawnX, c.spawnZ, 'run', dt, 0.3);
        // blocked on the way home (a prop / creature / the player on the spot): never stay immune forever - end the evade
        // where it stands when that is inside the camp, else keep trying and finally snap back to the spawn point
        if (!home && c.retStall > RETURN_STALL && dh <= c.home.r) home = true;
        else if (!home && c.retT > RETURN_TIMEOUT) { c.x = c.spawnX; c.z = c.spawnZ; home = true; }
        if (home) { c.st = 'idle'; c.speed = 0; c.vx = c.vz = 0; c.hp = c.maxHp; c.threat.clear(); c.aiT = this.rnd(1, 3); this.events.push({ type: 'reset', id: c.id }); }
        return;
      }
      // aggressive species notice players
      if (!c.target && B.aggro > 0) {
        let best = null, bd = B.aggro;
        for (const p of this.players.values()) { if (!p.alive) continue; const d = Math.hypot(p.x - c.x, p.z - c.z); if (d < bd) { bd = d; best = p; } }
        if (best) {
          if (B.type === 'ambush' && c.alert < (B.raise || 0.6)) { c.alert += dt; c.speed = 0; this._face(c, best.x, best.z, dt); if (c.alert > 0 && !c.flags.raised) { c.flags.raised = true; this.events.push({ type: 'alert', id: c.id }); } return; }
          this._aggro(c, best.id, false);
        } else if (c.alert > 0) { c.alert = Math.max(0, c.alert - dt); if (c.alert === 0) c.flags.raised = false; }
      }
      if (c.target) return this._combat(c, dt);
      // ---- peaceful: roam inside the camp ----
      if (c.dest) {
        c.destT -= dt;                                        // a leg whose end is blocked (prop, fence, another creature) gives up instead of walking in place
        if (this._moveTo(c, c.dest.x, c.dest.z, c.destMode || 'walk', dt, 0.15) || c.destT <= 0) { c.dest = null; c.aiT = this.rnd(B.pause[0], B.pause[1]); }
        return;
      }
      c.speed = 0; c.vx = c.vz = 0; c.st = 'idle';
      if (c.aiT <= 0 && B.roam > 0) {
        const a = this.R() * TAU, r = this.rnd(B.dash[0], B.dash[1]);
        let tx = c.x + Math.cos(a) * r, tz = c.z + Math.sin(a) * r;
        const dx = tx - c.home.x, dz = tz - c.home.z, dd = Math.hypot(dx, dz);
        if (dd > B.roam) { tx = c.home.x + dx / dd * B.roam; tz = c.home.z + dz / dd * B.roam; }
        c.dest = { x: tx, z: tz };
        // rats skitter (short runs), rabbits hop-run, the rest walk
        c.destMode = B.type === 'skitter' ? (this.R() < 0.55 ? 'run' : 'walk') : B.type === 'evasive' ? (this.R() < 0.4 ? 'run' : 'walk') : 'walk';
        c.destT = Math.hypot(tx - c.x, tz - c.z) / c.D.speed[c.destMode] * 1.3 + 0.6;   // time budget for the leg (turn + walk + margin)
        c.st = 'roam';
      }
    }
    _goHome(c) { c.st = 'return'; c.act = null; c.dest = null; c.alert = 0; c.flags.raised = false; c.retT = 0; c.retBest = Infinity; c.retStall = 0; this.events.push({ type: 'leash', id: c.id }); }

    _combat(c, dt) {
      const B = c.D.behavior, p = this.players.get(c.target);
      const dx = p.x - c.x, dz = p.z - c.z, dist = Math.hypot(dx, dz), gap = dist - p.radius - c.D.radius;
      c.st = 'chase';
      // enrage (boss) - a one-shot special at the HP threshold
      if (B.enrageAt && !c.enraged && c.hp / c.maxHp <= B.enrageAt) { c.enraged = true; return this._startAttack(c, 'enrage', p); }
      // choose an attack whose use range covers the current gap and is off cooldown
      const pick = this._pickAttack(c, gap);
      if (pick) {
        const a = c.D.attacks[pick];
        const facing = Math.abs(angD(Math.atan2(dx, dz), c.yaw));
        if (facing < (a.charge ? 0.25 : 0.6)) return this._startAttack(c, pick, p);
        this._face(c, p.x, p.z, dt); c.speed = 0; c.vx = c.vz = 0;
        return;
      }
      const melee = c.D._melee || (c.D._melee = Math.min(...Object.values(c.D.attacks).filter((a) => !a.special && a.use[0] <= 0.01).map((a) => a.use[1])));   // cached per species
      switch (B.type) {
        case 'skitter': {                                     // erratic darting: zig-zag approach, brief hesitations
          if (c.aiT <= 0) { c.zig = (this.R() - 0.5) * 1.6; c.aiT = this.rnd(0.25, 0.7); c.hes = this.R() < 0.18 ? this.rnd(0.15, 0.4) : 0; }
          if (c.hes > 0) { c.hes -= dt; c.speed = 0; this._face(c, p.x, p.z, dt); return; }
          const a = Math.atan2(dx, dz) + (gap > 1.2 ? c.zig : 0);
          return this._moveDir(c, a, gap > melee * 0.8 ? 'run' : 'walk', dt, gap - melee * 0.6);
        }
        case 'evasive': {                                     // keeps hopping out of reach, darts in to kick
          if (c.evadeT > 0) {
            c.evadeT -= dt;
            const away = Math.atan2(-dx, -dz) + c.orbitDir * 0.9;
            return this._moveDir(c, away, 'run', dt, 9);
          }
          if (gap < B.dodge && !(c.cd.dodge > 0)) {
            if (!c.cd.kick || c.cd.kick > 0.2) { c.evadeT = this.rnd(0.45, 0.8); c.cd.dodge = this.rnd(2.2, 3.4); c.orbitDir = -c.orbitDir; return; }
          }
          return this._moveDir(c, Math.atan2(dx, dz), 'run', dt, gap - melee * 0.6);
        }
        case 'ambush': {                                      // short pursuit only; mostly strikes from where it lies
          if (gap > 2.5) return this._moveDir(c, Math.atan2(dx, dz), 'run', dt, gap - melee * 0.7);
          return this._moveDir(c, Math.atan2(dx, dz), 'walk', dt, gap - melee * 0.7);
        }
        case 'pack': {                                        // circle at the orbit radius, flank, then lunge in
          const orbit = B.orbit, want = Math.atan2(-dx, -dz) + c.orbitDir * 0.55;
          if (c.aiT <= 0) { c.aiT = this.rnd(1.2, 2.6); if (this.R() < 0.3) c.orbitDir = -c.orbitDir; }
          const ox = p.x + Math.sin(want) * orbit, oz = p.z + Math.cos(want) * orbit;
          if (gap > orbit + 2.5) return this._moveDir(c, Math.atan2(dx, dz), 'run', dt, 99);
          this._moveTo(c, ox, oz, 'stalk', dt, 0.2);
          this._face(c, p.x, p.z, dt * 0.7);
          return;
        }
        case 'skirmisher': {                                  // controlled: approach, strafe a little between attacks
          if (gap > melee * 0.9) return this._moveDir(c, Math.atan2(dx, dz), gap > 3 ? 'run' : 'walk', dt, gap - melee * 0.6);
          if (c.aiT <= 0) { c.aiT = this.rnd(0.7, 1.4); c.orbitDir = this.R() < 0.5 ? 1 : -1; }
          const side = Math.atan2(dx, dz) + c.orbitDir * Math.PI / 2;
          this._moveDir(c, side, 'walk', dt, 0.6, true);
          this._face(c, p.x, p.z, dt);
          return;
        }
        default:                                             // charger / boss: straight at the target
          return this._moveDir(c, Math.atan2(dx, dz), gap > 2.5 ? 'run' : 'walk', dt, gap - melee * 0.6);
      }
    }
    _pickAttack(c, gap) {
      let best = null, bestScore = -1;
      gap = Math.max(0, gap);                                 // already in contact counts as zero gap
      for (const id in c.D.attacks) {
        const a = c.D.attacks[id];
        if (a.special || (c.cd[id] || 0) > 0) continue;
        if (gap < a.use[0] || gap > a.use[1]) continue;
        const score = (a.charge ? 3 : 0) + (a.aoe ? 2 : 0) + a.cd * 0.1 + this.R() * 0.5;
        if (score > bestScore) { bestScore = score; best = id; }
      }
      return best;
    }
    _startAttack(c, id, p) {
      const a = c.D.attacks[id];
      c.act = { id, def: a, t: 0, x0: c.x, z0: c.z, yaw: c.yaw, hitSet: new Set(), lungeDone: 0, tx: p.x, tz: p.z };
      c.speed = 0; c.vx = c.vz = 0;
      this.events.push({ type: 'attack', id: c.id, attack: id, dur: a.dur, target: p.id, tx: p.x, tz: p.z, telegraph: a.telegraph || null, reach: a.reach, yaw: c.yaw });
    }
    _tickAttack(c, dt) {
      const A = c.act, a = A.def, u0 = A.t / a.dur;
      const k = c.enraged ? 1.15 : 1;
      A.t += dt * k;
      const u = Math.min(1, A.t / a.dur);
      const p = this.players.get(c.target);
      // tracking: turn toward the target during anticipation / wind-up, the strike direction locks at the active start
      if (p && u < a.phases.wu) { this._face(c, p.x, p.z, dt * (a.charge ? 1.6 : 1.2)); A.yaw = c.yaw; A.tx = p.x; A.tz = p.z; }
      // authoritative root motion along the locked facing (never through the target)
      const s1 = DEFS.lungeAt(a, u), ds = s1 - A.lungeDone;
      if (ds !== 0) {
        let step = ds;
        if (p && !a.charge && ds > 0) {
          const fx = Math.sin(A.yaw), fz = Math.cos(A.yaw);
          const ahead = (p.x - c.x) * fx + (p.z - c.z) * fz, minGap = p.radius + (c.D.front || c.D.radius) * 0.85;   // the snout stops at the target
          step = Math.min(step, Math.max(0, ahead - minGap));
        }
        c.x += Math.sin(A.yaw) * step; c.z += Math.cos(A.yaw) * step; A.lungeDone = s1;
        c.speed = Math.abs(ds) / Math.max(dt, 1e-4);
      } else c.speed = 0;
      c.yaw = A.yaw;
      // active window: the ONLY place a creature attack can register damage
      if (u >= a.active[0] && u0 <= a.active[1] && a.reach > 0) {
        for (const pl of this.players.values()) {
          if (!pl.alive || A.hitSet.has(pl.id)) continue;
          if (!a.aoe && !a.charge && pl.id !== c.target) continue;
          if (!DEFS.validateHit({ x: c.x, z: c.z, yaw: c.yaw, radius: c.D.radius }, { x: pl.x, z: pl.z, radius: pl.radius }, a)) continue;
          A.hitSet.add(pl.id);
          let dmg = DEFS.damageFor(c.sp, A.id, c.level, this.R());
          if (c.enraged) dmg = Math.round(dmg * 1.25);
          this.events.push({ type: 'hit', id: c.id, attack: A.id, target: pl.id, damage: dmg, heavy: !!a.heavy, dirX: Math.sin(c.yaw), dirZ: Math.cos(c.yaw) });
          if (a.charge) A.t = Math.max(A.t, a.phases.fo * a.dur);    // a charge stops on impact
        }
      }
      if (u >= 1) {
        c.cd[A.id] = a.cd * (c.enraged ? 0.7 : 1) * this.rnd(0.9, 1.2);
        if (A.id === 'enrage') this.events.push({ type: 'enraged', id: c.id });
        c.act = null; c.speed = 0;
        if (c.D.behavior.type === 'pack') { c.aiT = this.rnd(0.8, 1.6); c.orbitDir = this.R() < 0.5 ? 1 : -1; }
      }
    }

    /* ---------------- movement helpers ---------------- */
    _face(c, x, z, dt) {
      const want = Math.atan2(x - c.x, z - c.z);
      c.yaw += clamp(angD(want, c.yaw), -c.D.turn * dt, c.D.turn * dt);
    }
    _moveDir(c, ang, mode, dt, maxDist, strafe) {
      const spd = (c.D.speed[mode] || c.D.speed.run) * (c.enraged ? 1.25 : 1);
      if (maxDist <= 0.02) { c.speed = 0; c.vx = c.vz = 0; return true; }
      if (!strafe) c.yaw += clamp(angD(ang, c.yaw), -c.D.turn * dt, c.D.turn * dt);
      // move mostly along the facing (no moon-walking); strafing moves along `ang` while facing the target
      const dir = strafe ? ang : c.yaw, align = strafe ? 1 : Math.max(0, Math.cos(angD(ang, c.yaw)));
      const step = Math.min(maxDist, spd * dt * (0.25 + 0.75 * align));
      c.x += Math.sin(dir) * step; c.z += Math.cos(dir) * step;
      c.mode = mode; c.speed = step / Math.max(dt, 1e-4); c.vx = Math.sin(dir) * c.speed; c.vz = Math.cos(dir) * c.speed;
      return false;
    }
    _moveTo(c, x, z, mode, dt, tol) {
      const dx = x - c.x, dz = z - c.z, d = Math.hypot(dx, dz);
      if (d < tol) { c.speed = 0; c.vx = c.vz = 0; return true; }
      this._moveDir(c, Math.atan2(dx, dz), mode, dt, d);
      return false;
    }
    // soft separation: creatures do not stack, nobody walks into players or static obstacles.
    // Only awake creatures are processed; neighbours come from a spatial hash (cell >= 4 m, 3x3 query) instead of O(n^2).
    _cellKey(x, z) { const c = this._cell; return (Math.floor(x / c) + 32768) * 65536 + (Math.floor(z / c) + 32768); }
    _buildObsGrid() {
      const g = new Map(), pad = this._maxR + 0.5, c = this._cell;
      for (const o of this.obstacles) {
        const x0 = Math.floor((o.x - o.r - pad) / c), x1 = Math.floor((o.x + o.r + pad) / c), z0 = Math.floor((o.z - o.r - pad) / c), z1 = Math.floor((o.z + o.r + pad) / c);
        for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
          const k = (ix + 32768) * 65536 + (iz + 32768); let l = g.get(k); if (!l) g.set(k, l = []); l.push(o);
        }
      }
      this._obsGrid = g; this._obsN = this.obstacles.length;
    }
    _separate(dt) {
      const L = this.creatures, n = L.length, act = this._act, head = this._head, cand = this._cand, ps = this._pl;
      act.length = 0; head.clear();
      if (this._next.length < n) this._next = new Int32Array(Math.max(n, this._next.length * 2));
      const next = this._next;
      for (let i = 0; i < n; i++) {
        const a = L[i]; if (!a.alive || a.dormant) continue;
        act.push(i);
        const k = this._cellKey(a.x, a.z), h = head.get(k);
        next[i] = h === undefined ? -1 : h; head.set(k, i);
      }
      const obs = this.obstacles, useGrid = obs.length > 12;
      if (useGrid && this._obsN !== obs.length) this._buildObsGrid();
      const cs = this._cell;
      for (let q = 0; q < act.length; q++) {
        const i = act[q], a = L[i];
        // neighbours with a higher index (same pair order as the old double loop: pushes made earlier are seen by later pairs)
        cand.length = 0;
        const cx = Math.floor(a.x / cs), cz = Math.floor(a.z / cs);
        for (let ix = cx - 1; ix <= cx + 1; ix++) for (let iz = cz - 1; iz <= cz + 1; iz++) {
          let j = head.get((ix + 32768) * 65536 + (iz + 32768));
          if (j === undefined) continue;
          for (; j >= 0; j = next[j]) if (j > i) cand.push(j);
        }
        if (cand.length > 1) cand.sort((u, v) => u - v);
        for (let m = 0; m < cand.length; m++) {
          const b = L[cand[m]];
          const dx = b.x - a.x, dz = b.z - a.z, d2 = dx * dx + dz * dz, r = (a.D.radius + b.D.radius) * 0.9;
          if (d2 > r * r || d2 < 1e-8) continue;
          const d = Math.sqrt(d2), push = (r - d) * 0.5, nx = dx / d, nz = dz / d;
          const wa = a.D.mass / (a.D.mass + b.D.mass);
          a.x -= nx * push * (1 - wa) * 2; a.z -= nz * push * (1 - wa) * 2; b.x += nx * push * wa * 2; b.z += nz * push * wa * 2;
        }
        for (let m = 0; m < ps.length; m++) {
          const p = ps[m];
          const dx = a.x - p.x, dz = a.z - p.z, d = Math.hypot(dx, dz);
          // long bodies: the extent toward the player blends from the body radius (side) to the snout (front)
          const fwd = d > 1e-6 ? Math.max(0, -(Math.sin(a.yaw) * dx + Math.cos(a.yaw) * dz) / d) : 0;
          const r = (a.D.radius + ((a.D.front || a.D.radius) - a.D.radius) * fwd + p.radius) * 0.85;
          if (d < r && d > 1e-6) { a.x = p.x + dx / d * r; a.z = p.z + dz / d * r; }
        }
        if (useGrid) {
          const l = this._obsGrid.get(this._cellKey(a.x, a.z));
          if (l) for (const o of l) {
            const dx = a.x - o.x, dz = a.z - o.z, d = Math.hypot(dx, dz), r = a.D.radius + o.r;
            if (d < r && d > 1e-6) { a.x = o.x + dx / d * r; a.z = o.z + dz / d * r; }
          }
        } else for (let m = 0; m < obs.length; m++) {
          const o = obs[m];
          const dx = a.x - o.x, dz = a.z - o.z, d = Math.hypot(dx, dz), r = a.D.radius + o.r;
          if (d < r && d > 1e-6) { a.x = o.x + dx / d * r; a.z = o.z + dz / d * r; }
        }
        if (this.collide) { const p = this._cp; p.x = a.x; p.z = a.z; this.collide(p, a.D.radius * 0.8); a.x = p.x; a.z = p.z; }
      }
    }

    /* ---------------- replication ---------------- */
    // compact state for clients (what a server would broadcast every network tick)
    snapshot() {
      return this.creatures.map((c) => ({
        id: c.id, sp: c.sp, lv: c.level, x: +c.x.toFixed(3), z: +c.z.toFixed(3), yaw: +c.yaw.toFixed(3), hp: c.hp, maxHp: c.maxHp,
        st: c.st, mode: c.mode, spd: +c.speed.toFixed(2), act: c.act ? { id: c.act.id, t: +c.act.t.toFixed(3) } : null,
        alive: c.alive, despawned: c.despawned, stun: c.stun > 0, enraged: c.enraged, alert: c.alert > 0, target: c.target, seq: c.seq,
      }));
    }
    drainEvents() { const e = this.events; this.events = []; return e; }
  }

  global.CreatureSim = CreatureSim;
})(typeof window !== 'undefined' ? window : globalThis);
