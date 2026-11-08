// Classes: the role a ship plays in a fight, for the player's ship and each squad member alike.
// A class shapes the ship's stats a little (on top of its gear, rules/loadout.js) and gives it three
// skills (rules/abilities.js SKILLS, each with an activation time and a cooldown):
// - Tank: more hull and shields, a little less firepower; enemies go for it (combat/combat-core.js
//   aim), and it can taunt them, fortify itself and restore its shields,
// - DPS: more firepower and accuracy, a little less hull; overload, salvo and mark,
// - Healer: sturdier shields, less firepower; it repairs and restores its side.
//
//   Classes.LIST, Classes.CLASSES[id]   { id, name, code, note, mods: { hull, shield, firepower, accuracy } }
//   Classes.DEFAULT                     the class a new game (and a save from before classes) has
//   Classes.valid(id) -> id             a known class, or DEFAULT
//   Classes.apply(stats, id) -> stats   Loadout.stats() with the class's mods (cls; classDamage: × its
//                                       guns' damage against ships, combat/combat-realtime.js)
//   Classes.skills(id) -> [ability id]  its three skills
//   Classes.program(id) -> [line]       a squad member's starting program for it (rules/logic.js)
// ES module (`Classes`); also runs in Node (the tests).

import { Abilities } from './abilities.js';

const Classes = (() => {
  const CLASSES = {
    tank: { name: 'Tank', code: 'TNK', note: 'Draws the enemy\'s fire and soaks it up', mods: { hull: 1.4, shield: 1.3, firepower: 0.8, accuracy: 0 } },
    dps: { name: 'DPS', code: 'DPS', note: 'Deals the damage', mods: { hull: 1, shield: 1, firepower: 1.3, accuracy: 0.05 } },
    healer: { name: 'Healer', code: 'HEL', note: 'Keeps its side flying: repairs and shields', mods: { hull: 1, shield: 1.2, firepower: 0.75, accuracy: 0 } },
  };
  for (const [id, c] of Object.entries(CLASSES)) c.id = id;
  const LIST = Object.values(CLASSES);
  const DEFAULT = 'dps';
  const valid = (id) => (CLASSES[id] ? id : DEFAULT);

  function apply(stats, id) {
    const m = CLASSES[valid(id)].mods;
    return {
      ...stats, cls: valid(id),
      hull: Math.round(stats.hull * m.hull), shield: Math.round(stats.shield * m.shield),
      // Its guns' damage against ships (not rocks: mining is the gear's alone), in classDamage.
      firepower: stats.firepower * m.firepower, accuracy: stats.accuracy + m.accuracy, classDamage: m.firepower,
    };
  }
  const skills = (id) => Abilities.skillsOf(valid(id));

  // Starting programs: lines that use the class's skills, then fight the leader's target.
  const clause = (o) => ({ join: null, not: false, of: null, rel: null, value: null, ...o });
  const line = (o) => ({ on: true, subject: 'enemy', pick: 'any', when: [], act: 'attack', skill: null, ...o });
  const leaderTarget = () => line({ when: [clause({ prop: 'isLeaderTarget' })] });
  const PROGRAMS = {
    tank: () => [
      line({ subject: 'self', act: 'use', skill: 'taunt' }), // a use line holds only while the skill's ready
      line({ subject: 'self', act: 'use', skill: 'fortify', when: [clause({ prop: 'hull', rel: '<', value: 70 })] }),
      leaderTarget(),
    ],
    dps: () => [
      line({ subject: 'self', act: 'use', skill: 'overload' }),
      line({ act: 'use', skill: 'salvo', when: [clause({ prop: 'isLeaderTarget' })] }),
      leaderTarget(),
    ],
    healer: () => [
      line({ subject: 'leader', act: 'use', skill: 'repair-beam', when: [clause({ prop: 'hull', rel: '<', value: 70 })] }),
      line({ subject: 'self', act: 'use', skill: 'repair-beam', when: [clause({ prop: 'hull', rel: '<', value: 70 })] }),
      leaderTarget(),
    ],
  };
  const program = (id) => PROGRAMS[valid(id)]();

  return { CLASSES, LIST, DEFAULT, valid, apply, skills, program };
})();

export { Classes };
