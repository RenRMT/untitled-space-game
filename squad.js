'use strict';

// The player's squad: AI-flown ships that fly in formation with the player (their leader) and
// fight beside them. Every squad member is an android ship (art/culture.js xeno().android) with
// an android designation for a name, and a row of logic slots holding AI logic modules
// (logic.js): its instructions, checked in slot order.
// - A member is plain data, saved with the cargo (game.js): { id, name, seed, hull (a ship class,
//   loadout.js), tier (its gear, Mk I–V), modules: [module id | null] (one per slot),
//   hullPoints, disabled }.
// - A member whose hull is shot down is disabled: it drops out of the fight and rejoins, repaired,
//   the next time the player docks.
//
//   Squad.SLOTS                             logic slots per member
//   Squad.member(seed, { modules, hull, tier }) -> a new member (the first joins at the end of the
//                                           first mission, missions.js)
//   Squad.stats(m) -> Loadout.stats()       what it flies with
//   Squad.formation(leader, i) -> { x, y }  its place behind the leader ({ x, y, angle })
//   Squad.install(m, id, slot), Squad.remove(m, slot), Squad.move(m, from, to)
//   Squad.modulesOf(m) -> [module ids]      the installed ones, in the order they're checked
//   Squad.read(saved) -> [members]          a save, checked (unknown modules are dropped)
// Works as a classic browser script (global `Squad`) and as a Node module.

const Squad = (() => {
  const isNode = typeof require === 'function' && typeof module !== 'undefined';
  const { mulberry32 } = isNode ? require('./rng.js') : globalThis;
  const L = isNode ? require('./logic.js') : Logic;
  const Load = isNode ? require('./loadout.js') : Loadout;

  const SLOTS = 4;
  // Android designations: a callsign and a two-digit unit number ("Cipher-07").
  const CALLSIGNS = ['Axiom', 'Cipher', 'Vector', 'Relay', 'Sigma', 'Index', 'Kernel', 'Lattice', 'Parse', 'Tensor', 'Quanta', 'Servo', 'Syntax', 'Vertex'];
  // Formation: members take places behind the leader, alternating left and right, a row per pair.
  const FORMATION = { back: 120, side: 95 };

  function designation(seed) {
    const r = mulberry32((seed ^ 0x5a17) >>> 0);
    return `${CALLSIGNS[Math.floor(r() * CALLSIGNS.length)]}-${String(1 + Math.floor(r() * 98)).padStart(2, '0')}`;
  }

  function member(seed, { modules = [], hull = 'fighter', tier = 1, id = `sq${seed >>> 0}` } = {}) {
    const slots = Array.from({ length: SLOTS }, (_, i) => (L.MODULES[modules[i]] ? modules[i] : null));
    const m = { id, name: designation(seed), seed: seed >>> 0, hull, tier, modules: slots, hullPoints: 0, disabled: false };
    m.hullPoints = stats(m).hull;
    return m;
  }

  const stats = (m) => Load.stats(Load.npc(m.hull, m.tier));
  const modulesOf = (m) => m.modules.filter(Boolean);

  function formation(leader, i) {
    const row = Math.floor(i / 2) + 1, side = i % 2 ? 1 : -1;
    const bx = -FORMATION.back * row, by = side * FORMATION.side * row;
    const c = Math.cos(leader.angle), s = Math.sin(leader.angle);
    return { x: leader.x + bx * c - by * s, y: leader.y + bx * s + by * c };
  }

  const inSlot = (slot) => Number.isInteger(slot) && slot >= 0 && slot < SLOTS;
  function install(m, id, slot) {
    if (!L.MODULES[id] || !inSlot(slot)) return false;
    m.modules[slot] = id;
    return true;
  }
  function remove(m, slot) {
    if (!inSlot(slot) || !m.modules[slot]) return null;
    const id = m.modules[slot];
    m.modules[slot] = null;
    return id;
  }
  function move(m, from, to) {
    if (!inSlot(from) || !inSlot(to)) return false;
    [m.modules[from], m.modules[to]] = [m.modules[to], m.modules[from]];
    return true;
  }

  function read(saved) {
    if (!Array.isArray(saved)) return null;
    return saved.filter((d) => d && Number.isFinite(d.seed) && Load.HULLS[d.hull]?.npc).map((d) => {
      const m = member(d.seed, { modules: Array.isArray(d.modules) ? d.modules : [], hull: d.hull, tier: Number.isInteger(d.tier) ? d.tier : 1, id: String(d.id) });
      if (Number.isFinite(d.hullPoints)) m.hullPoints = Math.max(0, Math.min(stats(m).hull, d.hullPoints));
      m.disabled = !!d.disabled;
      return m;
    });
  }

  return { SLOTS, member, stats, modulesOf, formation, install, remove, move, read, designation };
})();

if (typeof module !== 'undefined') module.exports = Squad;
