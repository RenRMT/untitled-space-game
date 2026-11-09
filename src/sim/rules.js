// Redshift's rules (notes/sim.md): a run's state and everything that changes it, cycle by cycle.
// Plain data in, plain data out, so the page (main.js), the tests (tests/sim.js) and the scripted
// player (tools/sim-play.js) share them.
//
// Two clocks run in a system: `cycle`, the cycles elapsed (what the horizon fills by), and `time`,
// the system's own time, which the hole dilates (what production, building and the map's orbits
// run on). Past half the meter, time runs slower than the cycles; at 100% it stops, and the system
// is lost.
//
// meta is what outlives a run (save.js): the Archive's levels (`archive`), Insight, the story's
// furthest chapter. The rules read the Archive's upgrades from it and add Insight to it at a jump.
//
//   SimRules.newRun(mode, meta, seed?) -> state    mode: 'story' | 'endless'; the first system entered
//   SimRules.world(state) -> system                the current system (SimWorld.generate, cached)
//   SimRules.tick(state, meta, cycles) -> events   run the clock on (fractions allowed); events: [{ kind, ... }]
//   SimRules.dilation(state) -> 0..1               how fast the system's time runs now
//   SimRules.rates(state, meta) -> { m, v, cr, sci, sec, demand, by: { [body key]: { out, in, mul, notes } } }
//                                                  per cycle of the system's own time, before dilation
//   SimRules.cost(state, meta, what, arg) -> { m?, v?, cr?, sci? }   what: 'station' (type) | 'upgrade' (key) |
//                                                  'ship' (key) | 'slot' (key) | 'gate'
//   SimRules.canBuild(state, meta, key, type) -> { ok, why, cost, preview }   preview: what it would make there
//   SimRules.build / upgrade / addShip / addSlot / demolish(state, meta, key[, type]) -> bool
//   SimRules.gateStatus(state, meta) -> { stage, of, building, f, cost, ok, why, done, charge }
//   SimRules.buildGate(state, meta) -> bool
//   SimRules.choices(state, meta) -> [destination]   where the gate leads (the jump's choices), with their preview
//                                                  (story: the next chapter's cultures and hazards; none from the last)
//   SimRules.isFinal(state) -> bool                  the story's last system: the jump wins
//   SimRules.jump(state, meta, i) -> summary | null  { from, insight, parts: [[label, n]], boons }
//   SimRules.retry(state, meta)                      a lost system again, from its arrival (story)
//   SimRules.endRun(state, meta) -> { escaped, insight }   a lost endless run: what it keeps
//   SimRules.archive(meta, id) -> level, SimRules.buyArchive(meta, id) -> bool, SimRules.archiveOpen(meta) -> bool
//   SimRules.has(state, culture) -> bool             whether a culture is in this system
// ES module (`SimRules`); also runs in Node (the tests).

import { SimConfig } from './config.js';
import { SimStory } from './story.js';
import { SimWorld } from './world.js';

const SimRules = (() => {
  const C = SimConfig;
  const VERSION = 1;
  const RES = ['m', 'v', 'cr', 'sci'];
  const ALL = ['android', 'wedge', 'block', 'shard', 'drifters', 'alien'];

  // ---------- The world ----------
  let cached = null;
  function world(state) {
    const t = state.terms;
    const key = JSON.stringify(t);
    if (!cached || cached.key !== key) cached = { key, w: SimWorld.generate(t.seed, t) };
    return cached.w;
  }
  const bodyOf = (w, key) => w.bodies.find((b) => b.key === key);
  const has = (state, c) => state.terms.cultures.includes(c);

  // ---------- The Archive (meta) ----------
  const archive = (meta, id) => (meta && meta.archive && meta.archive[id]) || 0;
  // Whether the Archive is open: once the story has reached the Shard (who bring it), or after an
  // endless run's first jump.
  const archiveOpen = (meta) => (meta?.story || 0) >= 3 || !!meta?.endless;
  function buyArchive(meta, id) {
    const A = C.ARCHIVE[id], lv = archive(meta, id);
    if (!A || lv >= A.lv || meta.insight < A.cost[lv]) return false;
    meta.insight -= A.cost[lv];
    meta.archive[id] = lv + 1;
    return true;
  }

  // ---------- A run ----------
  function newRun(mode, meta, seed = 1 + Math.floor(Math.random() * 1e9), terms = null) {
    const state = {
      version: VERSION, mode, seed, depth: 0, escaped: 0, speed: 1, status: 'play',
      terms: null, cycle: 0, time: 0, pull: 0, res: {}, made: {}, stations: {}, gate: null, approval: {},
      unrest: 0, log: [], past: [], boon: null, insightSys: 0, choices: null, arrival: null, rates: null,
      requests: [], offers: [], effects: {}, next: {}, seq: 1,
    };
    if (mode === 'endless' && meta) meta.endless = true;
    enter(state, meta, terms || (mode === 'story' ? SimStory.terms(0, seed) : { seed, depth: 0, distance: 'mid', rich: null, hazard: null, cultures: ALL }));
    return state;
  }

  // Arrive in a system: everything built is left behind; the Archive and any boon set the kit.
  function enter(state, meta, terms, boon = null) {
    const lifeMul = (terms.lifeMul || 1) * (1 + archive(meta, 'damper') * C.ARCHIVE.damper.life);
    state.terms = { ...terms, lifeMul };
    const w = world(state);
    state.cycle = 0; state.time = 0; state.pull = Math.max(0, w.pull0 - (terms.pullCut || 0)); state.status = 'play';
    state.res = { ...C.START };
    const kit = archive(meta, 'kit');
    for (const k of RES) state.res[k] += (C.ARCHIVE.kit.start[k] || 0) * kit;
    if (boon?.start) for (const [k, n] of Object.entries(boon.start)) state.res[k] += n;
    state.made = { m: 0, v: 0, cr: 0, sci: 0 };
    state.stations = {};
    state.gate = { stage: 0, left: 0, total: 0, charge: 0 };
    state.approval = {};
    for (const c of C.SETTLED) if (has(state, c)) state.approval[c] = Math.min(100, C.APPROVAL.start + archive(meta, 'accord') * C.ARCHIVE.accord.approval);
    state.unrest = 0; state.boon = boon; state.insightSys = 0; state.choices = null;
    state.requests = []; state.offers = []; state.effects = {}; state.used = {};
    state.next = { request: C.REQUESTS.first, alien: C.ALIENS.first, hazard: C.HAZARDS[terms.hazard]?.every || 0 };
    state.log = [];
    state.arrival = { terms: state.terms, boon };
    if (state.mode === 'story' && meta) meta.story = Math.max(meta.story || 0, state.depth);
    state.rates = rates(state, meta);
  }

  const dilation = (state) => C.dilation(state.pull);

  // ---------- Costs ----------
  const scale = (c, k) => Object.fromEntries(Object.entries(c).map(([r, n]) => [r, Math.ceil(n * k)]));
  const hazardOf = (state) => (state.terms.hazard ? C.HAZARDS[state.terms.hazard] : null);
  function cost(state, meta, what, arg) {
    const hz = hazardOf(state), mul = hz?.costMul || 1;
    switch (what) {
      case 'station': return scale(C.STATIONS[arg].cost, mul);
      case 'upgrade': { const st = state.stations[arg]; return st && st.level < 3 ? scale(C.UPGRADE_COST[st.level], mul) : null; }
      case 'ship': { const st = state.stations[arg]; return st ? scale(C.STATIONS[st.type].ship.cost, mul * (archive(meta, 'hangar') ? C.ARCHIVE.hangar.shipMul ** archive(meta, 'hangar') : 1)) : null; }
      case 'slot': return scale(C.SLOT_COST, mul);
      case 'gate': {
        const stage = C.GATE[state.gate.stage];
        if (!stage) return null;
        return scale(stage.cost, mul * (1 + C.GATE_DEPTH * state.depth * (state.terms.ease ?? 1)) * C.ARCHIVE.gate.gateMul ** archive(meta, 'gate'));
      }
      default: return null;
    }
  }
  const afford = (state, c) => !!c && Object.entries(c).every(([r, n]) => (state.res[r] || 0) >= n);
  const pay = (state, c) => { for (const [r, n] of Object.entries(c)) state.res[r] -= n; };
  const short = (state, c) => Object.entries(c || {}).filter(([r, n]) => (state.res[r] || 0) < n).map(([r]) => r);

  // ---------- Production ----------
  // What a station makes and uses per cycle of system time, and why: its level, its body's pips,
  // its trait, the hazard, its culture's mood, its ships and its neighbours.
  function stationRates(state, meta, w, key, st) {
    const S = C.STATIONS[st.type], b = bodyOf(w, key);
    const r = { out: {}, in: {}, sec: 0, mul: 1, notes: [] };
    if (st.alien && !st.left) { r.out = { sci: 0.5, v: 0.5 }; r.notes.push(['Alien hive', 1]); return r; }
    if (!S || st.left > 0 || st.wreck) return r;
    if (st.blocked > 0) { r.notes.push(['Blockaded', 0]); return r; }
    if (st.off > 0) { r.notes.push(['Knocked out', 0]); return r; }
    let mul = C.LEVEL_MUL[st.level - 1];
    if (state.effects.boost > 0) { mul *= 1.5; r.notes.push(['Alien gift', 1.5]); }
    const trait = b.trait ? C.TRAITS[b.trait] : null;
    if (trait?.mul?.[st.type]) { mul *= trait.mul[st.type]; r.notes.push([trait.name, trait.mul[st.type]]); }
    const hz = hazardOf(state);
    if (hz?.mul?.[st.type]) { mul *= hz.mul[st.type]; r.notes.push([hz.name, hz.mul[st.type]]); }
    if (hz?.inner && b.ring < hz.inner) { mul *= hz.innerMul; r.notes.push([hz.name, hz.innerMul]); }
    const ap = state.approval[S.culture];
    if (ap != null) {
      const am = ap <= 0 ? 0 : ap >= C.APPROVAL.high ? C.APPROVAL.highMul : ap <= C.APPROVAL.low ? C.APPROVAL.lowMul : 1;
      if (am !== 1) { mul *= am; r.notes.push([am === 0 ? 'On strike' : am > 1 ? `${C.CULTURES[S.culture].name} devoted` : `${C.CULTURES[S.culture].name} discontent`, am]); }
    }
    if ((st.type === 'mine' || st.type === 'siphon') && archive(meta, 'drills')) {
      const k = 1 + archive(meta, 'drills') * C.ARCHIVE.drills.extract;
      mul *= k; r.notes.push(['Deep drills', k]);
    }
    if (st.type === 'hub' && SimWorld.group(w, key).some((k2) => k2 !== key && ['mine', 'siphon'].includes(state.stations[k2]?.type) && !(state.stations[k2].left > 0))) {
      mul *= 1.5; r.notes.push(['Next to a rig', 1.5]);
    }
    const shipsOn = st.ships > 0 && !(state.effects.storm > 0);
    if (shipsOn && S.ship.bonus) { const k = 1 + S.ship.bonus * st.ships; mul *= k; r.notes.push([`${st.ships} ${S.ship.name.toLowerCase()}${st.ships > 1 ? 's' : ''}`, k]); }
    if (st.ships > 0 && state.effects.storm > 0) r.notes.push(['Ion storm: ships dark', 1]);
    r.mul = mul;
    for (const [res, n] of Object.entries(S.out)) r.out[res] = n * mul * (S.per ? b[S.per] : 1);
    const add = trait?.add?.[st.type];
    if (add) for (const [res, n] of Object.entries(add)) r.out[res] = (r.out[res] || 0) + n * C.LEVEL_MUL[st.level - 1];
    for (const [res, n] of Object.entries(S.in || {})) r.in[res] = n * C.LEVEL_MUL[st.level - 1];
    if (S.sec) {
      let sec = S.sec * C.LEVEL_MUL[st.level - 1] * (trait?.mul?.defense && st.type === 'defense' ? trait.mul.defense : 1);
      if (hz?.secMul) sec *= hz.secMul;
      if (shipsOn) sec += (S.ship.sec || 0) * st.ships;
      r.sec = sec;
    }
    return r;
  }

  function rates(state, meta) {
    const w = world(state);
    const tot = { m: C.ARK.m, v: C.ARK.v, cr: C.ARK.cr, sci: 0, sec: state.boon?.sec || 0, demand: 0, by: {} };
    const built = builtCount(state);
    for (const [key, st] of Object.entries(state.stations)) {
      const r = stationRates(state, meta, w, key, st);
      tot.by[key] = r;
      for (const [res, n] of Object.entries(r.out)) tot[res] += n;
      for (const [res, n] of Object.entries(r.in)) tot[res] -= n;
      tot.sec += r.sec;
      // A rogue station skims the system's minerals and volatiles; an outpost pays its way.
      if (st.rogue && !st.left) tot.skim = (tot.skim || 0) + C.DRIFTERS.skim;
      if (st.outpost) tot.cr += C.DRIFTERS.outpost.cr;
    }
    if (tot.skim) { tot.m *= 1 - Math.min(0.6, tot.skim); tot.v *= 1 - Math.min(0.6, tot.skim); }
    tot.demand = C.DEMAND[0] + C.DEMAND[1] * built;
    return tot;
  }
  const builtCount = (state) => Object.values(state.stations).filter((s) => !s.left && C.STATIONS[s.type]).length;

  // Production for dt cycles of system time: consumers take what's there, in proportion when short.
  function produce(state, meta, dt) {
    const w = world(state);
    for (const k of ['m', 'v', 'cr']) { const n = (C.ARK[k] || 0) * dt; state.res[k] += n; state.made[k] += n; }
    const skim = Object.values(state.stations).filter((s) => s.rogue && !s.left).length * C.DRIFTERS.skim;
    const keep = 1 - Math.min(0.6, skim);
    // Producers first, then consumers.
    const list = Object.entries(state.stations).map(([key, st]) => [key, st, stationRates(state, meta, w, key, st)]);
    for (const [, st, r] of list) {
      if (Object.keys(r.in).length) continue;
      for (const [res, n] of Object.entries(r.out)) { const x = n * dt * (res === 'm' || res === 'v' ? keep : 1); state.res[res] += x; state.made[res] += x; }
      if (st.outpost) state.res.cr += C.DRIFTERS.outpost.cr * dt;
    }
    for (const [, , r] of list) {
      if (!Object.keys(r.in).length) continue;
      let f = 1;
      for (const [res, n] of Object.entries(r.in)) f = Math.min(f, n > 0 ? state.res[res] / (n * dt) : 1);
      f = Math.max(0, Math.min(1, f));
      r.running = f;
      for (const [res, n] of Object.entries(r.in)) state.res[res] -= n * dt * f;
      for (const [res, n] of Object.entries(r.out)) { const x = n * dt * f; state.res[res] += x; state.made[res] += x; }
    }
  }

  // ---------- Building ----------
  function canBuild(state, meta, key, type) {
    const w = world(state), b = bodyOf(w, key), S = C.STATIONS[type];
    if (!b || !S) return { ok: false, why: 'Nothing to build on' };
    const c = cost(state, meta, 'station', type);
    const preview = previewAt(state, meta, key, type);
    if (b.kind === 'gate') return { ok: false, why: 'The gate goes here', cost: c, preview };
    if (state.stations[key]) return { ok: false, why: state.stations[key].rogue ? 'Drifters hold it' : 'Taken', cost: c, preview };
    if (!has(state, S.culture)) return { ok: false, why: `No ${C.CULTURES[S.culture].name} here`, cost: c, preview };
    if (S.per && !b[S.per]) return { ok: false, why: `No ${C.RES[S.per].name.toLowerCase()} here`, cost: c, preview };
    if (!afford(state, c)) return { ok: false, why: `Needs ${short(state, c).map((r) => C.RES[r].name.toLowerCase()).join(', ')}`, cost: c, preview, short: true };
    return { ok: true, cost: c, preview };
  }
  // What a new level-1 station of a type would make at a body: its rates as if built now.
  function previewAt(state, meta, key, type) {
    const w = world(state);
    const st = { type, level: 1, ships: 0, slots: 1, left: 0, culture: C.STATIONS[type].culture, seed: 1 };
    return stationRates({ ...state, stations: { ...state.stations, [key]: st } }, meta, w, key, st);
  }
  function build(state, meta, key, type) {
    const r = canBuild(state, meta, key, type);
    if (!r.ok || state.status !== 'play') return false;
    pay(state, r.cost);
    const S = C.STATIONS[type];
    const total = S.build * (archive(meta, 'prefab') ? C.ARCHIVE.prefab.buildMul : 1);
    state.stations[key] = { type, level: 1, ships: 0, slots: 1, left: total, total, culture: S.culture, seed: (state.seq++ * 7919 + state.terms.seed) % 99991 };
    state.rates = rates(state, meta);
    return true;
  }
  const ready = (st) => st && !(st.left > 0) && !st.rogue && !st.wreck && !st.alien;
  function upgrade(state, meta, key) {
    const st = state.stations[key], c = cost(state, meta, 'upgrade', key);
    if (!ready(st) || !c || !afford(state, c)) return false;
    pay(state, c);
    st.level++;
    state.rates = rates(state, meta);
    return true;
  }
  function addShip(state, meta, key) {
    const st = state.stations[key], c = cost(state, meta, 'ship', key);
    if (!ready(st) || st.ships >= st.slots || !afford(state, c)) return false;
    pay(state, c);
    st.ships++;
    state.rates = rates(state, meta);
    return true;
  }
  function addSlot(state, meta, key) {
    const st = state.stations[key], c = cost(state, meta, 'slot', key);
    if (!ready(st) || st.slots >= C.MAX_SLOTS || !afford(state, c)) return false;
    pay(state, c);
    st.slots++;
    return true;
  }
  function demolish(state, meta, key) {
    const st = state.stations[key];
    if (!st || st.rogue || st.alien) return false;
    if (C.STATIONS[st.type]) for (const [r, n] of Object.entries(C.STATIONS[st.type].cost)) state.res[r] += Math.floor(n * C.REFUND);
    delete state.stations[key];
    state.rates = rates(state, meta);
    return true;
  }

  // ---------- The gate ----------
  function gateStatus(state, meta) {
    const g = state.gate, of = C.GATE.length, done = g.stage >= of;
    const building = g.left > 0, c = done || building ? null : cost(state, meta, 'gate');
    const why = done ? '' : building ? 'Building' : afford(state, c) ? '' : `Needs ${short(state, c).map((r) => C.RES[r].name.toLowerCase()).join(', ')}`;
    return { stage: g.stage, of, building, f: building ? 1 - g.left / g.total : 0, cost: c, ok: !done && !building && afford(state, c), why, done, charge: g.charge, next: C.GATE[g.stage] || null };
  }
  function buildGate(state, meta) {
    const s = gateStatus(state, meta);
    if (!s.ok || state.status !== 'play') return false;
    pay(state, s.cost);
    const total = C.GATE[state.gate.stage].build;
    state.gate.left = total; state.gate.total = total;
    return true;
  }

  // ---------- The clock ----------
  function tick(state, meta, cycles) {
    const events = [];
    if (state.status !== 'play' || cycles <= 0) return events;
    const w = world(state);
    // In steps of at most one cycle, so a long frame lands the same as many short ones.
    let left = cycles;
    while (left > 1e-9 && state.status === 'play') {
      const dt = Math.min(1, left);
      left -= dt;
      const before = Math.floor(state.cycle);
      state.cycle += dt;
      state.pull = Math.min(100, state.pull + (100 / w.life) * dt);
      const d = dilation(state), local = dt * d;
      state.time += local;
      produce(state, meta, local);
      // Building runs on system time.
      for (const [key, st] of Object.entries(state.stations)) {
        if (st.left > 0) {
          st.left = Math.max(0, st.left - local);
          if (!st.left) events.push(...builtAt(state, meta, w, key, st));
        }
      }
      if (state.gate.left > 0) {
        state.gate.left = Math.max(0, state.gate.left - local);
        if (!state.gate.left) { state.gate.stage++; events.push({ kind: 'gate', stage: state.gate.stage, done: state.gate.stage >= C.GATE.length }); }
      } else if (state.gate.stage >= C.GATE.length) {
        // Overcharge: faster the nearer the horizon (not slowed by it: the gate draws on the hole).
        const k = 1 + archive(meta, 'coils') * C.ARCHIVE.coils.overcharge;
        state.gate.charge = Math.min(1, state.gate.charge + (C.OVERCHARGE.base + C.OVERCHARGE.k * (state.pull / 100) ** 2) * dt * k);
      }
      if (Math.floor(state.cycle) !== before) events.push(...cycleEnd(state, meta, w));
      if (state.pull >= 100) { state.status = 'lost'; state.speed = 0; events.push({ kind: 'lost' }); }
    }
    return events;
  }

  function builtAt(state, meta, w, key, st) {
    const b = bodyOf(w, key), ev = [{ kind: 'built', key, type: st.type }];
    const trait = b.trait ? C.TRAITS[b.trait] : null;
    // A derelict is salvaged and ruins give their Insight once, whatever is built there after.
    const first = !st.rogue && !state.used[key];
    if (first && (trait?.salvage || trait?.insight)) state.used[key] = true;
    if (first && trait?.salvage) { for (const [r, n] of Object.entries(trait.salvage)) state.res[r] += n; ev.push({ kind: 'salvage', key, got: trait.salvage }); }
    if (first && trait?.insight) { state.insightSys += trait.insight; ev.push({ kind: 'insight', key, n: trait.insight }); }
    if (trait?.approval && !st.rogue && C.STATIONS[st.type].culture === Object.keys(trait.approval)[0]) {
      for (const [c, n] of Object.entries(trait.approval)) if (state.approval[c] != null) state.approval[c] = Math.min(100, state.approval[c] + n);
    }
    state.rates = rates(state, meta);
    return ev;
  }

  // Once a whole cycle: the cultures' moods and the timed effects.
  function cycleEnd(state, meta) {
    const ev = [];
    state.rates = rates(state, meta);
    const r = state.rates, built = builtCount(state);
    for (const c of Object.keys(state.approval)) {
      const want = C.WANT[C.CULTURES[c].values];
      const need = want[0] + want[1] * Math.max(0, built - C.WANT_FREE), got = c === 'wedge' ? r.sec : Math.max(0, r[C.CULTURES[c].values]) * dilation(state);
      const before = state.approval[c];
      state.approval[c] = Math.max(0, Math.min(100, before + (got >= need ? C.APPROVAL.up : -C.APPROVAL.down)));
      if (before > C.APPROVAL.low && state.approval[c] <= C.APPROVAL.low) ev.push({ kind: 'mood', culture: c, low: true });
      if (before < C.APPROVAL.high && state.approval[c] >= C.APPROVAL.high) ev.push({ kind: 'mood', culture: c, high: true });
    }
    for (const [k, n] of Object.entries(state.effects)) if (n > 0) state.effects[k] = n - 1;
    for (const st of Object.values(state.stations)) {
      if (st.blocked > 0 && --st.blocked === 0) ev.push({ kind: 'unblocked' });
      if (st.off > 0) st.off--;
    }
    return ev;
  }

  // ---------- The jump ----------
  // Whether this is the story's last system: its gate leads out of the hole's reach.
  const isFinal = (state) => state.mode === 'story' && state.depth >= SimStory.LAST;
  function choices(state, meta) {
    if (isFinal(state)) return [];
    if (!state.choices) {
      const count = 3 + archive(meta, 'scanner');
      const ch = state.mode === 'story' ? SimStory.chapter(state.depth + 1) : null;
      state.choices = SimWorld.choices(state.terms.seed, state.depth, ch ? { count, cultures: ch.cultures, hazards: ch.hazards } : { count, cultures: state.terms.cultures })
        .map((t) => (ch ? { ...t, traits: ch.traits, ease: SimStory.EASE } : t));
    }
    const charge = state.gate.charge;
    return state.choices.map((t) => {
      const lifeMul = 1 + charge * C.HORIZON.overchargeLife;
      const w = SimWorld.generate(t.seed, { ...t, lifeMul: lifeMul * (1 + archive(meta, 'damper') * C.ARCHIVE.damper.life) });
      const pullCut = Math.round(charge * 10);
      return { terms: { ...t, lifeMul, pullCut }, name: w.name, star: w.star, sky: w.sky, life: w.life, pull0: Math.max(0, w.pull0 - pullCut), bodies: w.bodies.length - 1,
        minerals: w.bodies.reduce((s, b) => s + b.m, 0), volatiles: w.bodies.reduce((s, b) => s + b.v, 0), traits: w.bodies.filter((b) => b.trait).map((b) => b.trait) };
    });
  }
  // Insight this system has earned so far (what a jump now would give).
  function insightNow(state) {
    return Math.floor(state.made.sci / C.INSIGHT.sci) + Math.round(state.gate.charge * C.INSIGHT.charge) + state.insightSys;
  }
  function boonsNow(state) {
    return Object.entries(state.approval).filter(([, a]) => a >= C.APPROVAL.boon).map(([c]) => c);
  }
  function snapshot(state) {
    const w = world(state);
    return {
      name: w.name, terms: state.terms, depth: state.depth, cycle: Math.floor(state.cycle), time: state.time, pull: state.pull,
      stations: JSON.parse(JSON.stringify(state.stations)), gate: { ...state.gate }, made: { ...state.made }, approval: { ...state.approval },
    };
  }
  function jump(state, meta, i) {
    if (state.status !== 'play' || state.gate.stage < C.GATE.length) return null;
    const list = choices(state, meta), dest = list[i];
    if (!dest && !isFinal(state)) return null;
    const w = world(state);
    const parts = [['Science', Math.floor(state.made.sci / C.INSIGHT.sci)], ['Overcharge', Math.round(state.gate.charge * C.INSIGHT.charge)], ['Finds and requests', state.insightSys]];
    const boons = boonsNow(state);
    let boon = null;
    for (const c of boons) {
      const B = C.BOONS[c];
      if (B.insight) parts.push([B.name, B.insight]);
      boon = { ...(boon || {}), ...(B.sec ? { sec: (boon?.sec || 0) + B.sec } : {}), ...(B.start ? { start: { ...(boon?.start || {}), ...B.start } } : {}), names: [...(boon?.names || []), B.name] };
    }
    const insight = parts.reduce((s, [, n]) => s + n, 0);
    meta.insight = (meta.insight || 0) + insight;
    state.past.push(snapshot(state));
    if (state.past.length > 12) state.past.shift();
    state.depth++; state.escaped++;
    if (state.mode === 'endless') meta.best = Math.max(meta.best || 0, state.escaped);
    const from = w.name;
    if (!dest) {
      // The story's last jump: out of the hole's reach.
      state.status = 'won'; state.speed = 0;
      meta.story = SimStory.LAST + 1;
      return { from, to: null, won: true, insight, parts: parts.filter(([, n]) => n > 0), boons: [] };
    }
    enter(state, meta, { ...dest.terms, depth: state.depth }, boon);
    return { from, to: world(state).name, insight, parts: parts.filter(([, n]) => n > 0), boons: boons.map((c) => C.BOONS[c]) };
  }
  function retry(state, meta) {
    enter(state, meta, state.arrival.terms, state.arrival.boon);
  }
  function endRun(state, meta) {
    const keep = Math.floor(insightNow(state) * C.INSIGHT.lostKeep);
    meta.insight = (meta.insight || 0) + keep;
    if (state.mode === 'endless') meta.best = Math.max(meta.best || 0, state.escaped);
    return { escaped: state.escaped, insight: keep };
  }

  return {
    VERSION, RES, ALL, newRun, enter, world, tick, dilation, rates, cost, afford, short, canBuild, previewAt, build, upgrade, addShip, addSlot, demolish,
    gateStatus, buildGate, choices, isFinal, jump, retry, endRun, insightNow, boonsNow, archive, archiveOpen, buyArchive, has, builtCount, stationRates, snapshot, bodyOf,
  };
})();

export { SimRules };
