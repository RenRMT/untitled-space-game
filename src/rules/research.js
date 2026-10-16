'use strict';

// The research tree: what salvaged components (rules/goods.js) are for. Researching a node uses up
// components of its kind plus a few trade goods, and then:
// - an equipment node unlocks that piece of equipment (rules/loadout.js): from then on stations sell it,
// - a hull upgrade node improves every hull you fly: more cargo, more hull, an extra hardpoint.
// The Mk I of each equipment line is known from the start. Each Mk needs the one before it in its
// line; the heavy cannon branches off the pulse laser at Mk II, the beam turret at Mk III.
// Costs: equipment Mk n uses four components of tier n−1 of the line's kind (and two of the tier
// below, from Mk III), plus trade goods; Mk V needs an exotic component, found only in lawless
// space (world/security.js). Weapons use weapon components, shields and hull upgrades hull components,
// computers and scanners computer components, engines drive components.
//
//   Research.LINES                 [{ id, label, nodes: [node] }] in display order
//   Research.NODES[id]             { id, line, tier, name, requires: [id], cost: { [rules/goods.js kind]: n },
//                                    equipment?: equipment id, upgrade?: { cargo?, hull?, weapons? }, note }
//   Research.status(id, researched, have(kind) -> n)
//                                  -> { state: 'done' | 'available' | 'locked', ok, needs: [node id],
//                                       cost: [{ kind, need, have }] }
//   Research.upgrades(researched)  -> { cargo, hull, weapons }   (rules/loadout.js `upgrades`)
//   Research.known(researched)     -> Set of equipment ids the player may buy
// researched: a Set of node ids. Works as a classic browser script (global `Research`) and as a
// Node module.

const Research = (() => {
  const isNode = typeof require === 'function';
  const L = isNode ? require('./loadout.js') : Loadout;
  const G = isNode ? require('./goods.js') : Goods;
  const { MK, EQUIPMENT } = L;

  const comp = (category, tier) => G.component(category, tier);
  // Components for equipment Mk n of a kind.
  function components(category, n) {
    if (n === 2) return { [comp(category, 1)]: 4 };
    if (n === 5) return { [comp(category, 4)]: 4, [comp(category, 5)]: 1 };
    return { [comp(category, n - 1)]: 4, [comp(category, n - 2)]: 2 };
  }

  // Equipment lines in the tree: which components they use, and the trade goods per Mk (II–V).
  const EQUIPMENT_LINES = [
    { line: 'pulse-laser', group: 'weapons', category: 'weapon', goods: [['titanium', 2], ['superconductor', 2], ['platinum', 2], ['plasma-conduit', 3]] },
    { line: 'heavy-cannon', group: 'weapons', category: 'weapon', branch: 'pulse-laser', goods: [['titanium', 3], ['superconductor', 2], ['platinum', 3], ['plasma-conduit', 3]] },
    { line: 'beam-turret', group: 'weapons', category: 'weapon', branch: 'pulse-laser', goods: [null, ['optical-fibre', 4], ['plasma-conduit', 2], ['plasma-conduit', 4]] },
    { line: 'deflector', group: 'shields', category: 'hull', goods: [['copper-cable', 2], ['graphene', 2], ['metamaterial', 2], ['nanite-suspension', 3]] },
    { line: 'flight-computer', group: 'computers', category: 'computer', goods: [['electronics', 2], ['robotics', 2], ['ai-cores', 2], ['ai-cores', 4]] },
    { line: 'courier-drive', group: 'engines', category: 'drive', goods: [['hydrazine', 3], ['deuterium', 2], ['helium-3', 2], ['helium-3', 4]] },
    { line: 'survey-scanner', group: 'scanners', category: 'computer', goods: [['optical-fibre', 2], ['corundum', 2], ['diamond', 2], ['diamond', 4]] },
  ];

  // Hull upgrades: each step adds its share (cargo, hull) or a hardpoint, on every hull.
  const HULL_UPGRADES = [
    {
      id: 'cargo-racks', name: 'Cargo racks', upgrade: { cargo: 0.2 }, note: '+20% cargo hold',
      steps: [
        { hull: [[1, 5]], goods: [['steel-pipe', 3]] },
        { hull: [[2, 5], [1, 2]], goods: [['carbon-fibre', 2]] },
        { hull: [[3, 5], [2, 2]], goods: [['aerogel', 2]] },
      ],
    },
    {
      id: 'armour', name: 'Armour plating', upgrade: { hull: 0.15 }, note: '+15% hull',
      steps: [
        { hull: [[1, 5]], goods: [['iron', 4]] },
        { hull: [[2, 5], [1, 2]], goods: [['titanium', 3]] },
        { hull: [[3, 5], [2, 2]], goods: [['graphene', 2]] },
      ],
    },
  ];
  const GROUPS = [
    ['weapons', 'Weapons'], ['shields', 'Shields'], ['computers', 'Ship computers'], ['engines', 'Engines'], ['scanners', 'Scanners'], ['hull', 'Hull upgrades'],
  ];

  const NODES = {};
  const add = (node) => { NODES[node.id] = node; return node; };
  for (const E of EQUIPMENT_LINES) {
    for (let n = 2; n <= 5; n++) {
      const id = `${E.line}-${n}`;
      if (!EQUIPMENT[id]) continue; // a branch that starts later
      const prev = `${E.line}-${n - 1}`;
      // The first Mk of a branch needs the same Mk of the line it branches from.
      const requires = EQUIPMENT[prev] ? (EQUIPMENT[prev].tier === 1 ? [] : [prev]) : [`${E.branch}-${n}`];
      const [good, count] = E.goods[n - 2];
      add({
        id, line: E.line, group: E.group, tier: n, name: EQUIPMENT[id].name, requires, equipment: id,
        cost: { ...components(E.category, n), [good]: count }, note: L.summary(EQUIPMENT[id]),
      });
    }
  }
  for (const U of HULL_UPGRADES) {
    U.steps.forEach((step, i) => {
      const cost = {};
      for (const [tier, n] of step.hull) cost[comp('hull', tier)] = n;
      for (const [good, n] of step.goods) cost[good] = n;
      add({
        id: `${U.id}-${i + 1}`, line: U.id, group: 'hull', tier: i + 1, name: `${U.name} ${MK[i + 1]}`,
        requires: i ? [`${U.id}-${i}`] : [], upgrade: U.upgrade, cost, note: U.note,
      });
    });
  }
  add({
    id: 'hardpoint-retrofit', line: 'hardpoint-retrofit', group: 'hull', tier: 3, name: 'Hardpoint retrofit', requires: ['armour-2'],
    upgrade: { weapons: 1 }, cost: { [comp('weapon', 3)]: 3, [comp('hull', 3)]: 3, titanium: 4, superconductor: 2 },
    note: 'One more weapon slot on every hull (four at most)',
  });

  const LINES = GROUPS.map(([id, label]) => ({ id, label, nodes: Object.values(NODES).filter((n) => n.group === id) }));

  function status(id, researched, have) {
    const node = NODES[id];
    const cost = Object.entries(node.cost).map(([kind, need]) => ({ kind, need, have: have(kind) }));
    if (researched.has(id)) return { state: 'done', ok: false, needs: [], cost };
    const needs = node.requires.filter((r) => !researched.has(r));
    const ok = !needs.length && cost.every((c) => c.have >= c.need);
    return { state: needs.length ? 'locked' : 'available', ok, needs, cost };
  }

  function upgrades(researched) {
    const out = { cargo: 0, hull: 0, weapons: 0 };
    for (const id of researched) {
      const u = NODES[id]?.upgrade;
      if (!u) continue;
      for (const k of Object.keys(out)) out[k] += u[k] || 0;
    }
    return out;
  }

  function known(researched) {
    const out = new Set(L.STARTER_GEAR);
    for (const id of researched) if (NODES[id]?.equipment) out.add(NODES[id].equipment);
    return out;
  }

  return { LINES, NODES, status, upgrades, known };
})();

if (typeof module !== 'undefined') module.exports = Research;
