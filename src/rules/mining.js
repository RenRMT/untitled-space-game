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
// A big asteroid also breaks into shards (notes/hazards.md phase 4): small rocks drifting apart, each
// quick to break, with a smaller chance of a drop of the asteroid's kind.
//   Mining.shards(galaxySeed, asteroid) -> [{ i, a, d, r, seed }]   a, d: the way and how far it flies
//   Mining.shardYield(galaxySeed, asteroid, i) -> { kind, seed } | null
//
// Deposits on planets and moons (game/surface-run.js) are worked the same way: many small nodes on
// open ground round the landing site, each a unit of one of the site's goods (rules/hazards.js
// surface), solid rock but for the gas giants' cloud deck (siphoned). A field is seeded afresh on each
// landing; the riskier the site, the more nodes (site.rich), and they gather near its hazards, where
// they're rich (a unit more).
//   Mining.deposits(seed, site, o) -> [{ i, x, y, r, kind, material, rich }]
//     o: { x0, y0, x1, y1 } (where to look, surface units), start: [x, y] (kept clear: the landing
//     spot), ok(x, y, r) (open ground there), field (which landing: a fresh field for each),
//     near(x, y) -> 0..1 (how close a hazard is: nodes gather there, and are rich within half of it)
//   Mining.depositYield(seed, deposit, o?) -> [{ kind, seed }]   what it leaves: 1 unit, +1 rich,
//     +1 broken exposed (o.exposed: on a hot day side)
// ES module (`Mining`); also runs in Node (the tests).

import { nextSeed, seeded, weightedPick } from '../core/rng.js';
import { Goods } from './goods.js';

const Mining = (() => {
  const G = Goods;

  const config = {
    rock: 4, // an asteroid's integrity per unit of its radius
    gas: 2, // a gas pocket's, per unit of its radius
    node: 1.3, // a surface node's or a shard's, per unit of its radius (no floor: about a second's work)
    // per site: how many (× site.rich), how big, apart, clear of the landing spot; and how many fewer
    // land away from the hazards (a share of them kept: `far`)
    deposits: { n: 18, r: [8, 13], gap: 70, clear: 160, tries: 2000, far: 0.4 },
    shards: { from: 18, n: [3, 6], r: [5, 9], fly: [30, 70], chance: 0.6 }, // asteroids this big or more break into n shards; their drop chance ×
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
  const small = (e) => e.surface || e.shard;
  const integrity = (e) => (small(e) ? Math.max(1, Math.round(e.radius * config.node)) : Math.max(20, Math.round(e.radius * config[material(e)])));
  // A rock as a combatant: it doesn't move, shoot, dodge or shield itself.
  const stats = (e) => ({
    name: e.kind === 'deposit' ? 'Deposit' : e.shard ? 'Shard' : e.kind === 'gas' ? 'Gas pocket' : 'Asteroid', radius: e.radius, hull: integrity(e), shield: 0, shieldRecharge: 0,
    maxSpeed: 0, accel: 0, turnRate: 0, evasion: 0, accuracy: 0, weapons: [], lockTime: Infinity, lockRange: 0, miningRate: 0,
  });

  // A big asteroid's shards, flying out round it; none from a small one.
  function shards(galaxySeed, asteroid) {
    const S = config.shards, rad = asteroid.radius ?? asteroid.r;
    if (!YIELD[asteroid.ast?.type ?? asteroid.type] || rad < S.from) return [];
    const r = seeded(galaxySeed, asteroid.key, 0x5a7d), n = Math.min(S.n[1], S.n[0] + Math.floor((rad - S.from) / 10 + r() * 1.5));
    return Array.from({ length: n }, (_, i) => ({
      i, a: ((i + r() * 0.6) / n) * Math.PI * 2, d: S.fly[0] + r() * (S.fly[1] - S.fly[0]), r: Math.round(S.r[0] + r() * (S.r[1] - S.r[0])), seed: nextSeed(r),
    }));
  }
  // What a shard drops: as its asteroid would, less often.
  function shardYield(galaxySeed, asteroid, i) {
    const y = YIELD[asteroid.ast?.type ?? asteroid.type];
    if (!y) return null;
    const r = seeded(galaxySeed, `${asteroid.key}:s${i}`, 0x313f);
    if (r() >= y.chance * config.shards.chance) return null;
    const what = weightedPick(y.items, r());
    return { kind: G.type(what) ? what : G.pick(r, what, (t) => t.stage === 'raw' && !t.surface), seed: nextSeed(r) };
  }

  // Deposits: spots picked at random in the area, kept where the ground is open, apart from each
  // other and clear of the landing spot, most of those far from the hazards passed over; what each
  // holds by the site's weights. A fresh field for each landing (o.field).
  function deposits(seed, site, o) {
    const D = config.deposits, r = seeded(seed, `deposits:${o.field ?? 0}`, 0xde9), out = [], n = Math.round(D.n * (site.rich || 1));
    for (let k = 0; k < D.tries && out.length < n; k++) {
      const x = o.x0 + r() * (o.x1 - o.x0), y = o.y0 + r() * (o.y1 - o.y0), rad = D.r[0] + r() * (D.r[1] - D.r[0]), pick = r(), keep = r();
      if (o.start && Math.hypot(x - o.start[0], y - o.start[1]) < D.clear) continue;
      const near = o.near ? o.near(x, y) : 0;
      if (o.near && keep > D.far + (1 - D.far) * near) continue;
      if (out.some((d) => Math.hypot(d.x - x, d.y - y) < D.gap) || !o.ok(x, y, rad)) continue;
      out.push({ i: out.length, x: Math.round(x), y: Math.round(y), r: Math.round(rad), kind: weightedPick(site.deposits, pick), material: site.material, rich: near >= 0.5 });
    }
    return out;
  }
  // What a node leaves: a unit, one more if it's rich, one more if broken out on a hot day side.
  function depositYield(seed, d, o = {}) {
    const r = seeded(seed, `deposit:${d.field ?? 0}:${d.i}`, 0xd19), n = 1 + (d.rich ? 1 : 0) + (o.exposed ? 1 : 0);
    return Array.from({ length: n }, () => ({ kind: d.kind, seed: nextSeed(r) }));
  }

  return { config, YIELD, yieldOf, gasOf, material, integrity, stats, shards, shardYield, deposits, depositYield };
})();

export { Mining };
