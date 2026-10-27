// Lab: a research queue over a table of packages, shared by the game's research (rules/research.js)
// and the race's hangar (race/career.js). One package builds at a time, the rest wait their turn,
// each starting the moment the one before it finishes, on the real clock (so it goes on while the
// game is closed). Paying is the caller's job: the lab only says what can be queued and keeps time.
//
//   Lab.create({ packages, categories, queueMax(lab) -> n, config: { speed } }) -> lab rules:
//     packages[id]   { id, cat, requires: [id | [id, ...]], time (s), cost: { credits?, [kind]: n }, fork? }
//                    a requirement that is a list is met by any one of it; packages with the same fork
//                    rule each other out (one done or pending closes the rest)
//     categories     [{ id, group? }] in display order (layout)
//   rules.empty() -> lab              { done: [id], doneAt: { [id]: ms }, active: { id, start, end } | null, queue: [id] }
//   rules.timeOf(id) -> ms            its build time, at config.speed
//   rules.pending(lab) -> [id]        the one building, then the queue
//   rules.closed(lab, id) -> id | null   the fork sibling that rules it out
//   rules.status(id, lab, credits, have(kind) -> n)
//                -> { state: 'done' | 'active' | 'queued' | 'available' | 'locked' | 'closed', ok, needs, credits, cost, by? }
//   rules.enqueue(lab, id, now) -> bool, cancel(lab, id, now) -> [{ id, refund }], grant(lab, id, now),
//   rules.settle(lab, now) -> [ids], progress(lab, now) -> 0..1
//   rules.layout(list) -> { cols, rows, nodes: [{ id, col, row }], edges: [[from, to]], lanes: [{ cat, row }] }
//                a list of packages as a tree: a column per step of requirements (a package's col
//                overrides), a row per chain within a category
// Times are milliseconds since the epoch. ES module (`Lab`); also runs in Node (the tests).

const Lab = (() => {
  const flat = (requires) => requires.flat();

  function create({ packages, categories, queueMax, config = { speed: 1 } }) {
    const timeOf = (id) => (packages[id].time * 1000) / config.speed;
    const empty = () => ({ done: [], doneAt: {}, active: null, queue: [] });
    const pending = (lab) => [...(lab.active ? [lab.active.id] : []), ...lab.queue];
    const met = (r, ahead) => (Array.isArray(r) ? r.some((x) => ahead.includes(x)) : ahead.includes(r));
    function closed(lab, id) {
      const f = packages[id].fork;
      if (!f) return null;
      return [...lab.done, ...pending(lab)].find((x) => x !== id && packages[x]?.fork === f) || null;
    }

    function status(id, lab, credits, have) {
      const p = packages[id];
      const cost = Object.entries(p.cost).filter(([k]) => k !== 'credits').map(([kind, need]) => ({ kind, need, have: have(kind) }));
      const base = { needs: [], credits: p.cost.credits || 0, cost };
      if (lab.done.includes(id)) return { ...base, state: 'done', ok: false };
      if (lab.active?.id === id) return { ...base, state: 'active', ok: false };
      if (lab.queue.includes(id)) return { ...base, state: 'queued', ok: false };
      const by = closed(lab, id);
      if (by) return { ...base, state: 'closed', ok: false, by };
      // A requirement still to build may be ahead of it in the queue.
      const ahead = [...lab.done, ...pending(lab)];
      const needs = p.requires.filter((r) => !met(r, ahead));
      const room = lab.queue.length < queueMax(lab) || !lab.active;
      const ok = !needs.length && room && credits >= base.credits && cost.every((x) => x.have >= x.need);
      return { ...base, needs, state: needs.length ? 'locked' : 'available', ok, full: !room };
    }

    function enqueue(lab, id, now) {
      if (!packages[id] || lab.done.includes(id) || pending(lab).includes(id) || closed(lab, id)) return false;
      if (!lab.active) lab.active = { id, start: now, end: now + timeOf(id) };
      else if (lab.queue.length < queueMax(lab)) lab.queue.push(id);
      else return false;
      return true;
    }

    function settle(lab, now) {
      const finished = [];
      while (lab.active && lab.active.end <= now) {
        const { id, end } = lab.active;
        lab.done.push(id);
        (lab.doneAt ||= {})[id] = end;
        finished.push(id);
        const next = lab.queue.shift();
        lab.active = next ? { id: next, start: end, end: end + timeOf(next) } : null;
      }
      return finished;
    }

    function cancel(lab, id, now) {
      const out = [];
      const i = lab.queue.indexOf(id);
      if (i >= 0) {
        lab.queue.splice(i, 1);
        out.push({ id, refund: 1 });
      } else if (lab.active?.id === id) {
        const next = lab.queue.shift();
        lab.active = next ? { id: next, start: now, end: now + timeOf(next) } : null;
        out.push({ id, refund: 0.5 });
      } else return out;
      // Whatever was queued on top of it goes too.
      for (let j = 0; j < lab.queue.length;) {
        const q = lab.queue[j], ahead = [...lab.done, ...(lab.active ? [lab.active.id] : []), ...lab.queue.slice(0, j)];
        if (packages[q].requires.every((r) => met(r, ahead))) { j++; continue; }
        lab.queue.splice(j, 1);
        out.push({ id: q, refund: 1 });
      }
      // A requirement cancelled from under the one now building: it goes too.
      if (lab.active && !packages[lab.active.id].requires.every((r) => met(r, lab.done))) {
        out.push(...cancel(lab, lab.active.id, now).map((x, k) => (k ? x : { ...x, refund: 1 })));
      }
      return out;
    }

    function grant(lab, id, now) {
      if (!packages[id] || lab.done.includes(id)) return [];
      const out = [];
      const i = lab.queue.indexOf(id);
      if (i >= 0) { lab.queue.splice(i, 1); out.push({ id, refund: 1 }); }
      if (lab.active?.id === id) {
        const next = lab.queue.shift();
        lab.active = next ? { id: next, start: now, end: now + timeOf(next) } : null;
        out.push({ id, refund: 1 });
      }
      lab.done.push(id);
      (lab.doneAt ||= {})[id] = now;
      return out;
    }

    function progress(lab, now) {
      const a = lab.active;
      if (!a) return 0;
      return Math.max(0, Math.min(1, (now - a.start) / Math.max(1, a.end - a.start)));
    }

    // Within a category, a package follows its requirement along the same row when the cell is
    // free, and otherwise starts a row of its own.
    function layout(list) {
      const ids = new Set(list.map((p) => p.id));
      const col = {};
      const colOf = (id) => (col[id] ??= packages[id].col ?? Math.max(-1, ...flat(packages[id].requires).filter((r) => ids.has(r)).map(colOf)) + 1);
      const nodes = [], lanes = [], taken = new Set(), rowOf = {};
      let rows = 0;
      for (const cat of categories) {
        const inCat = list.filter((p) => p.cat === cat.id);
        if (!inCat.length) continue;
        lanes.push({ cat: cat.id, row: rows });
        for (const p of inCat) {
          const at = colOf(p.id);
          const after = flat(p.requires).find((r) => ids.has(r) && packages[r].cat === cat.id && col[r] === at - 1 && !taken.has(`${rowOf[r]}:${at}`));
          const row = after ? rowOf[after] : rows++;
          rowOf[p.id] = row;
          taken.add(`${row}:${at}`);
          nodes.push({ id: p.id, col: at, row });
        }
      }
      const edges = list.flatMap((p) => flat(p.requires).filter((r) => ids.has(r)).map((r) => [r, p.id]));
      return { cols: Math.max(0, ...nodes.map((n) => n.col + 1)), rows, nodes, edges, lanes };
    }

    return { config, timeOf, empty, pending, closed, status, enqueue, settle, cancel, grant, progress, layout };
  }

  return { create };
})();

export { Lab };
