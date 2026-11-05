/* Dev bench for HUD parts (ui/*.js): a real in-game frame as backdrop (bench-bg.jpg) + the HUD fed with SAMPLE state.
 * A bench page loads: ui/fonts.css, hud.css, the part's css, ui/paint.js, the part's js, hud.js, then this file.
 * Query: ?open=<window id> opens a window · ?target=hostile|elite|boss|neutral|none · ?dead=1 · ?low=1 (low hp/mp)
 * Sets document.title = 'ready' after ~1.2 s so tools can screenshot it. Sample data never ships in the game (index.html feeds real state).
 */
(function () {
  const q = new URLSearchParams(location.search);
  document.documentElement.style.cssText += ';margin:0;height:100%;overflow:hidden;background:#20262a url(ui/bench-bg.jpg) center/cover no-repeat';
  if (/\/ui\/[^/]*$/.test(location.pathname)) document.documentElement.style.backgroundImage = 'url(bench-bg.jpg)';
  const ic = (hue, glyph) => '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><defs><radialGradient id="g' + hue + '" cx="50%" cy="38%" r="78%"><stop offset="0" stop-color="hsl(' + hue + ',38%,34%)"/><stop offset="1" stop-color="hsl(' + hue + ',40%,10%)"/></radialGradient></defs>' +
    '<rect width="64" height="64" fill="url(#g' + hue + ')"/><g fill="#E6DFCE" stroke="#14100C" stroke-width="1.6" paint-order="stroke">' + glyph + '</g></svg>';
  const G = ['<circle cx="32" cy="32" r="14"/>', '<path d="M14 46 L32 12 L50 46 Z"/>', '<rect x="18" y="18" width="28" height="28"/>', '<path d="M32 10 L38 28 L56 30 L42 41 L46 58 L32 48 L18 58 L22 41 L8 30 L26 28 Z"/>',
    '<path d="M12 32 h40 M32 12 v40" stroke="#E6DFCE" stroke-width="6"/>', '<circle cx="24" cy="32" r="9"/><circle cx="42" cy="32" r="9"/>', '<path d="M20 12 h24 l-6 40 h-12 Z"/>', '<path d="M32 8 a24 24 0 1 0 1 0 Z M32 20 a12 12 0 1 1 -1 0 Z" fill-rule="evenodd"/>'];
  const project = (x, y, z) => ({ x: x / 6, y: y / 4 - 0.25, z: 0 });
  const hud = GameHUD.create({ project, onSkill: (i) => hud.pressed(i), onEscape: () => false, onToggleWalk: () => { walk = !walk; },
    keys: [['W A S D', 'Hareket'], ['1 – 8', 'Yetenekler']] });
  window.__hud = hud;
  let walk = false;
  hud.setPlayerInfo({ name: 'Savaşçı', title: 'Kılıç Ustası', emblemHTML: ic(30, G[3]) });
  const names = ['Girdap', 'Hamle', 'Yer Sarsıntısı', 'Hilal Dalgası', 'Sıçrama Darbesi', 'Döner Kesik', 'Savaş Narası', 'Demir Beden'];
  const skills = names.map((n, i) => ({ id: 's' + i, name: n, key: String(i + 1), alt: i === 0 ? 'Q' : '', iconHTML: ic([28, 210, 30, 45, 12, 270, 5, 45][i], G[i]),
    mp: [30, 18, 32, 24, 34, 26, 20, 30][i], cd: [8, 6, 10, 7, 12, 9, 22, 26][i], desc: 'Örnek açıklama: yeteneğin ne yaptığını kısaca anlatır.' }));
  hud.setSkills(skills, { id: 'basic', name: 'Kılıç Darbesi', iconHTML: ic(220, G[4]), desc: 'Hedefe sol tık: koşar ve vurur.' });
  hud.show();
  const targets = {
    hostile: { id: 'w1', name: 'Bozkır Kurdu', level: 3, type: 'Canavar', disposition: 'hostile', rank: 'normal', hp: 2100, maxHp: 5200 },
    elite: { id: 'e1', name: 'Mezar Bekçisi', level: 6, type: 'Ölümsüz', disposition: 'hostile', rank: 'elite', hp: 8914, maxHp: 8914 },
    boss: { id: 'b1', name: 'Sırtık Reisi Grumbak', level: 10, type: 'Canavar · Bölge patronu', disposition: 'hostile', rank: 'boss', hp: 412000, maxHp: 980000 },
    neutral: { id: 'dummy', name: 'Eğitim Kuklası', level: 1, type: 'Talim hedefi', disposition: 'neutral', rank: 'normal', hp: 18978, maxHp: 20000 },
  };
  const tk = q.get('target') || 'hostile', low = q.get('low') === '1', dead = q.get('dead') === '1';
  for (const [c, t, tone] of [['system', 'Taşkale bölgesine girdin.', 'sys'], ['system', 'Seviye 4 oldun. Can ve mana yenilendi.', 'lvl'], ['system', 'Savaş Narası etkin (12 sn).', 'buff'],
    ['combat', 'Bozkır Kurdu · 342 hasar', 'dmg'], ['combat', 'Bozkır Kurdu · 1.284 hasar · kritik', 'crit'], ['combat', 'Bozkır Kurdu sana vurdu · 118', 'hurt'], ['system', 'Bozkır Kurdu öldürüldü · +220 tecrübe', 'lvl']]) hud.logLine(c, t, tone);
  hud.setPerf({ fps: 60, tris: 43816 });
  // the game's real top-down world render (index.html captureMapImage), saved as ui/bench-map.jpg
  let mapImage = null;
  const mi = new Image();
  mi.onload = () => { mapImage = { src: mi, minX: -102.2, maxX: 102.2, minZ: -102.2, maxZ: 144.2 }; };
  mi.src = (/\/ui\/[^/]*$/.test(location.pathname) ? '' : 'ui/') + 'bench-map.jpg';
  const cdStart = [5, 0, 1.6, 0, 0, 3.2, 0, 22], t0 = performance.now();
  let last = t0;
  (function loop() {
    const now = performance.now(), dt = (now - last) / 1000, t = (now - t0) / 1000; last = now;
    const mp = low ? 40 : 384, hp = dead ? 0 : low ? 520 : 2992;
    const tg = tk === 'none' ? null : Object.assign({ effects: tk === 'neutral' ? [] : [{ id: 'poison', name: 'Zehir', desc: 'Saniyede 42 zehir hasarı.', iconHTML: ic(110, G[1]), left: 4.2, debuff: true }] }, targets[tk]);
    hud.update({
      player: { level: 4, hp, maxHp: 3400, mp, maxMp: 420, mpRegen: 9, absorb: 0, dead,
        buffs: [{ id: 'rage', name: 'Savaş Narası', iconHTML: ic(5, G[6]), left: Math.max(0, 9.5 - t), dur: 12 }, { id: 'iron', name: 'Demir Beden', iconHTML: ic(45, G[7]), left: Math.max(0, 6.6 - t), dur: 8 }] },
      exp: { level: 4, exp: 1240, need: 1500 + 4 * 900 },
      skills: skills.map((s, i) => ({ cd: Math.max(0, cdStart[i] - t), cdTotal: s.cd, usable: mp >= s.mp, active: i === 6, activeLeft: Math.max(0, 9.5 - t), activeDur: 12, casting: false })),
      target: tg,
      walk,
      map: { region: 'Taşkale', bounds: { minX: -102.2, maxX: 102.2, minZ: -102.2, maxZ: 144.2 }, image: mapImage, player: { x: 38.6, z: 34.2, yaw: 0.6 + t * 0.05 }, view: { x: Math.sin(t * 0.05) , z: -Math.cos(t * 0.05) }, moveTo: { x: 30, z: 26 },
        markers: [{ id: 'w1', x: 46, z: 41, kind: 'hostile', selected: tk === 'hostile', label: 'Bozkır Kurdu (3)' }, { id: 'n1', x: -38, z: 22, kind: 'npc', label: 'Demirci' }, { id: 'n2', x: 20, z: -34, kind: 'npc', label: 'Şifacı' }, { id: 'p1', x: 0, z: 0, kind: 'poi', label: 'Yol taşı' }] },
      stats: { mpRegen: 9, hpRegen: 2, attackSpeed: 1.08, damageMul: 1.3, damageTaken: 1, critChance: 0.15, critMul: 1.75 },
    });
    hud.tick(dt);
    requestAnimationFrame(loop);
  })();
  if (q.get('quests') === '1') hud.setQuests([
    { id: 'q1', title: 'Kurt sürüsünü dağıt', distance: 140, objectives: [{ text: 'Bozkır Kurdu öldür', cur: 6, max: 10 }, { text: 'Sürü liderini yen', cur: 0, max: 1 }] },
    { id: 'q2', title: 'Demirciye cevher götür', objectives: [{ text: 'Demir cevheri topla', cur: 5, max: 5, done: true }, { text: 'Demirci ile konuş' }] }]);
  if (q.get('party') === '1') hud.setParty([{ id: 'p1', name: 'Kaan', level: 5, hp: 2900, maxHp: 3600 }, { id: 'p2', name: 'Elif', level: 4, hp: 600, maxHp: 2500 }, { id: 'p3', name: 'Mert', level: 3, hp: 0, maxHp: 2700, dead: true }]);
  setTimeout(() => { if (q.get('open')) hud.windows.show(q.get('open')); }, 400);
  setTimeout(() => { hud.combatText({ x: 1, y: 2, z: 0 }, '1.284', 'crit'); hud.xpGain(220); }, 300);
  setTimeout(() => { document.title = 'ready'; }, 1200);
})();
