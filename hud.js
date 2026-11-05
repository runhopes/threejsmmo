/* TDS - in-game HUD: an HTML/CSS overlay over the WebGL canvas (styles: hud.css).
 *
 * The game owns all rules and state; the HUD only presents what it is given:
 *   const hud = GameHUD.create({ project, onSkill, onEscape, onRestart });
 *   hud.setPlayerInfo({...}); hud.setSkills(skills, basic);   // once per character
 *   hud.update(state);                                         // every frame: components diff and touch the DOM only on change
 *   hud.tick(dt);                                              // frame-dependent bits only (world-anchored numbers, map redraw)
 *   hud.combatText / xpGain / levelUp / error / hurt / log / combo / pressed / deny   // events
 *
 * Components: HUDController (create) - PlayerStatus - TargetStatus - MinimapHUD - QuestTracker - PartyFrames - ActionBar -
 * ExperienceBar - LogPanel - UtilityMenu - windows (Character, Skills, Map, Menu) - CombatFeedback - TooltipManager.
 * Quest tracker and party frames render nothing until the game provides data (hud.setQuests / hud.setParty).
 * The log is a system / combat log: the game has no chat backend, so there is no chat input and no invented channels.
 */
(function (global) {
  'use strict';
  const D = document;
  function h(tag, cls, parent, html) {
    const e = D.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    if (parent) parent.appendChild(e);
    return e;
  }
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const NF = new Intl.NumberFormat('tr-TR');
  const fmt = (n) => NF.format(Math.round(n));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const pad2 = (n) => (n < 10 ? '0' : '') + n;
  const store = {
    get(k, d) { try { const v = localStorage.getItem('tds.hud.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('tds.hud.' + k, JSON.stringify(v)); } catch (e) { /* storage blocked: settings stay per session */ } },
  };
  const toggle = (el, cls, on) => { if (el.classList.contains(cls) !== !!on) el.classList.toggle(cls, !!on); };
  const setTxt = (el, t) => { if (el._t !== t) { el._t = t; el.textContent = t; } };
  // buttons never take keyboard focus (Space / Enter must not re-trigger them while playing)
  function btn(cls, parent, html, onClick) {
    const b = h('button', cls, parent, html);
    b.type = 'button'; b.tabIndex = -1;
    b.addEventListener('mousedown', (e) => e.preventDefault());
    if (onClick) b.addEventListener('click', (e) => { e.stopPropagation(); onClick(e); });
    return b;
  }

  /* ---------- one line-icon family (24px grid, 1.5px stroke) ---------- */
  const ICONS = {
    character: '<circle cx="12" cy="8" r="3.6"/><path d="M4.8 20c.8-4.1 3.6-6.4 7.2-6.4s6.4 2.3 7.2 6.4"/>',
    skills: '<path d="M12 6.6C10 5.1 7.1 4.6 4 5.1v13.2c3.1-.5 6 0 8 1.5 2-1.5 4.9-2 8-1.5V5.1c-3.1-.5-6 0-8 1.5Z"/><path d="M12 6.6v13.2"/>',
    map: '<path d="M3.5 6.4 9 4.5l6 2 5.5-1.9v13l-5.5 1.9-6-2-5.5 1.9v-13Z"/><path d="M9 4.5v13M15 6.5v13"/>',
    menu: '<path d="M5 7h14M5 12h14M5 17h14"/>',
    close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    chevron: '<path d="m7 10 5 5 5-5"/>',
    up: '<path d="m7 14 5-5 5 5"/>',
    plus: '<path d="M12 6.5v11M6.5 12h11"/>',
    minus: '<path d="M6.5 12h11"/>',
  };
  const icon = (n) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[n] + '</svg>';

  /* ==================== TooltipManager ==================== */
  function Tooltips(root) {
    const el = h('div', 'hud-tip', root); el.hidden = true;
    let anchor = null, build = null, place = 'top';
    function position() {
      if (!anchor) return;
      const r = anchor.getBoundingClientRect(), w = el.offsetWidth, ht = el.offsetHeight, m = 8;
      let x = r.left + r.width / 2 - w / 2, y = place === 'top' ? r.top - ht - m : place === 'left' ? r.top : r.bottom + m;
      if (place === 'left') x = r.left - w - m;
      if (place === 'right') { x = r.right + m; y = r.top; }
      if (y < m) y = r.bottom + m;
      x = Math.max(m, Math.min(innerWidth - w - m, x)); y = Math.max(m, Math.min(innerHeight - ht - m, y));
      el.style.left = x + 'px'; el.style.top = y + 'px';
    }
    function show(a, fn, p) { anchor = a; build = fn; place = p || 'top'; refresh(); el.hidden = false; position(); }
    function refresh() { if (!anchor) return; const html = build(); if (!html) { hide(); return; } if (el._h !== html) { el._h = html; el.innerHTML = html; position(); } }
    function hide() { anchor = null; el.hidden = true; }
    function bind(target, fn, p) {
      target.addEventListener('mouseenter', () => show(target, fn, p));
      target.addEventListener('mouseleave', () => { if (anchor === target) hide(); });
    }
    return { show, hide, bind, refresh, get anchor() { return anchor; } };
  }

  /* ==================== bars ==================== */
  // fill + a delayed "recent loss" ghost + optional absorb overlay; DOM writes only when the value visibly changes
  function Bar(parent, kind) {
    const el = h('div', 'hud-bar ' + kind, parent);
    const ghost = h('i', 'ghost', el), abs = kind === 'hp' ? h('i', 'abs', el) : null, fill = h('i', 'fill', el), txt = h('span', '', el);
    let f = -1, a = -1;
    return {
      el, txt,
      set(v, max, text, absorb) {
        const nf = max > 0 ? clamp01(v / max) : 0;
        if (Math.abs(nf - f) > 0.0008) {
          toggle(ghost, 'lag', nf < f);
          fill.style.transform = 'scaleX(' + nf.toFixed(4) + ')';
          ghost.style.transform = 'scaleX(' + nf.toFixed(4) + ')';
          f = nf;
        }
        if (abs) {
          const na = max > 0 ? Math.min(clamp01((absorb || 0) / max), 1 - nf) : 0;
          if (Math.abs(na - a) > 0.001 || (na > 0 && Math.abs(nf - (abs._f || 0)) > 0.001)) {
            abs.style.left = (nf * 100).toFixed(2) + '%'; abs.style.width = (na * 100).toFixed(2) + '%'; abs._f = nf; a = na;
          }
        }
        if (text !== undefined && txt._t !== text) { txt._t = text; txt.innerHTML = text; }
      },
    };
  }
  // status effect strip: [{ id, name, iconHTML, left, dur, debuff, desc }]
  function FxStrip(parent, tips) {
    const el = h('div', 'hud-fx', parent);
    let key = '', items = {}, data = {};
    return {
      el,
      set(list) {
        list = list || [];
        const k = list.map((x) => x.id).join(',');
        if (k !== key) {
          key = k; el.innerHTML = ''; items = {};
          for (const x of list) {
            const d = h('div', 'fx' + (x.debuff ? ' debuff' : ''), el, x.iconHTML + '<b></b>');
            items[x.id] = d;
            tips.bind(d, () => { const s = data[x.id]; return s ? '<div class="tt">' + esc(s.name) + '</div>' + (s.left > 0 ? '<div class="ts">' + Math.ceil(s.left) + ' sn kaldı</div>' : '') + (s.desc ? '<div class="tb" style="margin-top:4px">' + esc(s.desc) + '</div>' : '') : ''; }, 'bottom');
          }
        }
        for (const x of list) {
          data[x.id] = x;
          const d = items[x.id]; if (!d) continue;
          setTxt(d.lastChild, x.left > 0 ? (x.left >= 60 ? Math.ceil(x.left / 60) + 'dk' : Math.ceil(x.left) + '') : '');
          toggle(d, 'ending', x.left > 0 && x.left < 3);
        }
      },
    };
  }

  /* ==================== PlayerStatus ==================== */
  function PlayerStatus(hud) {
    const root = h('div', 'hud-player hud-i', hud.frame);
    const box = h('div', 'box hud-panel', root);
    const emb = h('div', 'emb', box), col = h('div', 'col', box), head = h('div', 'head', col);
    const name = h('span', 'name', head), ttl = h('span', 'ttl', head), lvl = h('span', 'lvl', head, 'Sv.<b>1</b>');
    const hp = Bar(col, 'hp'), mp = Bar(col, 'mp');
    const fx = FxStrip(root, hud.tips);
    hud.tips.bind(hp.el, () => '<div class="tt">Can</div><div class="ts">' + fmt(last.hp) + ' / ' + fmt(last.maxHp) + (last.absorb > 0 ? ' · ' + fmt(last.absorb) + ' emilim' : '') + '</div>', 'bottom');
    hud.tips.bind(mp.el, () => '<div class="tt">Mana</div><div class="ts">' + fmt(last.mp) + ' / ' + fmt(last.maxMp) + (last.mpRegen ? ' · saniyede +' + fmt(last.mpRegen) : '') + '</div>', 'bottom');
    let last = {};
    emb.addEventListener('click', () => hud.windows.toggle('char'));
    emb.style.cursor = 'pointer';
    return {
      setInfo(info) { emb.innerHTML = info.emblemHTML || ''; setTxt(name, info.name || ''); setTxt(ttl, info.title || ''); },
      set(p) {
        last = p;
        setTxt(lvl.lastChild, String(p.level));
        hp.set(p.hp, p.maxHp, p.dead ? 'Ölü' : fmt(p.hp) + ' / ' + fmt(p.maxHp), p.absorb);
        mp.set(p.mp, p.maxMp, fmt(p.mp) + ' / ' + fmt(p.maxMp));
        toggle(root, 'dead', p.dead);
        fx.set(p.buffs);
      },
    };
  }

  /* ==================== PartyFrames (data-driven; hidden without a party) ==================== */
  function PartyFrames(hud) {
    const root = h('div', 'hud-party hud-i', hud.frame); root.hidden = true;
    let key = '', rows = {};
    return {
      set(list) {
        list = list || [];
        root.hidden = !list.length;
        const k = list.map((m) => m.id).join(',');
        if (k !== key) {
          key = k; root.innerHTML = ''; rows = {};
          for (const m of list) {
            const el = h('div', 'pm hud-panel', root), hd = h('div', 'head', el);
            const n = h('span', 'nm', hd), st = h('span', 'state', hd), lv = h('span', 'lv', hd), bar = Bar(el, 'hp');
            rows[m.id] = { el, n, st, lv, bar };
          }
        }
        for (const m of list) {
          const r = rows[m.id];
          setTxt(r.n, m.name); setTxt(r.lv, m.level ? 'Sv. ' + m.level : '');
          setTxt(r.st, m.offline ? 'çevrimdışı' : m.dead ? 'ölü' : '');
          toggle(r.el, 'dead', m.dead); toggle(r.el, 'off', m.offline);
          r.bar.set(m.hp, m.maxHp);
        }
      },
    };
  }

  /* ==================== TargetStatus ==================== */
  const DISP = { hostile: 'Düşman', neutral: 'Tarafsız', friendly: 'Dost' };
  const RANK = { elite: 'ELİT', boss: 'BOSS' };
  function TargetStatus(hud) {
    const root = h('div', 'hud-target hud-panel hud-i off', hud.frame);
    const head = h('div', 'head', root), name = h('span', 'name', head), rank = h('span', 'rank', head), lvl = h('span', 'lvl', head);
    const sub = h('div', 'sub', root), bar = Bar(root, 'tgt'), fx = FxStrip(root, hud.tips);
    let id = null;
    return {
      set(t) {
        if (!t) { if (id !== null) { id = null; root.classList.add('off'); } return; }
        if (id !== t.id) {
          id = t.id; root.classList.remove('off');
          const boss = t.rank === 'boss';
          root.className = 'hud-target hud-panel hud-i ' + (boss ? 'boss' : (t.disposition || 'hostile'));
          setTxt(name, t.name); rank.hidden = !RANK[t.rank]; setTxt(rank, RANK[t.rank] || '');
          setTxt(sub, [t.type, DISP[t.disposition]].filter(Boolean).join(' · '));
        }
        setTxt(lvl, t.level ? 'Sv. ' + t.level : '');
        const pct = t.maxHp > 0 ? t.hp / t.maxHp * 100 : 0;
        bar.set(t.hp, t.maxHp, '<span class="l">' + fmt(t.hp) + ' / ' + fmt(t.maxHp) + '</span><span class="r">%' + (pct >= 10 ? Math.round(pct) : pct.toFixed(1)).toString().replace('.', ',') + '</span>');
        fx.set(t.effects);
      },
    };
  }

  /* ==================== MinimapHUD (live positions, canvas) ==================== */
  // state: { region, player: {x, z, yaw}, view: {x, z} (camera forward on the ground), markers: [{ id, x, z, kind, selected, label }],
  //          moveTo: {x, z} | null, bounds: {minX, maxX, minZ, maxZ} }. Map up = -Z (the "W" direction).
  const MARK = { hostile: '#B5524C', neutral: '#C49A55', friendly: '#6F9474', npc: '#C4AB7E', quest: '#C4AB7E', party: '#93AECB', poi: '#B9B3A6' };
  function drawMap(cv, S, range, opts) {
    const dpr = Math.min(2, global.devicePixelRatio || 1), css = cv.clientWidth || 1, px = Math.round(css * dpr);
    if (cv.width !== px) { cv.width = px; cv.height = px; }
    const g = cv.getContext('2d'), sc = px / (2 * range), c = px / 2, P = S.player;
    const X = (wx) => c + (wx - P.x) * sc, Y = (wz) => c + (wz - P.z) * sc;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#121617'; g.fillRect(0, 0, px, px);
    if (S.bounds) {                                               // walkable world area
      const b = S.bounds;
      g.fillStyle = '#182022'; g.fillRect(X(b.minX), Y(b.minZ), (b.maxX - b.minX) * sc, (b.maxZ - b.minZ) * sc);
    }
    const step = range > 30 ? 10 : 5, major = step * 5;
    g.lineWidth = Math.max(1, dpr * 0.75);
    for (let pass = 0; pass < 2; pass++) {
      g.strokeStyle = pass ? 'rgba(151,156,150,.16)' : 'rgba(151,156,150,.07)';
      g.beginPath();
      const s = pass ? major : step;
      for (let wx = Math.ceil((P.x - range) / s) * s; wx <= P.x + range; wx += s) { if (!pass && wx % major === 0) continue; const x = Math.round(X(wx)) + 0.5; g.moveTo(x, 0); g.lineTo(x, px); }
      for (let wz = Math.ceil((P.z - range) / s) * s; wz <= P.z + range; wz += s) { if (!pass && wz % major === 0) continue; const y = Math.round(Y(wz)) + 0.5; g.moveTo(0, y); g.lineTo(px, y); }
      g.stroke();
    }
    if (S.view) {                                                 // camera view cone
      const a = Math.atan2(S.view.x, S.view.z), L = Math.min(range * 0.95, 18) * sc, w = 0.62;
      g.fillStyle = 'rgba(221,215,200,.06)';
      g.beginPath(); g.moveTo(c, c);
      g.lineTo(c + Math.sin(a - w) * L, c + Math.cos(a - w) * L); g.lineTo(c + Math.sin(a + w) * L, c + Math.cos(a + w) * L); g.closePath(); g.fill();
    }
    if (S.moveTo) {                                               // right-click move order
      const x = X(S.moveTo.x), y = Y(S.moveTo.z), r = 3.5 * dpr;
      g.strokeStyle = '#7FA486'; g.lineWidth = 1.25 * dpr;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke();
      g.setLineDash([2 * dpr, 3 * dpr]); g.strokeStyle = 'rgba(127,164,134,.45)'; g.beginPath(); g.moveTo(c, c); g.lineTo(x, y); g.stroke(); g.setLineDash([]);
    }
    for (const m of S.markers || []) {
      let x = X(m.x), y = Y(m.z);
      const out = x < 0 || y < 0 || x > px || y > px;
      if (out && !(opts && opts.edge)) continue;
      if (out) { const ang = Math.atan2(x - c, y - c), e = c - 6 * dpr; x = c + Math.sin(ang) * Math.min(e / Math.abs(Math.sin(ang) || 1e-6), e / Math.abs(Math.cos(ang) || 1e-6)) * 0.98; y = c + Math.cos(ang) * Math.min(e / Math.abs(Math.sin(ang) || 1e-6), e / Math.abs(Math.cos(ang) || 1e-6)) * 0.98; }
      const r = (m.kind === 'party' ? 3 : 4) * dpr;
      g.fillStyle = MARK[m.kind] || MARK.poi; g.strokeStyle = '#0B0D0E'; g.lineWidth = dpr;
      g.beginPath();
      if (m.kind === 'party') g.arc(x, y, r, 0, Math.PI * 2);
      else { g.moveTo(x, y - r); g.lineTo(x + r, y); g.lineTo(x, y + r); g.lineTo(x - r, y); g.closePath(); }
      g.fill(); g.stroke();
      if (m.selected) { g.strokeStyle = MARK[m.kind] || MARK.poi; g.lineWidth = dpr; g.beginPath(); g.arc(x, y, r + 3.5 * dpr, 0, Math.PI * 2); g.stroke(); }
      if (opts && opts.labels && m.label) {
        g.font = 600 + ' ' + Math.round(11 * dpr) + 'px "Alegreya Sans", sans-serif'; g.fillStyle = '#DDD7C8'; g.textAlign = 'center';
        g.shadowColor = '#000'; g.shadowBlur = 2 * dpr; g.fillText(m.label, x, y - r - 5 * dpr); g.shadowBlur = 0;
      }
    }
    // player: arrow along the facing direction
    const a = P.yaw, s = 7 * dpr;
    g.save(); g.translate(c, c); g.rotate(-a + Math.PI);
    g.beginPath(); g.moveTo(0, -s); g.lineTo(s * 0.68, s * 0.78); g.lineTo(0, s * 0.38); g.lineTo(-s * 0.68, s * 0.78); g.closePath();
    g.fillStyle = '#E6E0D2'; g.strokeStyle = '#0B0D0E'; g.lineWidth = 1.4 * dpr; g.lineJoin = 'round'; g.stroke(); g.fill();
    g.restore();
  }
  function MinimapHUD(hud) {
    const ranges = [12, 20, 34];
    let zi = Math.min(2, Math.max(0, hud.settings.mapZoom | 0)), S = null, dirty = true, acc = 0, sig = '';
    const root = h('div', 'hud-map', hud.frame), head = h('div', 'head', root);
    const region = h('span', 'region', head), coord = h('span', 'coord', head);
    const wrap = h('div', 'wrap', root), cv = h('canvas', '', wrap);
    h('span', 'north', wrap, 'K');
    const zoom = h('div', 'zoom', wrap);
    const zb = (d) => () => { zi = Math.max(0, Math.min(2, zi + d)); hud.settings.mapZoom = zi; hud.saveSettings(); dirty = true; };
    hud.tips.bind(btn('', zoom, icon('minus'), zb(1)), () => '<div class="tt">Uzaklaştır</div>', 'bottom');
    hud.tips.bind(btn('', zoom, icon('plus'), zb(-1)), () => '<div class="tt">Yakınlaştır</div>', 'bottom');
    wrap.addEventListener('click', () => hud.windows.toggle('map'));
    hud.tips.bind(cv, () => '<div class="tt">' + esc((S && S.region) || 'Harita') + '</div><div class="ts">Büyük harita: M</div>', 'left');
    const perf = h('div', 'perf', root);
    return {
      perf, root,
      set(state) {
        S = state;
        const p = S.player, k = [p.x.toFixed(2), p.z.toFixed(2), p.yaw.toFixed(2), S.view ? (S.view.x.toFixed(2) + S.view.z.toFixed(2)) : '',
          S.moveTo ? S.moveTo.x.toFixed(1) + S.moveTo.z.toFixed(1) : '', (S.markers || []).map((m) => m.x.toFixed(1) + m.z.toFixed(1) + (m.selected ? 's' : '')).join()].join('|');
        if (k !== sig) { sig = k; dirty = true; }
        setTxt(region, S.region || '');
        setTxt(coord, Math.round(p.x) + ', ' + Math.round(-p.z));
      },
      frame(dt) { acc += dt; if (dirty && S && acc >= 1 / 30) { acc = 0; dirty = false; drawMap(cv, S, ranges[zi]); } },
      redraw() { dirty = true; },
      get state() { return S; },
    };
  }

  /* ==================== QuestTracker (data-driven; hidden without quests) ==================== */
  // list: [{ id, title, objectives: [{ text, cur, max, done }], done, distance (m, only if known) }]
  function QuestTracker(hud) {
    const root = h('div', 'hud-quests', hud.frame); root.hidden = true;
    const hd = h('div', 'qh', root, icon('chevron') + '<span>Görevler</span><span class="n"></span>');
    const list = h('div', 'ql', root);
    let collapsed = !!hud.settings.questsCollapsed, sig = '';
    toggle(root, 'collapsed', collapsed);
    hd.addEventListener('click', () => { collapsed = !collapsed; toggle(root, 'collapsed', collapsed); hud.settings.questsCollapsed = collapsed; hud.saveSettings(); });
    return {
      set(quests) {
        quests = quests || [];
        root.hidden = !quests.length || !hud.settings.showQuests;
        const k = JSON.stringify(quests);
        if (k === sig) return;
        sig = k;
        setTxt(hd.querySelector('.n'), quests.length ? String(quests.length) : '');
        list.innerHTML = quests.map((q) => '<div class="q' + (q.done ? ' done' : '') + '"><div class="qt"><span>' + esc(q.title) + '</span>' +
          (q.distance !== undefined && q.distance !== null ? '<span class="d">' + Math.round(q.distance) + ' m</span>' : '') + '</div>' +
          (q.objectives || []).map((o) => '<div class="o' + (o.done ? ' done' : '') + '"><span>' + esc(o.text) + '</span>' +
            (o.max ? '<span class="p">' + (o.done ? '✓' : (o.cur || 0) + '/' + o.max) + '</span>' : (o.done ? '<span class="p">✓</span>' : '')) + '</div>').join('') + '</div>').join('');
      },
    };
  }

  /* ==================== ActionBar ==================== */
  // skills: [{ id, name, key, alt, iconHTML, mp, cd, desc }]; per-frame state per slot: { cd, usable, active, activeLeft, activeDur, casting }
  function ActionBar(hud) {
    const root = h('div', 'hud-actions', hud.frame);
    const gBasic = h('div', 'grp hud-panel', root), gSkills = h('div', 'grp hud-panel', root);
    const combo = h('div', 'combo', gBasic, '<i></i><i></i><i></i>');
    let slots = [], basicSlot = null, defs = [], states = [];
    function makeSlot(parent, s, i) {
      const el = h('div', 'slot' + (i < 0 ? ' basic' : ''), parent);
      el.dataset.slot = i;
      const ic = h('div', 'ic', el, s.iconHTML);
      const cd = h('div', 'cd', el), cdt = h('div', 'cdt', el), dur = h('i', 'dur', el);
      h('kbd', '', el, esc(s.keyLabel || s.key));
      const cost = s.mp ? h('span', 'cost', el, String(s.mp)) : null;
      return { el, ic, cd, cdt, dur, cost, cooling: false, cdTotal: 0, cdLast: 0, txt: '', active: false };
    }
    function tipFor(i) {
      const s = i < 0 ? hud.basic : defs[i], st = i < 0 ? {} : (states[i] || {});
      if (!s) return '';
      const keys = i < 0 ? 'Sağ tık' : 'Tuş ' + s.key + (s.alt ? ' / ' + s.alt : '');
      let warn = '';
      if (st.cd > 0) warn = '<div class="tw">Bekleme: ' + (st.cd >= 1 ? Math.ceil(st.cd) + ' sn' : st.cd.toFixed(1).replace('.', ',') + ' sn') + '</div>';
      else if (st.usable === false) warn = '<div class="tw bad">Yetersiz mana</div>';
      if (st.active && st.activeLeft > 0) warn += '<div class="tw">Etkin: ' + Math.ceil(st.activeLeft) + ' sn</div>';
      return '<div class="tt">' + esc(s.name) + '</div><div class="ts">' + keys + '</div>' +
        (s.mp || s.cd ? '<div class="tm">' + (s.mp ? '<span class="mp">' + s.mp + ' mana</span>' : '') + (s.cd ? '<span>' + s.cd + ' sn bekleme</span>' : '') + '</div>' : '<div style="height:6px"></div>') +
        '<div class="tb">' + esc(s.desc || '') + '</div>' + warn;
    }
    function startCd(S, left, total) {
      S.cooling = true; S.cdTotal = total;
      S.cd.style.animation = 'none'; void S.cd.offsetWidth;
      S.cd.style.setProperty('--dur', total + 's'); S.cd.style.setProperty('--delay', (-(total - left)).toFixed(3) + 's');
      S.cd.style.animation = '';
      S.el.classList.add('cooling');
    }
    function startDur(S, left, total) {
      S.dur.style.animation = 'none'; void S.dur.offsetWidth;
      S.dur.style.setProperty('--adur', total + 's'); S.dur.style.setProperty('--adelay', (-(total - left)).toFixed(3) + 's');
      S.dur.style.animation = '';
    }
    function flash(S, cls, ms) { S.el.classList.remove(cls); void S.el.offsetWidth; S.el.classList.add(cls); clearTimeout(S['t_' + cls]); S['t_' + cls] = setTimeout(() => S.el.classList.remove(cls), ms); }
    return {
      setSkills(list, basic, onUse) {
        gSkills.innerHTML = ''; slots = []; defs = list; states = [];
        list.forEach((s, i) => {
          const S = makeSlot(gSkills, s, i); slots.push(S);
          S.el.addEventListener('pointerdown', (e) => { e.stopPropagation(); if (e.button === 0 && onUse) onUse(i); });
          hud.tips.bind(S.el, () => tipFor(i), 'top');
        });
        if (basicSlot) basicSlot.el.remove();
        if (basic) {
          basicSlot = makeSlot(gBasic, Object.assign({ keyLabel: 'SAĞ' }, basic), -1);
          hud.tips.bind(basicSlot.el, () => tipFor(-1), 'top');
        }
      },
      update(list) {
        states = list;
        for (let i = 0; i < slots.length; i++) {
          const S = slots[i], st = list[i] || {}, cd = st.cd || 0;
          if (cd > 0) {
            if (!S.cooling || cd > S.cdLast + 0.05) startCd(S, cd, st.cdTotal || defs[i].cd || cd);
            const t = cd >= 1 ? String(Math.ceil(cd)) : cd.toFixed(1).replace('.', ',');
            if (t !== S.txt) { S.txt = t; S.cdt.textContent = t; }
          } else if (S.cooling) { S.cooling = false; S.el.classList.remove('cooling'); S.txt = ''; flash(S, 'ready', 420); }
          S.cdLast = cd;
          toggle(S.el, 'nores', st.usable === false);
          toggle(S.el, 'casting', !!st.casting);
          const act = !!st.active;
          if (act && (!S.active || (st.activeLeft || 0) > (S.aLast || 0) + 0.05) && st.activeDur) startDur(S, st.activeLeft, st.activeDur);
          S.aLast = st.activeLeft || 0;
          if (act !== S.active) { S.active = act; toggle(S.el, 'active', act); }
        }
        if (hud.tips.anchor && hud.tips.anchor.classList && hud.tips.anchor.classList.contains('slot')) hud.tips.refresh();
      },
      pressed(i) { if (slots[i]) flash(slots[i], 'press', 120); },
      deny(i) { if (slots[i]) flash(slots[i], 'deny', 340); },
      combo(n) { [...combo.children].forEach((x, k) => toggle(x, 'on', k < n)); },
      el: root,
    };
  }

  /* ==================== ExperienceBar ==================== */
  function ExperienceBar(hud) {
    const root = h('div', 'hud-xp', hud.frame), fill = h('i', '', root);
    let f = -1, L = {}, acc = 0, accT = 0, gainEl = null;
    hud.tips.bind(root, () => L.need ? '<div class="tt">Seviye ' + L.level + '</div><div class="ts">' + fmt(L.exp) + ' / ' + fmt(L.need) + ' TP · %' +
      (L.exp / L.need * 100).toFixed(1).replace('.', ',') + '</div><div class="ts">Sonraki seviyeye ' + fmt(L.need - L.exp) + ' TP</div>' : '', 'top');
    return {
      set(x) {
        L = x;
        const nf = x.need > 0 ? clamp01(x.exp / x.need) : 0;
        if (Math.abs(nf - f) > 0.0005) { fill.style.transform = 'scaleX(' + nf.toFixed(4) + ')'; f = nf; }
      },
      levelUp() { root.classList.remove('flash'); void root.offsetWidth; root.classList.add('flash'); },
      gain(n) {                                                   // gains add up into one quiet label at the bar's end
        acc += n; accT = 1.3;
        if (!gainEl) gainEl = h('div', 'hud-xpgain', hud.actions.el);
        gainEl.style.opacity = '1';
        gainEl.textContent = '+' + fmt(acc) + ' TP';
      },
      frame(dt) { if (accT > 0) { accT -= dt; if (accT <= 0) { acc = 0; if (gainEl) gainEl.style.opacity = '0'; } } },
    };
  }

  /* ==================== LogPanel (system / combat log) ==================== */
  function LogPanel(hud) {
    const root = h('div', 'hud-log', hud.frame), bar = h('div', 'bar', root), body = h('div', 'body', root);
    const channels = [{ id: 'system', name: 'Sistem' }, { id: 'combat', name: 'Savaş' }];
    let filter = hud.settings.logTab || 'system', count = 0;
    const tabs = {};
    for (const c of channels) {
      const t = btn('tab', bar, esc(c.name) + '<i class="u"></i>', () => setFilter(c.id));
      tabs[c.id] = t;
    }
    const grow = btn('grow', bar, icon('up'), () => { toggle(root, 'expanded', !root.classList.contains('expanded')); hud.settings.logExpanded = root.classList.contains('expanded'); hud.saveSettings(); stick(true); });
    hud.tips.bind(grow, () => '<div class="tt">' + (root.classList.contains('expanded') ? 'Daralt' : 'Genişlet') + '</div>', 'top');
    toggle(root, 'expanded', !!hud.settings.logExpanded);
    const empty = h('div', 'ln empty ch-system ch-combat', body, 'Henüz kayıt yok.');
    function setFilter(id) {
      filter = id; body.dataset.f = id;
      for (const k in tabs) { toggle(tabs[k], 'on', k === id); if (k === id) tabs[k].classList.remove('unread'); }
      hud.settings.logTab = id; hud.saveSettings(); stick(true);
    }
    function stick(force) { if (force || body.scrollHeight - body.scrollTop - body.clientHeight < 24) body.scrollTop = body.scrollHeight; }
    setFilter(filter);
    body.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
    return {
      add(ch, text, tone) {
        if (empty.parentNode) empty.remove();
        const atEnd = body.scrollHeight - body.scrollTop - body.clientHeight < 24;
        const d = new Date();
        const ln = h('div', 'ln ch-' + ch + (tone ? ' t-' + tone : ''), body, '<time>' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + '</time>' + esc(text));
        if (++count > 200) { body.firstChild.remove(); count--; }
        if (ch !== filter && tabs[ch]) tabs[ch].classList.add('unread');
        if (atEnd) body.scrollTop = body.scrollHeight;
        return ln;
      },
      root,
      applySettings(s) { root.style.setProperty('--log-a', String(s.logAlpha)); toggle(root, 'ts', s.timestamps); },
    };
  }

  /* ==================== windows ==================== */
  function Windows(hud) {
    const open = [];                                              // stacking order (last = top)
    const reg = {};
    function make(id, title, key, cls) {
      const el = h('div', 'hud-win ' + cls, hud.frame); el.hidden = true;
      const wh = h('div', 'wh', el); h('span', 't', wh, esc(title)); if (key) h('span', 'k', wh, esc(key));
      btn('x', wh, icon('close'), () => close(id));
      const body = h('div', 'wb', el);
      el.addEventListener('pointerdown', () => { const i = open.indexOf(id); if (i >= 0 && i < open.length - 1) { open.splice(i, 1); open.push(id); restack(); } });
      reg[id] = { el, body, onOpen: null };
      return reg[id];
    }
    // a part (ui/*.js) that builds its own window element registers it here: stacking, Esc and the menu strip then treat it like any window
    function register(id, el, o) {
      el.hidden = true;
      el.addEventListener('pointerdown', () => { const i = open.indexOf(id); if (i >= 0 && i < open.length - 1) { open.splice(i, 1); open.push(id); restack(); } });
      reg[id] = { el, body: el, onOpen: (o && o.onOpen) || null, onClose: (o && o.onClose) || null, esc: !(o && o.esc === false) };   // esc:false = Esc passes through (Atherion inventory)
      return reg[id];
    }
    function restack() { open.forEach((id, i) => { reg[id].el.style.zIndex = String(10 + i); }); }
    function show(id) { const w = reg[id]; if (!w || !w.el.hidden) return; w.el.hidden = false; open.push(id); restack(); if (w.onOpen) w.onOpen(); hud.menu.sync(); }
    function close(id) { const w = reg[id]; if (!w || w.el.hidden) return; w.el.hidden = true; open.splice(open.indexOf(id), 1); hud.tips.hide(); if (w.onClose) w.onClose(); hud.menu.sync(); }
    return {
      make, register, show, close, reg,
      toggle(id) { if (reg[id] && reg[id].el.hidden) show(id); else close(id); },
      isOpen(id) { return !!reg[id] && !reg[id].el.hidden; },
      closeTop() { for (let i = open.length - 1; i >= 0; i--) if (reg[open[i]].esc !== false) { close(open[i]); return true; } return false; },
    };
  }

  /* ==================== UtilityMenu ==================== */
  function UtilityMenu(hud, items) {
    const root = h('div', 'hud-util', hud.frame), bs = {};
    for (const it of items) {
      const b = btn('ub hud-panel', root, icon(it.icon), () => hud.windows.toggle(it.id));
      bs[it.id] = b;
      hud.tips.bind(b, () => '<div class="tt">' + esc(it.label) + '</div><div class="ts">Kısayol: ' + esc(it.key) + '</div>', 'top');
    }
    return { sync() { for (const id in bs) toggle(bs[id], 'on', hud.windows.isOpen(id)); } };
  }

  /* ==================== CombatFeedback ==================== */
  function CombatFeedback(hud) {
    const layer = h('div', 'hud-ft', hud.root);
    const MAX = 14, pool = [];
    for (let i = 0; i < MAX; i++) pool.push({ el: h('div', 'n', layer), on: false, t: 0, life: 0.7, x: 0, y: 0, z: 0, jx: 0, stack: 0, born: 0 });
    const err = h('div', 'hud-center hud-err', hud.frame), lvl = h('div', 'hud-center hud-lvl', hud.frame);
    const dead = h('div', 'hud-center hud-dead', hud.frame, '<b>Öldün</b><span>Diriltmek için <kbd>R</kbd></span>'); dead.hidden = true;
    const hurt = h('div', 'hud-hurt', hud.root);
    let errT = 0, clock = 0;
    function number(pos, text, kind) {
      if (!hud.settings.numbers && kind !== 'buff') return;
      let it = pool.find((p) => !p.on);
      if (!it) it = pool.reduce((a, b) => (a.born < b.born ? a : b));     // hard cap: recycle the oldest
      // numbers spawned at the same spot within 0.25 s stack upward instead of overlapping
      let stack = 0;
      for (const p of pool) if (p.on && clock - p.born < 0.25 && Math.abs(p.x - pos.x) < 0.6 && Math.abs(p.z - pos.z) < 0.6) stack = Math.max(stack, p.stack + 1);
      Object.assign(it, { on: true, t: 0, life: kind === 'crit' ? 0.95 : kind === 'buff' ? 1.1 : 0.75, x: pos.x, y: pos.y, z: pos.z, jx: (Math.random() - 0.5) * 22, stack: stack % 4, born: clock });
      it.el.className = 'n' + (kind && kind !== 'dmg' ? ' ' + kind : '');
      it.el.textContent = text;
    }
    return {
      number,
      frame(dt) {
        clock += dt;
        const W = innerWidth, H = innerHeight;
        for (const it of pool) {
          if (!it.on) continue;
          it.t += dt;
          const u = it.t / it.life;
          if (u >= 1) { it.on = false; it.el.style.opacity = '0'; continue; }
          const v = hud.opts.project(it.x, it.y, it.z);
          if (!v || v.z > 1) { it.el.style.opacity = '0'; continue; }
          const rise = 30 * (1 - Math.pow(1 - u, 2)) * hud.s, pop = it.el.classList.contains('crit') ? 1 + 0.18 * Math.max(0, 1 - it.t / 0.1) : 1;
          const x = (v.x * 0.5 + 0.5) * W + it.jx, y = (-v.y * 0.5 + 0.5) * H - rise - it.stack * 17 * hud.s;
          it.el.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0) translate(-50%,-50%) scale(' + pop.toFixed(3) + ')';
          it.el.style.opacity = (u < 0.08 ? u / 0.08 : u > 0.6 ? 1 - (u - 0.6) / 0.4 : 1).toFixed(3);
        }
        if (errT > 0) { errT -= dt; if (errT <= 0) err.classList.remove('on'); }
      },
      error(text) { if (err._t !== text || !err.classList.contains('on')) setTxt(err, text); err.classList.add('on'); errT = 1.4; },
      levelUp(level) { lvl.textContent = 'Seviye ' + level; lvl.classList.remove('on'); void lvl.offsetWidth; lvl.classList.add('on'); },
      dead(on) { if (dead.hidden === !!on) dead.hidden = !on; },
      hurt() { hurt.classList.remove('on'); void hurt.offsetWidth; hurt.classList.add('on'); },
    };
  }

  /* ==================== window contents ==================== */
  function CharacterWindow(hud) {
    const w = hud.windows.make('char', 'Karakter', 'P', 'win-char');
    let info = {}, st = null, t = 0;
    function render() {
      if (!st) return;
      const p = st.player, sx = st.stats || {};
      const row = (lb, v, cls) => '<div class="row"><span class="lb">' + lb + '</span><span class="v' + (cls ? ' ' + cls : '') + '">' + v + '</span></div>';
      w.body.innerHTML = '<div class="who"><div class="emb">' + (info.emblemHTML || '') + '</div><div><b>' + esc(info.name || '') + '</b><span>' + esc(info.title || '') + ' · Seviye ' + p.level + '</span></div></div>' +
        '<div class="sec">Durum</div>' +
        row('Can', fmt(p.hp) + ' / ' + fmt(p.maxHp)) + row('Mana', fmt(p.mp) + ' / ' + fmt(p.maxMp)) +
        (st.exp ? row('Tecrübe', fmt(st.exp.exp) + ' / ' + fmt(st.exp.need) + ' TP') : '') +
        '<div class="sec">Değerler</div>' +
        (sx.mpRegen ? row('Mana yenilenmesi', '+' + fmt(sx.mpRegen) + ' / sn') : '') +
        (sx.hpRegen ? row('Can yenilenmesi', '%' + sx.hpRegen + ' / sn <span class="lb" style="font-weight:500">(savaş dışında)</span>') : '') +
        (sx.attackSpeed ? row('Saldırı hızı', sx.attackSpeed.toFixed(2).replace('.', ',') + (sx.attackSpeedBuff ? ' <span class="lb" style="font-weight:500">(+%' + Math.round(sx.attackSpeedBuff * 100) + ')</span>' : ''), sx.attackSpeedBuff ? 'up' : '') : '') +
        row('Hasar çarpanı', '×' + (sx.damageMul || 1).toFixed(2).replace('.', ','), sx.damageMul > 1 ? 'up' : '') +
        row('Alınan hasar', sx.damageTaken !== undefined && sx.damageTaken < 1 ? '−%' + Math.round((1 - sx.damageTaken) * 100) : 'normal', sx.damageTaken < 1 ? 'up' : '') +
        (p.absorb > 0 ? row('Emilim kalkanı', fmt(p.absorb), 'up') : '') +
        (sx.critChance ? row('Kritik şansı', '%' + Math.round(sx.critChance * 100) + ' · ×' + String(sx.critMul).replace('.', ',')) : '');
    }
    w.onOpen = render;
    return {
      setInfo(i) { info = i; },
      update(state, dt) { st = state; if (!hud.windows.isOpen('char')) return; t -= dt; if (t <= 0) { t = 0.25; render(); } },
    };
  }
  function SkillsWindow(hud) {
    const w = hud.windows.make('skills', 'Yetenekler', 'K', 'win-skills');
    return {
      set(skills, basic) {
        const rows = (basic ? [Object.assign({ keyLabel: 'Sağ tık' }, basic)] : []).concat(skills);
        w.body.innerHTML = rows.map((s) => '<div class="sk"><div class="ic">' + s.iconHTML + '</div><div class="n"><b>' + esc(s.name) + '</b><span class="key">' +
          esc(s.keyLabel || (s.key + (s.alt ? ' / ' + s.alt : ''))) + '</span><span class="m">' + (s.mp ? '<span class="mp">' + s.mp + ' mana</span>' : '') +
          (s.cd ? (s.mp ? ' · ' : '') + s.cd + ' sn' : '') + '</span></div><p>' + esc(s.desc || '') + '</p></div>').join('');
      },
    };
  }
  function MapWindow(hud) {
    const w = hud.windows.make('map', 'Harita', 'M', 'win-map');
    const mw = h('div', 'mw', w.body), cv = h('canvas', '', mw), zoom = h('div', 'zoom', mw);
    const legend = h('div', 'legend', w.body);
    const ranges = [30, 55, 100];
    let zi = 1, acc = 0;
    btn('', zoom, icon('minus'), () => { zi = Math.min(2, zi + 1); acc = 1; });
    btn('', zoom, icon('plus'), () => { zi = Math.max(0, zi - 1); acc = 1; });
    w.onOpen = () => { acc = 1; };
    return {
      frame(dt) {
        if (!hud.windows.isOpen('map')) return;
        acc += dt;
        const S = hud.minimap.state;
        if (S && acc >= 1 / 20) {
          acc = 0; drawMap(cv, S, ranges[zi], { labels: true, edge: true });
          const kinds = [...new Set((S.markers || []).map((m) => m.kind))];
          const lg = '<span><i style="background:#E6E0D2"></i>Sen</span>' + kinds.map((k) => '<span><i style="background:' + (MARK[k] || MARK.poi) + '"></i>' +
            ({ hostile: 'Düşman', neutral: 'Tarafsız hedef', friendly: 'Dost', npc: 'NPC', quest: 'Görev', party: 'Grup üyesi', poi: 'İlgi noktası' }[k] || k) + '</span>').join('') +
            (S.moveTo ? '<span><i style="background:#7FA486;border-radius:50%"></i>Hedef nokta</span>' : '');
          if (legend._h !== lg) { legend._h = lg; legend.innerHTML = lg; }
        }
      },
    };
  }
  function MenuWindow(hud) {
    const w = hud.windows.make('menu', 'Menü', 'Esc', 'win-menu');
    function render() {
      const s = hud.settings;
      w.body.innerHTML = '';
      const sec = (t) => h('div', 'sec', w.body, esc(t));
      const row = (label) => { const r = h('div', 'row', w.body); h('span', 'lb', r, esc(label)); return r; };
      sec('Arayüz');
      const sr = row('Arayüz ölçeği'), seg = h('div', 'seg', sr);
      for (const [v, l] of [['auto', 'Oto'], [0.9, '90'], [1, '100'], [1.15, '115'], [1.3, '130']]) {
        btn(s.scale === v ? 'on' : '', seg, l, () => { s.scale = v; hud.saveSettings(); hud.applyScale(); render(); });
      }
      const ar = row('Kayıt penceresi saydamlığı'), rg = h('input', '', ar);
      rg.type = 'range'; rg.min = '0'; rg.max = '0.9'; rg.step = '0.05'; rg.value = String(s.logAlpha);
      rg.addEventListener('input', () => { s.logAlpha = +rg.value; hud.saveSettings(); hud.log.applySettings(s); });
      rg.addEventListener('change', () => rg.blur());                   // hand the keyboard back to the game
      rg.tabIndex = -1;
      const tg = (label, key, after) => {
        const r = row(label), b = btn('tg' + (s[key] ? ' on' : ''), r, '', () => { s[key] = !s[key]; toggle(b, 'on', s[key]); hud.saveSettings(); if (after) after(); });
      };
      tg('Kayıtta zaman damgası', 'timestamps', () => hud.log.applySettings(s));
      tg('Hasar sayıları', 'numbers');
      tg('Mini harita', 'showMap', () => hud.applyVisibility());
      tg('Kayıt penceresi', 'showLog', () => hud.applyVisibility());
      tg('Performans göstergesi', 'perf', () => hud.applyPerf());
      sec('Kısayollar');
      h('div', 'keys', w.body, (hud.opts.keys || []).map(([k, d]) => '<kbd>' + esc(k) + '</kbd><span>' + esc(d) + '</span>').join(''));
      const acts = h('div', 'acts', w.body);
      btn('hud-btn pri', acts, 'Oyuna dön', () => hud.windows.close('menu'));
      if (hud.opts.onRestart) btn('hud-btn', acts, 'Sınıf seçimine dön', () => hud.opts.onRestart());
    }
    w.onOpen = render;
    return {};
  }

  /* ==================== HUDController ==================== */
  const DEFAULTS = { scale: 'auto', showMap: true, showLog: true, logAlpha: 0, timestamps: false, numbers: true, perf: true, showQuests: true, mapZoom: 1, logTab: 'system', logExpanded: false, questsCollapsed: false };
  function create(opts) {
    opts = Object.assign({ project: null, onSkill: null, onEscape: null, onRestart: null, keys: [] }, opts || {});
    const root = h('div', '', D.body); root.id = 'hud-root'; root.hidden = true;
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    const frame = h('div', 'hud-frame', root);
    const hud = { root, frame, opts, s: 1, settings: Object.assign({}, DEFAULTS, store.get('settings', {})) };
    hud.saveSettings = () => store.set('settings', hud.settings);
    hud.tips = Tooltips(root);
    hud.windows = Windows(hud);
    // window hotkeys (lower-case key -> window id); parts add their own (e.g. inventory 'i')
    hud.keymap = { k: 'skills', m: 'map', p: 'char' };
    // Atherion UI parts (ui/*.js, global HUDParts) replace the built-in components one by one; a missing part keeps the old one.
    // Every created component goes into hud.parts: tick(dt) calls .frame(dt), a scale change calls .resize(s).
    const PARTS = global.HUDParts || {};
    hud.parts = [];
    const part = (name, fallback) => { const c = PARTS[name] ? PARTS[name](hud) : (fallback ? fallback() : null); if (c) hud.parts.push(c); return c; };
    hud.menu = { sync() {} };                                     // real menu strip arrives below; windows may sync before it exists
    hud.player = part('player', () => PlayerStatus(hud));
    hud.party = part('party', () => PartyFrames(hud));
    hud.target = part('target', () => TargetStatus(hud));
    hud.minimap = part('minimap', () => MinimapHUD(hud));
    hud.compass = part('compass', null);
    hud.effects = part('effects', null);
    hud.quests = part('quests', () => QuestTracker(hud));
    hud.actions = part('actions', () => ActionBar(hud));
    hud.xp = part('xp', () => ExperienceBar(hud));
    hud.log = part('chat', () => LogPanel(hud));
    hud.charWin = part('charwin', () => CharacterWindow(hud));
    hud.skillsWin = part('skillswin', () => SkillsWindow(hud));
    hud.mapWin = part('worldmap', () => MapWindow(hud));
    hud.inventory = part('inventory', null);
    part('menuwin', () => MenuWindow(hud));
    hud.menu = part('menustrip', () => UtilityMenu(hud, [
      { id: 'char', label: 'Karakter', key: 'P', icon: 'character' },
      { id: 'skills', label: 'Yetenekler', key: 'K', icon: 'skills' },
      { id: 'map', label: 'Harita', key: 'M', icon: 'map' },
      { id: 'menu', label: 'Menü', key: 'Esc', icon: 'menu' },
    ]));
    hud.fb = part('feedback', () => CombatFeedback(hud));
    hud.plates = part('nameplates', null);                       // world-anchored name plates (state.plates)
    let perf = {};
    // UI scale: discrete steps per resolution class (not a fractional zoom of the whole page)
    hud.applyScale = () => {
      const st = hud.settings.scale, H = innerHeight;
      const s = st === 'auto' ? (H < 840 ? 0.875 : H < 1180 ? 1 : H < 1520 ? 1.2 : 1.45) : +st;
      hud.s = s; root.style.setProperty('--s', String(s));
      for (const c of hud.parts) { if (c.resize) c.resize(s); else if (c.redraw) c.redraw(); }
    };
    hud.applyPerf = () => { hud.minimap.perf.hidden = !hud.settings.perf; };
    hud.applyVisibility = () => { hud.minimap.root.hidden = !hud.settings.showMap; hud.log.root.hidden = !hud.settings.showLog; };
    addEventListener('resize', hud.applyScale);
    hud.applyScale(); hud.applyPerf(); hud.applyVisibility(); hud.log.applySettings(hud.settings);

    // ---------- public API ----------
    Object.assign(hud, {
      show() { root.hidden = false; hud.applyScale(); },
      hide() { root.hidden = true; hud.tips.hide(); },
      get visible() { return !root.hidden; },
      setPlayerInfo(info) { hud.info = info; hud.player.setInfo(info); hud.charWin.setInfo(info); },
      setSkills(skills, basic) {
        hud.skills = skills; hud.basic = basic;
        hud.actions.setSkills(skills, basic, (i) => opts.onSkill && opts.onSkill(i));
        hud.skillsWin.set(skills, basic);
      },
      // state: { player, exp, skills: [slot state], target, map, stats }
      // state: { player, exp, skills, target, map, stats, walk, inventory }
      update(state) {
        hud.state = state;
        if (state.player) {
          hud.player.set(state.player); hud.fb.dead(state.player.dead); toggle(root, 'hud-root-dead', state.player.dead);
          if (hud.effects) hud.effects.set(state.player.buffs || []);
        }
        if (state.skills) hud.actions.update(state.skills, state);
        if (state.exp) hud.xp.set(state.exp);
        hud.target.set(state.target || null, state);
        if (state.map) { hud.minimap.set(state.map); if (hud.compass) hud.compass.set(state.map); }
        if (hud.inventory && hud.inventory.set) hud.inventory.set(state);
        if (hud.plates) hud.plates.set(state.plates || [], state);
      },
      tick(dt) {
        if (root.hidden) return;
        for (const c of hud.parts) if (c.frame) c.frame(dt);
        if (hud.state) hud.charWin.update(hud.state, dt);
      },
      setQuests(list) { hud.quests.set(list); },
      setParty(list) { hud.party.set(list); },
      setPerf(p) { Object.assign(perf, p); hud.minimap.perf.textContent = (perf.fps ? perf.fps + ' fps' : '') + (perf.tris ? ' · ' + fmt(perf.tris) + ' üçgen' : ''); },
      combatText(pos, text, kind) { hud.fb.number(pos, text, kind); },
      xpGain(n) { hud.xp.gain(n); },
      levelUp(level) { hud.fb.levelUp(level); hud.xp.levelUp(); },
      error(text) { hud.fb.error(text); },
      hurt() { hud.fb.hurt(); },
      logLine(ch, text, tone) { return hud.log.add(ch, text, tone); },
      combo(n) { hud.actions.combo(n); },
      pressed(i) { hud.actions.pressed(i); },
      deny(i) { hud.actions.deny(i); },
      // keyboard routing; returns true when the HUD consumed the key (the game must then ignore it)
      onKeyDown(e) {
        if (root.hidden) return false;
        const t = e.target, typing = t && ((t.tagName === 'INPUT' && /^(text|search|email|number|password)$/.test(t.type)) || t.tagName === 'TEXTAREA' || t.isContentEditable);
        if (typing) { if (e.key === 'Escape') t.blur(); return true; }      // keys typed into HUD controls never reach gameplay
        if (e.key === 'Escape') {
          if (hud.windows.closeTop()) return true;
          if (opts.onEscape && opts.onEscape()) return true;            // e.g. clear the current target
          hud.windows.show('menu'); return true;
        }
        if (e.repeat || e.ctrlKey || e.altKey || e.metaKey) return false;
        if (e.key === 'Enter' && hud.log.focus) { hud.log.focus(); return true; }   // chat input (Atherion: "ENTER Mesajını yaz")
        const k = e.key.toLowerCase();
        if (hud.keymap[k] && hud.windows.reg[hud.keymap[k]]) { hud.windows.toggle(hud.keymap[k]); return true; }
        return false;
      },
    });
    return hud;
  }

  global.GameHUD = { create, version: 1 };
})(window);
