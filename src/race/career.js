// The race's career: what a run brings home (credits and salvage parts, Pickups) and the hangar's
// research that spends it. The research is the game's lab (rules/lab.js) over the race's own
// packages: four trees (Drive, Handling, Dash, Chassis), three tiers each, and every tier a fork of
// two choices, one ruling out the other. Every choice is a trade, like the game's mods
// (rules/mods.js): it gives more than it takes (VALUE: by W, its gains at least RATIO × its costs),
// so the question is which ship to build, not whether to upgrade. A tree can be stripped back
// (respec) for a fee, its parts half refunded. Kept apart from the game's save (race.career).
//
//   Career.TREES                [{ id, name, part, note }]: the trees, in order, each paid in its own part
//   Career.PARTS                the salvage kinds ('coil', 'vane', 'cell', 'plate')
//   Career.PACKAGES[id]         { id, cat (its tree), tier, fork, name, note, fx: { [key]: fraction | n }, requires, time (s), cost }
//   Career.FX[key]              { label, dir (+1: more is better, −1: less), w (its worth for VALUE) }
//   Career.value(fx) -> { gain, cost }   by W: what a choice gives and takes
//   Career.lab                  the lab's rules (Lab.create) over the packages; Career.lab.config.speed (?fastresearch)
//   Career.empty() -> career    { version, credits, parts: { [part]: n }, lab }
//   Career.load(), save(career) the career from and to the browser's storage (race.career), the lab settled
//   Career.from(data, now) -> career   a saved one (or null) brought up to date and settled
//   Career.fx(done) -> { [key]: total }   what's done adds up to
//   Career.tune(done) -> { stats, handling, drift, dash, hull, wall, bump }: × (or + for charges) on
//                the stock run's numbers, clamped (CLAMP); the identity with nothing done
//   Career.stats(stats, tune) -> stats   the race's stats (Config.stats) × the tune's
//   Career.sig(done) -> ''      a short tag of the build, for the ghost's key ('' when stock)
//   Career.buy(career, id, now) -> bool   paid and queued; cancel(career, id, now) -> refunds
//   Career.respec(career, tree, now) -> bool   the tree stripped back: RESPEC credits per tier done
//                (none to undo what's still building), parts half back for what was done, the rest as cancel
//   Career.bank(career, haul, result) -> { mult, purse, credits, parts }   a run's haul brought home:
//                result: { place (1.. | null), wreck, level }; × MULT by the finish, + the level's purse
// ES module (`Career`); also runs in Node (the tests).

import { Save } from '../core/save.js';
import { Store } from '../core/store.js';
import { Lab } from '../rules/lab.js';

const Career = (() => {
  const KEY = 'race.career', MIGRATIONS = [];
  const M = 60, H = 3600;
  const PARTS = ['coil', 'vane', 'cell', 'plate'];
  const TREES = [
    { id: 'drive', name: 'Drive', part: 'coil', note: 'top speed against acceleration' },
    { id: 'handling', name: 'Handling', part: 'vane', note: 'steering and grip against the drift' },
    { id: 'dash', name: 'Dash', part: 'cell', note: 'more charges against a stronger burst' },
    { id: 'chassis', name: 'Chassis', part: 'plate', note: 'armour, weight and the side-bump' },
  ];
  // What a choice can change: dir, which way is better; w, what a fraction (or a charge) is worth.
  const FX = {
    speed: { label: 'Top speed', dir: 1, w: 3 },
    accel: { label: 'Acceleration', dir: 1, w: 2 },
    turn: { label: 'Steering', dir: 1, w: 2.5 },
    grip: { label: 'Grip', dir: 1, w: 2 },
    brake: { label: 'Brake', dir: 1, w: 0.5 },
    slideOn: { label: 'Drift start', dir: -1, w: 0.5 },
    driftAt: { label: 'Drift charge time', dir: -1, w: 1 },
    driftBoost: { label: 'Drift boost', dir: 1, w: 1.5 },
    charges: { label: 'Dash charges', dir: 1, w: 0.35 },
    refill: { label: 'Dash refill time', dir: -1, w: 1.5 },
    dashTime: { label: 'Dash duration', dir: 1, w: 0.8 },
    dashBoost: { label: 'Dash boost', dir: 1, w: 1.5 },
    side: { label: 'Sidestep', dir: 1, w: 0.5 },
    hull: { label: 'Hull', dir: 1, w: 0.6 },
    wallDamage: { label: 'Wall damage', dir: -1, w: 0.5 },
    wallFriction: { label: 'Wall scrape', dir: -1, w: 0.8 },
    bumpPower: { label: 'Bump power', dir: 1, w: 0.8 },
    bumpRecoil: { label: 'Bump recoil', dir: -1, w: 0.8 },
  };
  const RATIO = 2;
  // [tree, tier, choice, name, fx, note]
  const TABLE = [
    ['drive', 1, 'a', 'Long-stroke coil', { speed: 0.06, accel: -0.02 }, 'faster at the top, a little slower to get there'],
    ['drive', 1, 'b', 'Snap igniter', { accel: 0.1, speed: -0.02 }, 'quick off the line and out of corners'],
    ['drive', 2, 'a', 'Overdrive', { speed: 0.06, turn: -0.02 }, 'more top speed, turns a touch wider'],
    ['drive', 2, 'b', 'Torque fill', { accel: 0.08, hull: -0.06 }, 'pulls hard, the frame lightened for it'],
    ['drive', 3, 'a', 'Slipstream', { speed: 0.08, grip: -0.03 }, 'the fastest straights, a looser rear'],
    ['drive', 3, 'b', 'Launch control', { accel: 0.12, refill: 0.06 }, 'the engine drinks from the dash'],
    ['handling', 1, 'a', 'Vector vanes', { turn: 0.08, speed: -0.02 }, 'turns tighter, a little drag'],
    ['handling', 1, 'b', 'Grip skirts', { grip: 0.08, accel: -0.02 }, 'sticks to the line'],
    ['handling', 2, 'a', 'Loose tail', { slideOn: -0.15, driftBoost: 0.1, grip: -0.03 }, 'slides sooner, boosts harder out of them'],
    ['handling', 2, 'b', 'Planted', { grip: 0.06, brake: 0.1, driftBoost: -0.04 }, 'grips and stops, drifts pay less'],
    ['handling', 3, 'a', 'Drift master', { driftAt: -0.15, driftBoost: 0.08, turn: -0.02 }, 'drift levels come quicker'],
    ['handling', 3, 'b', 'Racing line', { turn: 0.08, slideOn: 0.08 }, 'sharp and tidy, slow to break loose'],
    ['dash', 1, 'a', 'Capacitor bank', { charges: 1, refill: 0.1 }, 'one more charge, each slower to come back'],
    ['dash', 1, 'b', 'Fast cycle', { refill: -0.2, dashBoost: -0.04 }, 'charges come back sooner, a softer burst'],
    ['dash', 2, 'a', 'Long burn', { dashTime: 0.3, dashBoost: -0.04 }, 'a longer burst'],
    ['dash', 2, 'b', 'Hot burn', { dashBoost: 0.1, dashTime: -0.08 }, 'a harder, shorter burst'],
    ['dash', 3, 'a', 'Overcharge', { charges: 1, dashTime: -0.08 }, 'another charge, a little shorter each'],
    ['dash', 3, 'b', 'Quick recovery', { refill: -0.2, side: -0.05 }, 'charges back fast, a shorter sidestep'],
    ['chassis', 1, 'a', 'Armour plate', { hull: 0.25, accel: -0.02 }, 'takes the knocks, a bit heavier'],
    ['chassis', 1, 'b', 'Light frame', { accel: 0.05, hull: -0.06 }, 'lighter and quicker, dents easier'],
    ['chassis', 2, 'a', 'Ram prow', { bumpPower: 0.35, turn: -0.02 }, 'shoves rivals aside'],
    ['chassis', 2, 'b', 'Shock mounts', { bumpRecoil: -0.35, bumpPower: -0.08 }, 'shrugs off knocks'],
    ['chassis', 3, 'a', 'Battering hull', { bumpPower: 0.25, wallDamage: -0.2, speed: -0.02 }, 'hits harder, walls hurt less'],
    ['chassis', 3, 'b', 'Glancing hull', { wallFriction: -0.25, hull: -0.06 }, 'scrapes along walls and keeps its speed'],
  ];
  const CREDITS = [0, 300, 1200, 4000], PARTS_NEED = [0, 2, 5, 10], TIME = [0, 5 * M, 45 * M, 4 * H];
  const RESPEC = 150; // credits per tier done
  const PACKAGES = {};
  const idOf = (tree, tier, choice) => `${tree}.${tier}${choice}`;
  for (const [tree, tier, choice, name, eff, note] of TABLE) {
    const part = TREES.find((t) => t.id === tree).part;
    PACKAGES[idOf(tree, tier, choice)] = {
      id: idOf(tree, tier, choice), cat: tree, tier, choice, fork: `${tree}.${tier}`, name, note, fx: eff,
      requires: tier > 1 ? [[idOf(tree, tier - 1, 'a'), idOf(tree, tier - 1, 'b')]] : [],
      time: TIME[tier], cost: { credits: CREDITS[tier], [part]: PARTS_NEED[tier] },
    };
  }
  const lab = Lab.create({ packages: PACKAGES, categories: TREES, queueMax: () => 2, config: { speed: 1 } });

  function value(eff) {
    let gain = 0, cost = 0;
    for (const [k, f] of Object.entries(eff)) {
      const v = FX[k].dir * f * FX[k].w;
      if (v > 0) gain += v; else cost -= v;
    }
    return { gain, cost };
  }

  const empty = () => ({ version: MIGRATIONS.length, credits: 0, parts: Object.fromEntries(PARTS.map((p) => [p, 0])), lab: lab.empty() });
  // A saved career (or null) brought up to date: what a table no longer has dropped, the lab settled.
  function from(data, now = Date.now()) {
    const c = data && typeof data === 'object' ? Save.migrate(data, MIGRATIONS) : empty();
    c.credits = Number.isFinite(c.credits) ? c.credits : 0;
    c.parts = { ...empty().parts, ...(c.parts || {}) };
    const l = { ...lab.empty(), ...(c.lab || {}) }, known = (id) => !!PACKAGES[id];
    c.lab = { done: l.done.filter(known), doneAt: l.doneAt || {}, active: l.active && known(l.active.id) ? l.active : null, queue: l.queue.filter(known) };
    lab.settle(c.lab, now);
    return c;
  }
  const load = (now = Date.now()) => from(Store.getJSON(KEY, null), now);
  const save = (c) => Store.setJSON(KEY, c);

  function fx(done) {
    const out = {};
    for (const id of done) for (const [k, f] of Object.entries(PACKAGES[id]?.fx || {})) out[k] = (out[k] || 0) + f;
    return out;
  }
  const CLAMP = [0.5, 2];
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  function tune(done) {
    const s = fx(done), m = (k) => clamp(1 + (s[k] || 0), CLAMP[0], CLAMP[1]);
    return {
      stats: { maxSpeed: m('speed'), accel: m('accel'), turnRate: m('turn') },
      handling: { GRIP: m('grip'), BRAKE: m('brake'), on: m('slideOn') },
      drift: { at: m('driftAt'), boost: m('driftBoost') },
      dash: { charges: clamp(s.charges || 0, 0, 2), refill: m('refill'), boostTime: m('dashTime'), boost: m('dashBoost'), side: m('side') },
      hull: m('hull'),
      wall: { damage: m('wallDamage'), friction: m('wallFriction') },
      bump: { power: m('bumpPower'), recoil: m('bumpRecoil') },
    };
  }
  const stats = (st, t) => ({ ...st, maxSpeed: st.maxSpeed * t.stats.maxSpeed, accel: st.accel * t.stats.accel, turnRate: st.turnRate * t.stats.turnRate });
  const sig = (done) => [...done].sort().map((id) => id.replace(/^(\w)\w*\.(\d)/, '$1$2')).join('');

  const have = (c) => (kind) => c.parts[kind] || 0;
  const status = (c, id) => lab.status(id, c.lab, c.credits, have(c));
  function pay(c, cost, k) {
    for (const [kind, n] of Object.entries(cost)) {
      if (kind === 'credits') c.credits += Math.floor(n * k);
      else c.parts[kind] = (c.parts[kind] || 0) + Math.floor(n * k);
    }
  }
  function buy(c, id, now) {
    if (!status(c, id).ok || !lab.enqueue(c.lab, id, now)) return false;
    pay(c, PACKAGES[id].cost, -1);
    return true;
  }
  function cancel(c, id, now) {
    const out = lab.cancel(c.lab, id, now);
    for (const x of out) pay(c, PACKAGES[x.id].cost, x.refund);
    return out;
  }
  function respec(c, tree, now) {
    const done = c.lab.done.filter((id) => PACKAGES[id].cat === tree);
    const fee = RESPEC * done.length;
    if (c.credits < fee) return false;
    for (const id of lab.pending(c.lab).filter((x) => PACKAGES[x].cat === tree).reverse()) cancel(c, id, now);
    c.credits -= fee;
    for (const id of done) {
      c.lab.done.splice(c.lab.done.indexOf(id), 1);
      delete c.lab.doneAt[id];
      const { credits, ...parts } = PACKAGES[id].cost; // eslint-disable-line no-unused-vars
      pay(c, parts, 0.5);
    }
    return true;
  }

  const MULT = { first: 1.5, podium: 1.25, finish: 1, wreck: 0.5 };
  const PURSE = { regular: 60, advanced: 100, expert: 150 };
  function bank(c, haul, { place = null, wreck = false, level = 'regular' } = {}) {
    const mult = wreck ? MULT.wreck : place === 1 ? MULT.first : place && place <= 3 ? MULT.podium : MULT.finish;
    const round = mult >= 1 ? Math.round : Math.floor;
    const purse = wreck ? 0 : PURSE[level] || PURSE.regular;
    const credits = round(haul.credits * mult) + purse, parts = {};
    for (const [k, n] of Object.entries(haul.parts)) if (n) parts[k] = round(n * mult);
    c.credits += credits;
    for (const [k, n] of Object.entries(parts)) c.parts[k] = (c.parts[k] || 0) + n;
    return { mult, purse, credits, parts };
  }

  return { KEY, TREES, PARTS, PACKAGES, FX, RATIO, RESPEC, MULT, PURSE, CLAMP, lab, value, empty, from, load, save, fx, tune, stats, sig, status, buy, cancel, respec, bank };
})();

export { Career };
