// Ship classes (hulls), their equipment slots and the equipment fitted in them.
// A hull has 1–4 tool mounts (slot type 'weapon', from when they held guns), one each of shield,
// ship computer, engine and scanner, and 1–3 utility slots. What is fitted decides how the ship
// flies, senses, mines and stands up to hazards (rules/hazards.js):
// - engine: top speed, acceleration and turn rate (the hull's handling scales the last two),
// - scanner: how far around the ship hidden contacts are identified, how far they are pinged, and
//   how far away a rock can be locked,
// - ship computer: accuracy, how fast it locks on, and how hard its tools bite (miningRate),
// - tools: what wears rocks down (game/combat.js extraction, on combat/combat-realtime.js): damage,
//   fire rate, range and a field of fire (arc), and a factor for each material (vs: rock, gas), so
//   a drill does nothing to gas and a siphon nothing to rock,
// - shields: take collisions (flight/collide.js) and other knocks before the hull does,
// - utility gear, for longer runs: a radiator sheds more heat a second (cool), radiation shielding
//   stops a share of the radiation coming in (radGuard), an auxiliary tank holds more fuel (fuel) and
//   a cargo pod more cargo (cargo). Two of a kind add up (shielding: each stops its share of what
//   the other lets through).
// Equipment comes in lines of Mk I–V (tier 1–5). The player starts with the Mk I of each slot's
// line; the rest is assembled from parts (rules/recipes.js), Mk II and up by blueprint
// (rules/research.js). `price` is what it's worth: spare gear sells for half.
// NPC ships (fighters, freighters) fit their own lines, by tier (they are switched off for now).
// Hulls marked with a price are sold at shipyards.
// Research (rules/research.js upgrades: hull refits, refinements) comes in as `upgrades`:
// { cargo, hull } as fractions added, { weapons } as extra tool mounts, and { lines: { [line]:
// { [stat]: fraction } } } added to the stats of that line's gear (tuned), within LIMITS.
// Mods (rules/mods.js) are fitted to a slot, as many as its gear has room for (the rest wait, unused).
// A loadout is plain data, ready to save: { hull, fitted: { [slot id]: equipment id | null },
// mods?: { [slot id]: [mod id] } }.
// ES module (`Loadout`); also runs in Node (the tests).

import { Format } from '../core/format.js';
import { clamp } from '../core/math.js';
import { Mods } from './mods.js';

const Loadout = (() => {
  const MAX_WEAPONS = 4;
  const MK = [null, 'Mk I', 'Mk II', 'Mk III', 'Mk IV', 'Mk V'];

  // Slot types, in the order the Ship tab lists them.
  const SLOT_TYPES = {
    weapon: 'Tool',
    shield: 'Shield',
    computer: 'Ship computer',
    engine: 'Engine',
    scanner: 'Scanner',
    utility: 'Utility',
  };

  // Equipment lines. stats(tier) feeds stats() below; turnRate is in radians per second. A tool's
  // arc is the width of its field of fire in degrees, centred on the ship's nose (360: all round);
  // vs: its damage factor on each material (rules/mining.js material, or 'ship'; missing: 1). lockTime is the
  // computer's seconds to lock on, lockRange the scanner's reach for a lock, in world units.
  // from: the first tier the line has (a branch that starts later); npc: fitted to NPC ships only,
  // never sold. The tool lines keep the ids of the weapons they were, so saves need no change.
  const at = (list, t) => list[t - 1];
  const LINES = {
    // Tools: the laser reaches far and does a little to gas; the drill bites hard, close in; the
    // siphon draws gas from all round.
    'pulse-laser': { slot: 'weapon', name: 'Mining laser', stats: (t) => ({ damage: at([6, 8, 10, 13, 17], t), fireRate: 4, range: 650 + 50 * t, arc: 60, vs: { rock: 1, gas: 0.25 } }) },
    'heavy-cannon': { slot: 'weapon', name: 'Fracture drill', from: 2, stats: (t) => ({ damage: at([0, 18, 23, 29, 37], t), fireRate: 2, range: 260 + 30 * t, arc: 40, vs: { rock: 1.5, gas: 0 } }) },
    'beam-turret': { slot: 'weapon', name: 'Gas siphon', stats: (t) => ({ damage: at([4, 5, 7, 9, 12], t), fireRate: 5, range: 350 + 50 * t, arc: 360, vs: { rock: 0, gas: 1, ship: 0 } }) },
    deflector: { slot: 'shield', name: 'Deflector', stats: (t) => ({ strength: at([80, 110, 150, 200, 270], t), recharge: at([6, 8, 10, 13, 17], t) }) },
    'flight-computer': { slot: 'computer', name: 'Flight computer', stats: (t) => ({ miningRate: at([1, 1.25, 1.5, 1.8, 2.2], t), accuracy: at([0.75, 0.8, 0.85, 0.9, 0.95], t), lockTime: at([1, 0.85, 0.7, 0.55, 0.4], t) }) },
    'courier-drive': { slot: 'engine', name: 'Courier drive', stats: (t) => ({ maxSpeed: at([650, 700, 760, 820, 900], t), accel: at([520, 600, 690, 790, 900], t), turnRate: at([3.6, 3.8, 4, 4.2, 4.5], t), evasion: at([0.15, 0.18, 0.21, 0.24, 0.28], t) }) },
    // Utility gear: for hazards (heat, radiation) and for longer runs (fuel, hold).
    radiator: { slot: 'utility', name: 'Radiator', stats: (t) => ({ cool: at([3, 4, 5.5, 7, 9], t) }) },
    'rad-shielding': { slot: 'utility', name: 'Radiation shielding', stats: (t) => ({ radGuard: at([0.3, 0.38, 0.46, 0.54, 0.62], t) }) },
    'aux-tank': { slot: 'utility', name: 'Auxiliary tank', stats: (t) => ({ fuel: at([40, 55, 75, 100, 130], t) }) },
    'cargo-pod': { slot: 'utility', name: 'Cargo pod', stats: (t) => ({ cargo: at([6, 8, 11, 14, 18], t) }) },
    'survey-scanner': { slot: 'scanner', name: 'Survey scanner', stats: (t) => ({ sensorRange: at([3000, 3500, 4500, 5500, 7000], t), pingRange: at([7000, 9000, 11000, 13000, 16000], t), lockRange: at([1600, 1900, 2200, 2600, 3000], t) }) },
    // NPC gear: pirates fly Mk I–IV of these by their tier; freighters and patrols Mk I.
    autocannon: { slot: 'weapon', name: 'Autocannon', npc: true, stats: (t) => ({ damage: at([5, 7, 9, 12, 15], t), fireRate: 3, range: 550 + 50 * t, arc: 40 }) },
    'cargo-turret': { slot: 'weapon', name: 'Cargo turret', npc: true, stats: (t) => ({ damage: at([5, 6, 8, 10, 12], t), fireRate: 3, range: 600, arc: 360 }) },
    'light-deflector': { slot: 'shield', name: 'Light deflector', npc: true, stats: (t) => ({ strength: at([30, 42, 58, 78, 100], t), recharge: at([2, 3, 4, 5, 6], t) }) },
    'cargo-shield': { slot: 'shield', name: 'Cargo shield', npc: true, stats: (t) => ({ strength: at([60, 80, 105, 135, 170], t), recharge: at([3, 4, 5, 6, 7], t) }) },
    'targeting-computer': { slot: 'computer', name: 'Targeting computer', npc: true, stats: (t) => ({ miningRate: 0, accuracy: at([0.65, 0.7, 0.75, 0.8, 0.85], t), lockTime: at([0.6, 0.55, 0.5, 0.45, 0.4], t) }) },
    'fighter-drive': { slot: 'engine', name: 'Fighter drive', npc: true, stats: (t) => ({ maxSpeed: at([700, 740, 780, 820, 860], t), accel: at([900, 950, 1000, 1050, 1100], t), turnRate: at([4.2, 4.3, 4.4, 4.5, 4.6], t), evasion: at([0.25, 0.27, 0.29, 0.31, 0.33], t) }) },
    'freighter-drive': { slot: 'engine', name: 'Freighter drive', npc: true, stats: () => ({ maxSpeed: 300, accel: 200, turnRate: 1.5, evasion: 0.05 }) },
    'basic-scanner': { slot: 'scanner', name: 'Basic scanner', npc: true, stats: (t) => ({ sensorRange: 2000, pingRange: 2000, lockRange: 1200 + 150 * (t - 1) }) },
  };
  // Credits to buy one, by tier; tools cost a fifth more.
  const PRICES = [null, 250, 800, 2000, 5000, 12000];
  const WEAPON_PRICE = 1.2;

  // Equipment by id ('pulse-laser-3'): { slot, name, line, tier, stats, price, npc? }.
  const EQUIPMENT = {};
  for (const [line, L] of Object.entries(LINES)) {
    for (let t = L.from || 1; t <= 5; t++) {
      const price = L.npc ? 0 : Math.round(PRICES[t] * (L.slot === 'weapon' ? WEAPON_PRICE : 1));
      EQUIPMENT[`${line}-${t}`] = { slot: L.slot, name: `${L.name} ${MK[t]}`, line, tier: t, stats: L.stats(t), price, ...(L.npc ? { npc: true } : {}) };
    }
  }
  // The player's starting gear: the Mk I of each line that has one (and isn't NPC gear), but for
  // utility gear: the utility slots start empty.
  const STARTER_GEAR = Object.keys(EQUIPMENT).filter((id) => !EQUIPMENT[id].npc && EQUIPMENT[id].tier === 1 && EQUIPMENT[id].slot !== 'utility');
  // Without a ship computer or a scanner, a lock is slow and short-ranged.
  const NO_LOCK = { lockTime: 2.5, lockRange: 600 };
  // How far bonuses may take a stat: [lowest, highest].
  const LIMITS = { accuracy: [0, 0.99], evasion: [0, 0.6], lockTime: [0.2, Infinity], fireRate: [0.5, Infinity], arc: [0, 360], radGuard: [0, 0.9] };

  // What research (its line) and mods (as many as it has room for) add to a piece of gear's stats.
  function bonusFor(item, upgrades = {}, mods = []) {
    const out = { ...(upgrades.lines?.[item.line] || {}) };
    for (const [k, f] of Object.entries(Mods.effects(mods, Mods.SLOTS[item.tier]))) out[k] = (out[k] || 0) + f;
    return out;
  }
  // A piece of gear's stats with fractions added ({ damage: 0.08 } is 8% more damage), kept in LIMITS.
  function tuned(base, bonus = {}) {
    const out = { ...base };
    for (const [k, f] of Object.entries(bonus)) {
      if (!(k in out) || !f) continue;
      const [lo, hi] = LIMITS[k] || [0, Infinity];
      out[k] = clamp(out[k] * (1 + f), lo, hi);
    }
    return out;
  }

  // Ship classes. radius is the hull's collision size in world units, cargo its hold in units,
  // hull its hit points, fuel its tank (rules/hazards.js burns it), handling a factor on the
  // engine's acceleration and turn rate, utility its utility slots.
  // price: sold at shipyards for this many credits (a trade-in fetches half); art: which design
  // it is drawn as (game/options.js). The player starts in a Courier; fighters and freighters are the NPC
  // ships of the same names (flight/scene.js roles), fitted with their lines at a tier (npc()).
  const HULLS = {
    courier: {
      name: 'Courier', utility: 2, radius: 16, cargo: 20, hull: 120, fuel: 100, weapons: 2, handling: 1, price: 4000,
      note: 'Quick and balanced: the ship you start in.',
      starter: {
        'weapon-1': 'pulse-laser-1', 'weapon-2': 'beam-turret-1',
        shield: 'deflector-1', computer: 'flight-computer-1', engine: 'courier-drive-1', scanner: 'survey-scanner-1',
      },
    },
    hauler: {
      name: 'Hauler', utility: 3, radius: 26, cargo: 60, hull: 160, fuel: 160, weapons: 1, handling: 0.7, price: 9000,
      note: 'Three times the hold, one hardpoint, slow to turn.',
    },
    corvette: {
      name: 'Corvette', utility: 2, radius: 20, cargo: 24, hull: 220, fuel: 120, weapons: 3, handling: 0.9, price: 16000,
      note: 'Three hardpoints and a tougher hull.',
    },
    gunship: {
      name: 'Gunship', utility: 2, radius: 24, cargo: 16, hull: 340, fuel: 140, weapons: 4, handling: 0.75, price: 36000,
      note: 'Four hardpoints and the heaviest hull; little room for cargo.',
    },
    fighter: {
      name: 'Fighter', radius: 14, cargo: 0, hull: 50, weapons: 1, handling: 1,
      npc: { 'weapon-1': 'autocannon', shield: 'light-deflector', computer: 'targeting-computer', engine: 'fighter-drive', scanner: 'basic-scanner' },
    },
    freighter: {
      name: 'Freighter', radius: 30, cargo: 60, hull: 160, weapons: 1, handling: 1,
      npc: { 'weapon-1': 'cargo-turret', shield: 'cargo-shield', computer: 'targeting-computer', engine: 'freighter-drive', scanner: 'basic-scanner' },
    },
  };
  const FOR_SALE = Object.keys(HULLS).filter((id) => HULLS[id].price);
  // An NPC ship's hull gains this much per gear tier above Mk I.
  const NPC_ARMOUR = 0.2;

  const weaponSlots = (hullId, upgrades = {}) => Math.min(MAX_WEAPONS, HULLS[hullId].weapons + (upgrades.weapons || 0));

  // The slots of a hull, in display order: [{ id, type, label }]. upgrades.weapons adds hardpoints.
  const NUMBERED = ['weapon', 'utility'];
  function slotsOf(hullId, upgrades = {}) {
    const out = [];
    for (let i = 1; i <= weaponSlots(hullId, upgrades); i++) out.push({ id: `weapon-${i}`, type: 'weapon', label: `${SLOT_TYPES.weapon} ${i}` });
    for (const type of Object.keys(SLOT_TYPES)) if (!NUMBERED.includes(type)) out.push({ id: type, type, label: SLOT_TYPES[type] });
    for (let i = 1; i <= (HULLS[hullId].utility || 0); i++) out.push({ id: `utility-${i}`, type: 'utility', label: `${SLOT_TYPES.utility} ${i}` });
    return out;
  }

  // A new ship of a class with its starter gear (an NPC hull: its lines at Mk I).
  function starter(hullId) {
    const hull = HULLS[hullId];
    if (hull.npc) return npc(hullId, 1);
    const fitted = {};
    for (const s of slotsOf(hullId)) fitted[s.id] = hull.starter?.[s.id] ?? null;
    return { hull: hullId, fitted };
  }

  // An NPC ship of a class with its gear at a tier (1–5), and a hull reinforced to match.
  function npc(hullId, tier = 1) {
    const t = clamp(tier, 1, 5);
    const fitted = {};
    for (const s of slotsOf(hullId)) fitted[s.id] = HULLS[hullId].npc[s.id] ? `${HULLS[hullId].npc[s.id]}-${t}` : null;
    return { hull: hullId, fitted, armour: NPC_ARMOUR * (t - 1) };
  }

  // Slots with what is fitted in them: [{ id, type, label, item: { id, ...EQUIPMENT[id] } | null }].
  function slots(loadout, upgrades = {}) {
    return slotsOf(loadout.hull, upgrades).map((s) => {
      const id = loadout.fitted[s.id];
      return { ...s, item: id && EQUIPMENT[id] ? { id, ...EQUIPMENT[id] } : null };
    });
  }

  // The same gear moved to another hull: each slot keeps its item (and mods) where the new hull has
  // that slot; what doesn't fit (weapons past its hardpoints) comes back in `left` (equipment ids)
  // and `leftMods` (mod ids).
  function refit(loadout, hullId, upgrades = {}) {
    const fitted = {}, mods = {}, left = [], leftMods = [];
    for (const s of slotsOf(hullId, upgrades)) {
      fitted[s.id] = loadout.fitted[s.id] ?? null;
      if (loadout.mods?.[s.id]?.length) mods[s.id] = [...loadout.mods[s.id]];
    }
    for (const [id, item] of Object.entries(loadout.fitted)) if (item && !(id in fitted)) left.push(item);
    for (const [id, list] of Object.entries(loadout.mods || {})) if (!(id in fitted)) leftMods.push(...list);
    return { loadout: { hull: hullId, fitted, mods }, left, leftMods };
  }

  // Room for mods in a slot, by what's fitted there (none when empty, or for gear no mod fits).
  function modRoom(loadout, slotId) {
    const item = EQUIPMENT[loadout.fitted[slotId]];
    return item && Mods.LIST.some((m) => m.slot === item.slot) ? Mods.SLOTS[item.tier] : 0;
  }
  // The loadout with each slot's mods cut to the room its gear has, and what was cut (mod ids).
  function trimMods(loadout) {
    const mods = {}, left = [];
    for (const [id, list] of Object.entries(loadout.mods || {})) {
      const room = modRoom(loadout, id), type = EQUIPMENT[loadout.fitted[id]]?.slot;
      const keep = list.filter((m) => Mods.fits(m, type)).slice(0, room), rest = [...list];
      for (const m of keep) rest.splice(rest.indexOf(m), 1);
      left.push(...rest);
      if (keep.length) mods[id] = keep;
    }
    return { loadout: { ...loadout, mods }, left };
  }

  // What the ship can do with this loadout. Empty slots contribute nothing.
  // initiative (who fires first each combat round) comes from the scanner's reach.
  function stats(loadout, upgrades = {}) {
    const hull = HULLS[loadout.hull];
    const handling = hull.handling || 1;
    const out = {
      name: hull.name, radius: hull.radius,
      cargo: Math.round(hull.cargo * (1 + (upgrades.cargo || 0))),
      hull: Math.round(hull.hull * (1 + (upgrades.hull || 0) + (loadout.armour || 0))), fuel: hull.fuel || 100,
      maxSpeed: 0, accel: 0, turnRate: 0, sensorRange: 0, pingRange: 0, miningRate: 0,
      cool: 0, radGuard: 0,
      shield: 0, shieldRecharge: 0, firepower: 0, weaponSlots: weaponSlots(loadout.hull, upgrades), weaponsFitted: 0,
      accuracy: 0, evasion: 0, initiative: 0, weapons: [], ...NO_LOCK,
    };
    for (const { id, type, item } of slots(loadout, upgrades)) {
      if (!item) continue;
      const s = tuned(item.stats, bonusFor(item, upgrades, loadout.mods?.[id]));
      if (type === 'engine') Object.assign(out, { maxSpeed: s.maxSpeed, accel: s.accel * handling, turnRate: s.turnRate * handling, evasion: s.evasion || 0 });
      else if (type === 'scanner') Object.assign(out, { sensorRange: s.sensorRange, pingRange: s.pingRange, initiative: s.sensorRange + s.pingRange, lockRange: s.lockRange });
      else if (type === 'computer') Object.assign(out, { miningRate: s.miningRate, accuracy: s.accuracy || 0, lockTime: s.lockTime });
      else if (type === 'shield') Object.assign(out, { shield: s.strength, shieldRecharge: s.recharge });
      else if (type === 'utility') {
        out.cool += s.cool || 0;
        out.radGuard = 1 - (1 - out.radGuard) * (1 - (s.radGuard || 0));
        out.fuel += Math.round(s.fuel || 0);
        out.cargo += Math.round(s.cargo || 0);
      }
      else if (type === 'weapon') {
        out.firepower += s.damage * s.fireRate;
        out.weaponsFitted++;
        out.weapons.push({ name: item.name, damage: s.damage, fireRate: s.fireRate, range: s.range, arc: s.arc, ...(s.vs ? { vs: s.vs } : {}) });
      }
    }
    return out;
  }

  const degrees = (rad) => Math.round((rad * 180) / Math.PI);
  // What a tool does to each material: 'rock ×1.5 · no gas'.
  const vsText = (vs) => Object.entries(vs).map(([m, f]) => (f ? `${m} ×${f}` : `no ${m}`)).join(' · ');
  const k = Format.dist;

  // What a piece of utility gear does: '+5.5 heat shed a second'.
  function utilityText(s) {
    if (s.cool) return `+${s.cool} heat shed a second`;
    if (s.radGuard) return `stops ${Math.round(s.radGuard * 100)}% of radiation`;
    if (s.fuel) return `+${s.fuel} fuel`;
    if (s.cargo) return `+${s.cargo} hold`;
    return '';
  }

  // One line of what a piece of equipment does, for the Ship tab.
  function summary(item) {
    const s = item.stats;
    switch (item.slot) {
      case 'weapon': return `${s.damage} damage · ${s.fireRate}/s · ${s.range} range · ${s.arc >= 360 ? 'all round' : `${s.arc}° arc`}${s.vs ? ` · ${vsText(s.vs)}` : ''}`;
      case 'shield': return `${s.strength} strength · ${s.recharge}/s recharge`;
      case 'computer': return `${Math.round(s.accuracy * 100)}% accuracy · ${s.lockTime} s lock · mining ×${s.miningRate.toFixed(1)}`;
      case 'engine': return `${s.maxSpeed} speed · ${s.accel} accel · ${degrees(s.turnRate)}°/s · ${Math.round(s.evasion * 100)}% evasion`;
      case 'scanner': return `Identifies at ${k(s.sensorRange)} · pings at ${k(s.pingRange)} · locks at ${k(s.lockRange)}`;
      case 'utility': return utilityText(s);
      default: return '';
    }
  }

  return { MAX_WEAPONS, MK, SLOT_TYPES, LINES, EQUIPMENT, STARTER_GEAR, HULLS, FOR_SALE, LIMITS, slotsOf, starter, npc, slots, refit, modRoom, trimMods, bonusFor, tuned, stats, summary };
})();

export { Loadout };
