// Mods: fitted to a piece of gear's slot, each a fixed trade (an extended barrel reaches further
// but fires slower), picked by the player and changed freely while docked. Never random. Gear has
// room for more of them the better it is (SLOTS by Mk). A mod belongs to its slot, so it stays when
// the gear in the slot is swapped, as long as the new gear has room for it. Mods are assembled from
// parts (rules/recipes.js), once their kind is researched (rules/research.js `mods.<slot>`).
//
//   Mods.MODS[id]                 { id, name, slot (a rules/loadout.js slot type), effects: { [stat]: fraction }, note }
//   Mods.LIST                     every mod, by slot
//   Mods.SLOTS[tier] -> n         room for mods on gear of that Mk (I: none, II–III: one, IV–V: two)
//   Mods.fits(id, slotType) -> bool
//   Mods.effects(ids, room) -> { [stat]: fraction }   what the first `room` mods add together
//   Mods.LOWER                    stats where less is better (a shorter lock time)
// Effects are fractions of the gear's stat, added to research's (rules/loadout.js tuned).
// ES module (`Mods`); also runs in Node (the tests).

const Mods = (() => {
  const SLOTS = [0, 0, 1, 1, 2, 2];
  const LOWER = new Set(['lockTime']);
  // [id, name, slot, effects, note]
  const TABLE = [
    ['extended-barrel', 'Extended barrel', 'weapon', { range: 0.15, fireRate: -0.1 }, 'reaches further, fires slower'],
    ['overcharger', 'Overcharger', 'weapon', { damage: 0.15, range: -0.1 }, 'hits harder, at shorter range'],
    ['rapid-cycler', 'Rapid cycler', 'weapon', { fireRate: 0.15, damage: -0.08 }, 'fires faster, each shot lighter'],
    ['gimbal-mount', 'Gimbal mount', 'weapon', { arc: 0.5, range: -0.1 }, 'a wider field of fire, shorter reach'],
    ['hardened-emitter', 'Hardened emitter', 'shield', { strength: 0.15, recharge: -0.15 }, 'a stronger shield that recharges slower'],
    ['fast-cycler', 'Fast cycler', 'shield', { recharge: 0.25, strength: -0.1 }, 'recharges faster, holds less'],
    ['targeting-suite', 'Targeting suite', 'computer', { accuracy: 0.05, miningRate: -0.2 }, 'more accurate, mines slower'],
    ['ore-analyser', 'Ore analyser', 'computer', { miningRate: 0.3, accuracy: -0.03 }, 'mines faster, a little less accurate'],
    ['lock-accelerator', 'Lock accelerator', 'computer', { lockTime: -0.2, accuracy: -0.02 }, 'locks on faster'],
    ['afterburner', 'Afterburner', 'engine', { maxSpeed: 0.1, turnRate: -0.1 }, 'faster, turns wider'],
    ['vector-thrusters', 'Vector thrusters', 'engine', { turnRate: 0.15, maxSpeed: -0.05 }, 'turns tighter, a little slower'],
    ['evasion-routine', 'Evasion routine', 'engine', { evasion: 0.2, accel: -0.1 }, 'harder to hit, slower to speed up'],
    ['long-array', 'Long array', 'scanner', { sensorRange: 0.2, lockRange: -0.1 }, 'identifies further, locks shorter'],
    ['lock-array', 'Lock array', 'scanner', { lockRange: 0.2, pingRange: -0.15 }, 'locks further, pings shorter'],
  ];
  const MODS = {};
  for (const [key, name, slot, fx, note] of TABLE) MODS[`mod.${key}`] = { id: `mod.${key}`, name, slot, effects: fx, note };
  const LIST = Object.values(MODS);

  const fits = (id, slotType) => MODS[id]?.slot === slotType;
  function effects(ids = [], room = Infinity) {
    const out = {};
    for (const id of ids.slice(0, room)) for (const [k, f] of Object.entries(MODS[id]?.effects || {})) out[k] = (out[k] || 0) + f;
    return out;
  }

  return { SLOTS, LOWER, MODS, LIST, fits, effects };
})();

export { Mods };
