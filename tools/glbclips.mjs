// REFERENCE/RETARGET TOOL: open a GLB in a headless browser and evaluate a page script against it.
//   node tools/glbclips.mjs <file.glb> <script.js>   (script body gets `gltf`, `THREE`; must return JSON-able data)
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const [file, scriptFile] = process.argv.slice(2);
const b64 = fs.readFileSync(file).toString('base64');
const body = fs.readFileSync(scriptFile, 'utf8');
const browser = await chromium.launch({ channel: 'msedge', args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('pageerror: ' + e.message));
  await page.setContent(`<html><body>
    <script src="https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js"></script>
  </body></html>`, { waitUntil: 'load' });
  const out = await page.evaluate(async ([b64, body]) => {
    const bin = atob(b64), buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    const gltf = await new Promise((res, rej) => new THREE.GLTFLoader().parse(buf.buffer, '', res, rej));
    return (new Function('gltf', 'THREE', body))(gltf, THREE);
  }, [b64, body]);
  process.stdout.write(typeof out === 'string' ? out : JSON.stringify(out));
} finally { await browser.close(); }
