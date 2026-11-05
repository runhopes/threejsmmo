/* TDS MOBA - creature variants, renderer side (levels 5-18).
 * The gameplay entries (name, levels, hp, damage, loot, boss flag, scale x multiplier) are DERIVED in defs.js from
 * CREATURE_DEFS.VARIANT_SPECS (pure data, so the simulation / a server sees them without three.js). Here every variant becomes
 * a thin CreatureKit species that delegates rig / animator / attack animations to its base species, shares the base's geometry
 * and wears a colour tint (CreatureKit.defineVariant). Load order: defs, core, sim, net, species/*, variants.
 * Variants of base species registered by species files (CREATURE_DEFS.addSpecies) are derived here, now that all of them loaded.
 * A variant whose base is missing (creatures.html with ?sp=...) is skipped silently.
 * Extending the roster: CREATURE_DEFS.addVariant({ id, base, name, en, levels, scale, tint, hpMul | hp, dps, expFrac, loot, ... })
 * (see VARIANT_SPECS in defs.js for the fields) BEFORE this file runs, or call CreatureKit.registerVariants() afterwards. */
(function (global) {
  'use strict';
  const K = global.CreatureKit, DEFS = global.CREATURE_DEFS;
  if (!K || !DEFS || !DEFS.VARIANTS) return;
  function registerVariants() {
    if (DEFS.deriveVariants) DEFS.deriveVariants();
    for (const id in DEFS.VARIANTS) {
      const v = DEFS.VARIANTS[id];
      if (!K.SPECIES[id] && K.SPECIES[v.base]) K.defineVariant(id, v.base, { tint: v.tint });
    }
  }
  K.registerVariants = registerVariants;
  registerVariants();
})(typeof window !== 'undefined' ? window : globalThis);
