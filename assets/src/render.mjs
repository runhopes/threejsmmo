import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
const [dir] = process.argv.slice(2);
const svg = readFileSync(dir + '/emblem.svg', 'utf8');
const font = 'file://' + dir + '/../../fonts/AlegreyaSC-Medium.ttf';
const b = await chromium.launch({ channel: 'chrome' });
const p = await b.newPage();
async function shot(w, h, html, out) { await p.setViewportSize({ width: w, height: h }); await p.setContent(html); await p.waitForTimeout(300); await p.screenshot({ path: out, omitBackground: false }); }
const icon = `<style>html,body{margin:0}</style>${svg}`;
await shot(1024, 1024, icon, dir + '/../icon-only.png');
const splash = (bg) => `<style>@font-face{font-family:A;src:url('${font}')}html,body{margin:0;width:2732px;height:2732px;background:${bg};display:flex;flex-direction:column;align-items:center;justify-content:center}
svg{width:900px;height:900px;border-radius:200px}h1{font:500 170px A;letter-spacing:.32em;color:#E8DDC2;margin:90px 0 0 .32em;text-shadow:0 6px 30px #000}</style>${svg}<h1>ATHERION</h1>`;
await shot(2732, 2732, splash('#16252f'), dir + '/../splash.png');
await shot(2732, 2732, splash('#0d161b'), dir + '/../splash-dark.png');
await b.close();
