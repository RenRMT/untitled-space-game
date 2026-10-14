'use strict';

// Station markets, recreated on demand from the galaxy seed and the station (no saved state).
// Prices start from each item type's base price (goods.js). Every station buys every trade good;
// what it sells, and at what price, depends on what kind of place it is:
// - categories it produces are cheap, categories it consumes fetch a premium,
// - outposts follow their type (mining camps sell ore, salvage yards metal and conduits),
// - system stations get a seeded mix; capitals and major stations stock every category,
// - within a category on sale, common types are always stocked and rarer ones less often (more
//   often where the category is produced); exotics are never sold, only found.
// Salvaged components aren't traded at all: they're used for research (research.js).
// Each station adds a little seeded jitter, so neighbouring markets differ.
// Prices are whole credits. `buy` is what the player pays, `sell` what the player gets.
// Works as a classic browser script (global `Economy`) and as a Node module.

const Economy = (() => {
  const { hashInt, mulberry32, seedToInt } = typeof require === 'function' ? require('./rng.js') : globalThis;
  const G = typeof require === 'function' ? require('./goods.js') : Goods;
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
    startingCredits: 500,
  };

  // Fixed profiles for outposts and special stations; system stations without one get a seeded mix.
  const PROFILES = {
    capital: { produces: ['synthetic', 'crates'], consumes: ['mineral', 'gas'], sellsAll: true },
    waystation: { produces: [], consumes: ['barrels'], sellsAll: true },
    'mining camp': { produces: ['mineral', 'metal'], consumes: ['tubes', 'gas'] },
    'salvage yard': { produces: ['metal', 'tubes'], consumes: [] },
  };

  // Seeded profile for a system station: a couple of categories made, a couple wanted.
  function mixedProfile(r, major) {
    const pool = CATEGORIES.slice();
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    const nProd = major ? 2 : 1 + Math.floor(r() * 2);
    return { produces: pool.slice(0, nProd), consumes: pool.slice(nProd, nProd + 2), sellsAll: major };
  }

  // A station as Sectors builds it: { key, market: { kind: 'system' | 'outpost', type } }.
  // type is the outpost type, or for system stations 'capital' | 'waystation' | 'major' | 'minor'.
  function profileOf(station, r) {
    const type = station.market.type;
    return PROFILES[type] || mixedProfile(r, type === 'major');
  }

  // Base price of an item type (goods.js), before any station's factors.
  const basePrice = (kind) => (G.type(kind) ? G.type(kind).price : 0);

  // The market at a station: { goods }, every trade good as { kind, category, rarity, buy, sell,
  // produced, consumed }; buy is null where the station doesn't stock it.
  function market(galaxySeed, station) {
    const r = mulberry32(hashInt(seedToInt(galaxySeed), seedToInt(station.key), 0xec0));
    const P = profileOf(station, r);
    const jitter = () => 1 + (r() * 2 - 1) * config.jitter;
    const forSale = new Set(P.produces);
    for (const id of CATEGORIES) if (P.sellsAll || r() < 0.5) forSale.add(id);
    for (const id of CATEGORIES) if (forSale.size < config.minForSale) forSale.add(id);
    const goods = [];
    for (const category of CATEGORIES) {
      const produced = P.produces.includes(category), consumed = P.consumes.includes(category);
      const factor = produced ? config.produced : consumed ? config.consumed : 1;
      for (const t of G.ofCategory(category)) {
        const price = t.price * factor * jitter();
        // The commonest type of a category on sale is always stocked; the rest by rarity.
        const stocked = forSale.has(category) && (r() < (produced ? config.stockProduced : config.stock)[t.rarity] || t === G.ofCategory(category)[0]);
        goods.push({
          kind: t.id, category, rarity: t.rarity, produced, consumed,
          buy: stocked ? Math.max(1, Math.round(price * (1 + config.spread))) : null,
          sell: Math.max(1, Math.round(price * (1 - config.spread))),
        });
      }
    }
    return { goods };
  }

  return { config, basePrice, market };
})();

if (typeof module !== 'undefined') module.exports = Economy;
