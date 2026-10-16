// Research: the packages that unlock building blocks for squad programs (rules/logic.js),
// shown as code libraries to import (`import combat.select`). Research costs credits, salvaged
// components and trade goods (rules/goods.js), all paid when a package is queued, and takes time:
// real time, which goes on while the game is closed. One package builds at a time; up to
// QUEUE_MAX more wait their turn, each starting the moment the one before it finishes (so a
// queue left overnight is worked through overnight).
// Logic packages only ever unlock decisions (subjects, conditions, keywords, actions, more lines);
// the abilities a `use` line runs come from elsewhere, so the packages for it are hidden until then.
// The same lab also researches the ship: hull refits (rules/hullmods.js) for every hull you fly.
// Each package is of a kind: 'logic' (a code library, `name@ver`) or 'hull' (an upgrade).
//
//   Research.GROUPS                   [{ id, label }]: the Research tab's groups, in order
//   Research.CATEGORIES               [{ id, group, label, note }] in display order
//   Research.PACKAGES[id]             { id, kind, name, ver?, cat, requires: [id], cost: { credits, [goods kind]: n },
//                                       time (s), lines?, hidden?, note, example? (a line),
//                                       upgrade? { cargo?, hull?, weapons? }, refine? { line, stats: { [stat]: fraction } },
//                                       industry? { [bonus]: n } }
//   Research.LIST                     the packages that show, in display order
//   Research.config.speed             time runs this many times faster (?fastresearch)
//   Research.title(id)                its name as shown: `name@ver` for logic, the name otherwise
//   Research.timeOf(id) -> s          how long it takes to build
//   Research.gives(id) -> [{ kind, id, label }]   the blocks it unlocks (Logic.blocks), lines, upgrades
//   Research.known(done) -> Set       the packages known, for Logic.check (core is always known)
//   Research.lineBonus(done) -> n     program lines added (rules/squad.js lineLimit)
//   Research.upgrades(done)           -> { cargo, hull, weapons, lines: { [line]: { [stat]: fraction } } }:
//                                     what's done adds to every ship (rules/loadout.js stats)
//   Research.bonusAt(lab, t, key) -> n   an industry bonus from what was done by time t
//   Research.empty() -> lab           { done: [id], doneAt: { [id]: ms }, active: { id, start, end } | null, queue: [id] }
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
import { HullMods } from './hullmods.js';
import { Logic } from './logic.js';

const Research = (() => {
  const QUEUE_MAX = 3;
  const config = { speed: 1 };
  const M = 60, H = 3600;
  const c = (category, tier) => Goods.component(category, tier);

  const GROUPS = [
    { id: 'logic', label: 'Logic' },
    { id: 'hull', label: 'Hull' },
  ];
  const CATEGORIES = [
    { id: 'core', group: 'logic', label: 'Core', note: 'the language itself: keywords and memory' },
    { id: 'combat', group: 'logic', label: 'Combat', note: 'who to target and how to engage' },
    { id: 'tactics', group: 'logic', label: 'Tactics', note: 'reading the fight' },
    { id: 'maint', group: 'logic', label: 'Maintenance', note: 'keeping self and the squad flying' },
    { id: 'hull', group: 'hull', label: 'Hull refits', note: 'for every hull you fly' },
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
  for (const [id, p] of Object.entries(PACKAGES)) Object.assign(p, { id, kind: 'logic' });
  // Hull refits: each step of a line takes longer than the one before, the hardpoint longest.
  const HULL_TIME = [0, 20 * M, H, 3 * H];
  for (const n of HullMods.LIST) {
    const id = `hull.${n.id}`;
    PACKAGES[id] = {
      id, kind: 'hull', name: n.name, cat: 'hull', line: n.line, tier: n.tier, requires: n.requires.map((r) => `hull.${r}`),
      time: n.upgrade.weapons ? 4 * H : HULL_TIME[n.tier], cost: { credits: n.credits, ...n.cost }, upgrade: n.upgrade, note: n.note,
    };
  }
  const LIST = CATEGORIES.flatMap((cat) => Object.values(PACKAGES).filter((p) => p.cat === cat.id && !p.hidden));

  const title = (id) => (PACKAGES[id].kind === 'logic' ? `${PACKAGES[id].name}@${PACKAGES[id].ver}` : PACKAGES[id].name);
  const timeOf = (id) => (PACKAGES[id].time * 1000) / config.speed;
  const gives = (id) => {
    const p = PACKAGES[id];
    return [
      ...Logic.blocks(id),
      ...(p.lines ? [{ kind: 'lines', id: 'lines', label: `+${p.lines} line${p.lines === 1 ? '' : 's'}` }] : []),
      ...(p.upgrade || p.refine || p.industry ? [{ kind: 'upgrade', id: 'upgrade', label: p.note }] : []),
    ];
  };
  const known = (done) => new Set(done);
  const lineBonus = (done) => done.reduce((n, id) => n + (PACKAGES[id]?.lines || 0), 0);
  function upgrades(done) {
    const out = { cargo: 0, hull: 0, weapons: 0, lines: {} };
    for (const id of done) {
      const p = PACKAGES[id];
      if (p?.upgrade) for (const k of ['cargo', 'hull', 'weapons']) out[k] += p.upgrade[k] || 0;
      if (p?.refine) {
        const line = (out.lines[p.refine.line] ||= {});
        for (const [stat, f] of Object.entries(p.refine.stats)) line[stat] = (line[stat] || 0) + f;
      }
    }
    return out;
  }
  // Industry bonuses count from when their package finished, so work done offline gets them on time.
  const bonusAt = (lab, t, key) => lab.done.reduce((n, id) => n + ((lab.doneAt?.[id] ?? 0) <= t ? PACKAGES[id]?.industry?.[key] || 0 : 0), 0);
  const empty = () => ({ done: [], doneAt: {}, active: null, queue: [] });
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

  return { QUEUE_MAX, config, GROUPS, CATEGORIES, PACKAGES, LIST, title, timeOf, gives, known, lineBonus, upgrades, bonusAt, empty, status, enqueue, cancel, settle, progress };
})();

export { Research };
