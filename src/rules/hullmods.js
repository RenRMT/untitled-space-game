// Hull refits: improvements fitted at a shipyard that apply to every hull you fly. Cargo racks
// and armour plating come in three steps each (each step needs the one before); the hardpoint
// retrofit adds a weapon slot and needs armour II. Each costs credits and salvaged hull
// components (rules/goods.js).
//
//   HullMods.NODES[id]            { id, line, tier, name, requires: [id], credits, cost: { [component kind]: n },
//                                   upgrade: { cargo?, hull?, weapons? }, note }
//   HullMods.LIST                 the nodes in display order
//   HullMods.status(id, owned, credits, have(kind) -> n)
//                                 -> { state: 'done' | 'available' | 'locked', ok, needs: [id], credits,
//                                      cost: [{ kind, need, have }] }
//   HullMods.upgrades(owned)      -> { cargo, hull, weapons }   (rules/loadout.js `upgrades`)
// owned: a Set of node ids. ES module (`HullMods`); also runs in Node (the tests).

import { Goods } from './goods.js';
import { Loadout } from './loadout.js';

const HullMods = (() => {
  const comp = (tier) => Goods.component('hull', tier);
  const LINES = [
    {
      id: 'cargo-racks', name: 'Cargo racks', upgrade: { cargo: 0.2 }, note: '+20% cargo hold',
      steps: [{ credits: 2500, hull: [[1, 5]] }, { credits: 6000, hull: [[2, 5], [1, 2]] }, { credits: 12000, hull: [[3, 5], [2, 2]] }],
    },
    {
      id: 'armour', name: 'Armour plating', upgrade: { hull: 0.15 }, note: '+15% hull',
      steps: [{ credits: 3000, hull: [[1, 5]] }, { credits: 7000, hull: [[2, 5], [1, 2]] }, { credits: 14000, hull: [[3, 5], [2, 2]] }],
    },
  ];

  const NODES = {};
  for (const L of LINES) {
    L.steps.forEach((step, i) => {
      const cost = {};
      for (const [tier, n] of step.hull) cost[comp(tier)] = n;
      const id = `${L.id}-${i + 1}`;
      NODES[id] = {
        id, line: L.id, tier: i + 1, name: `${L.name} ${Loadout.MK[i + 1]}`, requires: i ? [`${L.id}-${i}`] : [],
        credits: step.credits, cost, upgrade: L.upgrade, note: L.note,
      };
    });
  }
  NODES['hardpoint-retrofit'] = {
    id: 'hardpoint-retrofit', line: 'hardpoint-retrofit', tier: 3, name: 'Hardpoint retrofit', requires: ['armour-2'],
    credits: 20000, cost: { [Goods.component('weapon', 3)]: 3, [comp(3)]: 3 }, upgrade: { weapons: 1 },
    note: 'One more weapon slot on every hull (four at most)',
  };
  const LIST = Object.values(NODES);

  function status(id, owned, credits, have) {
    const node = NODES[id];
    const cost = Object.entries(node.cost).map(([kind, need]) => ({ kind, need, have: have(kind) }));
    if (owned.has(id)) return { state: 'done', ok: false, needs: [], credits: node.credits, cost };
    const needs = node.requires.filter((r) => !owned.has(r));
    const ok = !needs.length && credits >= node.credits && cost.every((c) => c.have >= c.need);
    return { state: needs.length ? 'locked' : 'available', ok, needs, credits: node.credits, cost };
  }

  function upgrades(owned) {
    const out = { cargo: 0, hull: 0, weapons: 0 };
    for (const id of owned) {
      const u = NODES[id]?.upgrade;
      if (!u) continue;
      for (const k of Object.keys(out)) out[k] += u[k] || 0;
    }
    return out;
  }

  return { NODES, LIST, status, upgrades };
})();

export { HullMods };
