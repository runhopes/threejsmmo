/* TDS MOBA - creature gameplay definitions (levels 1-10). PURE DATA, no three.js: shared by the authoritative
 * simulation (creatures/sim.js, could run on a server unchanged) and by the client animation, which keys every attack
 * pose on the SAME phase numbers so what the player sees lines up with when the server registers the hit.
 *
 * Attack timeline (normalised u = t / dur), named instants used by both sides:
 *   s = 0 start | an = anticipation peak | wu = wind-up end (active starts) | hit = strike | fo = follow-through end | e = 1
 *   active: [u0, u1] = the only window in which the simulation may register a hit (once per attack)
 *   reach / cosArc: validated against the target at the moment of the hit (Knight.validateMeleeHit semantics)
 *   lunge: root motion (m) during [wu, fo] - authoritative, the view just follows the position
 *   radius = body circle for separation / hit capsules, front = root-to-snout extent (long bodies stop with the HEAD at the target)
 */
(function (global) {
  'use strict';
  const A = (dur, an, wu, hit, fo, active, o) => Object.assign({ dur, phases: { s: 0, an, wu, hit, fo, e: 1 }, active }, o);

  const SPECIES = {
    rat: {
      scale: 3.6,
      name: 'Çayır Sıçanı', en: 'Meadow Rat', levels: [1, 2], hp: 260, hpLv: 70, exp: 260, expLv: 60,
      radius: 0.32, front: 0.36, height: 0.42, mass: 0.2, poise: 0,            // poise 0: every hit interrupts it
      speed: { walk: 0.75, run: 3.6 }, turn: 9,
      behavior: { type: 'skitter', aggro: 0, assist: 5, leash: 13, roam: 3.5, pause: [0.6, 2.4], dash: [0.4, 1.5] },
      attacks: {
        bite: A(0.78, 0.2, 0.42, 0.5, 0.66, [0.44, 0.56], { reach: 0.62, cosArc: 0.35, dmg: [34, 46], dmgLv: 9, cd: 1.15, use: [0, 0.75], lunge: 0.22 }),
      },
      corpse: 9, respawn: [14, 20],
      loot: [{ id: 'rat_tail', name: 'Sıçan Kuyruğu', p: 0.4 }],
    },
    rabbit: {
      scale: 3,
      name: 'Yaban Tavşanı', en: 'Wild Rabbit', levels: [2, 3], hp: 340, hpLv: 80, exp: 360, expLv: 70,
      radius: 0.3, front: 0.3, height: 0.5, mass: 0.25, poise: 0,
      speed: { walk: 1.1, run: 4.6 }, turn: 10,
      behavior: { type: 'evasive', aggro: 0, assist: 0, leash: 15, roam: 4.5, pause: [1.2, 3.5], dash: [0.8, 2.2], dodge: 2.4 },
      attacks: {
        kick: A(0.72, 0.24, 0.4, 0.47, 0.62, [0.4, 0.52], { reach: 0.7, cosArc: -0.2, dmg: [44, 58], dmgLv: 10, cd: 1.6, use: [0, 0.8], lunge: -0.15, backKick: true }),
      },
      corpse: 9, respawn: [14, 22],
      loot: [{ id: 'rabbit_pelt', name: 'Tavşan Postu', p: 0.35 }],
    },
    snake: {
      scale: 2.6,
      name: 'Çayır Yılanı', en: 'Meadow Snake', levels: [3, 4], hp: 520, hpLv: 110, exp: 520, expLv: 90,
      radius: 0.38, front: 0.45, height: 0.5, mass: 0.3, poise: 0.3,
      speed: { walk: 0.9, run: 2.3 }, turn: 5,
      behavior: { type: 'ambush', aggro: 4.2, assist: 0, leash: 7, roam: 0, pause: [6, 12], dash: [0.5, 1.2], raise: 0.7 },
      attacks: {
        strike: A(0.86, 0.22, 0.46, 0.53, 0.7, [0.48, 0.58], { reach: 1.15, cosArc: 0.55, dmg: [70, 88], dmgLv: 14, cd: 1.7, use: [0, 1.0], lunge: 0.35 }),   // reach = what the fangs visibly cover
      },
      corpse: 10, respawn: [16, 24],
      loot: [{ id: 'snake_skin', name: 'Yılan Derisi', p: 0.35 }],
    },
    boar: {
      scale: 1.65,
      name: 'Yaban Domuzu', en: 'Wild Boar', levels: [4, 6], hp: 980, hpLv: 170, exp: 880, expLv: 140,
      radius: 0.62, front: 0.85, height: 1.0, mass: 1, poise: 0.55,
      speed: { walk: 1.15, run: 3.8, charge: 7.2 }, turn: 5,
      behavior: { type: 'charger', aggro: 6.5, assist: 0, leash: 18, roam: 5, pause: [2, 5], dash: [1.5, 3.5], chargeMin: 4.0, chargeMax: 11 },
      attacks: {
        tusk: A(0.95, 0.22, 0.46, 0.53, 0.72, [0.47, 0.6], { reach: 1.25, cosArc: 0.3, dmg: [112, 140], dmgLv: 20, cd: 1.5, use: [0, 1.15], lunge: 0.3 }),
        charge: A(1.75, 0.2, 0.36, 0.5, 0.82, [0.36, 0.8], { reach: 1.15, cosArc: 0.2, dmg: [170, 210], dmgLv: 26, cd: 6, use: [4, 11], lunge: 6.4, charge: true, heavy: true }),
      },
      corpse: 11, respawn: [20, 30],
      loot: [{ id: 'boar_tusk', name: 'Domuz Dişi', p: 0.3 }],
    },
    wolf: {
      scale: 1.6,
      name: 'Bozkır Kurdu', en: 'Steppe Wolf', levels: [6, 8], hp: 1350, hpLv: 220, exp: 1300, expLv: 190,
      radius: 0.55, front: 0.82, height: 0.95, mass: 0.8, poise: 0.45,
      speed: { walk: 1.3, run: 5.6, stalk: 1.6 }, turn: 7,
      behavior: { type: 'pack', aggro: 9, assist: 9, leash: 22, roam: 6, pause: [2, 6], dash: [1.5, 3.5], orbit: 3.2 },
      attacks: {
        lunge: A(1.0, 0.24, 0.44, 0.52, 0.72, [0.46, 0.6], { reach: 1.45, cosArc: 0.45, dmg: [150, 186], dmgLv: 24, cd: 2.0, use: [0.6, 2.6], lunge: 1.5 }),
      },
      corpse: 12, respawn: [22, 32],
      loot: [{ id: 'wolf_fang', name: 'Kurt Dişi', p: 0.3 }],
    },
    goblin: {
      scale: 1.6,
      name: 'Goblin Akıncı', en: 'Goblin Raider', levels: [8, 9], hp: 1900, hpLv: 280, exp: 1900, expLv: 240,
      radius: 0.42, front: 0.36, height: 1.4, mass: 0.6, poise: 0.5,
      speed: { walk: 1.2, run: 4.4 }, turn: 9,
      behavior: { type: 'skirmisher', aggro: 8.5, assist: 8, leash: 20, roam: 5, pause: [2, 5], dash: [1.2, 3], strafe: 1.8 },
      attacks: {
        stab: A(0.9, 0.2, 0.42, 0.5, 0.68, [0.44, 0.56], { reach: 1.15, cosArc: 0.5, dmg: [170, 205], dmgLv: 26, cd: 1.35, use: [0, 1.0], lunge: 0.35 }),
        slash: A(1.15, 0.24, 0.42, 0.5, 0.74, [0.42, 0.6], { reach: 1.2, cosArc: 0.1, dmg: [200, 245], dmgLv: 30, cd: 3.2, use: [0, 1.0], lunge: 0.45 }),
      },
      corpse: 12, respawn: [24, 34],
      loot: [{ id: 'goblin_dagger', name: 'Paslı Hançer', p: 0.15 }],
    },
    spikeback: {
      scale: 1.55,
      name: 'Dikensırt', en: 'Spikeback Boar', levels: [10, 10], boss: true, hp: 9500, hpLv: 0, exp: 7000, expLv: 0,
      radius: 0.95, front: 1.25, height: 1.65, mass: 3, poise: 0.85, staggerAt: [0.66, 0.33],   // staggers when HP crosses these
      speed: { walk: 1.2, run: 4.1, charge: 8.0 }, turn: 3.6,
      behavior: { type: 'boss', aggro: 10, assist: 0, leash: 26, roam: 3, pause: [3, 7], dash: [1.5, 3], enrageAt: 0.4, chargeMin: 5, chargeMax: 13 },
      attacks: {
        sweep: A(1.6, 0.3, 0.52, 0.58, 0.76, [0.53, 0.66], { reach: 2.1, cosArc: -0.1, dmg: [330, 390], dmgLv: 0, cd: 2.6, use: [0, 2.0], lunge: 0.35, heavy: true, telegraph: 'cone' }),
        stomp: A(1.85, 0.34, 0.6, 0.64, 0.78, [0.6, 0.68], { reach: 3.4, cosArc: -1, dmg: [280, 330], dmgLv: 0, cd: 7, use: [0, 2.6], lunge: 0, heavy: true, telegraph: 'ring', aoe: true }),
        charge: A(2.3, 0.3, 0.44, 0.55, 0.84, [0.44, 0.82], { reach: 1.6, cosArc: 0.2, dmg: [420, 480], dmgLv: 0, cd: 9, use: [5, 13], lunge: 9.5, charge: true, heavy: true, telegraph: 'line' }),
        enrage: A(2.0, 0.25, 0.45, 0.55, 0.8, [1.1, 1.2], { reach: 0, cosArc: 1, dmg: [0, 0], cd: 999, use: [-1, -1], lunge: 0, special: true }),
      },
      corpse: 20, respawn: [60, 75],
      loot: [{ id: 'spike_bristle', name: 'Sertleşmiş Kıl', p: 1 }],
    },
  };

  /* Game scale: creatures are PLAYER-SIZED (the player is ~1.95 m): goblin ~1.9 m, wolf / boar heads ~1.6 m, the boss
   * ~2.7 m, rat / rabbit / snake are giant breeds ~1-1.3 m tall (readable, clickable, hittable by every skill). Everything geometric scales with it; speeds scale with sqrt(scale) (Froude similarity: a bigger animal
   * moving proportionally faster keeps the same natural stride timing; capped at x1.25 for gameplay). Values above are authored at scale 1. */
  function applyGameScale(S) {                                                    // exactly once per def
    const s = S.scale || 1, sv = Math.min(Math.sqrt(s), 1.25);                    // speed growth capped: player-sized mobs must not outrun the player
    S.radius *= s; S.front *= s; S.height *= s;
    for (const k in S.speed) S.speed[k] *= sv;
    for (const a of Object.values(S.attacks)) { a.reach *= s; if (!a.charge) a.lunge *= s; }
    S._scaled = true;
    return S;
  }
  for (const id in SPECIES) applyGameScale(SPECIES[id]);
  // a NEW base species (species files loaded after defs.js, e.g. bear.js): authored at scale 1 like the table above; the game
  // scale is applied here, once. Returns the def.
  function addSpecies(id, def) {
    if (SPECIES[id]) throw new Error('species already defined: ' + id);
    SPECIES[id] = def;
    return def._scaled ? def : applyGameScale(def);
  }

  /* ---------------- VARIANTS (levels 5-18) ----------------
   * A variant is a base species at another size / tint with its own gameplay numbers (own name, levels, hp, exp, damage, loot,
   * respawn, optional boss flag). Visuals: CreatureKit.defineVariant (creatures/variants.js) registers a thin renderer entry that
   * shares the base's geometry / rig / animator / attack animations; here (pure data, so the server / simtest see it too) the
   * def is DERIVED from the already game-scaled base def: deep copy, geometry (radius / front / height / reach / non-charge lunge)
   * x the variant multiplier, speeds by the same capped sqrt rule as above, attack timings / phases unchanged (they drive the animation).
   * Tuning model (mobs keep the progression curve of the base roster):
   *   hp   = HP_CURVE(level) x hpMul        (curve: ~2400 @10, 3300 @12, 4500 @14, 6000 @16, 7800 @18; wolf 6 = 1350 sits on it)
   *   dmg  = the base attack set scaled so the PRIMARY attack averages dps x warrior max HP(minLevel) x cooldown per hit
   *          (warrior reference: 3400 hp x 1.08 per level, index.html); +8 % of that per level inside the band
   *   exp  = expFrac x EXP_NEED(level)      (index.html: the next level needs 1500 + 900 x level)
   * Bosses use absolute hp, fixed damage (no per-level term) and keep the base species' attack set. */
  const HP_ANCHORS = [[5, 1135], [10, 2400], [12, 3300], [14, 4500], [16, 6000], [18, 7800]];
  function hpCurve(lv) {                                     // log-linear between anchors, 1.16 / level below the first anchor
    const A = HP_ANCHORS;
    if (lv <= A[0][0]) return A[0][1] * Math.pow(1.16, lv - A[0][0]);
    for (let i = 1; i < A.length; i++) if (lv <= A[i][0]) { const k = (lv - A[i - 1][0]) / (A[i][0] - A[i - 1][0]); return A[i - 1][1] * Math.pow(A[i][1] / A[i - 1][1], k); }
    return A[A.length - 1][1] * Math.pow(1.14, lv - A[A.length - 1][0]);
  }
  const warriorHp = (lv) => 3400 * Math.pow(1.08, lv - 1);
  const expNeed = (lv) => 1500 + 900 * lv;
  const rd = (v, step) => Math.round(v / (step || 1)) * (step || 1);
  // base: base species id | scale: size multiplier | tint: colour multiplier | hpMul (or hp for bosses) | dps: share of the
  // warrior's max HP per second for the primary attack | expFrac: share of the level's EXP need per kill | loot: [id, Turkish name]
  const VARIANT_SPECS = [
    { id: 'rat_swamp', base: 'rat', name: 'Bataklık Sıçanı', en: 'Marsh Rat', levels: [7, 9], scale: 1.25, tint: [0.62, 0.78, 0.5], hpMul: 0.62, dps: 0.014, expFrac: 0.12, loot: ['rat_swamp_tooth', 'Bataklık Sıçanı Dişi'] },
    { id: 'rabbit_king', base: 'rabbit', name: 'Tavşan Kral Uzunkulak', en: 'Rabbit King Longear', levels: [5, 5], scale: 1.8, tint: [1.25, 1.2, 1.1], boss: true, hp: 3500, dps: 0.03, expFrac: 0.7, respawn: [90, 120], corpse: 14,
      behavior: { aggro: 5.5, leash: 22, roam: 5 }, loot: ['king_ear', 'Kral Tavşan Kulağı'] },
    { id: 'snake_marsh', base: 'snake', name: 'Bataklık Kobrası', en: 'Marsh Cobra', levels: [10, 12], scale: 1.3, tint: [0.5, 0.75, 0.45], hpMul: 0.8, dps: 0.018, expFrac: 0.16, loot: ['cobra_gland', 'Kobra Zehir Kesesi'] },
    { id: 'snake_dune', base: 'snake', name: 'Kanyon Çıngıraklısı', en: 'Canyon Rattler', levels: [13, 15], scale: 1.4, tint: [1.3, 1.0, 0.6], hpMul: 0.8, dps: 0.021, expFrac: 0.17, loot: ['rattle_tail', 'Çıngırak Kuyruğu'] },
    { id: 'boar_black', base: 'boar', name: 'Kara Domuz', en: 'Black Boar', levels: [11, 13], scale: 1.12, tint: [0.55, 0.5, 0.55], hpMul: 1.0, dps: 0.024, expFrac: 0.2, loot: ['black_bristle', 'Kara Kıl Demeti'] },
    { id: 'boar_iron', base: 'boar', name: 'Demirdişli Domuz', en: 'Irontusk Boar', levels: [15, 17], scale: 1.22, tint: [0.7, 0.82, 1.05], hpMul: 1.05, dps: 0.026, expFrac: 0.21, loot: ['iron_tusk', 'Demir Diş'] },
    { id: 'wolf_dark', base: 'wolf', name: 'Gölge Kurdu', en: 'Shadow Wolf', levels: [9, 11], scale: 1.08, tint: [0.5, 0.5, 0.58], hpMul: 0.95, dps: 0.021, expFrac: 0.21, loot: ['shadow_pelt', 'Gölge Postu'] },
    { id: 'wolf_alpha', base: 'wolf', name: 'Alfa Kurt Karakulak', en: 'Alpha Blackear', levels: [12, 12], scale: 1.5, tint: [0.35, 0.35, 0.42], boss: true, hp: 11000, dps: 0.032, cdMul: 0.9, expFrac: 0.7, respawn: [90, 120], corpse: 14,
      behavior: { aggro: 11, assist: 11, leash: 28 }, loot: ['alpha_claw', 'Alfa Kurt Pençesi'] },
    { id: 'wolf_frost', base: 'wolf', name: 'Kış Kurdu', en: 'Winter Wolf', levels: [14, 16], scale: 1.15, tint: [1.9, 2.0, 2.3], hpMul: 1.0, dps: 0.024, expFrac: 0.22, loot: ['frost_fur', 'Buz Kürkü'] },
    { id: 'goblin_warrior', base: 'goblin', name: 'Goblin Savaşçı', en: 'Goblin Warrior', levels: [10, 12], scale: 1.08, tint: [0.8, 1.0, 0.7], hpMul: 1.0, dps: 0.024, expFrac: 0.22, loot: ['goblin_badge', 'Savaşçı Rozeti'] },
    { id: 'goblin_brute', base: 'goblin', name: 'Goblin Kabadayı', en: 'Goblin Brute', levels: [12, 14], scale: 1.3, tint: [1.15, 0.8, 0.7], hpMul: 1.2, dps: 0.027, cdMul: 1.15, expFrac: 0.24, loot: ['brute_club', 'Kabadayı Tokmağı'] },
    { id: 'goblin_chief', base: 'goblin', name: 'Goblin Reisi Kemikkıran', en: 'Goblin Chief Bonebreaker', levels: [13, 13], scale: 1.5, tint: [1.2, 0.7, 0.6], boss: true, hp: 13000, dps: 0.034, cdMul: 1.1, expFrac: 0.7, respawn: [90, 120], corpse: 14,
      behavior: { aggro: 11, assist: 11, leash: 28 }, loot: ['bonebreaker_charm', 'Kemikkıran Tılsımı'] },
    { id: 'goblin_frost', base: 'goblin', name: 'Buz Goblini', en: 'Frost Goblin', levels: [16, 18], scale: 1.12, tint: [0.7, 0.95, 1.5], hpMul: 1.05, dps: 0.028, expFrac: 0.24, loot: ['frost_charm', 'Buz Tılsımı'] },
    // variants of the new bodies (bear / panther / troll): the frost valley's top levels
    { id: 'bear_polar', base: 'bear', name: 'Kutup Ayısı', en: 'Polar Bear', levels: [16, 18], scale: 1.18, tint: [1.9, 1.95, 2.1], hpMul: 1.05, dps: 0.029, expFrac: 0.26, loot: ['polar_claw', 'Kutup Pençesi'] },
    { id: 'panther_snow', base: 'panther', name: 'Kar Pumazı', en: 'Snow Cougar', levels: [15, 17], scale: 1.1, tint: [1.7, 1.75, 1.9], hpMul: 1.0, dps: 0.027, expFrac: 0.24, loot: ['snow_fang', 'Kar Pumazı Dişi'] },
    { id: 'troll_frost', base: 'troll', name: 'Buz Trolü', en: 'Frost Troll', levels: [17, 18], scale: 1.12, tint: [0.72, 0.98, 1.5], hpMul: 1.1, dps: 0.03, cdMul: 1.1, expFrac: 0.3, loot: ['troll_ice_heart', 'Buz Kalbi'] },
    { id: 'spike_red', base: 'spikeback', name: 'Kızıl Dikensırt', en: 'Red Spikeback', levels: [14, 14], scale: 1.1, tint: [1.5, 0.7, 0.6], boss: true, hp: 16000, dps: 0.022, expFrac: 0.7, respawn: [90, 110], loot: ['red_spine', 'Kızıl Diken'] },
    { id: 'spike_frost', base: 'spikeback', name: 'Buzsırt', en: 'Frostback', levels: [18, 18], scale: 1.2, tint: [0.9, 1.3, 1.8], boss: true, hp: 30000, dps: 0.022, expFrac: 0.7, respawn: [110, 140], loot: ['frost_spine', 'Buz Dikeni'] },
  ];
  const VARIANTS = {};
  // derive every pending spec whose base species exists (skips silently otherwise); safe to call again after more base species
  // were added (variants.js does, after all species files loaded). Returns the ids derived by this call.
  function deriveVariants() {
    const out = [];
    for (const v of VARIANT_SPECS) {
      if (SPECIES[v.id] || !SPECIES[v.base]) continue;
      deriveVariant(v); out.push(v.id);
    }
    return out;
  }
  // roster hook: add a variant spec (same fields as VARIANT_SPECS above) and derive it if its base is already there
  function addVariant(spec) { VARIANT_SPECS.push(spec); return SPECIES[spec.base] ? (deriveVariant(spec), spec.id) : null; }
  function deriveVariant(v) {
    const B = SPECIES[v.base];
    const m = v.scale, s0 = B.scale || 1, s1 = s0 * m;
    const sv0 = Math.min(Math.sqrt(s0), 1.25), sv1 = Math.min(Math.sqrt(s1), 1.25);
    const S = JSON.parse(JSON.stringify(B));                 // deep copy (attacks, behavior, loot)
    const L0 = v.levels[0], L1 = v.levels[1], span = Math.max(1, L1 - L0);
    S.variantOf = v.base; S.group = B.group || v.base; S.tint = v.tint.slice(); S.sizeMul = m; S.scale = s1;
    S.name = v.name; S.en = v.en; S.levels = v.levels.slice();
    S.radius *= m; S.front *= m; S.height *= m;
    for (const k in S.speed) S.speed[k] *= sv1 / sv0;
    if (v.boss) {
      S.boss = true; S.hp = v.hp; S.hpLv = 0;
      S.exp = rd(v.expFrac * expNeed(L0), 10); S.expLv = 0;
    } else {
      delete S.boss;
      S.hp = rd(hpCurve(L0) * v.hpMul, 5); S.hpLv = rd((hpCurve(L1) - hpCurve(L0)) * v.hpMul / span);
      S.exp = rd(v.expFrac * expNeed(L0), 5); S.expLv = rd(v.expFrac * (expNeed(L1) - expNeed(L0)) / span);
    }
    // damage: the whole base attack set scaled by ONE ratio so the primary attack hits the target share of the warrior's HP
    const ids = Object.keys(S.attacks), bp = B.attacks[ids[0]], baseMid = (bp.dmg[0] + bp.dmg[1]) / 2;
    const ratio = v.dps * warriorHp(L0) * bp.cd * (v.cdMul || 1) / baseMid;
    for (const id of ids) {
      const a = S.attacks[id], ba = B.attacks[id];
      a.reach *= m; if (!a.charge) a.lunge *= m;
      a.dmg = [Math.round(ba.dmg[0] * ratio), Math.round(ba.dmg[1] * ratio)];
      a.dmgLv = v.boss || L1 === L0 ? 0 : Math.round((a.dmg[0] + a.dmg[1]) / 2 * 0.08);
      if (v.cdMul && !a.special) a.cd = Math.round(a.cd * v.cdMul * 100) / 100;
    }
    if (v.behavior) Object.assign(S.behavior, v.behavior);     // bosses: a few overrides (rabbit king hunts, alpha / chief rally their kin)
    S.loot = [{ id: v.loot[0], name: v.loot[1], p: v.boss ? 1 : 0.3 }];
    if (v.respawn) S.respawn = v.respawn.slice();
    if (v.corpse) S.corpse = v.corpse;
    S._scaled = true;
    SPECIES[v.id] = S; VARIANTS[v.id] = { id: v.id, base: v.base, tint: S.tint, scale: m };
  }
  deriveVariants();

  /* Spawn camps (world metres; the player starts at the origin, the progression runs "up" the screen = -Z) */
  const ZONES = [
    { id: 'meadow', name: 'Sıçan Çayırı', species: 'rat', cx: -9, cz: -11, r: 7.5, count: 6 },
    { id: 'warren', name: 'Tavşan İnleri', species: 'rabbit', cx: 10, cz: -14, r: 8.1, count: 5 },
    { id: 'reeds', name: 'Sazlık', species: 'snake', cx: -6, cz: -27, r: 7.5, count: 4 },
    { id: 'oakwood', name: 'Meşe Korusu', species: 'boar', cx: 15, cz: -31, r: 8.8, count: 4 },
    { id: 'steppe', name: 'Kurt Bozkırı', species: 'wolf', cx: -19, cz: -43, r: 9.4, count: 4 },
    { id: 'camp', name: 'Goblin Kampı', species: 'goblin', cx: 7, cz: -53, r: 8.1, count: 4 },
    { id: 'den', name: 'Dikensırt İni', species: 'spikeback', cx: 27, cz: -63, r: 6.3, count: 1 },
  ];

  function statsFor(spId, level) {
    const S = SPECIES[spId], k = level - S.levels[0];
    return { maxHp: Math.round(S.hp + S.hpLv * k), exp: Math.round(S.exp + S.expLv * k), level };
  }
  function damageFor(spId, attackId, level, rnd) {
    const S = SPECIES[spId], a = S.attacks[attackId], k = level - S.levels[0];
    return Math.round((a.dmg[0] + (a.dmg[1] - a.dmg[0]) * rnd) + (a.dmgLv || 0) * k);
  }
  // pure: same semantics as Knight.validateMeleeHit (reach + facing arc), usable on a server
  function validateHit(att, tgt, a) {
    const dx = tgt.x - att.x, dz = tgt.z - att.z, dist = Math.hypot(dx, dz);
    if (dist > a.reach + (tgt.radius || 0) + (att.radius || 0) * 0.5) return false;
    if (a.cosArc <= -1 || dist < 0.3) return true;
    return (Math.sin(att.yaw) * dx + Math.cos(att.yaw) * dz) / dist >= a.cosArc;
  }

  // authoritative root motion of an attack: metres travelled along the facing at normalised time u
  function lungeAt(a, u) {
    const p = a.phases;
    if (!a.lunge) return 0;
    const k = Math.min(1, Math.max(0, (u - p.wu) / Math.max(1e-6, p.fo - p.wu)));
    if (a.charge) {                                   // charge: quick acceleration, steady run, short skid
      const acc = 0.12, dec = 0.25, v = 1 / (1 - acc / 2 - dec / 2);
      const s = k < acc ? 0.5 * v * k * k / acc : k < 1 - dec ? v * (acc / 2 + (k - acc)) : 1 - 0.5 * v * (1 - k) * (1 - k) / dec;
      return a.lunge * Math.min(1, s);
    }
    return a.lunge * k * k * (3 - 2 * k);
  }

  global.CREATURE_DEFS = { SPECIES, ZONES, VARIANTS, VARIANT_SPECS, addSpecies, addVariant, deriveVariants, statsFor, damageFor, validateHit, lungeAt };
})(typeof window !== 'undefined' ? window : globalThis);
