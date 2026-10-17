// Production: orders placed at stations that work through recipes (rules/recipes.js) on the
// real-world clock, while the game is closed too, like research. There's one storage for the whole
// game, reached from any station: an order takes its inputs from it and puts what it makes back in
// it, so a refinery order at a mining camp feeds a fabricator order at a minor station without
// anything carried between them. The chain of orders is the production pipeline.
// Each station type does one stage (STAGE): mining camps and salvage yards refine, minor stations
// and the waystation fabricate, capitals and major hubs (the shipyards) assemble. A station takes
// orders once it trusts the player (LOYALTY), one at a time (more with research); orders cost nothing.
// An order runs a recipe, for a count of runs or as long as inputs last. A run takes its inputs
// when it starts and sets room aside for what it makes, so finishing never fails. Orders start runs
// only when a run finishes, or when something changes (kick): so settling in one go or in many
// steps comes out the same, however long the game was closed. When orders want the same inputs,
// the first in the list (the priority the player sets) goes first. Industry research
// (rules/research.js bonusAt) adds speed and room from the moment it finished.
//
//   Industry.empty() -> state                { storage: { [kind (Recipes.item)]: n }, orders: [order], seq }
//   order: { id, station (key), name (the station's), type (its market type), recipe, left: n | null
//            (null: while inputs last), made, at, next, paused }
//     at / next: when the run under way started and finishes (ms), or null between runs
//   Industry.STAGE[station type] -> bay type (Recipes.BAYS), STATIONS[bay type] -> where that stage is done
//   Industry.STORAGE, SLOTS, LOYALTY { required, start }, MAX_EVENTS
//   Industry.env(lab) -> env                 times, room and slots, given the research done (rules/research.js)
//   Industry.canMake(station type, recipe id), slots(env), at(state, key) -> [order]
//   Industry.trusted(loyalty, key)           whether a station takes orders ({ [key]: n })
//   Industry.capacity(state, env, t), used(state), reserved(state), free(state, env, t)
//   Industry.runTime(order, env, t) -> ms    one run of its recipe
//   Industry.status(state, order) -> { id: 'running' | 'starved' | 'blocked' | 'done' | 'paused', missing? }
//   Industry.place(state, station { key, name, type }, recipe, count | null, env, now, loyalty?) -> order | null
//     (loyalty given: only at a station that trusts the player)
//   Industry.change(state, id, recipe, count, env, now), pause(state, id, paused, env, now),
//     cancel(state, id), move(state, i, j)   by order id, except move (positions in the list)
//   Industry.deposit(state, kind, n, env, now) -> n taken; withdraw(state, kind, n) -> n given
//   Industry.kick(state, env, now)           start every order that can start
//   Industry.settle(state, now, env, max?) -> { log: [{ id, key, name, recipe, at, out }], truncated }
//   Industry.summary(state, log) -> [text]   what was made, per station and good
//   Industry.recipeFor(kind, known?) -> recipe | null   what makes a kind (recycling only if nothing else does)
//   Industry.lineage(state, recipe id, known) -> [{ kind, need, have, raw, makers: [order], stage, source }]
//     where each input comes from; source: 'storage' | 'order' | 'raw' | 'stage' (an order of that stage needed)
//   Industry.pipelines(state) -> [{ end: [kind], orders, links: [{ from, to, kind }], gaps: [{ order, kind, stage }], standalone }]
//     orders linked by what they make (an output of one is an input of another), in groups; a gap
//     is an input that isn't raw and no order makes; standalone: an order linked to nothing
// Times are milliseconds since the epoch (core/clock.js). ES module (`Industry`); also runs in Node.

import { Goods } from './goods.js';
import { Recipes } from './recipes.js';
import { Research } from './research.js';

const Industry = (() => {
  const STAGE = { 'mining camp': 'refinery', 'salvage yard': 'refinery', minor: 'fabricator', waystation: 'fabricator', capital: 'assembler', major: 'assembler' };
  const STATIONS = { refinery: 'mining camps, salvage yards', fabricator: 'minor stations, the waystation', assembler: 'capitals, major hubs' };
  const STORAGE = { base: 200 };
  const SLOTS = 1; // orders per station, before research
  // A station takes orders from loyalty `required` up; every station starts at `start`, and
  // missions done for it raise it (game/jobs.js; the waystation's own: game/missions.js).
  const LOYALTY = { required: 1, start: 0 };
  const MAX_EVENTS = 20000; // runs settled per call; the rest wait for the next call

  const empty = () => ({ storage: {}, orders: [], seq: 1 });
  const add = (counts, kind, n) => { counts[kind] = (counts[kind] || 0) + n; if (counts[kind] <= 0) delete counts[kind]; };
  const total = (counts) => Object.values(counts).reduce((n, k) => n + k, 0);
  const find = (state, id) => state.orders.find((o) => o.id === id) || null;

  function env(lab) {
    return {
      recipe: (id) => Recipes.RECIPES[id],
      speed: (t) => 1 + Research.bonusAt(lab, t, 'speed'),
      room: (t) => Research.bonusAt(lab, t, 'storage'),
      slots: () => Research.bonusAt(lab, Infinity, 'bays'),
    };
  }

  const canMake = (type, recipe) => !!STAGE[type] && Recipes.RECIPES[recipe]?.bay === STAGE[type];
  const slots = (e) => SLOTS + e.slots();
  const at = (state, key) => state.orders.filter((o) => o.station === key);
  const trusted = (loyalty, key) => (loyalty?.[key] ?? LOYALTY.start) >= LOYALTY.required;

  const capacity = (state, e, t) => STORAGE.base + e.room(t);
  const used = (state) => total(state.storage);
  const reserved = (state) => state.orders.reduce((n, o) => n + (o.next != null ? total(Recipes.RECIPES[o.recipe].out) : 0), 0);
  const free = (state, e, t) => Math.max(0, capacity(state, e, t) - used(state) - reserved(state));

  const runTime = (o, e, t) => Math.round((e.recipe(o.recipe).time * 1000) / (e.speed(t) * Research.config.speed));

  const missing = (state, R) => Object.entries(R.in).find(([k, n]) => (state.storage[k] || 0) < n)?.[0] ?? null;
  // Whether a run would overfill storage (a run that makes no more than it takes always fits).
  const full = (state, R, e, t) => total(R.out) > total(R.in) && used(state) - total(R.in) + reserved(state) + total(R.out) > capacity(state, e, t);

  function status(state, o) {
    if (o.next != null) return { id: 'running' };
    if (o.left === 0) return { id: 'done' };
    if (o.paused) return { id: 'paused' };
    const R = Recipes.RECIPES[o.recipe], k = missing(state, R);
    return k ? { id: 'starved', missing: k } : { id: 'blocked' };
  }

  // Start a run of an order at time t, if its inputs are in storage and there's room for what it makes.
  function start(state, o, e, t) {
    if (o.paused || o.next != null || o.left === 0) return false;
    const R = e.recipe(o.recipe);
    if (!R || missing(state, R) || full(state, R, e, t)) return false;
    for (const [k, n] of Object.entries(R.in)) add(state.storage, k, -n);
    if (o.left !== null) o.left--;
    o.at = t;
    o.next = t + runTime(o, e, t);
    return true;
  }
  const kick = (state, e, t) => { for (const o of state.orders) start(state, o, e, t); };

  function settle(state, now, e, max = MAX_EVENTS) {
    const log = [];
    for (let n = 0; ; n++) {
      // The run that finishes first (the first in the list on a tie).
      let o = null;
      for (const x of state.orders) if (x.next != null && x.next <= now && (!o || x.next < o.next)) o = x;
      if (!o) break;
      if (n >= max) return { log, truncated: true };
      const t = o.next, R = e.recipe(o.recipe);
      for (const [k, c] of Object.entries(R.out)) add(state.storage, k, c);
      o.made++;
      o.at = o.next = null;
      log.push({ id: o.id, key: o.station, name: o.name, recipe: R.id, at: t, out: R.out });
      kick(state, e, t); // every order that can starts now: the next run, or one starved of what was just made
    }
    return { log, truncated: false };
  }

  const runs = (count) => (count === null ? null : Math.max(1, Math.floor(count)));
  function place(state, station, recipe, count, e, now, loyalty) {
    if (!canMake(station.type, recipe) || (loyalty && !trusted(loyalty, station.key)) || at(state, station.key).length >= slots(e)) return null;
    const o = { id: state.seq++, station: station.key, name: station.name, type: station.type, recipe, left: runs(count), made: 0, at: null, next: null, paused: false };
    state.orders.push(o);
    kick(state, e, now);
    return o;
  }
  // The run under way stops: its inputs go back to storage.
  function stop(state, o) {
    if (o.next == null) return;
    for (const [k, n] of Object.entries(Recipes.RECIPES[o.recipe].in)) add(state.storage, k, n);
    o.at = o.next = null;
    if (o.left !== null) o.left++;
  }
  function change(state, id, recipe, count, e, now) {
    const o = find(state, id);
    if (!o || !canMake(o.type, recipe)) return false;
    stop(state, o);
    Object.assign(o, { recipe, left: runs(count), made: 0, paused: false });
    kick(state, e, now);
    return true;
  }
  // Paused, an order starts no more runs; the one under way finishes.
  function pause(state, id, paused, e, now) {
    const o = find(state, id);
    if (!o) return false;
    o.paused = !!paused;
    kick(state, e, now);
    return true;
  }
  function cancel(state, id) {
    const o = find(state, id);
    if (!o) return false;
    stop(state, o);
    state.orders.splice(state.orders.indexOf(o), 1);
    return true;
  }
  function move(state, i, j) {
    if (i === j || !state.orders[i] || !state.orders[j]) return false;
    const [o] = state.orders.splice(i, 1);
    state.orders.splice(j, 0, o);
    return true;
  }
  function deposit(state, kind, n, e, now) {
    const k = Math.min(n, free(state, e, now));
    if (k <= 0) return 0;
    add(state.storage, kind, k);
    kick(state, e, now);
    return k;
  }
  function withdraw(state, kind, n) {
    const k = Math.min(n, state.storage[kind] || 0);
    if (k > 0) add(state.storage, kind, -k);
    return k;
  }

  function summary(state, log) {
    const made = new Map();
    for (const x of log) {
      for (const [kind, n] of Object.entries(x.out)) {
        const id = `${x.name}\u0000${kind}`;
        made.set(id, (made.get(id) || 0) + n);
      }
    }
    return [...made].map(([id, n]) => {
      const [name, kind] = id.split('\u0000');
      return `${name}: ${n} × ${Recipes.item(kind).name}`;
    });
  }

  // ---------- Lineage and pipelines ----------

  // Raw: mined, collected or salvaged, so no order is expected to make it.
  const isRaw = (kind) => Goods.isSalvage(kind) || Goods.type(kind)?.stage === 'raw';
  const makers = (state, kind) => state.orders.filter((o) => kind in Recipes.RECIPES[o.recipe].out);
  // The recipe that makes a kind: the first known one, recycling only when nothing else makes it.
  function recipeFor(kind, known) {
    const rs = Recipes.producers(kind).filter((r) => !known || known.has(r.id));
    return rs.find((r) => !r.id.startsWith('recycle.')) || rs[0] || null;
  }
  const stageFor = (kind, known) => recipeFor(kind, known)?.bay || null;

  function lineage(state, recipe, known) {
    return Object.entries(Recipes.RECIPES[recipe].in).map(([kind, need]) => {
      const have = state.storage[kind] || 0, by = makers(state, kind), raw = isRaw(kind);
      const source = have >= need ? 'storage' : by.length ? 'order' : raw ? 'raw' : 'stage';
      return { kind, need, have, raw, makers: by, stage: raw ? null : stageFor(kind, known), source };
    });
  }

  function pipelines(state) {
    const orders = state.orders, links = [];
    for (const a of orders) {
      for (const b of orders) {
        if (a === b) continue;
        for (const kind of Object.keys(Recipes.RECIPES[a.recipe].out)) if (kind in Recipes.RECIPES[b.recipe].in) links.push({ from: a.id, to: b.id, kind });
      }
    }
    // Groups: orders joined by links (union-find on ids).
    const root = new Map(orders.map((o) => [o.id, o.id]));
    const top = (id) => { while (root.get(id) !== id) id = root.get(id); return id; };
    for (const l of links) root.set(top(l.from), top(l.to));
    const groups = new Map();
    for (const o of orders) {
      const r = top(o.id);
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r).push(o);
    }
    return [...groups.values()].map((list) => {
      const ids = new Set(list.map((o) => o.id));
      const own = links.filter((l) => ids.has(l.from));
      const inputs = new Set(list.flatMap((o) => Object.keys(Recipes.RECIPES[o.recipe].in)));
      const end = [...new Set(list.flatMap((o) => Object.keys(Recipes.RECIPES[o.recipe].out)))].filter((k) => !inputs.has(k));
      const gaps = [];
      for (const o of list) {
        for (const kind of Object.keys(Recipes.RECIPES[o.recipe].in)) {
          if (!isRaw(kind) && !makers(state, kind).length) gaps.push({ order: o.id, kind, stage: stageFor(kind) });
        }
      }
      return { end, orders: list, links: own, gaps, standalone: list.length === 1 && !own.length };
    });
  }

  return {
    STAGE, STATIONS, STORAGE, SLOTS, LOYALTY, MAX_EVENTS, empty, recipeFor, env, canMake, slots, at, trusted, capacity, used, reserved, free,
    runTime, status, place, change, pause, cancel, move, deposit, withdraw, kick, settle, summary, isRaw, lineage, pipelines,
  };
})();

export { Industry };
