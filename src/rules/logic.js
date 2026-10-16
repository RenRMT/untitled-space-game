// AI logic modules: the instructions squad members (rules/squad.js) follow, as items installed in their
// logic slots. Each module is one rule, "if <condition>, then <action>", and has a category named
// for what it is about (a combat logic module for fighting; movement, support and others can come
// later). A squad member checks its modules in slot order whenever it decides what to do and
// carries out the first one whose condition holds. If none holds, it keeps formation with its
// leader.
//
//   Logic.CATEGORIES[id] = { label }                     e.g. combat: 'Combat logic module'
//   Logic.CONDITIONS[id] = { label, test(ctx) -> subject | null }   the thing it found (a ship...)
//   Logic.ACTIONS[id] = { label, intent(ctx, subject) -> intent }
//   Logic.MODULES[id] = { id, category, name, if, then, price }
//   Logic.decide(moduleIds, ctx) -> { module, intent }   the first module that applies, or
//                                                        { module: null, intent: { type: 'follow' } }
//   Logic.label(id) -> 'Combat logic module · Assist leader';  Logic.rule(id) -> 'If …, then …'
// ctx: what a squad member knows when it decides: { self, leader, inFight, enemies: the enemies
//   still flying [{ id, x, y, hull, ... }], leaderTarget: the id of the enemy the leader is
//   fighting, or null }.
// Intents: { type: 'follow' } (keep formation), { type: 'attack', target: an enemy id }.
// A new rule is a new condition and/or action and a MODULES entry; nothing else changes.
// ES module (`Logic`); also runs in Node (the tests).

const Logic = (() => {
  const CATEGORIES = {
    combat: { label: 'Combat logic module' },
  };

  const CONDITIONS = {
    'leader-target': {
      label: 'the leader is fighting a target',
      test: (ctx) => (ctx.inFight && ctx.leaderTarget !== null && ctx.enemies.find((e) => e.id === ctx.leaderTarget)) || null,
    },
  };

  const ACTIONS = {
    attack: { label: 'attack it', intent: (ctx, t) => ({ type: 'attack', target: t.id }) },
  };

  const MODULES = {
    'assist-leader': { category: 'combat', name: 'Assist leader', if: 'leader-target', then: 'attack', price: 400 },
  };
  for (const [id, m] of Object.entries(MODULES)) m.id = id;

  const FOLLOW = { type: 'follow' };

  function decide(moduleIds, ctx) {
    for (const id of moduleIds) {
      const m = MODULES[id];
      if (!m) continue;
      const subject = CONDITIONS[m.if].test(ctx);
      if (subject) return { module: m, intent: ACTIONS[m.then].intent(ctx, subject) };
    }
    return { module: null, intent: FOLLOW };
  }

  const label = (id) => `${CATEGORIES[MODULES[id].category].label} · ${MODULES[id].name}`;
  const rule = (id) => `If ${CONDITIONS[MODULES[id].if].label}, then ${ACTIONS[MODULES[id].then].label}`;

  return { CATEGORIES, CONDITIONS, ACTIONS, MODULES, decide, label, rule };
})();

export { Logic };
