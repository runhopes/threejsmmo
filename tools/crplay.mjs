// In-game creature check with REAL input at the game camera: walk to a camp, screenshot, click-attack a creature.
// node tools/crplay.mjs <outPrefix> [species=rat] [cls=warrior]
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
const out = process.argv[2] || 'shots/creatures/play/p', SP = process.argv[3] || 'rat', CLS = process.argv[4] || 'warrior';
fs.mkdirSync(path.dirname(out), { recursive: true });
const url = pathToFileURL(path.resolve(import.meta.dirname, '..', 'index.html')).href + '?cls=' + CLS + '&spawn=' + (process.env.SPAWN || 'gate_outer') + (process.env.NET ? '&net=' + process.env.NET : '');
const browser = await chromium.launch({ channel: 'msedge', args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const killer = setTimeout(() => { console.log('HARD TIMEOUT'); process.exit(3); }, 220000);
let bad = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => { bad++; console.log('pageerror: ' + e.message); });
  page.on('console', (m) => { if (m.type() === 'error') { bad++; console.log('console: ' + m.text()); } });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  const camp = await page.evaluate((sp) => CREATURE_DEFS.ZONES.find((z) => z.species === sp), SP);
  // walk toward the camp edge with WASD (camera-independent: W = -Z)
  for (let i = 0; i < 160; i++) {
    const s = await page.evaluate(() => ({ x: __knight.root.position.x, z: __knight.root.position.z }));
    const dx = camp.cx - s.x, dz = camp.cz + camp.r + 1.5 - s.z;   // south of the camp (the camera looks north)
    if (Math.hypot(dx, dz) < 1.2) break;
    const keys = []; if (dz < -0.6) keys.push('w'); if (dz > 0.6) keys.push('s'); if (dx < -0.6) keys.push('a'); if (dx > 0.6) keys.push('d');
    for (const k of keys) await page.keyboard.down(k);
    await page.waitForTimeout(220);
    for (const k of keys) await page.keyboard.up(k);
  }
  await page.waitForTimeout(900);
  await page.screenshot({ path: out + '_1_camp.png' });
  // pick the nearest creature of that species and click it repeatedly (left click = select + attack)
  const click = async () => {
    const p = await page.evaluate((sp) => {
      const W = __creatures, kp = __knight.root.position;
      let best = null, bd = 1e9;
      for (const c of W.authority.creatures) if (c.alive && c.sp === sp) { const d = Math.hypot(c.x - kp.x, c.z - kp.z); if (d < bd) { bd = d; best = c; } }
      if (!best) return null;
      const v = new THREE.Vector3(best.x, best.D.height * 0.5, best.z).project(__camera);
      return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight, id: best.id, d: bd, hp: best.hp };
    }, SP);
    if (p) await page.mouse.click(p.x, p.y);
    return p;
  };
  let first = await click();
  console.log('target', JSON.stringify(first));
  // approach while attacking (move with right click onto it, then attack)
  for (let i = 0; i < 60; i++) {
    const p = await page.evaluate((id) => { const c = __creatures.authority.byId.get(id); const kp = __knight.root.position; return c ? { d: Math.hypot(c.x - kp.x, c.z - kp.z), alive: c.alive, hp: c.hp } : null; }, first.id);
    if (!p || !p.alive) break;
    if (p.d > 1.6) {
      const t = await page.evaluate((id) => { const c = __creatures.authority.byId.get(id); const v = new THREE.Vector3(c.x, 0, c.z).project(__camera); return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight }; }, first.id);
      await page.mouse.click(t.x, t.y, { button: 'right' });
      await page.waitForTimeout(300);
    } else { await click(); await page.waitForTimeout(260); }
    if (i === 6) await page.screenshot({ path: out + '_2_fight.png' });
    if (i === 14) await page.screenshot({ path: out + '_2b_fight.png' });
  }
  await page.waitForTimeout(500);
  await page.screenshot({ path: out + '_3_after.png' });
  const st = await page.evaluate(() => ({ stats: __creatures.stats(), creatures: __creatures.authority.creatures.map((c) => c.sp + ':' + c.hp + (c.alive ? '' : '(dead)') + (c.target ? '>' + c.target : '')).join(' '), log: (document.querySelector('.hud-log') || document.body).innerText.split(String.fromCharCode(10)).slice(-14) }));
  console.log(JSON.stringify(st, null, 1));
} finally { clearTimeout(killer); await browser.close(); }
console.log(bad ? 'ERRORS ' + bad : 'ok');
