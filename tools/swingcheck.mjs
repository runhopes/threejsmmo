// Swing quality check for profile attacks (deterministic, preview.html):  node tools/swingcheck.mjs [attack1,attack2,attack3] [--table]
// Measures what made the old knight swings read "robotic" and prints PASS/FAIL against targets:
//   elbow   - chambered in the windup (min <= 110 deg), extended at contact (>= 150 deg)          (180 = straight arm)
//   wrist   - share of frames pinned at the wrist clamp (WRIST_MIN 34 deg / WRIST_MAX 149 deg) <= 15 %
//   speed   - strike peak hand speed (deg/s round the shoulder) >= 1.8x the windup peak
//   freeze  - longest stretch before contact with hand speed < 12 % of the strike peak <= 0.09 s
//   stutter - dips (> 25 %) in hand speed between the start of the drive and contact: 0
//   chain   - hips -> chest -> hand -> tip speed peaks in this order around the strike
//   contact - tip speed at contact >= 45 % of the tip peak (the blade is still travelling when it lands)
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const args = process.argv.slice(2);
const names = (args.find((a) => !a.startsWith('--')) || 'attack1,attack2,attack3').split(',');
const table = args.includes('--table');
const url = pathToFileURL(path.resolve(import.meta.dirname, '..', 'preview.html')).href;
const browser = await chromium.launch({ channel: 'msedge', args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
page.on('pageerror', (e) => console.log('pageerror: ' + e.message));
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true);
let fails = 0;
for (const n of names) {
  const r = await page.evaluate((n) => {
    const K = window.__knight, d = KNIGHT_DEFS[n], N = 400, V = THREE.Vector3, J = K.J, root = K.root, D = 180 / Math.PI;
    K.revive(); root.position.set(0, 0, 0); root.rotation.y = 0;
    const rows = [];
    for (let i = 0; i <= N; i++) {
      const t = d.dur * i / N;
      root.position.z = K._lungeAt(d, t);
      const p = K.evalPose(n, t); K._applyPose(p); K._applyIK(p); root.updateMatrixWorld(true);
      const sh = J.shR.getWorldPosition(new V()), el = J.elR.getWorldPosition(new V()), wr = J.wristR.getWorldPosition(new V());
      const tip = K.sword.localToWorld(new V(0, 1.17, 0)), base = K.sword.localToWorld(new V(0, 0.2, 0));
      const elbow = sh.clone().sub(el).angleTo(wr.clone().sub(el)) * D;
      const wrist = wr.clone().sub(el).normalize().angleTo(tip.clone().sub(base).normalize()) * D;
      rows.push({ t, u: t / d.dur, elbow, wrist, hv: wr.clone().sub(sh).normalize(), tip,
        hip: p['hips.ry'] || 0, chest: (p['hips.ry'] || 0) + (p['spine.ry'] || 0) + (p['chest.ry'] || 0) });
    }
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1], c = rows[i], dt = c.t - a.t;
      c.w = a.hv.angleTo(c.hv) / dt * D; c.tv = c.tip.distanceTo(a.tip) / dt;
      c.hw = Math.abs(c.hip - a.hip) / dt * D; c.cw = Math.abs(c.chest - a.chest) / dt * D;
    }
    rows[0].w = rows[0].tv = rows[0].hw = rows[0].cw = 0;
    const ph = d.phases, inR = (c, a, b) => c.u >= a && c.u <= b;
    const pk = (key, a, b) => rows.filter((c) => inR(c, a, b)).reduce((m, c) => (c[key] > m.v ? { v: c[key], u: c.u } : m), { v: 0, u: 0 });
    // a chained hit (2nd / 3rd) never plays from u 0: it starts at chainSkip out of the previous hit's follow-through
    const u0 = KNIGHT_COMBO.indexOf(n) > 0 ? (d.chainSkip || 0) : 0;
    const wind = pk('w', u0, ph.antic - 0.02), strike = pk('w', ph.antic - 0.02, ph.follow);
    const elbowWind = Math.min(...rows.filter((c) => inR(c, 0.12, ph.antic)).map((c) => c.elbow));
    const elbowContact = rows.filter((c) => Math.abs(c.u - ph.contact) < 0.015).reduce((s, c, _, A) => s + c.elbow / A.length, 0);
    const clamp = rows.filter((c) => Math.abs(c.wrist - 34.38) < 0.6 || Math.abs(c.wrist - 148.97) < 0.6).length / rows.length;
    let freeze = 0, run = 0;
    for (const c of rows) { if (inR(c, 0.05, ph.contact) && c.w < 0.12 * strike.v) { run += d.dur / N; freeze = Math.max(freeze, run); } else run = 0; }
    // stutter: from the last speed minimum before the strike peak (start of the drive) to contact, count dips deeper than 25 %
    const sIdx = rows.findIndex((c) => c.u >= strike.u);
    let a0 = sIdx; while (a0 > 1 && rows[a0 - 1].w <= rows[a0].w + 1e-6) a0--;
    let dips = 0, hi = 0;
    for (let i = a0; i < rows.length && rows[i].u <= ph.contact; i++) { const v = rows[i].w; if (v > hi) hi = v; else if (hi > 0 && v < 0.75 * hi) { dips++; hi = v; } }
    const tipPk = pk('tv', ph.antic, ph.follow);
    const tipC = rows.filter((c) => Math.abs(c.u - ph.contact) < 0.01).reduce((s, c, _, A) => s + c.tv / A.length, 0);
    const chain = { hips: pk('hw', ph.antic - 0.12, ph.contact + 0.05).u, chest: pk('cw', ph.antic - 0.12, ph.contact + 0.05).u, hand: strike.u, tip: tipPk.u };
    const tab = rows.filter((_, i) => i % 16 === 0).map((c) => [c.u.toFixed(2), c.elbow.toFixed(0), c.wrist.toFixed(0), c.w.toFixed(0), c.tv.toFixed(1)].join('\t'));
    return { n, dur: d.dur, elbowWind, elbowContact, clamp, windPk: wind.v, strikePk: strike.v, ratio: strike.v / Math.max(1, wind.v), freeze, dips, chain, tipPk: tipPk.v, tipC, tab };
  }, n);
  const ord = r.chain.hips <= r.chain.chest && r.chain.chest <= r.chain.hand + 0.005 && r.chain.hand <= r.chain.tip + 0.005;
  const checks = [
    ['elbow windup <= 110', r.elbowWind <= 110, r.elbowWind.toFixed(0) + ' deg'],
    ['elbow contact >= 150', r.elbowContact >= 150, r.elbowContact.toFixed(0) + ' deg'],
    ['wrist clamp <= 15%', r.clamp <= 0.15, (r.clamp * 100).toFixed(0) + ' %'],
    ['strike/windup >= 1.8', r.ratio >= 1.8, r.ratio.toFixed(2) + ' (' + r.strikePk.toFixed(0) + ' / ' + r.windPk.toFixed(0) + ' deg/s)'],
    ['freeze <= 0.09 s', r.freeze <= 0.09, r.freeze.toFixed(3) + ' s'],
    ['stutter = 0', r.dips === 0, r.dips + ' dips'],
    ['chain order', ord, 'hips ' + r.chain.hips.toFixed(3) + ' chest ' + r.chain.chest.toFixed(3) + ' hand ' + r.chain.hand.toFixed(3) + ' tip ' + r.chain.tip.toFixed(3)],
    ['tip at contact >= 45%', r.tipC >= 0.45 * r.tipPk, (r.tipC / Math.max(1e-6, r.tipPk) * 100).toFixed(0) + ' % (' + r.tipC.toFixed(1) + ' / ' + r.tipPk.toFixed(1) + ' m/s)'],
  ];
  const nf = checks.filter((c) => !c[1]).length; fails += nf;
  console.log(`\n${n} (${r.dur}s) — ${nf ? nf + ' FAIL' : 'all PASS'}`);
  for (const [label, ok, val] of checks) console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(22)} ${val}`);
  if (table) { console.log('  u\telbow\twrist\thand°/s\ttip m/s'); for (const l of r.tab) console.log('  ' + l); }
}
await browser.close();
console.log(fails ? `\n${fails} check(s) failed` : '\nall checks passed');
