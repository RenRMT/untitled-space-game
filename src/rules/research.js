// Logic research: the packages that unlock building blocks for squad programs (rules/logic.js),
// shown as code libraries to import (`import combat.select`). Research costs credits, salvaged
// components and trade goods (rules/goods.js), all paid when a package is queued, and takes time:
// real time, which goes on while the game is closed. One package builds at a time; up to
// QUEUE_MAX more wait their turn, each starting the moment the one before it finishes (so a
// queue left overnight is worked through overnight).
// Packages only ever unlock decisions (subjects, conditions, keywords, actions, more lines); the
// abilities a `use` line runs come from elsewhere, so the packages for it are hidden until then.
//
//   Research.CATEGORIES               [{ id, label, note }] in display order
//   Research.PACKAGES[id]             { id, name, ver, cat, requires: [id], cost: { credits, [goods kind]: n },
//                                       time (s), lines?, hidden?, note, example? (a line) }
//   Research.LIST                     the packages that show, in display order
//   Research.config.speed             time runs this many times faster (?fastresearch)
//   Research.timeOf(id) -> s          how long it takes to build
//   Research.gives(id) -> [{ kind, id, label }]   the blocks it unlocks (Logic.blocks), and lines
//   Research.known(done) -> Set       the packages known, for Logic.check (core is always known)
//   Research.lineBonus(done) -> n     program lines added (rules/squad.js lineLimit)
//   Research.empty() -> lab           { done: [id], active: { id, start, end } | null, queue: [id] }
//   Research.status(id, lab, credits, have(kind) -> n)
//                -> { state: 'done' | 'active' | 'queued' | 'available' | 'locked', ok, needs: [id],
//                     credits, cost: [{ kind, need, have }] }
//   Research.enqueue(lab, id, now) -> bool     queued (or started); paying is the caller's job
//   Research.cancel(lab, id, now) -> [{ id, refund }]   what's cancelled (with whatever was queued
//                                    needing it): refund 1 for a queued package, 0.5 for the one building
//   Research.settle(lab, now) -> [ids]         what finished by now (in order), into done
//   Research.progress(lab, now) -> 0..1        of the one building
// Times are milliseconds since the epoch (Date.now(), core/clock.js); a clock set back never
// undoes progress or makes it negative. ES module (`Research`); also runs in Node (the tests).

import { Goods } from './goods.js';
import { Logic } from './logic.js';

const Research = (() => {
  const QUEUE_MAX = 3;
  const config = { speed: 1 };
  const M = 60, H = 3600;
  const c = (category, tier) => Goods.component(category, tier);

  const CATEGORIES = [
    { id: 'core', label: 'Core', note: 'the language itself: keywords and memory' },
    { id: 'combat', label: 'Combat', note: 'who to target and how to engage' },
    { id: 'tactics', label: 'Tactics', note: 'reading the fight' },
    { id: 'maint', label: 'Maintenance', note: 'keeping self and the squad flying' },
  ];

  const L = (o) => ({ ...Logic.blank(), ...o, when: (o.when || []).map((x) => Logic.clause(x)) });
  const PACKAGES = {
    'core.bool': {
      name: 'core.bool', ver: '1.0', cat: 'core', requires: [], time: 5 * M,
      cost: { credits: 300, [c('computer', 1)]: 2, electronics: 1 }, note: 'and, not: more than one condition on a line',
      example: L({ when: [{ prop: 'isLeaderTarget', not: true }] }),
    },
    'core.bool.or': {
      name: 'core.bool', ver: '1.1', cat: 'core', requires: ['core.bool'], time: 15 * M,
      cost: { credits: 500, [c('computer', 1)]: 3, 'copper-cable': 2 }, note: 'or: either condition will do',
    },
    'mem.ext.1': {
      name: 'mem.ext', ver: '1.0', cat: 'core', requires: [], time: 30 * M, lines: 1,
      cost: { credits: 800, [c('computer', 2)]: 2, electronics: 2 }, note: 'memory for a fourth program line',
    },
    'mem.ext.2': {
      name: 'mem.ext', ver: '2.0', cat: 'core', requires: ['mem.ext.1'], time: 3 * H, lines: 2,
      cost: { credits: 3000, [c('computer', 3)]: 3, robotics: 2 }, note: 'memory for six program lines',
    },
    'mem.ext.3': {
      name: 'mem.ext', ver: '3.0', cat: 'core', requires: ['mem.ext.2'], time: 8 * H, lines: 2,
      cost: { credits: 8000, [c('computer', 4)]: 2, [c('computer', 5)]: 1, 'ai-cores': 2 }, note: 'memory for eight program lines',
    },
    'combat.select': {
      name: 'combat.select', ver: '1.0', cat: 'combat', requires: [], time: 20 * M,
      cost: { credits: 400, [c('weapon', 1)]: 2, [c('computer', 1)]: 2 }, note: 'pick the nearest, weakest or strongest enemy',
      example: L({ pick: 'weakest' }),
    },
    'combat.range': {
      name: 'combat.range', ver: '1.0', cat: 'combat', requires: ['combat.select'], time: 45 * M,
      cost: { credits: 900, [c('weapon', 2)]: 2, 'optical-fibre': 2 }, note: 'how far things are, and fighting from as far as the guns reach',
      example: L({ act: 'keepRange', when: [{ prop: 'distance', rel: '<', value: 600 }] }),
    },
    'combat.threat': {
      name: 'combat.threat', ver: '1.0', cat: 'combat', requires: ['combat.select'], time: H,
      cost: { credits: 1200, [c('computer', 2)]: 3, superconductor: 1 }, note: 'whom an enemy is shooting at',
      example: L({ when: [{ prop: 'targeting', value: 'leader' }] }),
    },
    'combat.focus': {
      name: 'combat.focus', ver: '1.0', cat: 'combat', requires: ['combat.threat'], time: H,
      cost: { credits: 1000, [c('computer', 2)]: 2, 'optical-fibre': 2 }, note: 'what kind of ship an enemy is',
      example: L({ when: [{ prop: 'class', rel: '==', value: 'freighter' }] }),
    },
    'tactics.count': {
      name: 'tactics.count', ver: '1.0', cat: 'tactics', requires: ['core.bool'], time: 45 * M,
      cost: { credits: 900, [c('computer', 2)]: 2, electronics: 2 }, note: 'how many enemies and squad members are still flying',
      example: L({ subject: 'self', act: 'follow', when: [{ of: 'fight', prop: 'enemies', rel: '>=', value: 4 }] }),
    },
    'tactics.use': {
      name: 'tactics.use', ver: '1.0', cat: 'tactics', requires: ['tactics.count'], time: 1.5 * H, hidden: true,
      cost: { credits: 2000, [c('computer', 3)]: 3, 'ai-cores': 1 }, note: 'use(): run an ability the ship has, when it is ready',
    },
    'maint.sense': {
      name: 'maint.sense', ver: '1.0', cat: 'maint', requires: [], time: 10 * M,
      cost: { credits: 300, [c('hull', 1)]: 2, [c('computer', 1)]: 1 }, note: 'hull and shield left, in %',
      example: L({ pick: 'any', when: [{ prop: 'hull', rel: '<', value: 30 }] }),
    },
    'squad.link': {
      name: 'squad.link', ver: '1.0', cat: 'maint', requires: [], time: 20 * M,
      cost: { credits: 500, [c('computer', 1)]: 2, 'copper-cable': 2 }, note: 'the other squad members, as a subject',
    },
    'maint.retreat': {
      name: 'maint.retreat', ver: '1.0', cat: 'maint', requires: ['maint.sense'], time: 45 * M,
      cost: { credits: 500, [c('drive', 1)]: 2, hydrazine: 2 }, note: 'retreat(): fall back beside the leader and hold fire',
      example: L({ subject: 'self', act: 'retreat', when: [{ prop: 'hull', rel: '<', value: 30 }] }),
    },
    'maint.guard': {
      name: 'maint.guard', ver: '1.0', cat: 'maint', requires: ['squad.link'], time: H,
      cost: { credits: 1500, [c('hull', 2)]: 2, [c('drive', 2)]: 1, graphene: 1 }, note: 'guard(): stay close to a ship and fire on whoever shoots at it',
      example: L({ subject: 'leader', act: 'guard' }),
    },
  };
  for (const [id, p] of Object.entries(PACKAGES)) p.id = id;
  const LIST = CATEGORIES.flatMap((cat) => Object.values(PACKAGES).filter((p) => p.cat === cat.id && !p.hidden));

  const timeOf = (id) => (PACKAGES[id].time * 1000) / config.speed;
  const gives = (id) => [
    ...Logic.blocks(id),
    ...(PACKAGES[id].lines ? [{ kind: 'lines', id: 'lines', label: `+${PACKAGES[id].lines} line${PACKAGES[id].lines === 1 ? '' : 's'}` }] : []),
  ];
  const known = (done) => new Set(done);
  const lineBonus = (done) => done.reduce((n, id) => n + (PACKAGES[id]?.lines || 0), 0);
  const empty = () => ({ done: [], active: null, queue: [] });
  const pending = (lab) => [...(lab.active ? [lab.active.id] : []), ...lab.queue];

  function status(id, lab, credits, have) {
    const p = PACKAGES[id];
    const cost = Object.entries(p.cost).filter(([k]) => k !== 'credits').map(([kind, need]) => ({ kind, need, have: have(kind) }));
    const base = { needs: [], credits: p.cost.credits || 0, cost };
    if (lab.done.includes(id)) return { ...base, state: 'done', ok: false };
    if (lab.active?.id === id) return { ...base, state: 'active', ok: false };
    if (lab.queue.includes(id)) return { ...base, state: 'queued', ok: false };
    // A requirement still to build may be ahead of it in the queue.
    const needs = p.requires.filter((r) => !lab.done.includes(r) && !pending(lab).includes(r));
    const room = lab.queue.length < QUEUE_MAX || !lab.active;
    const ok = !needs.length && room && credits >= base.credits && cost.every((x) => x.have >= x.need);
    return { ...base, needs, state: needs.length ? 'locked' : 'available', ok, full: !room };
  }

  function enqueue(lab, id, now) {
    if (!PACKAGES[id] || lab.done.includes(id) || pending(lab).includes(id)) return false;
    if (!lab.active) lab.active = { id, start: now, end: now + timeOf(id) };
    else if (lab.queue.length < QUEUE_MAX) lab.queue.push(id);
    else return false;
    return true;
  }

  function settle(lab, now) {
    const finished = [];
    while (lab.active && lab.active.end <= now) {
      const { id, end } = lab.active;
      lab.done.push(id);
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
      if (PACKAGES[q].requires.every((r) => ahead.includes(r))) { j++; continue; }
      lab.queue.splice(j, 1);
      out.push({ id: q, refund: 1 });
    }
    // A requirement cancelled from under the one now building: it goes too.
    if (lab.active && !PACKAGES[lab.active.id].requires.every((r) => lab.done.includes(r))) {
      out.push(...cancel(lab, lab.active.id, now).map((x, k) => (k ? x : { ...x, refund: 1 })));
    }
    return out;
  }

  function progress(lab, now) {
    const a = lab.active;
    if (!a) return 0;
    return Math.max(0, Math.min(1, (now - a.start) / Math.max(1, a.end - a.start)));
  }

  return { QUEUE_MAX, config, CATEGORIES, PACKAGES, LIST, timeOf, gives, known, lineBonus, empty, status, enqueue, cancel, settle, progress };
})();

export { Research };
