// Metin2-style click-to-attack check with real mouse input, per class.  node tools/crclick.mjs [classes...]
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
const classes = process.argv.slice(2).length ? process.argv.slice(2) : ['warrior', 'archer', 'mage'];
fs.mkdirSync('shots/creatures/click', { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
let fails = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };
try {
  for (const cls of classes) {
    console.log('== ' + cls);
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('pageerror', (e) => { fails++; console.log('  pageerror: ' + e.message); });
    await page.goto(pathToFileURL(path.resolve(import.meta.dirname, '..', 'index.html')).href + '?cls=' + cls + '&spawn=' + (process.env.SPAWN || 'gate_outer'), { waitUntil: 'load' });
    await page.waitForTimeout(1500);
    // walk toward the rat meadow with WASD, stop ~9 m short of its centre
    const camp = await page.evaluate(() => CREATURE_DEFS.ZONES.find((z) => z.species === 'rat'));
    for (let i = 0; i < 200; i++) {
      const s = await page.evaluate(() => ({ x: __knight.root.position.x, z: __knight.root.position.z }));
      const dx = camp.cx - s.x, dz = camp.cz + 10 - s.z;   // stand south of the camp: the camera looks north
      if (Math.hypot(dx, dz) < 1) break;
      const keys = []; if (dz < -0.5) keys.push('w'); if (dz > 0.5) keys.push('s'); if (dx < -0.5) keys.push('a'); if (dx > 0.5) keys.push('d');
      for (const k of keys) await page.keyboard.down(k); await page.waitForTimeout(160); for (const k of keys) await page.keyboard.up(k);
    }
    await page.waitForTimeout(400);
    // 1) empty ground click: moves, never attacks
    const p0 = await page.evaluate(() => ({ x: __knight.root.position.x, z: __knight.root.position.z }));
    await page.mouse.click(640, 560, { button: 'right' });
    await page.waitForTimeout(250);
    const a1 = await page.evaluate(() => !!(__knight.action && __knight.action.def.attack));
    await page.waitForTimeout(600);
    const p1 = await page.evaluate(() => ({ x: __knight.root.position.x, z: __knight.root.position.z }));
    ok(!a1, 'click on empty ground: no attack');
    ok(Math.hypot(p1.x - p0.x, p1.z - p0.z) > 0.5, 'click on empty ground: walks there');
    await page.waitForTimeout(800);
    // 2) one click on the nearest rat: approach (melee) / shoot (ranged) and damage it without more input
    const screenOf = (id) => page.evaluate((id) => { const c = __creatures.authority.byId.get(id); const v = new THREE.Vector3(c.x, Math.min(0.5, c.D.height * 0.5), c.z).project(__camera); return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight, hp: c.hp, alive: c.alive, d: Math.hypot(c.x - __knight.root.position.x, c.z - __knight.root.position.z) }; }, id);
    const id = await page.evaluate(() => { const kp = __knight.root.position; let b = null, bd = 1e9; for (const c of __creatures.authority.creatures) if (c.alive && c.sp === 'rat') { const d = Math.hypot(c.x - kp.x, c.z - kp.z); if (d < bd) { bd = d; b = c; } } return b.id; });
    let s = await screenOf(id);
    const hp0 = s.hp, d0 = s.d;
    await page.mouse.click(s.x, s.y, { button: 'right' });
    await page.waitForTimeout(cls === 'warrior' ? 3200 : 2200);
    s = await screenOf(id);
    await page.screenshot({ path: `shots/creatures/click/${cls}_1.png` });
    ok(s.hp < hp0 || !s.alive, `one click on a rat ${d0.toFixed(1)} m away: hero engages, rat HP ${hp0} -> ${s.alive ? s.hp : 'dead'}`);
    const sel = await page.evaluate(() => document.querySelector('.hud-target .name') && document.querySelector('.hud-target .name').textContent);
    ok(sel === 'Çayır Sıçanı', 'the clicked rat is the HUD target (' + sel + ')');
    // 3) keep clicking it until it dies
    for (let i = 0; i < 40; i++) { s = await screenOf(id); if (!s.alive) break; await page.mouse.click(s.x, s.y, { button: 'right' }); await page.waitForTimeout(300); }
    ok(!s.alive, 'repeated clicks kill it');
    await page.screenshot({ path: `shots/creatures/click/${cls}_2.png` });
    await page.close();
  }
} finally { await browser.close(); }
console.log(fails ? fails + ' FAILED' : 'all passed');
process.exit(fails ? 1 : 0);
