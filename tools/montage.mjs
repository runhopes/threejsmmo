// Stitch PNGs into one grid image: node tools/montage.mjs out.png cols img1.png img2.png ...
import { chromium } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';
const [out, colsS, ...imgs] = process.argv.slice(2);
const cols = +colsS || 5;
const b64 = imgs.map((f) => 'data:image/png;base64,' + fs.readFileSync(f).toString('base64'));
const html = `<html><body style="margin:0;background:#111;display:grid;grid-template-columns:repeat(${cols},auto);gap:2px;width:max-content">${b64.map((s, i) => `<div style="position:relative"><img src="${s}" style="display:block"><span style="position:absolute;left:4px;top:2px;color:#fff;font:11px sans-serif;background:#0008;padding:1px 4px">${path.basename(imgs[i], '.png')}</span></div>`).join('')}</body></html>`;
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
await page.setContent(html);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log(out);
