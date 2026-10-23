// Station markets: what each station stocks and its usual prices, recreated on demand from the system
// seed and the station, and the stockpiles the player's trading moves, which set the price now.
// Prices start from each item type's base price (rules/goods.js). Every station buys every trade good;
// what it sells, and at what price, depends on what kind of place it is:
// - categories it produces are cheap, categories it consumes fetch a premium,
// - outposts and the process stations follow their type (mining camps sell ore, salvage yards metal
//   and conduits, the minor station's volatiles works deuterium and hydrazine),
// - system stations get a seeded mix; capitals and major stations stock every category,
// - within a category on sale, the commonest type is always stocked (unless it's a part) and rarer
//   ones less often (more often where the category is produced); exotics are never sold, only found,
// - goods further along the production chain (rules/goods.js stage) are stocked less often, except
//   where they're made, and the rarest parts never: they have to be made.
// Salvaged components aren't traded at all: they're used for research (rules/research.js), hull
// refits among it.
// Equipment isn't sold: it's assembled from parts (rules/recipes.js), by blueprint (rules/research.js).
// Each station adds a little seeded jitter, so neighbouring markets differ.
// Prices are whole credits. `buy` is what the player pays, `sell` what the player gets.
//
// Supply and demand: each station keeps a stockpile of every good, and the price follows how full
// it is against a comfortable level (target, by rarity):
//   price = base * clamp((target / stock) ^ elasticity, clampLo, clampHi)
// A station rests at the stock that gives its usual price (eq): above target for what it produces,
// below for what it consumes, so an untouched market is the seeded one. Each unit the player buys
// takes one from the stockpile (none left: sold out) and each sold adds one, so a big sale drives
// the price down as it goes. Away from rest, the stockpile drifts back to it on the real-world
// clock (core/clock.js), halfway every halfLife: production, consumption and the galaxy's traders
// in one, worked out when someone looks, never ticked. Only stockpiles away from rest are saved.
//
//   Economy.market(galaxySeed, station, state?, now?, shift?) -> { goods: [{ kind, category, rarity, produced,
//     consumed, buy (null: not stocked), sell, stock, target, left (whole units to buy; 0: sold out) }] }
//     without state, every stockpile is at rest; shift: a share added to the spread both ways (how
//     the station's owner regards the player, rules/reputation.js priceShift)
//   Economy.empty() -> state                 { [station key]: { [kind]: { stock, at } } }
//   Economy.trade(state, galaxySeed, station, kind, n, now)   n units in (sold to it) or out (< 0)
//   Economy.prune(state, now)                forget stockpiles long since back at rest
//   Economy.read(d) -> state                 a saved state, checked
// ES module (`Economy`); also runs in Node (the tests).

import { clamp } from '../core/math.js';
import { seeded } from '../core/rng.js';
import { Goods } from './goods.js';

const Economy = (() => {
  const G = Goods;
  const CATEGORIES = G.categories('trade');

  const config = {
    produced: 0.7, // price factor for categories a station produces
    consumed: 1.35, // ... and for categories it consumes
    jitter: 0.1, // +/- per station and type
    spread: 0.08, // the station sells this much above its price and buys this much below
    minForSale: 3, // smallest number of categories a station stocks
    // Chance a type is stocked, by rarity (1 common ... 5 exotic), in a category the station sells,
    // and in one it produces.
    // Every good left is one research needs, so rarer ones are stocked more often than they
    // used to be (very rare ones were 5% and 15%).
    stock: [null, 1, 0.7, 0.4, 0.2, 0],
    stockProduced: [null, 1, 1, 0.7, 0.4, 0],
    // ... times this, by production stage, where the category isn't produced; parts this rare or
    // rarer are never stocked.
    stockStage: { raw: 1, refined: 1, part: 0.5 },
    madeOnly: 4,
    startingCredits: 500,
    target: [null, 120, 60, 30, 16, 8], // comfortable stock, by rarity
    elasticity: 0.8,
    clamp: [0.2, 5], // the price factor's range, so an empty or overflowing stockpile stays sane
    halfLife: 60 * 60 * 1000, // ms for a stockpile to come halfway back to rest
    settled: 0.5, // a stockpile this close to rest is at rest (and forgotten)
  };

  // Fixed profiles for outposts and special stations; system stations without one get a seeded mix.
  // Each process station sells what it works with (notes/hazards.md phase 6): the ore works ore,
  // the volatiles works deuterium and hydrazine, the fabricator electronics; the transport hub,
  // where routes meet, a little of everything.
  const PROFILES = {
    capital: { produces: ['synthetic', 'crates'], consumes: ['mineral', 'gas'], sellsAll: true },
    major: { produces: ['crates'], consumes: ['tubes', 'synthetic'], sellsAll: true },
    minor: { produces: ['gas', 'barrels'], consumes: ['tubes', 'metal'] },
    'mining camp': { produces: ['mineral', 'metal'], consumes: ['tubes', 'gas'] },
    'salvage yard': { produces: ['metal', 'tubes'], consumes: [] },
    'transport hub': { produces: [], consumes: [], sellsAll: true },
    // The android waystation makes its own cabling and synthetics, and runs on liquids it can't.
    waystation: { produces: ['tubes', 'synthetic'], consumes: ['barrels'] },
  };

  // Seeded profile for a system station: a couple of categories made, a couple wanted.
  function mixedProfile(r, major) {
    const pool = CATEGORIES.slice();
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    const nProd = major ? 2 : 1 + Math.floor(r() * 2);
    return { produces: pool.slice(0, nProd), consumes: pool.slice(nProd, nProd + 2), sellsAll: major };
  }

  // A station as the scene (flight/scene.js) builds it: { key, market: { kind: 'system' | 'outpost', type } }.
  // type is the outpost type, or for system stations 'capital' | 'major' | 'minor'.
  function profileOf(station, r) {
    const type = station.market.type;
    return PROFILES[type] || mixedProfile(r, type === 'major');
  }

  // Base price of an item type (rules/goods.js), before any station's factors.
  const basePrice = (kind) => (G.type(kind) ? G.type(kind).price : 0);

  // What a station stocks and its usual price factor per good, from the seed: [{ kind, category,
  // rarity, produced, consumed, stocked, factor }]. Kept per station, as it never changes.
  const profiles = new Map();
  function profile(galaxySeed, station) {
    const cacheKey = `${galaxySeed}|${station.key}`;
    if (profiles.has(cacheKey)) return profiles.get(cacheKey);
    const r = seeded(galaxySeed, station.key, 0xec0);
    const P = profileOf(station, r);
    const jitter = () => 1 + (r() * 2 - 1) * config.jitter;
    const forSale = new Set(P.produces);
    for (const id of CATEGORIES) if (P.sellsAll || r() < 0.5) forSale.add(id);
    // At least minForSale categories sure to be stocked (a part isn't).
    const sure = () => [...forSale].filter((id) => G.ofCategory(id)[0].stage !== 'part').length;
    for (const id of CATEGORIES) if (sure() < config.minForSale) forSale.add(id);
    const goods = [];
    for (const category of CATEGORIES) {
      const produced = P.produces.includes(category), consumed = P.consumes.includes(category);
      const base = produced ? config.produced : consumed ? config.consumed : 1;
      for (const t of G.ofCategory(category)) {
        const factor = t.surface ? base : base * jitter();
        // The commonest type of a category on sale is always stocked, unless it's a part (made
        // goods are worth making); the rest by rarity and stage.
        const chance = produced ? config.stockProduced[t.rarity] : config.stock[t.rarity] * (config.stockStage[t.stage] ?? 1);
        const madeOnly = (t.stage === 'part' && t.rarity >= config.madeOnly) || t.surface; // (surface goods: brought in, never stocked)
        const stocked = forSale.has(category) && !madeOnly && (r() < chance || (t === G.ofCategory(category)[0] && t.stage !== 'part'));
        goods.push({ kind: t.id, category, rarity: t.rarity, produced, consumed, stocked, factor });
      }
    }
    if (profiles.size > 2000) profiles.clear();
    profiles.set(cacheKey, goods);
    return goods;
  }

  // Comfortable stock of a good, and the stock it rests at given its usual price factor.
  const targetOf = (g) => config.target[g.rarity];
  const restOf = (g) => targetOf(g) * g.factor ** (-1 / config.elasticity);

  // A saved stockpile now: back toward rest by halves, one per halfLife since it was last moved.
  function stockAt(entry, rest, now) {
    const t = Math.max(0, now - entry.at);
    return rest + (entry.stock - rest) * 2 ** (-t / config.halfLife);
  }
  const factorAt = (g, stock) => clamp((targetOf(g) / Math.max(stock, 1)) ** config.elasticity, config.clamp[0], config.clamp[1]);

  // The market at a station: { goods }, every trade good as { kind, category, rarity, buy, sell,
  // produced, consumed, stock, target, left }; buy is null where the station doesn't stock it.
  function market(galaxySeed, station, state = null, now = 0, shift = 0) {
    const spread = config.spread + shift;
    const saved = state?.[station.key] || {};
    const goods = profile(galaxySeed, station).map((g) => {
      const rest = restOf(g);
      const entry = saved[g.kind];
      const stock = entry ? stockAt(entry, rest, now) : rest;
      // At rest, the usual factor itself, so an untouched market is exactly the seeded one.
      const price = G.type(g.kind).price * (entry ? factorAt(g, stock) : g.factor);
      return {
        kind: g.kind, category: g.category, rarity: g.rarity, produced: g.produced, consumed: g.consumed,
        buy: g.stocked ? Math.max(1, Math.round(price * (1 + spread))) : null,
        sell: Math.max(1, Math.round(price * (1 - spread))),
        stock, target: targetOf(g), left: g.stocked ? Math.max(0, Math.floor(stock)) : 0,
      };
    });
    return { goods };
  }

  const empty = () => ({});

  // n units of a good into a station's stockpile (sold to it), or out of it (n < 0, bought).
  function trade(state, galaxySeed, station, kind, n, now) {
    const g = profile(galaxySeed, station).find((x) => x.kind === kind);
    if (!g) return;
    const rest = restOf(g);
    const at = state[station.key] || (state[station.key] = {});
    const stock = Math.max(0, (at[kind] ? stockAt(at[kind], rest, now) : rest) + n);
    if (Math.abs(stock - rest) < config.settled) delete at[kind];
    else at[kind] = { stock, at: now };
    if (!Object.keys(at).length) delete state[station.key];
  }

  // Forget stockpiles that have had long enough to come back to rest (2^-30 of any push is nothing).
  function prune(state, now) {
    for (const [key, goods] of Object.entries(state)) {
      for (const [kind, e] of Object.entries(goods)) if (now - e.at > 30 * config.halfLife) delete goods[kind];
      if (!Object.keys(goods).length) delete state[key];
    }
    return state;
  }

  // A saved state, checked: known goods, finite numbers.
  function read(d) {
    const out = {};
    if (!d || typeof d !== 'object') return out;
    for (const [key, goods] of Object.entries(d)) {
      if (!goods || typeof goods !== 'object') continue;
      for (const [kind, e] of Object.entries(goods)) {
        if (!G.type(kind) || G.isSalvage(kind) || !e || !Number.isFinite(e.stock) || !Number.isFinite(e.at) || e.stock < 0) continue;
        (out[key] || (out[key] = {}))[kind] = { stock: e.stock, at: e.at };
      }
    }
    return out;
  }

  return { config, basePrice, market, empty, trade, prune, read };
})();

export { Economy };
