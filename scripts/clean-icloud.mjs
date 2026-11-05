// iCloud Drive (the project lives on a synced Desktop) leaves "name 2.ext", "name 3.ext" copies next to files that were replaced —
// Android's resource merger rejects them (build/ intermediates too) and they bloat the iOS bundle. Removes them under ios/, android/,
// www/ and node_modules/@capacitor. (Since 2026-11-05 the folder is *.nosync, which iCloud skips; this stays as a safety net.)
//   node scripts/clean-icloud.mjs   (runs inside npm run cap:sync)
import { readdirSync, rmSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DUP = / \d+(\.[^/]*)?$/;
let n = 0;
(function walk(d) {
  let es; try { es = readdirSync(d, { withFileTypes: true }); } catch { return; }
  for (const e of es) {
    if (e.name === 'node_modules') continue;
    const p = join(d, e.name);
    if (DUP.test(e.name)) { rmSync(p, { recursive: true, force: true }); n++; continue; }
    if (e.isDirectory()) walk(p);
  }
})(ROOT + '/ios'); 
for (const d of ['android', 'www', 'node_modules/@capacitor']) (function walk(dd) {
  let es; try { es = readdirSync(dd, { withFileTypes: true }); } catch { return; }
  for (const e of es) { const p = join(dd, e.name); if (DUP.test(e.name)) { rmSync(p, { recursive: true, force: true }); n++; continue; } if (e.isDirectory()) walk(p); }
})(join(ROOT, d));
console.log('icloud duplicates removed: ' + n);
