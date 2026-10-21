// Hull refits: improvements researched (rules/research.js, the Hull group, as `hull.<id>`) that
// apply to every hull you fly. Cargo racks and armour plating come in three steps each (each step
// needs the one before); the hardpoint retrofit adds a weapon slot and needs armour II. Each costs
// credits and salvaged hull components (rules/goods.js). This is the data; research builds them.
//
//   HullMods.NODES[id]            { id, line, tier, name, requires: [id], credits, cost: { [component kind]: n },
//                                   upgrade: { cargo?, hull?, weapons? }, note }
//   HullMods.LIST                 the nodes in display order
// ES module (`HullMods`); also runs in Node (the tests).

import { Goods } from './goods.js';
import { Loadout } from './loadout.js';

const HullMods = (() => {
  const comp = Goods.component('hull');
  const LINES = [
    {
      id: 'cargo-racks', name: 'Cargo racks', upgrade: { cargo: 0.2 }, note: '+20% cargo hold',
      steps: [{ credits: 2500, hull: 5 }, { credits: 6000, hull: 12 }, { credits: 12000, hull: 19 }],
    },
    {
      id: 'armour', name: 'Armour plating', upgrade: { hull: 0.15 }, note: '+15% hull',
      steps: [{ credits: 3000, hull: 5 }, { credits: 7000, hull: 12 }, { credits: 14000, hull: 19 }],
    },
  ];

  const NODES = {};
  for (const L of LINES) {
    L.steps.forEach((step, i) => {
      const cost = { [comp]: step.hull };
      const id = `${L.id}-${i + 1}`;
      NODES[id] = {
        id, line: L.id, tier: i + 1, name: `${L.name} ${Loadout.MK[i + 1]}`, requires: i ? [`${L.id}-${i}`] : [],
        credits: step.credits, cost, upgrade: L.upgrade, note: L.note,
      };
    });
  }
  NODES['hardpoint-retrofit'] = {
    id: 'hardpoint-retrofit', line: 'hardpoint-retrofit', tier: 3, name: 'Hardpoint retrofit', requires: ['armour-2'],
    credits: 20000, cost: { [Goods.component('weapon')]: 9, [comp]: 9 }, upgrade: { weapons: 1 },
    note: 'One more weapon slot on every hull (four at most)',
  };
  const LIST = Object.values(NODES);

  return { NODES, LIST };
})();

export { HullMods };
