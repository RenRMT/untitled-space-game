// What the player can do with a thing in space (dock at a station, mine an asteroid, attack a
// pirate), as one registry. The flight view (game/) adds each action once; the
// context menu's buttons, the keyboard shortcuts and how close an approach stops all come from it,
// so a new action is one add() call.
//
//   const actions = Interactions.create({ gap(e), speed() })
//     gap(e): distance from the ship to e's edge; speed(): the ship's speed
//   actions.add({ id, kind, verb, key?, when?(e), range, maxSpeed?, allowed?(e), busy?(e), hold?, run(e) })
//     kind: the entity kind it applies to (or a list of kinds), when: and only to these (e.g. hostile ships)
//     hold: the action a long press on the thing does (dock at a station, mine an asteroid)
//     range, maxSpeed: numbers or functions; how close the ship must be (beyond e's radius) and
//       how slow it must go to start
//     allowed(e) -> { ok, reason }: whether it may be done here at all (e.g. docking refused)
//     busy(e) -> a state, or null: while the action is under way (mining's countdown)
//   actions.state(action | id, e) -> { ok, label, inRange, approach?, busy?, progress? }
//     label as the button shows it: 'Dock', 'Dock · too far', 'Dock · slow down', ...
//     approach: not yet, but it can be once the ship has come closer or slowed down
//   actions.held(e)                  the action a long press on e does, or null
//   actions.of(e)                    the actions that apply to e, in the order they were added
//   actions.get(id), actions.forKey(key), actions.forKeys(key) (all with that key, in order)
//   actions.target(action, selected, list)   what a shortcut acts on: the selected thing if the
//                                            action applies to it, else the nearest one in reach
// ES module (`Interactions`); also runs in Node (the tests).

const Interactions = (() => {
  const value = (v) => (typeof v === 'function' ? v() : v);

  function create(env) {
    const list = [];
    const byId = new Map();

    function add(a) {
      list.push(a);
      byId.set(a.id, a);
      return a;
    }
    const get = (id) => byId.get(id) || null;
    const applies = (a, e) => (Array.isArray(a.kind) ? a.kind.includes(e.kind) : a.kind === e.kind) && (!a.when || a.when(e));
    const of = (e) => list.filter((a) => applies(a, e));
    const forKey = (key) => list.find((a) => a.key && a.key === String(key).toLowerCase()) || null;
    const forKeys = (key) => list.filter((a) => a.key && a.key === String(key).toLowerCase());

    function state(action, e) {
      const a = typeof action === 'string' ? get(action) : action;
      const busy = a.busy && a.busy(e);
      if (busy) return busy;
      const allowed = a.allowed ? a.allowed(e) : null;
      if (allowed && !allowed.ok) return { ok: false, label: allowed.reason, inRange: true };
      // Too far or too fast: an approach (game/selection.js) brings the ship to where it can start.
      if (env.gap(e) > value(a.range)) return { ok: false, label: `${a.verb} · too far`, inRange: false, approach: true };
      if (a.maxSpeed !== undefined && env.speed() > value(a.maxSpeed)) return { ok: false, label: `${a.verb} · slow down`, inRange: true, approach: true };
      return { ok: true, label: a.verb, inRange: true };
    }

    function target(a, selected, things) {
      if (selected && applies(a, selected)) return selected;
      let best = null, bestGap = Infinity;
      for (const e of things) {
        if (!applies(a, e) || !state(a, e).inRange) continue;
        const d = env.gap(e);
        if (d < bestGap) { bestGap = d; best = e; }
      }
      return best;
    }

    const held = (e) => of(e).find((a) => a.hold) || null;

    return { add, get, of, forKey, forKeys, state, target, held, range: (a) => value(a.range) };
  }

  return { create };
})();

export { Interactions };
