// Ship classes (hulls), their equipment slots and the equipment fitted in them.
// A hull has 1–4 weapon slots and one each of shield, ship computer, engine and scanner. What is
// fitted decides how the ship flies and senses:
// - engine: top speed, acceleration and turn rate (the hull's handling scales the last two),
// - scanner: how far around the ship hidden contacts are identified, and how far they are pinged,
// - ship computer: mining speed, accuracy in combat, and how fast it locks on in real-time combat,
// - weapons and shields: damage and protection in combat (combat/combat.js); engine evasion and scanner
//   initiative count there too. In real-time combat (combat/combat-realtime.js) a weapon also has a range
//   and a firing arc, and the scanner sets how far away a target can be locked.
// Equipment comes in lines of Mk I–V (tier 1–5). The player starts with the Mk I of each slot's
// line; the rest are researched (rules/research.js) and then bought at stations for `price` credits.
// NPC ships (fighters, freighters) fit their own lines, by tier: pirates in more dangerous space
// fly better gear (world/security.js). Hulls marked with a price are sold at shipyards.
// Hull upgrades from research (more cargo, more hull, an extra hardpoint) come in as `upgrades`:
// { cargo, hull } as fractions added, { weapons } as extra weapon slots.
// A loadout is plain data, ready to save: { hull, fitted: { [slot id]: equipment id | null } }.
// ES module (`Loadout`); also runs in Node (the tests).

import { Format } from '../core/format.js';
import { clamp } from '../core/math.js';

const Loadout = (() => {
  const MAX_WEAPONS = 4;
  const MK = [null, 'Mk I', 'Mk II', 'Mk III', 'Mk IV', 'Mk V'];

  // Slot types, in the order the Ship tab lists them.
  const SLOT_TYPES = {
    weapon: 'Weapon',
    shield: 'Shield',
    computer: 'Ship computer',
    engine: 'Engine',
    scanner: 'Scanner',
  };

  // Equipment lines. stats(tier) feeds stats() below; turnRate is in radians per second. In combat
  // (combat/combat.js) the computer's accuracy is weighed against the target engine's evasion.
  // Real-time combat only: a weapon's arc is the width of its field of fire in degrees, centred on
  // the ship's nose (360 for a turret); lockTime is the computer's seconds to lock on, lockRange
  // the scanner's reach for a lock, in world units. from: the first tier the line has (a branch
  // that starts later); npc: fitted to NPC ships only, never researched or sold.
  const at = (list, t) => list[t - 1];
  const LINES = {
    'pulse-laser': { slot: 'weapon', name: 'Pulse laser', stats: (t) => ({ damage: at([6, 8, 10, 13, 17], t), fireRate: 4, range: 650 + 50 * t, arc: 60 }) },
    'heavy-cannon': { slot: 'weapon', name: 'Heavy cannon', from: 2, stats: (t) => ({ damage: at([0, 18, 23, 29, 37], t), fireRate: 2, range: 800 + 100 * t, arc: 30 }) },
    'beam-turret': { slot: 'weapon', name: 'Beam turret', from: 3, stats: (t) => ({ damage: at([0, 0, 7, 9, 12], t), fireRate: 5, range: 500 + 50 * t, arc: 360 }) },
    deflector: { slot: 'shield', name: 'Deflector', stats: (t) => ({ strength: at([80, 110, 150, 200, 270], t), recharge: at([6, 8, 10, 13, 17], t) }) },
    'flight-computer': { slot: 'computer', name: 'Flight computer', stats: (t) => ({ miningRate: at([1, 1.25, 1.5, 1.8, 2.2], t), accuracy: at([0.75, 0.8, 0.85, 0.9, 0.95], t), lockTime: at([1, 0.85, 0.7, 0.55, 0.4], t) }) },
    'courier-drive': { slot: 'engine', name: 'Courier drive', stats: (t) => ({ maxSpeed: at([650, 700, 760, 820, 900], t), accel: at([520, 600, 690, 790, 900], t), turnRate: at([3.6, 3.8, 4, 4.2, 4.5], t), evasion: at([0.15, 0.18, 0.21, 0.24, 0.28], t) }) },
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
  // Credits to buy one, by tier; weapons cost a fifth more.
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
  // The player's starting gear: the Mk I of each line that has one (and isn't NPC gear).
  const STARTER_GEAR = Object.keys(EQUIPMENT).filter((id) => !EQUIPMENT[id].npc && EQUIPMENT[id].tier === 1);
  // Without a ship computer or a scanner, a lock is slow and short-ranged.
  const NO_LOCK = { lockTime: 2.5, lockRange: 600 };

  // Ship classes. radius is the hull's collision size in world units, cargo its hold in units,
  // hull its hit points in combat, handling a factor on the engine's acceleration and turn rate.
  // price: sold at shipyards for this many credits (a trade-in fetches half); art: which design
  // it is drawn as (game/options.js). The player starts in a Courier; fighters and freighters are the NPC
  // ships of the same names (flight/scene.js roles), fitted with their lines at a tier (npc()).
  const HULLS = {
    courier: {
      name: 'Courier', radius: 16, cargo: 20, hull: 120, weapons: 2, handling: 1, price: 4000,
      note: 'Quick and balanced: the ship you start in.',
      starter: {
        'weapon-1': 'pulse-laser-1', 'weapon-2': null,
        shield: 'deflector-1', computer: 'flight-computer-1', engine: 'courier-drive-1', scanner: 'survey-scanner-1',
      },
    },
    hauler: {
      name: 'Hauler', radius: 26, cargo: 60, hull: 160, weapons: 1, handling: 0.7, price: 9000,
      note: 'Three times the hold, one hardpoint, slow to turn.',
    },
    corvette: {
      name: 'Corvette', radius: 20, cargo: 24, hull: 220, weapons: 3, handling: 0.9, price: 16000,
      note: 'Three hardpoints and a tougher hull.',
    },
    gunship: {
      name: 'Gunship', radius: 24, cargo: 16, hull: 340, weapons: 4, handling: 0.75, price: 36000,
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
  function slotsOf(hullId, upgrades = {}) {
    const out = [];
    for (let i = 1; i <= weaponSlots(hullId, upgrades); i++) out.push({ id: `weapon-${i}`, type: 'weapon', label: `${SLOT_TYPES.weapon} ${i}` });
    for (const type of Object.keys(SLOT_TYPES)) if (type !== 'weapon') out.push({ id: type, type, label: SLOT_TYPES[type] });
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

  // The same gear moved to another hull: each slot keeps its item where the new hull has that slot;
  // what doesn't fit (weapons past its hardpoints) comes back in `left` (equipment ids).
  function refit(loadout, hullId, upgrades = {}) {
    const fitted = {}, left = [];
    for (const s of slotsOf(hullId, upgrades)) fitted[s.id] = loadout.fitted[s.id] ?? null;
    for (const [id, item] of Object.entries(loadout.fitted)) if (item && !(id in fitted)) left.push(item);
    return { loadout: { hull: hullId, fitted }, left };
  }

  // What the ship can do with this loadout. Empty slots contribute nothing.
  // initiative (who fires first each combat round) comes from the scanner's reach.
  function stats(loadout, upgrades = {}) {
    const hull = HULLS[loadout.hull];
    const handling = hull.handling || 1;
    const out = {
      name: hull.name, radius: hull.radius,
      cargo: Math.round(hull.cargo * (1 + (upgrades.cargo || 0))),
      hull: Math.round(hull.hull * (1 + (upgrades.hull || 0) + (loadout.armour || 0))),
      maxSpeed: 0, accel: 0, turnRate: 0, sensorRange: 0, pingRange: 0, miningRate: 0,
      shield: 0, shieldRecharge: 0, firepower: 0, weaponSlots: weaponSlots(loadout.hull, upgrades), weaponsFitted: 0,
      accuracy: 0, evasion: 0, initiative: 0, weapons: [], ...NO_LOCK,
    };
    for (const { type, item } of slots(loadout, upgrades)) {
      if (!item) continue;
      const s = item.stats;
      if (type === 'engine') Object.assign(out, { maxSpeed: s.maxSpeed, accel: s.accel * handling, turnRate: s.turnRate * handling, evasion: s.evasion || 0 });
      else if (type === 'scanner') Object.assign(out, { sensorRange: s.sensorRange, pingRange: s.pingRange, initiative: s.sensorRange + s.pingRange, lockRange: s.lockRange });
      else if (type === 'computer') Object.assign(out, { miningRate: s.miningRate, accuracy: s.accuracy || 0, lockTime: s.lockTime });
      else if (type === 'shield') Object.assign(out, { shield: s.strength, shieldRecharge: s.recharge });
      else if (type === 'weapon') {
        out.firepower += s.damage * s.fireRate;
        out.weaponsFitted++;
        out.weapons.push({ name: item.name, damage: s.damage, fireRate: s.fireRate, range: s.range, arc: s.arc });
      }
    }
    return out;
  }

  const degrees = (rad) => Math.round((rad * 180) / Math.PI);
  const k = Format.dist;

  // One line of what a piece of equipment does, for the Ship and Research tabs.
  function summary(item) {
    const s = item.stats;
    switch (item.slot) {
      case 'weapon': return `${s.damage} damage · ${s.fireRate} shots/s · ${s.range} range · ${s.arc >= 360 ? 'turret' : `${s.arc}° arc`}`;
      case 'shield': return `${s.strength} strength · ${s.recharge}/s recharge`;
      case 'computer': return `${Math.round(s.accuracy * 100)}% accuracy · ${s.lockTime} s lock · mining ×${s.miningRate.toFixed(1)}`;
      case 'engine': return `${s.maxSpeed} speed · ${s.accel} accel · ${degrees(s.turnRate)}°/s · ${Math.round(s.evasion * 100)}% evasion`;
      case 'scanner': return `Identifies at ${k(s.sensorRange)} · pings at ${k(s.pingRange)} · locks at ${k(s.lockRange)}`;
      default: return '';
    }
  }

  return { MAX_WEAPONS, MK, SLOT_TYPES, LINES, EQUIPMENT, STARTER_GEAR, HULLS, FOR_SALE, slotsOf, starter, npc, slots, refit, stats, summary };
})();

export { Loadout };
