// crop the centre of full screenshots into a sheet: node tools/crop.mjs out.png cols in1.png in2.png ...
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const [out, colsArg, ...files] = process.argv.slice(2);
const cols = +colsArg || 4, W = 440, H = 330;
const imgs = files.map((f) => 'data:image/png;base64,' + fs.readFileSync(f).toString('base64'));
const b = await chromium.launch({ channel: 'msedge' });
const p = await b.newPage({ viewport: { width: W * cols, height: H } });
await p.setContent(`<body style="margin:0;background:#000;display:grid;grid-template-columns:repeat(${cols},${W}px)">` + imgs.map((s) => `<div style="width:${W}px;height:${H}px;overflow:hidden;position:relative"><img src="${s}" style="position:absolute;left:${-(640 - W / 2)}px;top:${-(330 - H / 2)}px"></div>`).join('') + '</body>');
await p.screenshot({ path: out, fullPage: true });
await b.close();
