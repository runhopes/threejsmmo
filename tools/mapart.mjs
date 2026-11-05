// Paint the sketch (kroki) world map + a minimap tile to PNG files and time them (village.html).
//   node tools/mapart.mjs <outDir> [cx cz]   (tile centre for the minimap sample, default the great plaza)
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
const out = process.argv[2] || 'shots/newmap/map', cx = +(process.argv[3] || 0), cz = +(process.argv[4] || 150);
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--use-angle=d3d11'] });
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
  page.on('pageerror', (e) => console.log('pageerror: ' + e.message));
  await page.goto(pathToFileURL(path.resolve(import.meta.dirname, '..', 'village.html')).href, { waitUntil: 'load' });
  await page.waitForFunction(() => document.title === 'ready' || document.title === 'ERR', null, { timeout: 240000 });
  const r = await page.evaluate(([cx, cz]) => {
    const W = window.Village.World, b = W.region, res = {};
    let t = performance.now();
    const px = 1024, py = Math.round(px * (b.maxZ - b.minZ) / (b.maxX - b.minX));
    const a = W.paintMap(b.minX, b.maxX, b.minZ, b.maxZ, px, py); res.worldMs = Math.round(performance.now() - t); res.world = a.toDataURL('image/png');
    t = performance.now(); const m = W.paintMap(cx - 128, cx + 128, cz - 128, cz + 128, 1024, 1024); res.miniMs = Math.round(performance.now() - t); res.mini = m.toDataURL('image/png');
    return res;
  }, [cx, cz]);
  fs.writeFileSync(path.join(out, 'world.png'), Buffer.from(r.world.split(',')[1], 'base64'));
  fs.writeFileSync(path.join(out, 'mini.png'), Buffer.from(r.mini.split(',')[1], 'base64'));
  console.log('world ms', r.worldMs, 'mini ms', r.miniMs);
} finally { await browser.close(); }
