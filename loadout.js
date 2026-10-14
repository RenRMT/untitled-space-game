'use strict';

// Ship classes (hulls), their equipment slots and the equipment fitted in them.
// A hull has 1–4 weapon slots and one each of shield, ship computer, engine and scanner. What is
// fitted decides how the ship flies and senses:
// - engine: top speed, acceleration and turn rate,
// - scanner: how many sectors around the ship are charted, and how far contacts are pinged,
// - ship computer: mining speed, and accuracy in combat,
// - weapons and shields: damage and protection in combat (combat.js); engine evasion and scanner
//   initiative count there too.
// NPC ships (fighters, freighters) are hulls with starter gear as well.
// For now every ship starts with its hull's starter gear and nothing can be bought or swapped.
// A loadout is plain data, ready to save: { hull, fitted: { [slot id]: equipment id | null } }.
// Works as a classic browser script (global `Loadout`) and as a Node module.

const Loadout = (() => {
  const MAX_WEAPONS = 4;

  // Slot types, in the order the Ship tab lists them.
  const SLOT_TYPES = {
    weapon: 'Weapon',
    shield: 'Shield',
    computer: 'Ship computer',
    engine: 'Engine',
    scanner: 'Scanner',
  };

  // Equipment by id. stats feed stats() below; turnRate is in radians per second. In combat
  // (combat.js) the computer's accuracy is weighed against the target engine's evasion.
  const EQUIPMENT = {
    'pulse-laser-1': { slot: 'weapon', name: 'Pulse laser Mk I', stats: { damage: 6, fireRate: 4, range: 700 } },
    'deflector-1': { slot: 'shield', name: 'Deflector Mk I', stats: { strength: 80, recharge: 6 } },
    'flight-computer-1': { slot: 'computer', name: 'Flight computer Mk I', stats: { miningRate: 1, accuracy: 0.75 } },
    'courier-drive-1': { slot: 'engine', name: 'Courier drive Mk I', stats: { maxSpeed: 650, accel: 520, turnRate: 3.6, evasion: 0.15 } },
    'survey-scanner-1': { slot: 'scanner', name: 'Survey scanner Mk I', stats: { sensorRange: 1, pingRange: 2 } },
    // Gear fitted to NPC ships.
    'autocannon-1': { slot: 'weapon', name: 'Autocannon Mk I', stats: { damage: 5, fireRate: 3, range: 600 } },
    'light-deflector-1': { slot: 'shield', name: 'Light deflector Mk I', stats: { strength: 30, recharge: 2 } },
    'cargo-shield-1': { slot: 'shield', name: 'Cargo shield Mk I', stats: { strength: 60, recharge: 3 } },
    'targeting-computer-1': { slot: 'computer', name: 'Targeting computer Mk I', stats: { miningRate: 0, accuracy: 0.65 } },
    'fighter-drive-1': { slot: 'engine', name: 'Fighter drive Mk I', stats: { maxSpeed: 700, accel: 600, turnRate: 4.2, evasion: 0.25 } },
    'freighter-drive-1': { slot: 'engine', name: 'Freighter drive Mk I', stats: { maxSpeed: 300, accel: 200, turnRate: 1.5, evasion: 0.05 } },
    'basic-scanner-1': { slot: 'scanner', name: 'Basic scanner Mk I', stats: { sensorRange: 1, pingRange: 1 } },
  };

  // Ship classes. radius is the hull's collision size in world units, cargo its hold in units,
  // hull its hit points in combat. The player flies a Courier; fighters and freighters are the
  // NPC ships of the same names (sector.js roles).
  const HULLS = {
    courier: {
      name: 'Courier', radius: 16, cargo: 20, hull: 120, weapons: 2,
      starter: {
        'weapon-1': 'pulse-laser-1', 'weapon-2': null,
        shield: 'deflector-1', computer: 'flight-computer-1', engine: 'courier-drive-1', scanner: 'survey-scanner-1',
      },
    },
    fighter: {
      name: 'Fighter', radius: 14, cargo: 0, hull: 50, weapons: 1,
      starter: {
        'weapon-1': 'autocannon-1', shield: 'light-deflector-1', computer: 'targeting-computer-1',
        engine: 'fighter-drive-1', scanner: 'basic-scanner-1',
      },
    },
    freighter: {
      name: 'Freighter', radius: 30, cargo: 60, hull: 160, weapons: 1,
      starter: {
        'weapon-1': 'autocannon-1', shield: 'cargo-shield-1', computer: 'targeting-computer-1',
        engine: 'freighter-drive-1', scanner: 'basic-scanner-1',
      },
    },
  };

  // The slots of a hull, in display order: [{ id, type, label }].
  function slotsOf(hullId) {
    const hull = HULLS[hullId];
    const out = [];
    for (let i = 1; i <= hull.weapons; i++) out.push({ id: `weapon-${i}`, type: 'weapon', label: `${SLOT_TYPES.weapon} ${i}` });
    for (const type of Object.keys(SLOT_TYPES)) if (type !== 'weapon') out.push({ id: type, type, label: SLOT_TYPES[type] });
    return out;
  }

  // A new ship of a class, with its starter gear.
  function starter(hullId) {
    const fitted = {};
    for (const s of slotsOf(hullId)) fitted[s.id] = HULLS[hullId].starter[s.id] ?? null;
    return { hull: hullId, fitted };
  }

  // Slots with what is fitted in them: [{ id, type, label, item: { id, ...EQUIPMENT[id] } | null }].
  function slots(loadout) {
    return slotsOf(loadout.hull).map((s) => {
      const id = loadout.fitted[s.id];
      return { ...s, item: id && EQUIPMENT[id] ? { id, ...EQUIPMENT[id] } : null };
    });
  }

  // What the ship can do with this loadout. Empty slots contribute nothing.
  // initiative (who fires first each combat round) comes from the scanner's reach.
  function stats(loadout) {
    const hull = HULLS[loadout.hull];
    const out = {
      name: hull.name, radius: hull.radius, cargo: hull.cargo, hull: hull.hull,
      maxSpeed: 0, accel: 0, turnRate: 0, sensorRange: 0, pingRange: 0, miningRate: 0,
      shield: 0, shieldRecharge: 0, firepower: 0, weaponSlots: hull.weapons, weaponsFitted: 0,
      accuracy: 0, evasion: 0, initiative: 0, weapons: [],
    };
    for (const { type, item } of slots(loadout)) {
      if (!item) continue;
      const s = item.stats;
      if (type === 'engine') Object.assign(out, { maxSpeed: s.maxSpeed, accel: s.accel, turnRate: s.turnRate, evasion: s.evasion || 0 });
      else if (type === 'scanner') Object.assign(out, { sensorRange: s.sensorRange, pingRange: s.pingRange, initiative: s.sensorRange + s.pingRange });
      else if (type === 'computer') Object.assign(out, { miningRate: s.miningRate, accuracy: s.accuracy || 0 });
      else if (type === 'shield') Object.assign(out, { shield: s.strength, shieldRecharge: s.recharge });
      else if (type === 'weapon') {
        out.firepower += s.damage * s.fireRate;
        out.weaponsFitted++;
        out.weapons.push({ name: item.name, damage: s.damage, fireRate: s.fireRate });
      }
    }
    return out;
  }

  const degrees = (rad) => Math.round((rad * 180) / Math.PI);
  const sectors = (n) => `${n} sector${n === 1 ? '' : 's'}`;

  // One line of what a piece of equipment does, for the Ship tab.
  function summary(item) {
    const s = item.stats;
    switch (item.slot) {
      case 'weapon': return `${s.damage} damage · ${s.fireRate} shots/s · ${s.range} range`;
      case 'shield': return `${s.strength} strength · ${s.recharge}/s recharge`;
      case 'computer': return `${Math.round(s.accuracy * 100)}% accuracy · mining ×${s.miningRate.toFixed(1)}`;
      case 'engine': return `${s.maxSpeed} speed · ${s.accel} accel · ${degrees(s.turnRate)}°/s · ${Math.round(s.evasion * 100)}% evasion`;
      case 'scanner': return `Charts ${sectors(s.sensorRange)} around · pings ${sectors(s.pingRange)}`;
      default: return '';
    }
  }

  return { MAX_WEAPONS, SLOT_TYPES, EQUIPMENT, HULLS, slotsOf, starter, slots, stats, summary };
})();

if (typeof module !== 'undefined') module.exports = Loadout;
