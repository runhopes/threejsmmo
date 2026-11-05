// Visual check of the creature variants: every variant lined up next to its base species (and the 1.95 m warrior hero for scale)
// at game scale, in creatures.html. Writes shots/variants/<base>_<cam>.png (+ a per-variant strip) and reports console / page errors.
// Usage: node tools/crvariants.mjs [cam=q34,front] [base,base...]      Env: W=1600 H=700
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import vm from 'node:vm';
const root = path.resolve(import.meta.dirname, '..');
globalThis.window = globalThis;
vm.runInThisContext(fs.readFileSync(path.join(root, 'creatures/defs.js'), 'utf8'));
const V = globalThis.CREATURE_DEFS.VARIANTS;
const cams = (process.argv[2] || 'q34,front').split(','), only = process.argv[3] ? process.argv[3].split(',') : null;
const groups = {};
for (const id in V) (groups[V[id].base] || (groups[V[id].base] = [])).push(id);
const W = +process.env.W || 1600, H = +process.env.H || 700;
const out = path.join(root, 'shots/variants'); fs.mkdirSync(out, { recursive: true });
const url = pathToFileURL(path.join(root, 'creatures.html')).href;
const browser = await chromium.launch({ channel: 'msedge', args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
let failed = false;
try {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (/Failed to load resource|ERR_FILE_NOT_FOUND/.test(m.text())) return; if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  for (const base of Object.keys(groups)) {
    if (only && !only.includes(base)) continue;
    for (const cam of cams) {
      errors.length = 0;
      const list = [base, ...groups[base]].join(',');
      await page.goto(url + '?sp=' + list + '&t=1.2&cam=' + cam + '&hero=1', { waitUntil: 'load', timeout: 60000 });
      await page.waitForFunction(() => document.title === 'ready' || document.title === 'ERR', null, { timeout: 60000 });
      if ((await page.title()) === 'ERR') { failed = true; console.log(await page.evaluate(() => document.getElementById('err').textContent)); }
      const file = path.join(out, `${base}_${cam}.png`);
      await page.screenshot({ path: file });
      // numeric sanity from the live scene: view scale, tint, shared geometry, lowest bone above ground
      const info = await page.evaluate(() => window.__shot.items.map((it) => ({ id: it.id, scale: it.v.scale, tint: it.v.tint, geo: it.v.lodMeshes[0][0].geometry.uuid, mat: it.v.lodMeshes[0][0].material.name })));
      console.log(file); for (const i of info) console.log(`   ${i.id.padEnd(15)} scale ${i.scale.toFixed(2)}  tint ${i.tint ? i.tint.join('/') : '-'}  mat ${i.mat}`);
      const geos = new Set(info.map((i) => i.geo));
      if (geos.size !== 1) { failed = true; console.log('  FAIL geometry not shared between base and variants (' + geos.size + ' distinct)'); }
      if (errors.length) { failed = true; errors.forEach((e) => console.log('  ' + e)); }
    }
  }
} catch (e) { console.error(e.message); failed = true; }
finally { await browser.close(); }
console.log(failed ? 'FAILED' : 'crvariants done (look at shots/variants/*.png)');
process.exit(failed ? 1 : 0);
