// Research: the packages that unlock building blocks for squad programs (rules/logic.js),
// shown as code libraries to import (`import combat.select`). Research costs credits, salvaged
// components and trade goods (rules/goods.js), all paid when a package is queued, and takes time:
// real time, which goes on while the game is closed. One package builds at a time; up to
// QUEUE_MAX more (and more with industry research: queueMax) wait their turn, each starting the moment the one before it finishes (so a
// queue left overnight is worked through overnight).
// Logic packages only ever unlock decisions (subjects, conditions, keywords, actions, more lines);
// the abilities a `use` line runs are consumables industry makes (rules/abilities.js).
// The same lab also researches the ship: blueprints for gear from Mk II up (assembled at an
// assembler, rules/recipes.js), refinements (a few % more of one stat for every piece of a gear
// line), hull refits (rules/hullmods.js) for every hull you fly, and industry (faster bays, more
// of them, more room, alternative recipes, a longer lab queue).
// Each package is of a kind: 'logic' (a code library, `name@ver`), 'blueprint' (`bp.<gear id>`),
// 'refine' (`ref.<line>.<step>`), 'mods' (`mods.<slot type>`: the mods for that kind of gear,
// rules/mods.js), 'hull' or 'industry' (`ind.*`). A schematic recovered from pirates grants its blueprint outright (grant).
//
//   Research.GROUPS                   [{ id, label }]: the Research tab's groups, in order
//   Research.CATEGORIES               [{ id, group, label, note }] in display order
//   Research.PACKAGES[id]             { id, kind, name, ver?, cat, requires: [id], cost: { credits, [goods kind]: n },
//                                       time (s), lines?, hidden?, note, example? (a line),
//                                       upgrade? { cargo?, hull?, weapons? }, refine? { line, stats: { [stat]: fraction } },
//                                       industry? { [bonus]: n }, gear? (a blueprint's equipment id), col? (its column) }
//   Research.LIST                     the packages that show, in display order
//   Research.config.speed             time runs this many times faster (?fastresearch)
//   Research.title(id)                its name as shown: `name@ver` for logic, the name otherwise
//   Research.timeOf(id) -> s          how long it takes to build
//   Research.gives(id) -> [{ kind, id, label }]   the blocks it unlocks (Logic.blocks), lines, upgrades
//   Research.known(done) -> Set       the packages known, for Logic.check (core is always known)
//   Research.lineBonus(done) -> n     program lines added (rules/squad.js lineLimit)
//   Research.upgrades(done)           -> { cargo, hull, weapons, lines: { [line]: { [stat]: fraction } } }:
//                                     what's done adds to every ship (rules/loadout.js stats)
//   Research.bonusAt(lab, t, key) -> n   an industry bonus from what was done by time t ('speed',
//                                     'storage', 'bays', 'queue')
//   Research.queueMax(lab) -> n       how many packages can wait behind the one building
//   Research.blueprintFor(gear id) -> package id | null   (Mk I and NPC gear have none)
//   Research.grant(lab, id, now) -> [{ id, refund }]   done at once (a schematic): what was queued or
//                                building of it comes out, refunded in full; nothing if already done
//   Research.empty() -> lab           { done: [id], doneAt: { [id]: ms }, active: { id, start, end } | null, queue: [id] }
//   Research.status(id, lab, credits, have(kind) -> n)
//                -> { state: 'done' | 'active' | 'queued' | 'available' | 'locked', ok, needs: [id],
//                     credits, cost: [{ kind, need, have }] }
//   Research.enqueue(lab, id, now) -> bool     queued (or started); paying is the caller's job
//   Research.cancel(lab, id, now) -> [{ id, refund }]   what's cancelled (with whatever was queued
//                                    needing it): refund 1 for a queued package, 0.5 for the one building
//   Research.settle(lab, now) -> [ids]         what finished by now (in order), into done
//   Research.progress(lab, now) -> 0..1        of the one building
//   Research.layout(group) -> { cols, rows, nodes: [{ id, col, row }], edges: [[from, to]], lanes: [{ cat, row }] }
//                the group's packages as a tree, for the Research tab: a column per step of requirements
//                (at most MAX_COLS), a row per chain within a category; lanes: where each category starts
// Times are milliseconds since the epoch (Date.now(), core/clock.js); a clock set back never
// undoes progress or makes it negative. ES module (`Research`); also runs in Node (the tests).

import { Goods } from './goods.js';
import { HullMods } from './hullmods.js';
import { Loadout } from './loadout.js';
import { Logic } from './logic.js';
import { Mods } from './mods.js';

const Research = (() => {
  const QUEUE_MAX = 3;
  const config = { speed: 1 };
  const M = 60, H = 3600;
  const c = (category, tier) => Goods.component(category, tier);

  const GROUPS = [
    { id: 'logic', label: 'Logic' },
    { id: 'weapons', label: 'Weapons' },
    { id: 'systems', label: 'Systems' },
    { id: 'hull', label: 'Hull' },
    { id: 'industry', label: 'Industry' },
  ];
  // Blueprints: a category per gear line (its name labels the row), weapons apart from the rest.
  const GEAR_LINES = Object.entries(Loadout.LINES).filter(([, L]) => !L.npc);
  const CATEGORIES = [
    { id: 'core', group: 'logic', label: 'Core', note: 'the language itself: keywords and memory' },
    { id: 'combat', group: 'logic', label: 'Combat', note: 'who to target and how to engage' },
    { id: 'tactics', group: 'logic', label: 'Tactics', note: 'reading the fight' },
    { id: 'maint', group: 'logic', label: 'Maintenance', note: 'keeping self and the squad flying' },
    ...GEAR_LINES.map(([line, spec]) => ({ id: `bp.${line}`, group: spec.slot === 'weapon' ? 'weapons' : 'systems', label: spec.name, note: `blueprints for ${spec.name.toLowerCase()} gear` })),
    { id: 'mods.weapons', group: 'weapons', label: 'Mods', note: 'mods for weapons' },
    { id: 'mods.systems', group: 'systems', label: 'Mods', note: 'mods for shields, computers, engines and scanners' },
    { id: 'hull', group: 'hull', label: 'Hull refits', note: 'for every hull you fly' },
    { id: 'ind.speed', group: 'industry', label: 'Bay speed', note: 'every bay works faster' },
    { id: 'ind.room', group: 'industry', label: 'Bays and room', note: 'more bays per station, more room in each warehouse' },
    { id: 'ind.recipes', group: 'industry', label: 'Recipes', note: 'other ways to make things' },
    { id: 'ind.lab', group: 'industry', label: 'Lab', note: 'the lab itself' },
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
      name: 'tactics.use', ver: '1.0', cat: 'tactics', requires: ['tactics.count'], time: 1.5 * H,
      cost: { credits: 2000, [c('computer', 3)]: 3, electronics: 2 }, note: 'use(): spend a charge of an ability (repair, shield, EMP, jammer) when it will help',
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
  // Blueprints, Mk II to V of each line: each needs the Mk before it, takes components of the
  // gear's kind of salvage at its tier (Mk V an exotic one, so the best gear needs dangerous space)
  // and, from Mk III, parts made by industry.
  const BP_TIME = [0, 0, 15 * M, H, 4 * H, 12 * H];
  const BP_CREDITS = [0, 0, 500, 1500, 4000, 10000];
  const BP_PART = { weapon: 'capacitor', shield: 'power-cell', computer: 'electronics', engine: 'thruster-nozzle', scanner: 'electronics' };
  const BP_SALVAGE = { weapon: 'weapon', shield: 'hull', computer: 'computer', engine: 'drive', scanner: 'computer' };
  for (const [line, spec] of GEAR_LINES) {
    for (let t = Math.max(2, spec.from || 1); t <= 5; t++) {
      const gear = `${line}-${t}`, id = `bp.${gear}`, prev = `bp.${line}-${t - 1}`, cat = BP_SALVAGE[spec.slot];
      const cost = { credits: BP_CREDITS[t], [c(cat, Math.min(t, 4))]: 2 };
      if (t === 5) cost[c(cat, 5)] = 1;
      if (t >= 3) cost[BP_PART[spec.slot]] = t - 2;
      PACKAGES[id] = {
        id, kind: 'blueprint', name: Loadout.EQUIPMENT[gear].name, cat: `bp.${line}`, line, tier: t, col: t - Math.max(2, spec.from || 1), gear,
        requires: Loadout.EQUIPMENT[`${line}-${t - 1}`] && t > 2 ? [prev] : [], time: BP_TIME[t], cost,
        note: `Assemble the ${Loadout.EQUIPMENT[gear].name} at an assembler`,
      };
    }
  }
  // Refinements, three steps per gear line, each +4% of the line's stats: a step needs the one before
  // and a blueprint (Mk II for the first step, then III, then IV; a line starting later, later).
  // Drawn under the blueprints, each a column to the right of the one it needs.
  const REFINE = {
    'pulse-laser': { damage: 0.04 }, 'heavy-cannon': { damage: 0.04 }, 'beam-turret': { damage: 0.04 },
    deflector: { strength: 0.04, recharge: 0.04 }, 'flight-computer': { accuracy: 0.04 },
    'courier-drive': { maxSpeed: 0.04, accel: 0.04 }, 'survey-scanner': { sensorRange: 0.04, pingRange: 0.04 },
  };
  const STAT_NAMES = { damage: 'damage', strength: 'shield strength', recharge: 'recharge', accuracy: 'accuracy', maxSpeed: 'top speed', accel: 'acceleration', sensorRange: 'identify range', pingRange: 'ping range' };
  const REF_TIME = [0, 30 * M, 2 * H, 6 * H], REF_CREDITS = [0, 800, 2500, 6000];
  for (const [line, spec] of GEAR_LINES) {
    const first = Math.max(2, spec.from || 1), cat = BP_SALVAGE[spec.slot];
    for (let n = 1; n <= 3; n++) {
      const id = `ref.${line}.${n}`, bpTier = first + n - 1;
      const stats = REFINE[line], words = Object.keys(stats).map((k) => STAT_NAMES[k]).join(' and ');
      PACKAGES[id] = {
        id, kind: 'refine', name: `${spec.name} tuning ${Loadout.MK[n].replace('Mk ', '')}`, cat: `bp.${line}`, line, step: n, col: n,
        requires: [...(n > 1 ? [`ref.${line}.${n - 1}`] : []), `bp.${line}-${bpTier}`], time: REF_TIME[n],
        cost: { credits: REF_CREDITS[n], [c(cat, n + 1)]: 2, [BP_PART[spec.slot]]: n },
        refine: { line, stats }, note: `+4% ${words} for every ${spec.name.toLowerCase()}`,
      };
    }
  }
  // Mods, a package per kind of gear: what each kind's mods are made with is up to the assembler.
  const MOD_SHORT = { weapon: 'Weapon', shield: 'Shield', computer: 'Computer', engine: 'Engine', scanner: 'Scanner' };
  for (const slot of Object.keys(MOD_SHORT)) {
    const id = `mods.${slot}`, list = Mods.LIST.filter((m) => m.slot === slot);
    PACKAGES[id] = {
      id, kind: 'mods', name: `${MOD_SHORT[slot]} mods`, short: MOD_SHORT[slot], cat: slot === 'weapon' ? 'mods.weapons' : 'mods.systems', requires: [], time: H,
      cost: { credits: 1200, [c(BP_SALVAGE[slot], 2)]: 2, [BP_PART[slot]]: 1 }, mods: list.map((m) => m.id),
      note: `${list.map((m) => m.name).join(', ')}: mods for ${slot === 'weapon' ? 'weapons' : `${slot}s`}, fitted to gear from Mk II up`,
    };
  }
  // Industry: [id, name, short (on its node), cat, requires, time, credits, { cost }, { bonus }, note].
  const INDUSTRY = [
    ['ind.speed.1', 'Bay speed I', 'Speed I', 'ind.speed', [], H, 1500, { electronics: 2, [c('computer', 2)]: 2 }, { speed: 0.15 }, '+15% speed in every bay'],
    ['ind.speed.2', 'Bay speed II', 'Speed II', 'ind.speed', ['ind.speed.1'], 3 * H, 4000, { actuator: 2, [c('computer', 3)]: 2 }, { speed: 0.15 }, '+15% speed in every bay'],
    ['ind.speed.3', 'Bay speed III', 'Speed III', 'ind.speed', ['ind.speed.2'], 8 * H, 9000, { robotics: 2, [c('computer', 4)]: 2 }, { speed: 0.15 }, '+15% speed in every bay'],
    ['ind.storage.1', 'Warehouse racks I', 'Racks I', 'ind.room', [], 30 * M, 1000, { 'steel-pipe': 5, [c('hull', 1)]: 3 }, { storage: 100 }, '+100 room in every warehouse'],
    ['ind.storage.2', 'Warehouse racks II', 'Racks II', 'ind.room', ['ind.storage.1'], 2 * H, 3000, { 'hull-plating': 2, [c('hull', 2)]: 3 }, { storage: 100 }, '+100 room in every warehouse'],
    ['ind.bays.1', 'Extra bay I', 'Bays +1', 'ind.room', ['ind.storage.1'], 2 * H, 3000, { 'hull-plating': 2, [c('hull', 2)]: 2 }, { bays: 1 }, 'one more bay at every station'],
    ['ind.bays.2', 'Extra bay II', 'Bays +2', 'ind.room', ['ind.bays.1'], 6 * H, 8000, { 'hull-plating': 4, [c('hull', 3)]: 2 }, { bays: 1 }, 'one more bay at every station'],
    ['ind.alt.power-cell', 'Ice cells', 'Ice cells', 'ind.recipes', [], H, 1200, { 'power-cell': 1, [c('drive', 2)]: 2 }, {}, 'power cells straight from water ice, without hydrazine'],
    ['ind.alt.graphene', 'Carbon graphene', 'Graphene', 'ind.recipes', ['ind.alt.power-cell'], 2 * H, 2500, { graphene: 2, [c('hull', 2)]: 2 }, {}, 'graphene from carbon and ice, without corundum'],
    ['ind.lab.1', 'Lab queue', 'Queue +1', 'ind.lab', [], 4 * H, 5000, { robotics: 1, [c('computer', 3)]: 3 }, { queue: 1 }, 'one more package can wait in the lab queue'],
  ];
  for (const [id, name, short, cat, requires, time, credits, cost, industry, note] of INDUSTRY) {
    PACKAGES[id] = { id, kind: 'industry', name, short, cat, requires, time, cost: { credits, ...cost }, industry, note };
  }
  const LIST = CATEGORIES.flatMap((cat) => Object.values(PACKAGES).filter((p) => p.cat === cat.id && !p.hidden));
  const blueprintFor = (gear) => (PACKAGES[`bp.${gear}`] ? `bp.${gear}` : null);

  const title = (id) => (PACKAGES[id].kind === 'logic' ? `${PACKAGES[id].name}@${PACKAGES[id].ver}` : PACKAGES[id].name);
  const timeOf = (id) => (PACKAGES[id].time * 1000) / config.speed;
  const gives = (id) => {
    const p = PACKAGES[id];
    return [
      ...Logic.blocks(id),
      ...(p.lines ? [{ kind: 'lines', id: 'lines', label: `+${p.lines} line${p.lines === 1 ? '' : 's'}` }] : []),
      ...(p.upgrade || p.refine || p.industry ? [{ kind: 'upgrade', id: 'upgrade', label: p.note }] : []),
      ...(p.gear ? [{ kind: 'recipe', id: `make.${p.gear}`, label: `the ${p.name} recipe` }] : []),
      ...(p.mods || []).map((m) => ({ kind: 'mod', id: m, label: Mods.MODS[m].name })),
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
  const queueMax = (lab) => QUEUE_MAX + bonusAt(lab, Infinity, 'queue');
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
    const room = lab.queue.length < queueMax(lab) || !lab.active;
    const ok = !needs.length && room && credits >= base.credits && cost.every((x) => x.have >= x.need);
    return { ...base, needs, state: needs.length ? 'locked' : 'available', ok, full: !room };
  }

  function enqueue(lab, id, now) {
    if (!PACKAGES[id] || lab.done.includes(id) || pending(lab).includes(id)) return false;
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

  function grant(lab, id, now) {
    if (!PACKAGES[id] || lab.done.includes(id)) return [];
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

  // A group as a tree: a package's column is one past its furthest requirement in the group. Within
  // a category, a package follows its requirement along the same row when the cell is free, and
  // otherwise starts a row of its own.
  const MAX_COLS = 4;
  function layout(group) {
    const list = LIST.filter((p) => CATEGORIES.find((k) => k.id === p.cat).group === group);
    const ids = new Set(list.map((p) => p.id));
    const col = {};
    const colOf = (id) => (col[id] ??= PACKAGES[id].col ?? Math.max(-1, ...PACKAGES[id].requires.filter((r) => ids.has(r)).map(colOf)) + 1);
    const nodes = [], lanes = [], taken = new Set(), rowOf = {};
    let rows = 0;
    for (const cat of CATEGORIES.filter((k) => k.group === group)) {
      const inCat = list.filter((p) => p.cat === cat.id);
      if (!inCat.length) continue;
      lanes.push({ cat: cat.id, row: rows });
      for (const p of inCat) {
        const at = colOf(p.id);
        const after = p.requires.find((r) => ids.has(r) && PACKAGES[r].cat === cat.id && col[r] === at - 1 && !taken.has(`${rowOf[r]}:${at}`));
        const row = after ? rowOf[after] : rows++;
        rowOf[p.id] = row;
        taken.add(`${row}:${at}`);
        nodes.push({ id: p.id, col: at, row });
      }
    }
    const edges = list.flatMap((p) => p.requires.filter((r) => ids.has(r)).map((r) => [r, p.id]));
    return { cols: Math.max(0, ...nodes.map((n) => n.col + 1)), rows, nodes, edges, lanes };
  }

  return {
    QUEUE_MAX, MAX_COLS, config, queueMax, GROUPS, CATEGORIES, PACKAGES, LIST, title, timeOf, gives, known, lineBonus, upgrades, bonusAt, blueprintFor,
    empty, status, enqueue, cancel, grant, settle, progress, layout,
  };
})();

export { Research };
