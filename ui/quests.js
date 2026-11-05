/* TDS - quest tracker (HUD slot `quests`), ported 1:1 from Atherion scripts/quest/quest_tracker_view.gd
 * (v4 "Kuşak", ADR-0163 / ADR-0176; docs gorev_takipci_tasarim_v4.html, gorev_sol_sutun_ve_harita_isareti_tasarim.html).
 *
 * Left column, top-left (TOP_OFFSET 20; the party panel pushes it down, see ui/party.js), at most four rows, newest on top,
 * a dim "+N görev daha" line when more quests are active. Per quest three drawn surfaces: the BAND (ink from the screen edge,
 * as long as its text, fading out to the right), the SPINE (4 px progress rail on the screen edge) and the SIGIL (quest kind).
 * One-shot animations (no loops): accept slide-in + ink flash, ready strike + stamp punch + jade spine fill, objective-done
 * flash, height settle (0.18 s), exit slide-out (with an ash farewell flash when a ready quest leaves the list = turned in).
 *
 * API: set(list) — list = [{ id, title, objectives: [{ text, cur, max, done }], done, distance }]
 *   done = every objective met, waiting to be turned in (Atherion HAZIR: stamp "TESLİM ET", jade spine, ready sigil).
 *   Optional (ignored when absent, never guessed): desc (Atherion's one-line quest sentence), kind ('kill' | 'fetch' | 'talk' |
 *   'discover' | 'interact' | 'useitem'), tracked (amber sigil = on the compass). `distance` is not drawn: Atherion's tracker
 *   has no distance (the compass marker carries it).
 *   Card mapping (UIUtils.objective_rows_labeled): several objectives -> labelled rows "7/10 Bozkır Kurdu" (an objective without
 *   `max` has no counter); ONE objective -> a labelled row for hunt / gather kinds when there is a `desc`, otherwise its counter
 *   sits next to the name (Atherion's status slot) and, without `desc`, the objective text becomes the card's sentence.
 *   Sigil kind without `kind`: the verb of the first unfinished objective (öldür / konuş / topla ...), else Atherion's "fetch".
 * Also: setTopOffset(y) / baseTopOffset() (called by the party panel), frame(dt), resize(s).
 * Clicks: only when the game passes hud.opts.onQuestClick(id) do rows take the mouse (hover darkens the ink, like Atherion);
 * otherwise the column is click-through.
 * Units: Atherion canvas px (1920x1080 design), panel-local x (0 = screen x LEFT_MARGIN), scaled by hud.s.
 */
(function (global) {
  'use strict';
  const P = global.HUDPaint, D = document;

  /* ---------- geometry (quest_tracker_view.gd constants) ---------- */
  const PANEL_W = 380, ROW_SEP = 6, LEFT = 10, TOP_OFFSET = 20, MAX_ROWS = 4;
  const HINT_GAP = 10, HINT_H = 22, HINT_ROW_H = HINT_GAP + HINT_H - ROW_SEP, HINT_ALPHA = 0.62, HINT_SOLID_PAD = 30, HINT_FADE = 70,
    HINT_BASE = 15, HINT_KEY_GAP = 10, HINT_KEY_BOX = 14, HINT_KEY_STROKE = 'rgba(196,182,154,.55)';
  const BAND_INK = '11,8,5', BAND_ALPHA = 0.80, BAND_HOVER = 0.08, BAND_MAX = 0.97, BAND_TAIL = 22, BAND_FADE = 120, BAND_SOLID_MAX = 402;
  const LIP = ['227,211,183', 0.20], FLOOR = ['0,0,0', 0.45];
  const SPINE_X = -LEFT, SPINE_W = 4, SPINE_TRACK = 'rgba(196,182,154,.16)', SPINE_EDGE = 'rgba(0,0,0,.55)';
  const SIGIL_CX = 12, SIGIL_CY = 17;
  const TEXT_X = 30, TEXT_W = 340, PAD_TOP = 8, NAME_LINE_H = 20, NAME_BASE = 23, DESC_TOP = 30, DESC_STEP = 17, DESC_BASE = 13,
    DESC_MAX = 2, DESC_PAD = 8, STATUS_GAP = 12;
  const OBJ_GAP = 4, OBJ_ROW = 18, OBJ_BASE = 13, OBJ_PAD = 8, OBJ_COUNT_RIGHT = TEXT_X + 38 - 10, OBJ_NAME_X = TEXT_X + 38,
    OBJ_NAME_W = TEXT_X + TEXT_W - OBJ_NAME_X;
  const SHADOW_A = 0.62;   // TEXT_SHADOW: 1 px hard shadow under every line (engraved)

  /* ---------- palette ("Kül ve Kehribar") ---------- */
  const ASH = '#958365', ASH_HI = '#E3D3B7', BONE = '#C4B69A', AMBER = '#E2C78F', NAME_HOVER = '#F0E4CC', DESC = '#D2C4AB';
  const READY = '#9ED6A6', DONE_FILL = 'rgba(115,170,126,.92)', DONE_FLASH = '#BDEEC4';
  const WASH_READY = ['77,199,107', 0.26], WASH_PENDING = ['242,194,56', 0.15], STATE_FLASH_GAIN = 0.25;
  const CLAIM_FLASH = ['227,211,183', 0.30];

  /* ---------- fonts (Cinzel = name / counts / stamp, Alegreya 600 = body) ---------- */
  const FN = {
    name: P.F.cinzel(700, 16), count: P.F.cinzel(700, 12), stamp: P.F.cinzel(800, 11), key: P.F.cinzel(700, 10),
    desc: P.F.serif(600, 13), hint: P.F.serif(600, 12),
  };
  const NAME_TRACK = 1, STAMP_TRACK = 1.4, STAMP_TEXT = 'TESLİM ET';   // tr_upper(tr("QUEST_TRACKER_READY_TAG"))

  /* ---------- animation timings (seconds) ---------- */
  const ACCEPT_S = 0.40, ACCEPT_FROM = -28, ACCEPT_FLASH_S = 0.52, ACCEPT_GAIN = 0.18;
  const STRIKE_S = 0.22, STRIKE_SCALE = 0.986, STRIKE_INK_S = 0.24, STRIKE_INK_A = 0.42;
  const STAMP_PUNCH_SCALE = 1.45, READY_REVEAL_S = 0.60, STAMP_RATIO = 0.28 / 0.60, INLAY_DELAY_R = 0.10 / 0.60, INLAY_RATIO = 0.36 / 0.60;
  const CLAIM_FLASH_S = 0.26, CLAIM_HOLD_S = 0.10, CLAIM_FADE_S = 0.42, CLAIM_SLIDE_TO = -(PANEL_W + 40), CLAIM_EXIT_SCALE = 0.90, CLAIM_POP_SCALE = 1.06;
  const DONE_FLASH_S = 0.45, RESIZE_S = 0.18;

  // Godot Tween easings (Penner)
  const E = {
    lin: (t) => t,
    quadOut: (t) => 1 - (1 - t) * (1 - t),
    cubicOut: (t) => 1 - (1 - t) * (1 - t) * (1 - t),
    backOut: (t) => { const c = 1.70158; t -= 1; return t * t * ((c + 1) * t + c) + 1; },
    backIn: (t) => { const c = 1.70158; return t * t * ((c + 1) * t - c); },
    sineIn: (t) => 1 - Math.cos(t * Math.PI * 0.5),
  };
  const seg = (t, delay, dur, a, b, ease) => a + (b - a) * ease(Math.max(0, Math.min(1, (t - delay) / dur)));
  const smooth = (t) => t * t * (3 - 2 * t);

  /* ---------- sigils (SIGIL_SVG, 18 px box centred on 0,0; stroke 1.7, round) ---------- */
  const SIGIL = {
    kill: 'M-3.2 3.2L6.2 -6.2M-6.2 0.6L-0.6 6.2M-3.4 3.4L-6.4 6.4',
    fetch: 'M-2.4 -2.6C-7.6 -0.6 -7.4 7 0 7C7.4 7 7.6 -0.6 2.4 -2.6M-3.4 -2.8L3.4 -2.8M-2 -3L-3.2 -6.4L3.2 -6.4L2 -3',
    talk: 'M-4 -6.5L4 -6.5Q7 -6.5 7 -3.5L7 0.5Q7 3.5 4 3.5L-1 3.5L-4.5 7.2L-3.8 3.5L-4 3.5Q-7 3.5 -7 0.5L-7 -3.5Q-7 -6.5 -4 -6.5Z',
    discover: 'M0 -7L1.8 -1.8L7 0L1.8 1.8L0 7L-1.8 1.8L-7 0L-1.8 -1.8Z',
    interact: 'M-0.5 -3.4A2.9 2.9 0 1 0 -6.3 -3.4A2.9 2.9 0 1 0 -0.5 -3.4ZM-1.3 -1.3L6.2 6.2M3.4 3.4L5.2 1.6M5 5L6.8 3.2',
    useitem: 'M0 -6.5L0 3M-3.6 -0.6L0 3L3.6 -0.6M-6 6.5L6 6.5',
    ready: 'M6.8 0A6.8 6.8 0 1 0 -6.8 0A6.8 6.8 0 1 0 6.8 0ZM-3.3 0.2L-0.9 2.7L3.5 -2.6',
  };
  const KILL_POMMEL = 'M-5.6 6.9A1.3 1.3 0 1 0 -8.2 6.9A1.3 1.3 0 1 0 -5.6 6.9Z';
  const paths = {};
  const path = (d) => paths[d] || (paths[d] = new Path2D(d));
  // Atherion reads the kind from the active stage's first objective; here: the explicit `kind`, else the verb of the first
  // unfinished objective (Turkish), else Atherion's own fallback ("fetch").
  const KIND_VERBS = [['kill', /öldür|avla|\byen\b|yok et|dağıt|temizle/i], ['talk', /konuş|danış|haber ver|söyle/i],
    ['useitem', /bırak|yerleştir|kullan/i], ['interact', /\baç\b|çalıştır|etkileş/i], ['discover', /keşfet|\bbul\b|ulaş|ziyaret/i],
    ['fetch', /topla|getir|götür|teslim/i]];
  const LABELED_SOLO = { kill: 1, fetch: 1 };   // LABELED_SOLO_KINDS kill / drop / item_drop / camp (drop + item_drop draw the pouch)
  function sigilKind(q, objs, ready) {
    if (ready) return 'ready';
    if (q.kind && SIGIL[q.kind] && q.kind !== 'ready') return q.kind;
    const o = objs.find((x) => !objDone(x)) || objs[0];
    const text = o ? String(o.text || '') : '';
    for (const [k, re] of KIND_VERBS) if (re.test(text)) return k;
    return 'fetch';
  }

  /* ---------- text ---------- */
  const mctx = D.createElement('canvas').getContext('2d');
  const mcache = new Map();
  function tw(text, font, ls) {
    const k = font + '|' + (ls || 0) + '|' + text;
    let w = mcache.get(k);
    if (w === undefined) {
      if (mcache.size > 3000) mcache.clear();
      mctx.font = font; mctx.letterSpacing = (ls || 0) + 'px';
      w = mctx.measureText(text).width; mcache.set(k, w);
    }
    return w;
  }
  // engraved line at a BASELINE (Label top = baseline − ascent in the Godot view): hard 1 px shadow, no outline
  function etext(g, text, font, x, base, col, ls) {
    g.font = font; g.letterSpacing = (ls || 0) + 'px'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.fillStyle = 'rgba(0,0,0,' + SHADOW_A + ')'; g.fillText(text, x, base + 1);
    g.fillStyle = col; g.fillText(text, x, base);
  }
  // Label OVERRUN_TRIM_ELLIPSIS: longest prefix + "…" that fits
  function ellipsize(text, font, ls, maxW, trimSep) {
    if (tw(text, font, ls) <= maxW) return text;
    let lo = 0, hi = text.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (tw(text.slice(0, mid).trimEnd() + '…', font, ls) <= maxW) lo = mid; else hi = mid - 1;
    }
    let s = text.slice(0, lo).trimEnd();
    if (trimSep) s = s.replace(/[,·]+$/, '').trimEnd();
    return s + '…';
  }
  // AUTOWRAP_WORD_SMART at TEXT_W, max DESC_MAX lines; overflow -> the last visible line gets "…"
  function wrapDesc(text) {
    const words = text.split(/\s+/).filter(Boolean), lines = [];
    let cur = '';
    for (const w of words) {
      const t = cur ? cur + ' ' + w : w;
      if (tw(t, FN.desc) <= TEXT_W) { cur = t; continue; }
      if (cur) lines.push(cur);
      cur = w;
      while (tw(cur, FN.desc) > TEXT_W && cur.length > 1) {          // a single word wider than the strip breaks by letters
        let n = cur.length - 1;
        while (n > 1 && tw(cur.slice(0, n), FN.desc) > TEXT_W) n--;
        lines.push(cur.slice(0, n)); cur = cur.slice(n);
      }
    }
    if (cur) lines.push(cur);
    if (lines.length > DESC_MAX) {                          // Godot: the last VISIBLE line keeps its own words + "…"
      lines.length = DESC_MAX;
      let last = lines[DESC_MAX - 1];
      while (last.length > 1 && tw(last + '…', FN.desc) > TEXT_W) last = last.slice(0, -1);
      lines[DESC_MAX - 1] = last.trimEnd() + '…';
    }
    return lines;
  }

  /* ---------- band: x0..solidEnd flat, then `fade` px smoothstep to zero (BAND_FADE_STEPS = 10) ---------- */
  function band(g, x0, y, h, solidEnd, fade, rgb, a) {
    if (h <= 0 || a <= 0) return;
    const end = solidEnd + fade, span = end - x0;
    const gr = g.createLinearGradient(x0, 0, end, 0);
    const c = (al) => 'rgba(' + rgb + ',' + al.toFixed(4) + ')';
    gr.addColorStop(0, c(a));
    gr.addColorStop(Math.max(0, (solidEnd - x0) / span), c(a));
    for (let i = 1; i <= 10; i++) { const t = i / 10; gr.addColorStop(Math.min(1, (solidEnd - x0 + t * fade) / span), c(a * (1 - smooth(t)))); }
    g.fillStyle = gr; g.fillRect(x0, y, span, h);
  }

  /* ---------- data -> card model ---------- */
  const num = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);
  const objMax = (o) => (num(o.max) > 0 ? Math.round(o.max) : 0);
  const objCur = (o) => { const m = objMax(o); return m ? Math.max(0, Math.min(m, Math.round(num(o.cur)))) : 0; };
  const objDone = (o) => !!o.done || (objMax(o) > 0 && objCur(o) >= objMax(o));

  function build(c, q) {
    const objs = Array.isArray(q.objectives) ? q.objectives.filter((o) => o && (o.text || objMax(o))) : [];
    let desc = typeof q.desc === 'string' ? q.desc.trim() : '', rows = [], status = null, solo = null;
    const kind = sigilKind(q, objs, false);
    // UIUtils.objective_rows_labeled: several objectives -> always labelled rows; ONE objective -> a labelled row only for
    // hunt / gather kinds, otherwise its counter sits in the status slot next to the name
    if (objs.length === 1 && (!desc || !LABELED_SOLO[kind])) {
      solo = objs[0];
      if (!desc) desc = String(solo.text || '').trim();
      if (objMax(solo)) status = { head: String(objCur(solo)), tail: '/' + objMax(solo) };
    } else {
      rows = objs.map((o) => ({ name: String(o.text || ''), max: objMax(o), cur: objCur(o), done: objDone(o) }));
    }
    c.ready = !!q.done;
    c.kind = c.ready ? 'ready' : kind;
    c.tracked = !!q.tracked;
    c.title = String(q.title || '');
    c.rows = rows; c.solo = solo; c.status = status; c.desc = desc;
    // progress (spine): every objective counts with its target; an objective without a target is one unit
    let cur = 0, tot = 0;
    for (const o of objs) { const m = objMax(o) || 1; tot += m; cur += objMax(o) ? objCur(o) : objDone(o) ? 1 : 0; }
    c.ratio = tot ? Math.min(1, cur / tot) : 0;
    measure(c);
  }
  // title + status slot + band length + height (re-run when fonts arrive)
  function measure(c) {
    c.lines = c.desc ? wrapDesc(c.desc) : [];
    const statusOn = !c.ready && !!c.status;
    const statusW = c.ready ? stampWidth() : statusOn ? tw(c.status.head, FN.count) + tw(c.status.tail, FN.count) : 0;
    const nameMax = TEXT_W - (statusW > 0 ? statusW + STATUS_GAP : 0);
    c.nameText = ellipsize(c.title, FN.name, NAME_TRACK, nameMax);
    const nameW = Math.min(tw(c.title, FN.name, NAME_TRACK), nameMax);
    c.statusX = TEXT_X + nameW + STATUS_GAP;
    c.statusOn = statusOn;
    let right = TEXT_X + nameW + (statusW > 0 ? STATUS_GAP + statusW : 0);
    for (const l of c.lines) right = Math.max(right, TEXT_X + Math.min(tw(l, FN.desc), TEXT_W));
    c.rowText = c.rows.map((r) => ellipsize(r.name, FN.desc, 0, OBJ_NAME_W, true));
    for (const r of c.rows) right = Math.max(right, OBJ_NAME_X + Math.min(tw(r.name, FN.desc), OBJ_NAME_W));
    c.solidEnd = Math.min(right + BAND_TAIL, BAND_SOLID_MAX);
    const descBottom = DESC_TOP + c.lines.length * DESC_STEP;
    if (c.rows.length) { c.objTop = c.lines.length ? descBottom + OBJ_GAP : DESC_TOP; c.h = c.objTop + c.rows.length * OBJ_ROW + OBJ_PAD; }
    else c.h = c.lines.length ? descBottom + DESC_PAD : PAD_TOP + NAME_LINE_H + DESC_PAD;
  }
  const stampWidth = () => tw(STAMP_TEXT, FN.stamp, 1) + 0.4 * (STAMP_TEXT.length - 1);
  // which objectives are full (row index, or -1 for the single counter)
  function doneMap(c) {
    const m = {};
    if (c.rows.length) c.rows.forEach((r, i) => { m[i] = r.done; });
    else m[-1] = !!c.solo && objDone(c.solo);
    return m;
  }

  global.HUDParts = global.HUDParts || {};
  global.HUDParts.quests = function (hud) {
    const root = D.createElement('div');
    root.className = 'hud-ath-quests';
    root.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none';
    root.hidden = true;
    hud.frame.appendChild(root);
    const MX = 10, MY = 8;                                  // canvas margin around the column (accept slide, claim pop)
    const S = P.surface(root, '', LEFT + 560, 64, LEFT, MY);
    S.el.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none';
    const hits = D.createElement('div');                    // click targets (only with hud.opts.onQuestClick)
    hits.style.cssText = 'position:absolute;left:0;top:0';
    root.appendChild(hits);

    let display = [];                                        // cards in column order (live + leaving)
    const byId = new Map();                                  // live cards
    const seen = new Map();                                  // id -> { b: batch, i: index } (newest on top)
    let batch = 0, first = true, sig = '', more = 0, top = TOP_OFFSET, dirty = true, H = 0, hintY = -1, canvasH = 0, shown = false;
    const clickable = () => typeof hud.opts.onQuestClick === 'function';

    function newCard(q) {
      const c = { id: String(q.id), sig: JSON.stringify(q), x: 0, alpha: 1, scale: 1, flash: 0, strike: 0, claim: 0, readyPhase: 1,
        acc: null, strikeT: null, readyT: null, rs: null, exit: null, dfl: {}, hover: false, dead: false, y: 0 };
      build(c, q);
      c.hCur = c.h;
      c.doneSeen = doneMap(c);                               // bound already full: no flash
      return c;
    }
    function update(c, q) {
      const s = JSON.stringify(q);
      if (s === c.sig) return;
      c.sig = s;
      const wasReady = c.ready;
      build(c, q);
      if (c.ready && !wasReady) { c.strikeT = 0; c.readyT = 0; c.readyPhase = 0; }   // HAZIR: strike + stamp + jade spine (one shot)
      else if (!c.ready) { c.readyT = null; c.readyPhase = 1; }
      const now = doneMap(c);
      for (const k in now) if (now[k] && !c.doneSeen[k]) c.dfl[k] = 0;
      c.doneSeen = now;
      if (Math.abs(c.h - (c.rs ? c.rs.to : c.hCur)) > 0.01) c.rs = { from: c.hCur, to: c.h, t: 0 };
      dirty = true;
    }
    function leave(c, farewell) {
      byId.delete(c.id);
      c.exit = { t: 0, farewell, x0: c.x, a0: c.alpha, s0: c.scale };
      c.acc = null; c.strikeT = null; c.readyT = null; c.readyPhase = 1; c.rs = null; c.dfl = {}; c.hover = false;
      dirty = true;
    }

    // advance one card's one-shot animations; returns true when something moved this step
    function step(c, dt) {
      let moved = false;
      c.x = 0; c.alpha = 1; c.scale = 1; c.flash = 0; c.strike = 0; c.claim = 0;
      if (c.acc !== null) {
        const t = (c.acc += dt); moved = true;
        c.x = seg(t, 0, ACCEPT_S, ACCEPT_FROM, 0, E.cubicOut);
        c.alpha = seg(t, 0, ACCEPT_S * 0.6, 0, 1, E.lin);
        c.flash = seg(t, 0, ACCEPT_FLASH_S, 1, 0, E.quadOut);
        if (t >= ACCEPT_FLASH_S) c.acc = null;
      }
      if (c.strikeT !== null) {
        const t = (c.strikeT += dt); moved = true;
        c.strike = seg(t, 0, STRIKE_INK_S, 1, 0, E.quadOut);
        c.scale = t < STRIKE_S * 0.45 ? seg(t, 0, STRIKE_S * 0.45, 1, STRIKE_SCALE, E.quadOut)
          : seg(t, STRIKE_S * 0.45, STRIKE_S * 0.55, STRIKE_SCALE, 1, E.backOut);
        if (t >= STRIKE_INK_S) c.strikeT = null;
      }
      if (c.readyT !== null) {
        c.readyT += dt; moved = true;
        c.readyPhase = Math.min(1, c.readyT / READY_REVEAL_S);
        if (c.readyT >= READY_REVEAL_S) c.readyT = null;
      }
      for (const k in c.dfl) { moved = true; if ((c.dfl[k] += dt) >= DONE_FLASH_S) delete c.dfl[k]; }
      if (c.rs) {
        const r = c.rs; r.t += dt; moved = true;
        c.hCur = seg(r.t, 0, RESIZE_S, r.from, r.to, E.cubicOut);
        if (r.t >= RESIZE_S) { c.hCur = r.to; c.rs = null; }
      }
      if (c.exit) {
        const e = c.exit, t = (e.t += dt); moved = true;
        let t0 = 0, s0 = e.s0;
        if (e.farewell) {                                    // ash farewell flash + small pop + hold, then the slide
          c.claim = seg(t, 0, CLAIM_FLASH_S, 1, 0, E.quadOut);
          t0 = CLAIM_FLASH_S + CLAIM_HOLD_S;
          s0 = seg(t, 0, CLAIM_FLASH_S * 0.4, e.s0, CLAIM_POP_SCALE, E.quadOut);
        }
        c.scale = t < t0 ? s0 : seg(t, t0, CLAIM_FADE_S, s0, CLAIM_EXIT_SCALE, E.sineIn);
        c.x = seg(t, t0, CLAIM_FADE_S, e.x0, CLAIM_SLIDE_TO, E.backIn);
        c.alpha = seg(t, t0, CLAIM_FADE_S * 0.85, e.a0, 0, E.sineIn);
        if (t >= t0 + CLAIM_FADE_S) c.dead = true;
      }
      return moved;
    }
    const maxFlash = (c) => { let m = 0; for (const k in c.dfl) m = Math.max(m, seg(c.dfl[k], 0, DONE_FLASH_S, 1, 0, E.quadOut)); return m; };
    const flashOf = (c, k) => (c.dfl[k] === undefined ? 0 : seg(c.dfl[k], 0, DONE_FLASH_S, 1, 0, E.quadOut));

    /* ---------- drawing ---------- */
    function drawCard(g, c) {
      const h = c.hCur;
      if (h <= 0) return;
      g.save();
      g.globalAlpha = Math.max(0, Math.min(1, c.alpha));
      g.translate(c.x, c.y);
      if (c.scale !== 1) { g.translate(PANEL_W * 0.5, h * 0.5); g.scale(c.scale, c.scale); g.translate(-PANEL_W * 0.5, -h * 0.5); }
      // (1) BAND: ink (+hover / accept / strike), state wash (ready green, pending amber; flashes when an objective fills),
      //     ash farewell light, 1 px lip, floor
      const a = BAND_ALPHA + (c.hover ? BAND_HOVER : 0) + ACCEPT_GAIN * c.flash + STRIKE_INK_A * c.strike;
      band(g, -LEFT, 0, h, c.solidEnd, BAND_FADE, BAND_INK, Math.min(a, BAND_MAX));
      const wash = c.ready ? WASH_READY : WASH_PENDING;
      band(g, -LEFT, 0, h, c.solidEnd, BAND_FADE, wash[0], Math.min(wash[1] + STATE_FLASH_GAIN * maxFlash(c), 0.5));
      if (c.claim > 0) band(g, -LEFT, 0, h, c.solidEnd, BAND_FADE, CLAIM_FLASH[0], CLAIM_FLASH[1] * c.claim);
      band(g, -LEFT, 0, 1, c.solidEnd, BAND_FADE, LIP[0], LIP[1]);
      band(g, -LEFT, h - 1, 1, c.solidEnd, BAND_FADE, FLOOR[0], FLOOR[1]);
      // (2) SPINE: track, fill from the top (amber; green when every objective of the stage is met; jade when ready), edge
      g.fillStyle = SPINE_TRACK; g.fillRect(SPINE_X, 0, SPINE_W, h);
      let r = c.ready ? 1 : c.ratio;
      if (c.ready) r *= Math.max(0, Math.min(1, (c.readyPhase - INLAY_DELAY_R) / INLAY_RATIO));
      const fh = Math.round(h * Math.max(0, Math.min(1, r)));
      if (fh > 0) {
        g.fillStyle = c.ready ? READY : c.ratio >= 1 ? DONE_FILL : AMBER; g.fillRect(SPINE_X, 0, SPINE_W, fh);
        const fl = maxFlash(c);
        if (fl > 0) { g.fillStyle = P.rgba(DONE_FLASH, fl); g.fillRect(SPINE_X, 0, SPINE_W, fh); }
      }
      g.fillStyle = SPINE_EDGE; g.fillRect(SPINE_X + SPINE_W, 0, 1, h);
      // (3) SIGIL: jade when ready, amber when tracked on the compass, else bone
      drawSigil(g, c.kind, c.ready ? READY : c.tracked ? AMBER : BONE);
      if (c.ready) drawStamp(g, c);
      if (c.rows.length) drawRows(g, c);
      // labels (children of the card in Godot: drawn over its own _draw)
      etext(g, c.nameText, FN.name, TEXT_X, NAME_BASE, c.hover ? NAME_HOVER : ASH_HI, NAME_TRACK);
      if (c.statusOn) {
        etext(g, c.status.head, FN.count, c.statusX, NAME_BASE, ASH_HI);
        etext(g, c.status.tail, FN.count, c.statusX + tw(c.status.head, FN.count), NAME_BASE, BONE);
      }
      c.lines.forEach((l, i) => etext(g, l, FN.desc, TEXT_X, DESC_TOP + DESC_BASE + i * DESC_STEP, DESC));
      g.restore();
    }
    function drawSigil(g, kind, col) {
      const p = path(SIGIL[kind] || SIGIL.fetch);
      for (const pass of [0, 1]) {
        g.save(); g.translate(SIGIL_CX, SIGIL_CY + (pass ? 0 : 1));
        g.lineWidth = 1.7; g.lineCap = 'round'; g.lineJoin = 'round';
        g.strokeStyle = g.fillStyle = pass ? col : 'rgba(0,0,0,.6)';
        g.stroke(p);
        if (kind === 'kill') g.fill(path(KILL_POMMEL));
        g.restore();
      }
    }
    // "TESLİM ET": no frame, right after the name; punched 1.45 -> 1.0 from its centre (one shot)
    function drawStamp(g, c) {
      const p = Math.max(0, Math.min(1, c.readyPhase / STAMP_RATIO)), e = 1 - Math.pow(1 - p, 3);
      const sc = STAMP_PUNCH_SCALE + (1 - STAMP_PUNCH_SCALE) * e, al = Math.min(1, p * 1.6);
      if (al <= 0) return;
      const w = stampWidth();
      g.save();
      g.translate(c.statusX + w * 0.5, NAME_BASE - 4); g.scale(sc, sc);
      g.font = FN.stamp; g.letterSpacing = STAMP_TRACK + 'px'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
      g.fillStyle = 'rgba(0,0,0,' + (SHADOW_A * al).toFixed(3) + ')'; g.fillText(STAMP_TEXT, -w * 0.5, 5);
      g.fillStyle = P.rgba(READY, al); g.fillText(STAMP_TEXT, -w * 0.5, 4);
      g.restore();
    }
    // objective rows: counter first (right-aligned 38 px column), then the name; a full objective fades to ash
    function drawRows(g, c) {
      c.rows.forEach((r, i) => {
        const base = c.objTop + i * OBJ_ROW + OBJ_BASE;
        if (r.max) {
          const head = String(r.cur), tail = '/' + r.max, fl = flashOf(c, i);
          let hc = r.done ? ASH : ASH_HI, tc = r.done ? ASH : BONE;
          if (fl > 0) { hc = P.mix(hc, DONE_FLASH, fl); tc = P.mix(tc, DONE_FLASH, fl); }
          const wt = tw(tail, FN.count);
          etext(g, tail, FN.count, OBJ_COUNT_RIGHT - wt, base, tc);
          etext(g, head, FN.count, OBJ_COUNT_RIGHT - wt - tw(head, FN.count), base, hc);
        }
        if (c.rowText[i]) etext(g, c.rowText[i], FN.desc, OBJ_NAME_X, base, r.done ? ASH : DESC);
      });
    }
    function journalKey() {                                  // "+N görev daha · L": only when a quest window exists
      for (const k in hud.keymap) { const id = hud.keymap[k]; if ((id === 'quests' || id === 'journal') && hud.windows.reg && hud.windows.reg[id]) return k.toUpperCase(); }
      return '';
    }
    function drawHint(g, y) {
      const t = y + HINT_GAP - ROW_SEP, text = '+' + more + ' görev daha', w = tw(text, FN.hint);
      band(g, -LEFT, t, HINT_H, TEXT_X + w + HINT_SOLID_PAD, HINT_FADE, BAND_INK, HINT_ALPHA);
      etext(g, text, FN.hint, TEXT_X, t + HINT_BASE, BONE);
      const key = journalKey();
      if (!key) return;
      const kx = TEXT_X + w + HINT_KEY_GAP, ky = t + 4;
      g.strokeStyle = HINT_KEY_STROKE; g.lineWidth = 1; g.strokeRect(kx + 0.5, ky + 0.5, HINT_KEY_BOX, HINT_KEY_BOX);
      etext(g, key, FN.key, kx + (HINT_KEY_BOX + 1 - tw(key, FN.key)) * 0.5, ky + 11.5, BONE);
    }

    function layout() {
      let y = 0;
      for (const c of display) { c.y = y; y += c.hCur + ROW_SEP; }
      H = display.length ? y - ROW_SEP : 0;
      hintY = -1;
      if (more > 0 && byId.size > 0) { hintY = H + ROW_SEP; H = hintY + HINT_ROW_H; }
    }
    function place() {
      const s = hud.s;
      S.el.style.top = ((top - MY) * s) + 'px';
      hits.style.top = (top * s) + 'px';
    }
    function syncHits() {
      const on = clickable();
      const live = on ? display.filter((c) => !c.exit) : [];
      while (hits.children.length > live.length) hits.lastChild.remove();
      while (hits.children.length < live.length) {
        const d = D.createElement('div');
        d.style.cssText = 'position:absolute;pointer-events:auto;cursor:pointer';
        d.addEventListener('mousedown', (e) => e.preventDefault());
        d.addEventListener('mouseenter', () => { const c = byId.get(d._qid); if (c) { c.hover = true; dirty = true; } });
        d.addEventListener('mouseleave', () => { const c = byId.get(d._qid); if (c) { c.hover = false; dirty = true; } });
        d.addEventListener('click', (e) => { e.stopPropagation(); if (d._qid !== undefined && clickable()) hud.opts.onQuestClick(d._qid); });
        hits.appendChild(d);
      }
      const s = hud.s;
      live.forEach((c, i) => {
        const d = hits.children[i];
        if (d._qid !== c.id) { const o = byId.get(d._qid); if (o) o.hover = false; d._qid = c.id; }
        d.style.left = (LEFT * s) + 'px'; d.style.top = (c.y * s) + 'px'; d.style.width = (PANEL_W * s) + 'px'; d.style.height = (c.hCur * s) + 'px';
      });
    }
    function draw() {
      layout();
      const need = Math.max(64, Math.ceil((H + MY * 2) / 32) * 32);
      if (need !== canvasH || S.s !== hud.s) { canvasH = need; S.resize(hud.s, LEFT + 560, need); }
      place();
      const g = S.begin();
      for (const c of display) drawCard(g, c);
      if (hintY >= 0) drawHint(g, hintY);
      syncHits();
    }

    // _order_rows: live cards follow `want`; a leaving card stays glued under the live card that was above it
    function order(wantIds) {
      const rank = new Map(wantIds.map((id, i) => [id, i]));
      let prev = -1;
      const keyed = display.map((c, i) => {
        let k;
        if (!c.exit && rank.has(c.id)) { k = rank.get(c.id); prev = k; } else k = prev + 0.5;
        return [k, i, c];
      });
      keyed.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      display = keyed.map((x) => x[2]);
    }

    const api = {
      root,
      set(list) {
        list = Array.isArray(list) ? list.filter((q) => q && q.id !== undefined && q.id !== null) : [];
        const k = JSON.stringify(list);
        if (k === sig) return;
        sig = k;
        // newest on top: the first batch keeps the game's order, every later arrival goes above it
        const ids = new Set(list.map((q) => String(q.id)));
        for (const id of [...seen.keys()]) if (!ids.has(id)) seen.delete(id);
        let fresh = false;
        list.forEach((q, i) => { const id = String(q.id); if (!seen.has(id)) { seen.set(id, { b: batch, i }); fresh = true; } });
        if (fresh) batch++;
        const want = list.slice().sort((a, b) => { const A = seen.get(String(a.id)), B = seen.get(String(b.id)); return B.b - A.b || A.i - B.i; }).slice(0, MAX_ROWS);
        const wantIds = want.map((q) => String(q.id));
        // 1) out of the column: turned in (a ready quest that left the list) -> farewell; queued / abandoned -> plain slide
        for (const c of [...byId.values()]) if (!wantIds.includes(c.id)) leave(c, c.ready && !ids.has(c.id));
        // 2) in: new rows slide in (not on the very first fill: restored state appears without a show)
        for (const q of want) {
          const id = String(q.id);
          let c = byId.get(id);
          if (c) { update(c, q); continue; }
          c = newCard(q);
          if (!first) c.acc = 0;
          step(c, 0);
          byId.set(id, c); display.push(c);
        }
        order(wantIds);
        more = byId.size ? Math.max(0, list.length - byId.size) : 0;
        first = false;
        dirty = true;
      },
      frame(dt) {
        dt = Math.min(Math.max(dt || 0, 0), 0.1);
        let moved = false;
        for (const c of display) if (step(c, dt)) moved = true;
        if (display.some((c) => c.dead)) { display = display.filter((c) => !c.dead); dirty = true; }
        const show = display.length > 0 && !!hud.settings.showQuests;
        if (show !== shown) { shown = show; root.hidden = !show; dirty = true; }
        if (show && (moved || dirty)) { dirty = false; draw(); }
      },
      resize() { dirty = true; },
      // shared left column (party_controller._sync_quest_tracker): the party panel moves the column's top edge
      baseTopOffset() { return TOP_OFFSET; },
      setTopOffset(y) { if (Math.abs(y - top) < 1e-3) return; top = y; place(); },
    };
    P.onFonts(() => { mcache.clear(); for (const c of display) { const h0 = c.h; measure(c); if (!c.rs && Math.abs(c.hCur - h0) < 0.01) c.hCur = c.h; } dirty = true; });
    return api;
  };
})(window);
