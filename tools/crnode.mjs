// Headless creature harness: loads three r128 + creatures/*.js into Node (no browser) for numeric checks.
// import { load } from './crnode.mjs'; const { THREE, K, D } = await load(['rat']);
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
const root = path.resolve(import.meta.dirname, '..');
export async function load(species) {
  const THREE = await import('./vendor/three.module.r128.mjs');
  const ctx = globalThis;
  ctx.THREE = Object.assign({}, THREE);
  ctx.window = ctx;
  for (const f of ['creatures/defs.js', 'creatures/core.js', ...species.map((s) => `creatures/species/${s}.js`), 'creatures/variants.js']) {
    vm.runInThisContext(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f });
  }
  return { THREE: ctx.THREE, K: ctx.CreatureKit, D: ctx.CREATURE_DEFS };
}
