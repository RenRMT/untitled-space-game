// Asteroid mining: how much an asteroid or gas pocket takes to break up and what it leaves behind.
// Mining is extraction (game/combat.js): a rock is a passive target in a real-time fight
// (combat/combat-realtime.js) with no shields, no engine and no guns, and its integrity as its hull.
// The ship's tools wear it down while it's locked, in range and in their arc, each by its factor
// for the rock's material (rules/loadout.js `vs`). Broken up, an asteroid may drop one raw material
// to collect: a metal, mineral or gas (rules/goods.js). Drops are seeded by the system and the
// asteroid, so an asteroid always yields the same. A gas pocket in a nebula (world/solar-system.js)
// always yields gas, one to three units by the pocket's size (gasOf).
//   Mining.yieldOf(galaxySeed, asteroid) -> { kind, seed } | null
//   Mining.gasOf(galaxySeed, pocket) -> [{ kind, seed }]
//   Mining.material(e) -> 'rock' | 'gas'
//   Mining.integrity(e) -> points of damage it takes to break it up
//   Mining.stats(e) -> its stats as a combatant (rules/loadout.js stats() shape)
//
// Deposits on planets and moons (game/surface-run.js) are worked the same way: seeded spots on open
// ground round the landing site, each holding a few units of one of the site's goods (rules/hazards.js
// surface), solid rock but for the gas giants' cloud deck (siphoned).
//   Mining.deposits(seed, site, o) -> [{ i, x, y, r, kind, material }]
//     o: { x0, y0, x1, y1 } (where to look, surface units), start: [x, y] (kept clear: the landing
//     spot), ok(x, y, r) (open ground there)
//   Mining.depositYield(seed, deposit) -> [{ kind, seed }]   what it leaves, 2–4 units
// ES module (`Mining`); also runs in Node (the tests).

import { nextSeed, seeded, weightedPick } from '../core/rng.js';
import { Goods } from './goods.js';

const Mining = (() => {
  const G = Goods;

  const config = {
    rock: 6, // an asteroid's integrity per unit of its radius
    gas: 2, // a gas pocket's, per unit of its radius
    deposits: { n: 7, r: [14, 22], gap: 260, clear: 220, tries: 400 }, // per site: how many, how big, apart, clear of the landing spot
  };

  // Drop chance and what drops, by asteroid type (world/solar-system.js): a category (a raw type of
  // it, by rarity) or a type. Metallic rock gives metal, stony rock minerals and the odd metal,
  // carbonaceous rock minerals, icy rock gas.
  const YIELD = {
    metal: { chance: 0.7, items: [['metal', 4], ['mineral', 1]] },
    stony: { chance: 0.55, items: [['mineral', 4], ['metal', 1]] },
    carbon: { chance: 0.45, items: [['mineral', 1]] },
    ice: { chance: 0.45, items: [['gas', 1]] },
  };

  // What a mined asteroid drops: { kind (a rules/goods.js type), seed } or null.
  function yieldOf(galaxySeed, asteroid) {
    const y = YIELD[asteroid.ast.type];
    if (!y) return null;
    const r = seeded(galaxySeed, asteroid.key, 0x313e);
    if (r() >= y.chance) return null;
    const what = weightedPick(y.items, r());
    return { kind: G.type(what) ? what : G.pick(r, what, (t) => t.stage === 'raw' && !t.surface), seed: nextSeed(r) };
  }

  // What a collected gas pocket leaves: its size sets how much (1–3 units), each a raw gas, from
  // the pocket's own stream.
  function gasOf(galaxySeed, pocket) {
    const r = seeded(galaxySeed, pocket.key, 0x6a5);
    const n = 1 + Math.floor((pocket.pocket ? pocket.pocket.r : pocket.r || 60) / 45 + r() * 0.8);
    return Array.from({ length: Math.min(3, n) }, () => ({ kind: G.pick(r, 'gas', 'raw'), seed: nextSeed(r) }));
  }
  const material = (e) => e.material || (e.kind === 'gas' ? 'gas' : 'rock');
  const integrity = (e) => Math.max(20, Math.round(e.radius * config[material(e)]));
  // A rock as a combatant: it doesn't move, shoot, dodge or shield itself.
  const stats = (e) => ({
    name: e.kind === 'deposit' ? 'Deposit' : e.kind === 'gas' ? 'Gas pocket' : 'Asteroid', radius: e.radius, hull: integrity(e), shield: 0, shieldRecharge: 0,
    maxSpeed: 0, accel: 0, turnRate: 0, evasion: 0, accuracy: 0, weapons: [], lockTime: Infinity, lockRange: 0, miningRate: 0,
  });

  // Deposits: spots picked at random in the area, kept where the ground is open, apart from each
  // other and clear of the landing spot; what each holds by the site's weights.
  function deposits(seed, site, o) {
    const D = config.deposits, r = seeded(seed, 'deposits', 0xde9), out = [];
    for (let k = 0; k < D.tries && out.length < D.n; k++) {
      const x = o.x0 + r() * (o.x1 - o.x0), y = o.y0 + r() * (o.y1 - o.y0), rad = D.r[0] + r() * (D.r[1] - D.r[0]), pick = r();
      if (o.start && Math.hypot(x - o.start[0], y - o.start[1]) < D.clear) continue;
      if (out.some((d) => Math.hypot(d.x - x, d.y - y) < D.gap) || !o.ok(x, y, rad)) continue;
      out.push({ i: out.length, x: Math.round(x), y: Math.round(y), r: Math.round(rad), kind: weightedPick(site.deposits, pick), material: site.material });
    }
    return out;
  }
  // What a deposit leaves: two units, more for a bigger one.
  function depositYield(seed, d) {
    const r = seeded(seed, `deposit:${d.i}`, 0xd19), n = 2 + Math.floor((d.r - config.deposits.r[0]) / 4 + r() * 0.8);
    return Array.from({ length: Math.min(4, n) }, () => ({ kind: d.kind, seed: nextSeed(r) }));
  }

  return { config, YIELD, yieldOf, gasOf, material, integrity, stats, deposits, depositYield };
})();

export { Mining };
