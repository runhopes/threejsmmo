// 1:1 crops of HUD regions from a full screenshot, stacked into one sheet.
//   node tools/hudcrop.mjs in.png out.png "x,y,w,h" ["x,y,w,h" ...]     (negative x / y = from the right / bottom edge)
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const [inp, out, ...regions] = process.argv.slice(2);
const src = 'data:image/png;base64,' + fs.readFileSync(inp).toString('base64');
const b = await chromium.launch({ channel: 'msedge' });
const p = await b.newPage({ viewport: { width: 400, height: 300 } });
await p.setContent(`<body style="margin:0;background:#000"><img id="i" src="${src}" style="display:none"></body>`);
await p.waitForFunction(() => document.getElementById('i').complete);
const html = await p.evaluate((regions) => {
  const img = document.getElementById('i'), W = img.naturalWidth, H = img.naturalHeight;
  return regions.map((r) => {
    const parts = r.split(','), fromR = parts[0].trim().startsWith('-'), fromB = parts[1].trim().startsWith('-');
    let [x, y, w, h] = parts.map((v) => Math.abs(Number(v)));
    if (fromR) x = W - x - w; if (fromB) y = H - y - h;
    return `<div style="width:${w}px;height:${h}px;overflow:hidden;position:relative;margin:0 4px 4px 0;display:inline-block;vertical-align:top"><img src="${img.src}" style="position:absolute;left:${-x}px;top:${-y}px"></div>`;
  }).join('');
}, regions);
await p.setContent(`<body style="margin:0;padding:4px 0 0 4px;background:#000;width:max-content;max-width:1900px">${html}</body>`);
await p.screenshot({ path: out, fullPage: true });
await b.close();
console.log(out);
