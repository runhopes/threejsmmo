// Builds www/ (Capacitor webDir) from the game files. The web build on mmorpg.thebora.dev serves the project root
// directly (express); the mobile app bundles exactly the files index.html needs — never server/, tools/, .git, DB.
//   node scripts/build-www.mjs   (npm run build:www)
import { cpSync, rmSync, mkdirSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'www');
const FILES = ['index.html', 'privacy.html', 'hud.css', 'textures.js', 'locomotion.js', 'heromodel.js', 'knight.js', 'hud.js', 'mobile.js', 'perf.js'];
const DIRS = ['app', 'ui', 'fonts', 'vendor', 'creatures', 'village', 'world', 'vfx', 'magefx'];
const SKIP = new Set(['.md']);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
for (const f of FILES) {
  if (!existsSync(join(ROOT, f))) throw new Error('missing ' + f);
  cpSync(join(ROOT, f), join(OUT, f));
}
for (const d of DIRS) {
  cpSync(join(ROOT, d), join(OUT, d), { recursive: true, filter: (src) => statSync(src).isDirectory() || !SKIP.has(extname(src)) });
}
let n = 0, bytes = 0;
(function walk(p) { for (const e of readdirSync(p, { withFileTypes: true })) { const q = join(p, e.name); if (e.isDirectory()) walk(q); else { n++; bytes += statSync(q).size; } } })(OUT);
console.log(`www/: ${n} files, ${(bytes / 1048576).toFixed(1)} MB`);
