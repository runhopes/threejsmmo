// Tile PNGs into one review sheet:  node tools/sheet.mjs out.png cols a.png b.png ...
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const [out, colsArg, ...files] = process.argv.slice(2);
const cols = +colsArg || 5;
const imgs = files.map((f) => 'data:image/png;base64,' + fs.readFileSync(f).toString('base64'));
const b = await chromium.launch({ channel: 'msedge' });
const p = await b.newPage({ viewport: { width: 340 * cols, height: 300 } });
await p.setContent(`<body style="margin:0;background:#000;display:grid;grid-template-columns:repeat(${cols},340px)">` + imgs.map((s) => `<img src="${s}" style="width:340px">`).join('') + '</body>');
await p.screenshot({ path: out, fullPage: true });
await b.close();
