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
// line), hull refits (rules/hullmods.js) for every hull you fly, and industry (faster orders, more
// of them, more room, alternative recipes, a longer lab queue).
// Each package is of a kind: 'logic' (a code library, `name@ver`), 'blueprint' (`bp.<gear id>`),
// 'refine' (`ref.<line>.<step>`), 'mods' (`mods.<slot type>`: the mods for that kind of gear,
// rules/mods.js), 'hull' or 'industry' (`ind.*`). A schematic recovered from pirates grants its blueprint outright (grant).
//
//   Research.GROUPS                   [{ id, label }]: the Research tab's groups, in order
//   Research.CATEGORIES               [{ id, group, label, note, station }] in display order; station: the
//                                     station type it's queued at (notes/hazards.md phase 6)
//   Research.stationOf(id) -> station type, stationName(type) -> 'the ore works'
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
//                                     'storage', 'bays', 'queue', 'routes', 'haulers')
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
import { Lab } from './lab.js';
import { Loadout } from './loadout.js';
import { Logic } from './logic.js';
import { Mods } from './mods.js';

const Research = (() => {
  const QUEUE_MAX = 3;
  const config = { speed: 1 };
  const M = 60, H = 3600;
  const c = (category) => Goods.component(category);

  const GROUPS = [
    { id: 'logic', label: 'Logic' },
    { id: 'weapons', label: 'Weapons' },
    { id: 'systems', label: 'Systems' },
    { id: 'utility', label: 'Utility' },
    { id: 'hull', label: 'Hull' },
    { id: 'industry', label: 'Production' },
  ];
  // Blueprints: a category per gear line (its name labels the row), weapons and utility gear apart
  // from the rest.
  const GEAR_LINES = Object.entries(Loadout.LINES).filter(([, L]) => !L.npc);
  const GROUP_OF_SLOT = { weapon: 'weapons', utility: 'utility' };
  const CATEGORIES = [
    { id: 'core', group: 'logic', label: 'Core', note: 'the language itself: keywords and memory' },
    { id: 'combat', group: 'logic', label: 'Combat', note: 'who to target and how to engage' },
    { id: 'tactics', group: 'logic', label: 'Tactics', note: 'reading the fight' },
    { id: 'maint', group: 'logic', label: 'Maintenance', note: 'keeping self and the squad flying' },
    ...GEAR_LINES.map(([line, spec]) => ({ id: `bp.${line}`, group: GROUP_OF_SLOT[spec.slot] || 'systems', label: spec.name, note: `blueprints for ${spec.name.toLowerCase()} gear` })),
    { id: 'mods.weapons', group: 'weapons', label: 'Mods', note: 'mods for weapons' },
    { id: 'mods.systems', group: 'systems', label: 'Mods', note: 'mods for shields, computers, engines and scanners' },
    { id: 'hull', group: 'hull', label: 'Hull refits', note: 'for every hull you fly' },
    { id: 'ind.speed', group: 'industry', label: 'Order speed', note: 'every production order runs faster' },
    { id: 'ind.room', group: 'industry', label: 'Slots and storage', note: 'more orders and more room in stock at every station' },
    { id: 'ind.recipes', group: 'industry', label: 'Recipes', note: 'other ways to make things' },
    { id: 'ind.lab', group: 'industry', label: 'Lab', note: 'the lab itself' },
    { id: 'log', group: 'industry', label: 'Logistics', note: 'routes and haulers, at the transport hub' },
  ];
  // Where each category is queued (notes/hazards.md phase 6): the station type whose process it
  // belongs to. The lab is one queue, so every hour of it is still one budget; only placing a
  // package in it needs the right station.
  const STATION_OF = {
    core: 'waystation', combat: 'waystation', tactics: 'waystation', maint: 'waystation',
    'bp.pulse-laser': 'mining camp', 'bp.heavy-cannon': 'mining camp',
    'bp.beam-turret': 'minor', 'bp.radiator': 'minor', 'bp.aux-tank': 'minor',
    'bp.survey-scanner': 'salvage yard',
    'bp.deflector': 'major', 'bp.rad-shielding': 'major', 'bp.flight-computer': 'major', 'mods.weapons': 'major', 'mods.systems': 'major',
    'bp.courier-drive': 'capital', 'bp.cargo-pod': 'capital', hull: 'capital',
    'ind.speed': 'waystation', 'ind.room': 'waystation', 'ind.recipes': 'major', 'ind.lab': 'waystation',
    log: 'transport hub',
  };
  for (const cat of CATEGORIES) cat.station = STATION_OF[cat.id] || 'waystation';
  const STATION_NAME = {
    waystation: 'the waystation', 'mining camp': 'the ore works', minor: 'the volatiles works', 'transport hub': 'the transport hub',
    'salvage yard': 'the salvage yard', major: 'the fabricator', capital: 'the shipyard',
  };

  const L = (o) => ({ ...Logic.blank(), ...o, when: (o.when || []).map((x) => Logic.clause(x)) });
  const PACKAGES = {
    'core.bool': {
      name: 'core.bool', ver: '1.0', cat: 'core', requires: [], time: 5 * M,
      cost: { credits: 300, [c('computer')]: 2, electronics: 1 }, note: 'and, not: more than one condition on a line',
      example: L({ when: [{ prop: 'isLeaderTarget', not: true }] }),
    },
    'core.bool.or': {
      name: 'core.bool', ver: '1.1', cat: 'core', requires: ['core.bool'], time: 15 * M,
      cost: { credits: 500, [c('computer')]: 3, 'steel-pipe': 2 }, note: 'or: either condition will do',
    },
    'mem.ext.1': {
      name: 'mem.ext', ver: '1.0', cat: 'core', requires: [], time: 30 * M, lines: 1,
      cost: { credits: 800, [c('computer')]: 4, electronics: 2 }, note: 'memory for a fourth program line',
    },
    'mem.ext.2': {
      name: 'mem.ext', ver: '2.0', cat: 'core', requires: ['mem.ext.1'], time: 3 * H, lines: 2,
      cost: { credits: 3000, [c('computer')]: 9, electronics: 4 }, note: 'memory for six program lines',
    },
    'mem.ext.3': {
      name: 'mem.ext', ver: '3.0', cat: 'core', requires: ['mem.ext.2'], time: 8 * H, lines: 2,
      cost: { credits: 8000, [c('computer')]: 13, electronics: 6 }, note: 'memory for eight program lines',
    },
    'combat.select': {
      name: 'combat.select', ver: '1.0', cat: 'combat', requires: [], time: 20 * M,
      cost: { credits: 400, [c('weapon')]: 2, [c('computer')]: 2 }, note: 'pick the nearest, weakest or strongest enemy',
      example: L({ pick: 'weakest' }),
    },
    'combat.range': {
      name: 'combat.range', ver: '1.0', cat: 'combat', requires: ['combat.select'], time: 45 * M,
      cost: { credits: 900, [c('weapon')]: 4, 'steel-pipe': 2 }, note: 'how far things are, and fighting from as far as the guns reach',
      example: L({ act: 'keepRange', when: [{ prop: 'distance', rel: '<', value: 600 }] }),
    },
    'combat.threat': {
      name: 'combat.threat', ver: '1.0', cat: 'combat', requires: ['combat.select'], time: H,
      cost: { credits: 1200, [c('computer')]: 6, 'steel-pipe': 2 }, note: 'whom an enemy is shooting at',
      example: L({ when: [{ prop: 'targeting', value: 'leader' }] }),
    },
    'combat.focus': {
      name: 'combat.focus', ver: '1.0', cat: 'combat', requires: ['combat.threat'], time: H,
      cost: { credits: 1000, [c('computer')]: 4, 'steel-pipe': 2 }, note: 'what kind of ship an enemy is',
      example: L({ when: [{ prop: 'class', rel: '==', value: 'freighter' }] }),
    },
    'tactics.count': {
      name: 'tactics.count', ver: '1.0', cat: 'tactics', requires: ['core.bool'], time: 45 * M,
      cost: { credits: 900, [c('computer')]: 4, electronics: 2 }, note: 'how many enemies and squad members are still flying',
      example: L({ subject: 'self', act: 'follow', when: [{ of: 'fight', prop: 'enemies', rel: '>=', value: 4 }] }),
    },
    'tactics.use': {
      name: 'tactics.use', ver: '1.0', cat: 'tactics', requires: ['tactics.count'], time: 1.5 * H,
      cost: { credits: 2000, [c('computer')]: 9, electronics: 2 }, note: 'use(): spend a charge of an ability (repair, shield, EMP, jammer) when it will help',
    },
    'maint.sense': {
      name: 'maint.sense', ver: '1.0', cat: 'maint', requires: [], time: 10 * M,
      cost: { credits: 300, [c('hull')]: 2, [c('computer')]: 1 }, note: 'hull and shield left, in %',
      example: L({ pick: 'any', when: [{ prop: 'hull', rel: '<', value: 30 }] }),
    },
    'squad.link': {
      name: 'squad.link', ver: '1.0', cat: 'maint', requires: [], time: 20 * M,
      cost: { credits: 500, [c('computer')]: 2, 'steel-pipe': 2 }, note: 'the other squad members, as a subject',
    },
    'maint.retreat': {
      name: 'maint.retreat', ver: '1.0', cat: 'maint', requires: ['maint.sense'], time: 45 * M,
      cost: { credits: 500, [c('drive')]: 2, hydrazine: 2 }, note: 'retreat(): fall back beside the leader and hold fire',
      example: L({ subject: 'self', act: 'retreat', when: [{ prop: 'hull', rel: '<', value: 30 }] }),
    },
    'maint.guard': {
      name: 'maint.guard', ver: '1.0', cat: 'maint', requires: ['squad.link'], time: H,
      cost: { credits: 1500, [c('hull')]: 4, [c('drive')]: 2, 'carbon-fibre': 2 }, note: 'guard(): stay close to a ship and fire on whoever shoots at it',
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
  // gear's kind of salvage, more for each Mk (BP_SALVAGE_COUNT), and, from Mk III, electronics.
  const BP_TIME = [0, 0, 15 * M, H, 4 * H, 12 * H];
  const BP_CREDITS = [0, 0, 500, 1500, 4000, 10000];
  const BP_SALVAGE_COUNT = [0, 0, 4, 6, 8, 13];
  const BP_PART = 'electronics';
  const BP_SALVAGE = { weapon: 'weapon', shield: 'hull', computer: 'computer', engine: 'drive', scanner: 'computer', utility: 'hull' };
  for (const [line, spec] of GEAR_LINES) {
    for (let t = Math.max(2, spec.from || 1); t <= 5; t++) {
      const gear = `${line}-${t}`, id = `bp.${gear}`, prev = `bp.${line}-${t - 1}`, cat = BP_SALVAGE[spec.slot];
      const cost = { credits: BP_CREDITS[t], [c(cat)]: BP_SALVAGE_COUNT[t] };
      if (t >= 3) cost[BP_PART] = t - 2;
      PACKAGES[id] = {
        id, kind: 'blueprint', name: Loadout.EQUIPMENT[gear].name, cat: `bp.${line}`, line, tier: t, col: t - Math.max(2, spec.from || 1), gear,
        requires: Loadout.EQUIPMENT[`${line}-${t - 1}`] && t > 2 ? [prev] : [], time: BP_TIME[t], cost,
        note: `Assemble the ${Loadout.EQUIPMENT[gear].name} with a production order at a shipyard`,
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
    radiator: { cool: 0.04 }, 'rad-shielding': { radGuard: 0.04 }, 'aux-tank': { fuel: 0.04 }, 'cargo-pod': { cargo: 0.04 },
  };
  const STAT_NAMES = { damage: 'damage', strength: 'shield strength', recharge: 'recharge', accuracy: 'accuracy', maxSpeed: 'top speed', accel: 'acceleration', sensorRange: 'identify range', pingRange: 'ping range', cool: 'heat shed', radGuard: 'radiation stopped', fuel: 'fuel', cargo: 'hold' };
  const REF_TIME = [0, 30 * M, 2 * H, 6 * H], REF_CREDITS = [0, 800, 2500, 6000];
  for (const [line, spec] of GEAR_LINES) {
    const first = Math.max(2, spec.from || 1), cat = BP_SALVAGE[spec.slot];
    for (let n = 1; n <= 3; n++) {
      const id = `ref.${line}.${n}`, bpTier = first + n - 1;
      const stats = REFINE[line], words = Object.keys(stats).map((k) => STAT_NAMES[k]).join(' and ');
      PACKAGES[id] = {
        id, kind: 'refine', name: `${spec.name} tuning ${Loadout.MK[n].replace('Mk ', '')}`, cat: `bp.${line}`, line, step: n, col: n,
        requires: [...(n > 1 ? [`ref.${line}.${n - 1}`] : []), `bp.${line}-${bpTier}`], time: REF_TIME[n],
        cost: { credits: REF_CREDITS[n], [c(cat)]: 2 * (n + 1), [BP_PART]: n },
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
      cost: { credits: 1200, [c(BP_SALVAGE[slot])]: 4, [BP_PART]: 1 }, mods: list.map((m) => m.id),
      note: `${list.map((m) => m.name).join(', ')}: mods for ${slot === 'weapon' ? 'weapons' : `${slot}s`}, fitted to gear from Mk II up`,
    };
  }
  // Industry: [id, name, short (on its node), cat, requires, time, credits, { cost }, { bonus }, note].
  const INDUSTRY = [
    ['ind.speed.1', 'Order speed I', 'Speed I', 'ind.speed', [], H, 1500, { electronics: 2, [c('computer')]: 4 }, { speed: 0.15 }, '+15% speed on every order'],
    ['ind.speed.2', 'Order speed II', 'Speed II', 'ind.speed', ['ind.speed.1'], 3 * H, 4000, { electronics: 2, [c('computer')]: 6 }, { speed: 0.15 }, '+15% speed on every order'],
    ['ind.speed.3', 'Order speed III', 'Speed III', 'ind.speed', ['ind.speed.2'], 8 * H, 9000, { electronics: 4, [c('computer')]: 8 }, { speed: 0.15 }, '+15% speed on every order'],
    ['ind.storage.1', 'Storage racks I', 'Racks I', 'ind.room', [], 30 * M, 1000, { 'steel-pipe': 5, [c('hull')]: 3 }, { storage: 100 }, '+100 room in every station\'s stock'],
    ['ind.storage.2', 'Storage racks II', 'Racks II', 'ind.room', ['ind.storage.1'], 2 * H, 3000, { 'carbon-fibre': 4, [c('hull')]: 6 }, { storage: 100 }, '+100 room in every station\'s stock'],
    ['ind.bays.1', 'Order slots I', 'Slots +1', 'ind.room', ['ind.storage.1'], 2 * H, 3000, { 'carbon-fibre': 4, [c('hull')]: 4 }, { bays: 1 }, 'one more order at every station'],
    ['ind.bays.2', 'Order slots II', 'Slots +2', 'ind.room', ['ind.bays.1'], 6 * H, 8000, { 'carbon-fibre': 8, [c('hull')]: 6 }, { bays: 1 }, 'one more order at every station'],
    ['ind.alt.electronics', 'Silicate electronics', 'Silicate', 'ind.recipes', [], H, 1200, { electronics: 1, [c('computer')]: 4 }, {}, 'electronics from silicates and steel pipe, without carbon fibre'],
    ['ind.lab.1', 'Lab queue', 'Queue +1', 'ind.lab', [], 4 * H, 5000, { electronics: 2, [c('computer')]: 9 }, { queue: 1 }, 'one more package can wait in the lab queue'],
    ['log.routes.1', 'Route planning I', 'Routes +1', 'log', [], H, 1500, { 'steel-pipe': 6, hydrazine: 4, [c('drive')]: 2 }, { routes: 1 }, 'one more route from the transport hub'],
    ['log.haulers.1', 'Second hauler', 'Haulers +1', 'log', ['log.routes.1'], 3 * H, 4000, { 'steel-pipe': 10, hydrazine: 6, [c('drive')]: 4 }, { haulers: 1 }, 'one more hauler on each new route'],
    ['log.routes.2', 'Route planning II', 'Routes +2', 'log', ['log.routes.1'], 4 * H, 6000, { electronics: 2, hydrazine: 6, [c('drive')]: 6 }, { routes: 1 }, 'one more route from the transport hub'],
  ];
  for (const [id, name, short, cat, requires, time, credits, cost, industry, note] of INDUSTRY) {
    PACKAGES[id] = { id, kind: 'industry', name, short, cat, requires, time, cost: { credits, ...cost }, industry, note };
  }
  const LIST = CATEGORIES.flatMap((cat) => Object.values(PACKAGES).filter((p) => p.cat === cat.id && !p.hidden));
  const blueprintFor = (gear) => (PACKAGES[`bp.${gear}`] ? `bp.${gear}` : null);
  // The station type a package is queued at, and its name ('the ore works').
  const stationOf = (id) => CATEGORIES.find((k) => k.id === PACKAGES[id].cat).station;
  const stationName = (type) => STATION_NAME[type] || type;

  const title = (id) => (PACKAGES[id].kind === 'logic' ? `${PACKAGES[id].name}@${PACKAGES[id].ver}` : PACKAGES[id].name);
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
  const queueMax = (lab) => QUEUE_MAX + bonusAt(lab, Infinity, 'queue');
  // The queue itself (rules/lab.js), over these packages.
  const lab = Lab.create({ packages: PACKAGES, categories: CATEGORIES, queueMax, config });
  const { timeOf, empty, status, enqueue, settle, cancel, grant, progress } = lab;

  // A group as a tree: a package's column is one past its furthest requirement in the group.
  const MAX_COLS = 4;
  const layout = (group) => lab.layout(LIST.filter((p) => CATEGORIES.find((k) => k.id === p.cat).group === group));

  return {
    QUEUE_MAX, MAX_COLS, config, queueMax, GROUPS, CATEGORIES, PACKAGES, LIST, title, timeOf, gives, known, lineBonus, upgrades, bonusAt, blueprintFor, stationOf, stationName,
    empty, status, enqueue, cancel, grant, settle, progress, layout,
  };
})();

export { Research };
