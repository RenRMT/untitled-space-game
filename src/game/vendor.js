// The outfitter as the station menu sees it (its Outfitter tab, ui/station.js): gambits, gear and
// consumables for sale at the station docked at (rules/vendor.js), bought with credits.
// - Gambits are owned once bought (cargo.gambits), by the pilot and the whole squad.
// - Gear is the station's stock for today: a piece bought is gone from it until the stock turns over
//   the next day (cargo.shop). It goes into the spare gear, to fit from the Ship tab.
// - Consumables go into the kit (cargo.kit).
//
//   vendor.at(station)        the station docked at (game/docking.js), or null once launched
//   vendor.level              its system's level (world/galaxy.js), 1..5
//   vendor.gambits() -> [{ id, title, note, tier, price, owned, ok, why }]
//   vendor.gear() -> [{ i, spec, item, need (the level it asks for), price, sold }]          vendor.kit() -> [{ id, ability, price, count }]
//   vendor.mods() -> [{ id, mod, price, count }] (none where mods aren't sold)
//   vendor.buyGambit(id), vendor.buyGear(i), vendor.buyKit(id), vendor.buyMod(id) -> true if bought
//   ownedGambits() -> Set of package ids (the free ones among them)
//   grantGambit(id) -> true if it was new (a dungeon's drop: game/dungeon.js)
// Part of the flight view; src/main.js starts it.

import { Clock } from '../core/clock.js';
import { Abilities } from '../rules/abilities.js';
import { Loadout } from '../rules/loadout.js';
import { Loot } from '../rules/loot.js';
import { Mods } from '../rules/mods.js';
import { Progress } from '../rules/progress.js';
import { Research } from '../rules/research.js';
import { Vendor } from '../rules/vendor.js';
import { addTo, cargo, saveCargo, takeLoot } from './cargo.js';
import { notify } from './state.js';
import { world } from './world.js';

export const ownedGambits = () => new Set([...cargo.gambits, ...Vendor.FREE]);
export function grantGambit(id) {
  if (!Vendor.isGambit(id) || cargo.gambits.includes(id)) return false;
  cargo.gambits.push(id);
  saveCargo();
  return true;
}

let here = null; // { key, level, capital }
const today = () => Vendor.day(Clock.now());
// What's been bought from today's stock at a station: cargo.shop = { day, bought: { [key]: [i] } },
// cleared when the day turns over.
function boughtHere() {
  if (!cargo.shop || cargo.shop.day !== today()) cargo.shop = { day: today(), bought: {} };
  return (cargo.shop.bought[here.key] ||= []);
}

export const vendor = {
  at(station) {
    if (!station) { here = null; return; }
    const st = station.station || station, sys = world.galaxy?.systems[st.system];
    here = { key: station.key, level: Math.max(1, Math.min(5, sys?.level || 1)), capital: station.market?.type === 'capital', type: station.market?.type };
  },
  get level() { return here ? here.level : 1; },
  gambits() {
    if (!here) return [];
    const owned = ownedGambits();
    return Vendor.gambits(here.level).map((id) => {
      const P = Research.PACKAGES[id], can = Vendor.canBuyGambit(id, owned), price = Vendor.gambitPrice(id);
      const poor = can.ok && cargo.credits < price;
      return { id, title: Research.title(id), note: P.note, tier: Vendor.GAMBIT_TIER[id], price, owned: owned.has(id), ok: can.ok && !poor, why: poor ? 'Not enough credits' : can.why };
    });
  },
  buyGambit(id) {
    if (!here || !Vendor.gambits(here.level).includes(id)) return false;
    const price = Vendor.gambitPrice(id);
    if (!Vendor.canBuyGambit(id, ownedGambits()).ok || cargo.credits < price) return false;
    cargo.credits -= price;
    grantGambit(id);
    notify(`Gambit bought · import ${Research.title(id)}`, 2.5, { tone: 'good' });
    return true;
  },
  gear() {
    if (!here) return [];
    const sold = boughtHere();
    return Vendor.gear(here.key, here.level, today(), { capital: here.capital, cls: cargo.cls, seed: world.galaxy?.seed ?? 0 })
      .map((spec, i) => { const item = Loot.make(spec); return { i, spec, item, need: Progress.gearLevel(item), price: Vendor.gearPrice(spec), sold: sold.includes(i) }; });
  },
  buyGear(i) {
    const g = vendor.gear()[i];
    if (!g || g.sold || cargo.credits < g.price) return false;
    cargo.credits -= g.price;
    boughtHere().push(i);
    takeLoot(g.spec);
    notify(`Bought: ${Loadout.EQUIPMENT[g.spec.id].name} · in your spare gear`, 2.5, { tone: 'good' });
    saveCargo();
    return true;
  },
  mods: () => (here && Vendor.sellsMods(here.type) ? Vendor.MODS.map((id) => ({ id, mod: Mods.MODS[id], price: Vendor.MOD_PRICE, count: cargo.mods[id] || 0 })) : []),
  buyMod(id) {
    if (!here || !Vendor.sellsMods(here.type) || !Mods.MODS[id] || cargo.credits < Vendor.MOD_PRICE) return false;
    cargo.credits -= Vendor.MOD_PRICE;
    addTo(cargo.mods, id);
    saveCargo();
    return true;
  },
  kit: () => Vendor.KIT.map((id) => ({ id, ability: Abilities.ABILITIES[id], price: Abilities.ABILITIES[id].price, count: cargo.kit[id] || 0 })),
  buyKit(id) {
    const a = Abilities.ABILITIES[id];
    if (!here || !Vendor.KIT.includes(id) || cargo.credits < a.price) return false;
    cargo.credits -= a.price;
    addTo(cargo.kit, id);
    saveCargo();
    return true;
  },
};
