// Industry: bays leased at stations that work through recipes (rules/recipes.js) on the real-world
// clock, while the game is closed too, like research. Each station where you lease a bay has a
// warehouse of your own: bays take their inputs from it and put what they make back in it, so a
// refinery and a fabricator at the same station chain (cable refined overnight becomes electronics
// overnight). A lease is paid once; there's no upkeep.
// A bay runs a job: a recipe, for a count of runs or as long as inputs last. A run takes its inputs
// when it starts and sets room aside for what it makes, so finishing never fails. Bays start runs
// only when a run finishes, or when you change something (kick): so settling in one go or in many
// steps comes out the same, however long the game was closed. When bays want the same inputs, the
// first bay (the order you set) goes first. A bay of the kind the station suits works faster
// (SPECIALTY), and industry research (rules/research.js bonusAt) adds speed and room from the
// moment it finished.
//
//   Industry.empty() -> state                { sites: { [station key]: site } }
//   site: { name, type (the station's market type), storage: { [kind (Recipes.item)]: n }, bays: [bay] }
//   bay: { type (Recipes.BAYS), job: null | { recipe, left: n | null (null: while inputs last), made, at, next } }
//     at / next: when the run under way started and finishes (ms), or null between runs
//   Industry.LEASE[type], MAX_BAYS, STORAGE { base, perBay }, SPECIALTY[station type] -> bay type, FAST
//   Industry.env(lab) -> env                 times and room, given the research done (rules/research.js)
//   Industry.site(state, key, { name, type }) -> site   (made on first use)
//   Industry.capacity(site, env, t), used(site), reserved(site), free(site, env, t)
//   Industry.runTime(site, bay, env, t) -> ms   one run of its job's recipe
//   Industry.status(site, i) -> 'idle' | 'working' | 'waiting' | 'finished'
//   Industry.lease(site, type) -> bay        (paying is the caller's job)
//   Industry.setJob(site, i, recipe, count | null, env, now), clearJob(site, i), move(site, i, j)
//   Industry.deposit(site, kind, n, env, now) -> n taken; withdraw(site, kind, n) -> n given
//   Industry.kick(site, env, now)            start idle bays that can start
//   Industry.settle(state, now, env, max?) -> { log: [{ key, bay, recipe, at, out }], truncated }
//   Industry.summary(state, log) -> [text]   what was made, per station and good
// Times are milliseconds since the epoch (core/clock.js). ES module (`Industry`); also runs in Node.

import { Recipes } from './recipes.js';
import { Research } from './research.js';

const Industry = (() => {
  const LEASE = { refinery: 1500, fabricator: 3000, assembler: 5000 };
  const MAX_BAYS = 2;
  const STORAGE = { base: 40, perBay: 60 };
  const SPECIALTY = { 'mining camp': 'refinery', 'salvage yard': 'refinery', waystation: 'fabricator', major: 'fabricator', capital: 'assembler' };
  const FAST = 1.25; // how much faster a bay works at a station that suits it
  const MAX_EVENTS = 20000; // runs settled per call per site; the rest wait for the next call

  const empty = () => ({ sites: {} });
  const add = (counts, kind, n) => { counts[kind] = (counts[kind] || 0) + n; if (counts[kind] <= 0) delete counts[kind]; };
  const total = (counts) => Object.values(counts).reduce((n, k) => n + k, 0);

  function env(lab) {
    return {
      recipe: (id) => Recipes.RECIPES[id],
      speed: (t) => 1 + Research.bonusAt(lab, t, 'speed'),
      room: (t) => Research.bonusAt(lab, t, 'storage'),
      bays: () => Research.bonusAt(lab, Infinity, 'bays'),
    };
  }

  function site(state, key, { name, type }) {
    return (state.sites[key] ||= { name, type, storage: {}, bays: [] });
  }
  const capacity = (s, e, t) => STORAGE.base + STORAGE.perBay * s.bays.length + e.room(t);
  const used = (s) => total(s.storage);
  const reserved = (s) => s.bays.reduce((n, b) => n + (b.job?.next != null ? total(Recipes.RECIPES[b.job.recipe].out) : 0), 0);
  const free = (s, e, t) => Math.max(0, capacity(s, e, t) - used(s) - reserved(s));
  const maxBays = (e) => MAX_BAYS + e.bays();

  function runTime(s, b, e, t) {
    const R = e.recipe(b.job.recipe);
    const k = (SPECIALTY[s.type] === b.type ? FAST : 1) * e.speed(t) * Research.config.speed;
    return Math.round((R.time * 1000) / k);
  }

  function status(s, i) {
    const j = s.bays[i]?.job;
    if (!j) return 'idle';
    if (j.next != null) return 'working';
    return j.left === 0 ? 'finished' : 'waiting';
  }

  // Start a run of a bay's job at time t, if its inputs are in store and there's room for what it makes.
  function start(s, b, e, t) {
    const j = b.job;
    if (!j || j.next != null || j.left === 0) return false;
    const R = e.recipe(j.recipe);
    if (!R || Object.entries(R.in).some(([k, n]) => (s.storage[k] || 0) < n)) return false;
    if (used(s) - total(R.in) + reserved(s) + total(R.out) > capacity(s, e, t)) return false;
    for (const [k, n] of Object.entries(R.in)) add(s.storage, k, -n);
    if (j.left !== null) j.left--;
    j.at = t;
    j.next = t + runTime(s, b, e, t);
    return true;
  }
  const kick = (s, e, t) => { for (const b of s.bays) start(s, b, e, t); };

  function settle(state, now, e, max = MAX_EVENTS) {
    const log = [];
    let truncated = false;
    for (const key of Object.keys(state.sites).sort()) {
      const s = state.sites[key];
      for (let n = 0; ; n++) {
        // The run that finishes first (the first bay on a tie).
        let b = null;
        for (const x of s.bays) if (x.job?.next != null && x.job.next <= now && (!b || x.job.next < b.job.next)) b = x;
        if (!b) break;
        if (n >= max) { truncated = true; break; }
        const t = b.job.next, R = e.recipe(b.job.recipe);
        for (const [k, c] of Object.entries(R.out)) add(s.storage, k, c);
        b.job.made++;
        b.job.at = b.job.next = null;
        log.push({ key, bay: s.bays.indexOf(b), recipe: R.id, at: t, out: R.out });
        kick(s, e, t); // every bay that can starts now: the next run, or one waiting for what was just made
      }
    }
    return { log, truncated };
  }

  function lease(s, type) {
    const b = { type, job: null };
    s.bays.push(b);
    return b;
  }
  // Stop a bay: the inputs of the run under way go back to the warehouse.
  function clearJob(s, i) {
    const j = s.bays[i]?.job;
    if (!j) return;
    if (j.next != null) for (const [k, n] of Object.entries(Recipes.RECIPES[j.recipe].in)) add(s.storage, k, n);
    s.bays[i].job = null;
  }
  function setJob(s, i, recipe, count, e, now) {
    const b = s.bays[i];
    if (!b || Recipes.RECIPES[recipe]?.bay !== b.type) return false;
    clearJob(s, i);
    b.job = { recipe, left: count === null ? null : Math.max(1, Math.floor(count)), made: 0, at: null, next: null };
    kick(s, e, now);
    return true;
  }
  function move(s, i, j) {
    if (i === j || !s.bays[i] || !s.bays[j]) return false;
    const [b] = s.bays.splice(i, 1);
    s.bays.splice(j, 0, b);
    return true;
  }
  function deposit(s, kind, n, e, now) {
    const k = Math.min(n, free(s, e, now));
    if (k <= 0) return 0;
    add(s.storage, kind, k);
    kick(s, e, now);
    return k;
  }
  function withdraw(s, kind, n) {
    const k = Math.min(n, s.storage[kind] || 0);
    if (k > 0) add(s.storage, kind, -k);
    return k;
  }

  function summary(state, log) {
    const made = new Map();
    for (const x of log) {
      for (const [kind, n] of Object.entries(x.out)) {
        const id = `${x.key}\u0000${kind}`;
        made.set(id, (made.get(id) || 0) + n);
      }
    }
    return [...made].map(([id, n]) => {
      const [key, kind] = id.split('\u0000');
      return `${state.sites[key].name}: ${n} × ${Recipes.item(kind).name}`;
    });
  }

  return {
    LEASE, MAX_BAYS, STORAGE, SPECIALTY, FAST, MAX_EVENTS, empty, env, site, capacity, used, reserved, free, maxBays, runTime,
    status, lease, setJob, clearJob, move, deposit, withdraw, kick, settle, summary,
  };
})();

export { Industry };
