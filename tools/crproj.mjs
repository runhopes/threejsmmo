// Ranged shots at a creature: do arrows / fireballs fly INTO the body? Samples projectile height during the flight.
// node tools/crproj.mjs [archer|mage] [species=rat]
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
const cls = process.argv[2] || 'archer', SP = process.argv[3] || 'rat';
fs.mkdirSync('shots/creatures/proj', { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.log('pageerror: ' + e.message));
  await page.goto(pathToFileURL(path.resolve(import.meta.dirname, '..', 'index.html')).href + '?cls=' + cls + '&spawn=gate_outer', { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  const camp = await page.evaluate((sp) => CREATURE_DEFS.ZONES.find((z) => z.species === sp), SP);
  for (let i = 0; i < 200; i++) {
    const s = await page.evaluate(() => ({ x: __knight.root.position.x, z: __knight.root.position.z }));
    const dx = camp.cx - s.x, dz = camp.cz + camp.r + 6 - s.z;
    if (Math.hypot(dx, dz) < 1) break;
    const keys = []; if (dz < -0.5) keys.push('w'); if (dz > 0.5) keys.push('s'); if (dx < -0.5) keys.push('a'); if (dx > 0.5) keys.push('d');
    for (const k of keys) await page.keyboard.down(k); await page.waitForTimeout(160); for (const k of keys) await page.keyboard.up(k);
  }
  await page.waitForTimeout(500);
  const t = await page.evaluate((sp) => { const kp = __knight.root.position; let b = null, bd = 1e9; for (const c of __creatures.authority.creatures) if (c.alive && c.sp === sp) { const d = Math.hypot(c.x - kp.x, c.z - kp.z); if (d < bd) { bd = d; b = c; } }
    const v = new THREE.Vector3(b.x, b.D.height * 0.5, b.z).project(__camera); return { id: b.id, x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight, d: bd, h: b.D.height, hp: b.hp }; }, SP);
  console.log(`${cls} -> ${SP} at ${t.d.toFixed(1)} m (body height ${t.h.toFixed(2)} m)`);
  // install a sampler, then click the creature once
  await page.evaluate(() => { window.__samp = []; const f = () => { const P = (__arrows.length ? __arrows : __fireballs).filter((a) => !a.stuck); for (const a of P) __samp.push([+performance.now().toFixed(0), +a.pos.y.toFixed(2)]); if (__samp.length < 400) requestAnimationFrame(f); }; requestAnimationFrame(f); });
  await page.mouse.click(t.x, t.y);
  let shot = false;
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(40);
    const n = await page.evaluate(() => (__arrows.filter((a) => !a.stuck).length + __fireballs.length));
    if (n && !shot) { await page.waitForTimeout(90); await page.screenshot({ path: `shots/creatures/proj/${cls}_${SP}_flight.png` }); shot = true; }
  }
  await page.waitForTimeout(600);
  const r = await page.evaluate((id) => ({ samp: __samp, hp: __creatures.authority.byId.get(id).hp }), t.id);
  const ys = r.samp.map((s) => s[1]);
  console.log('  projectile height: launch', ys[0], '-> last', ys[ys.length - 1], ' (samples', ys.length + ')');
  console.log('  target HP', t.hp, '->', r.hp, r.hp < t.hp ? 'HIT' : 'no hit');
  await page.screenshot({ path: `shots/creatures/proj/${cls}_${SP}_after.png` });
} finally { await browser.close(); }
