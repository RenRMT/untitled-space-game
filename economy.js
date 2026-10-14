'use strict';

// Station markets, recreated on demand from the galaxy seed and the station (no saved state).
// Every station buys every trade good and all salvage; what it sells, and at what price, depends on
// what kind of place it is:
// - goods it produces are cheap (and always on sale), goods it consumes fetch a premium,
// - outposts follow their type (mining camps sell ore, refineries want it, ...),
// - system stations get a seeded mix; capitals and major stations sell everything,
// - salvage (loot components) is never sold, and pays best at salvage yards and Waystations.
// Each station adds a little seeded jitter, so neighbouring markets differ.
// Prices are whole credits. `buy` is what the player pays, `sell` what the player gets.
// Works as a classic browser script (global `Economy`) and as a Node module.

const Economy = (() => {
  const { hashInt, mulberry32, seedToInt } = typeof require === 'function' ? require('./rng.js') : globalThis;

  // Base price per unit, by item kind (art/items.js ids).
  const GOODS = { metal: 60, mineral: 45, gas: 35, synthetic: 90, crates: 50, barrels: 40, tubes: 70, fabrics: 55, perishables: 30 };
  const SALVAGE = { hull: 120, weapon: 220, computer: 180, drive: 200 };
  const GOOD_IDS = Object.keys(GOODS);

  const config = {
    produced: 0.7, // price factor for goods a station produces
    consumed: 1.35, // ... and for goods it consumes
    jitter: 0.1, // +/- per station and good
    spread: 0.08, // the station sells this much above its price and buys this much below
    minForSale: 3, // smallest number of goods a station offers
    startingCredits: 500,
  };

  // Fixed profiles for outposts and special stations; system stations without one get a seeded mix.
  const PROFILES = {
    capital: { produces: ['synthetic', 'fabrics', 'crates'], consumes: ['perishables', 'mineral', 'gas'], sellsAll: true },
    waystation: { produces: [], consumes: ['perishables', 'barrels'], sellsAll: true, salvage: 1.15 },
    'mining camp': { produces: ['mineral', 'metal'], consumes: ['perishables', 'tubes', 'gas'] },
    refinery: { produces: ['metal', 'gas', 'barrels'], consumes: ['mineral'] },
    'trading post': { produces: ['crates'], consumes: [], sellsAll: true },
    'research outpost': { produces: ['synthetic'], consumes: ['tubes', 'perishables'], salvageBy: { computer: 1.4 } },
    hermitage: { produces: ['fabrics', 'perishables'], consumes: ['tubes', 'barrels'] },
    'salvage yard': { produces: ['metal', 'tubes'], consumes: [], salvage: 1.3 },
  };

  // Seeded profile for a system station: a couple of goods made, a couple wanted.
  function mixedProfile(r, major) {
    const pool = GOOD_IDS.slice();
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

  // The market at a station: { goods: [{ kind, buy, sell, produced, consumed }], salvage: [{ kind, sell }] }.
  // buy is null where the station doesn't sell that good.
  function market(galaxySeed, station) {
    const r = mulberry32(hashInt(seedToInt(galaxySeed), seedToInt(station.key), 0xec0));
    const P = profileOf(station, r);
    const jitter = () => 1 + (r() * 2 - 1) * config.jitter;
    const forSale = new Set(P.produces);
    for (const id of GOOD_IDS) if (P.sellsAll || r() < 0.5) forSale.add(id);
    for (const id of GOOD_IDS) if (forSale.size < config.minForSale) forSale.add(id);
    const goods = GOOD_IDS.map((kind) => {
      const produced = P.produces.includes(kind), consumed = P.consumes.includes(kind);
      const price = GOODS[kind] * (produced ? config.produced : consumed ? config.consumed : 1) * jitter();
      return {
        kind, produced, consumed,
        buy: forSale.has(kind) ? Math.max(1, Math.round(price * (1 + config.spread))) : null,
        sell: Math.max(1, Math.round(price * (1 - config.spread))),
      };
    });
    const salvage = Object.keys(SALVAGE).map((kind) => ({
      kind,
      sell: Math.max(1, Math.round(SALVAGE[kind] * (P.salvage || 1) * ((P.salvageBy || {})[kind] || 1) * jitter() * (1 - config.spread))),
    }));
    return { goods, salvage };
  }

  return { GOODS, SALVAGE, config, market };
})();

if (typeof module !== 'undefined') module.exports = Economy;
