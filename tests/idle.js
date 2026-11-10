// Node checks for the idle game. No dependencies: `node tests/idle.js` (ONLY=text runs the tests whose
// names include it); `node tests/run.js` runs every game's.

import assert from 'node:assert';
import { Save } from '../src/core/save.js';
import { Goods } from '../src/rules/goods.js';
import { Research } from '../src/rules/research.js';
import { Industry } from '../src/rules/industry.js';
import * as AppSw from '../tools/app-sw.js';
import { Config as IdleConfig } from '../src/idle/config.js';
import { IdleRules } from '../src/idle/rules.js';
import { IdleSave } from '../src/idle/save.js';
import { ArtStationRoles } from '../src/art/station-roles.js';
import { finish, test } from './harness.js';

// ---------- The idle game (src/idle/, notes/idle.md) ----------
// The tests play the system a new save gets (IdleRules.LAYOUT); layout 1, which only saves made
// before there was a choice keep, has its own check in the layout test.

test('idle offline: idle/sw.js keeps every file the idle game loads (npm run idle:sw), the manifest and its icons among them', () => {
  const files = AppSw.appFiles('idle');
  for (const f of ['./', 'manifest.webmanifest', '../src/idle/main.js', '../src/ui/kit-line.css', '../assets/idle-icon-512.png', '../assets/idle-icon-180.png']) assert(files.includes(f), f);
  assert(!files.some((f) => f.includes('/game/') || f.includes('/race/') || f.endsWith('sw.js')), 'nothing of the game or the race, and not the worker itself');
  const { current, wanted } = AppSw.check('idle');
  assert.strictEqual(current, wanted, 'idle/sw.js: the file list is out of date: npm run idle:sw');
});

test('idle: the system, its bodies on their orbits, and a station of each type to build', () => {
  const w = IdleRules.world(1, IdleRules.LAYOUT);
  assert.strictEqual(w.stations.length, IdleConfig.BUILDS.length);
  for (const b of IdleConfig.BUILDS) assert.strictEqual(IdleRules.stationOf(w, b.id)?.type, b.type, b.id);
  assert.strictEqual(w.waystation.type, 'waystation');
  assert(w.sites.some((s) => s.kind === 'field' && s.goods.includes('iron')));
  assert.strictEqual(w.sites.filter((s) => s.kind === 'planet').length, w.galaxy.planets.length);
  const rings = w.sites.filter((s) => s.kind !== 'moon').map((s) => s.ring).sort((a, b) => a - b);
  assert.deepStrictEqual(rings, rings.map((_, i) => i), 'the planets and the field each on an orbit of their own, inner to outer');
  for (const m of w.sites.filter((s) => s.kind === 'moon')) assert.strictEqual(w.byKey.get(m.parent)?.kind, 'planet', m.key);
  for (const s of w.sites) for (const g of s.goods) assert(IdleConfig.RECIPES[`extract.${g}`], g);
  for (const st of w.stations) assert(ArtStationRoles.ROLE_OF[st.type] || ['mining camp', 'salvage yard'].includes(st.type), st.type);
});

test('idle: nothing built at first; chart by survey, build in orbit, drill, refine and sell; time away comes out the same however it is settled', () => {
  const w = IdleRules.world(1, IdleRules.LAYOUT), T = 1e12, field = w.sites.find((x) => x.kind === 'field');
  const planet = w.sites.find((x) => x.kind === 'planet' && x.body.moons.length);
  const s0 = IdleRules.empty(w, T);
  assert.deepStrictEqual(s0.built, [], 'no stations');
  assert.deepStrictEqual(s0.charted, [field.key], 'only the field charted');
  assert(!IdleRules.online(s0, w, w.waystation.key) && !IdleRules.online(s0, w, planet.key));
  assert(!IdleRules.buyDrill(s0, w, field.key, 'iron', T), 'no drill before there is a waystation to send to');
  assert(!IdleRules.surveyable(s0, w, `site:moon${planet.body.moons[0]}`), 'a moon waits for its planet');
  const play = (steps) => {
    const s = IdleRules.empty(w, T);
    assert(!IdleRules.build(s, w, 'build.waystation', planet.key, T), 'not round an uncharted body');
    assert(IdleRules.build(s, w, 'build.waystation', field.key, T), 'the waystation is free');
    assert.strictEqual(IdleRules.hostOf(s, w.waystation.key), field.key);
    assert.strictEqual(IdleRules.drillCost(s, field), 0, 'the first drill is free');
    assert(IdleRules.buyDrill(s, w, field.key, 'iron', T));
    assert(IdleRules.drillCost(s, field) > 0);
    assert(!IdleRules.industry.shuttle(s.industry, field.key), 'no shuttle until one is bought');
    const shuttle = IdleRules.shuttleCost(s);
    assert(!IdleRules.buyShuttle(s, w, field.key, T), `not for less than ${shuttle}`);
    s.credits += shuttle; // as if some iron was hauled by hand and sold
    assert(IdleRules.buyShuttle(s, w, field.key, T), 'bought');
    assert.strictEqual(IdleRules.industry.shuttle(s.industry, field.key).stops[1].station, w.waystation.key);
    assert(!IdleRules.buyShuttle(s, w, field.key, T), 'one a link');
    const cost = IdleRules.surveyCost(s);
    assert(IdleRules.survey(s, w, planet.key, T));
    assert.strictEqual(s.credits, IdleConfig.START_CREDITS - cost);
    assert(!IdleRules.survey(s, w, w.sites.find((x) => x.kind === 'planet' && x !== planet).key, T), 'one survey at a time');
    const charted = [];
    for (let i = 1; i <= steps; i++) {
      for (;;) { const r = IdleRules.settle(s, w, T + (3 * 3600e3 * i) / steps, 500); charted.push(...r.charted); if (!r.truncated) break; }
    }
    assert.deepStrictEqual(charted.map((c) => c.key), [planet.key], 'charted once, when the survey ended');
    return s;
  };
  const s = play(1);
  assert.deepStrictEqual(play(9), s, 'in slices and steps: the same');
  assert(IdleRules.charted(s, planet.key) && IdleRules.surveyable(s, w, `site:moon${planet.body.moons[0]}`), 'its moons can be surveyed now');
  assert.strictEqual(s.credits, IdleConfig.START_CREDITS - IdleRules.surveyCost(IdleRules.empty(w, T)) + IdleRules.findAt(w, planet.key), 'what the survey found is paid');
  const way = w.waystation.key, t = T + 3 * 3600e3;
  assert((IdleRules.industry.stockAt(s.industry, way).iron || 0) > 0, 'iron reached the waystation');
  const c0 = s.credits, { sold, credits } = IdleRules.sell(s, w, way, 'iron', 20, t);
  assert.strictEqual(sold, 20);
  assert.strictEqual(s.credits, c0 + credits);
  // The ore works, round the field beside the waystation: the iron goes there now, and pipe comes back.
  s.credits += 1000;
  assert.strictEqual(IdleRules.buildStatus(s, w, 'build.volatiles').id, 'locked', 'built in order');
  assert(IdleRules.build(s, w, 'build.ore', field.key, t));
  const camp = IdleRules.stationOf(w, 'build.ore');
  assert.strictEqual(IdleRules.berths(s, w, field.key).free, 0, 'the field\'s two berths taken');
  assert(!IdleRules.build(s, w, 'build.volatiles', field.key, t), 'no room left there');
  assert.strictEqual(IdleRules.industry.shuttle(s.industry, field.key).stops[1].station, camp.key, 'the field\'s drills send to the ore works');
  assert(!IdleRules.industry.shuttle(s.industry, camp.key), 'a new station has no shuttle');
  assert.strictEqual(IdleRules.haulTarget(s, w, camp.key), w.waystation, 'its goods go to the waystation by hand');
  assert(IdleRules.buyShuttle(s, w, camp.key, t));
  assert.strictEqual(IdleRules.industry.shuttle(s.industry, camp.key).stops[1].station, way, 'the ore works sends to the waystation');
  IdleRules.sell(s, w, way, 'iron', 100, t);
  while (IdleRules.settle(s, w, t + 3600e3).truncated);
  assert((IdleRules.industry.stockAt(s.industry, way)['steel-pipe'] || 0) > 0, 'pipe reached the waystation');
  // The volatiles works round the charted planet, paid from the waystation's stock.
  IdleRules.sell(s, w, way, 'steel-pipe', 100, t + 3600e3); // room for what it costs
  for (const [k, n] of Object.entries(IdleConfig.BUILDS[2].goods)) IdleRules.industry.deposit(s.industry, way, k, n, IdleRules.env(s), t + 3600e3);
  s.credits += IdleConfig.BUILDS[2].credits;
  assert.strictEqual(IdleRules.buildStatus(s, w, 'build.volatiles').id, 'ready');
  assert(IdleRules.build(s, w, 'build.volatiles', planet.key, t + 3600e3));
  const minor = IdleRules.stationOf(w, 'build.volatiles');
  assert(IdleRules.online(s, w, minor.key));
  assert.deepStrictEqual(IdleRules.posOf(s, w, minor.key), { x: planet.x, y: planet.y }, 'where its body is');
  assert(IdleRules.place(s, w, minor.key, 'make.hydrazine', t + 3600e3));
  // A save read back is the same state.
  assert.deepStrictEqual(IdleRules.read(JSON.parse(JSON.stringify(s))), JSON.parse(JSON.stringify(s)));
  assert.strictEqual(IdleRules.read({ ...JSON.parse(JSON.stringify(s)), version: 1 }), null, 'a first-slice save starts again');
});

// A system with every station built round the field and the first planet, and plenty to pay with;
// Haulage researched and a foreman at every station, so links have shuttles and orders go on.
function idleBuilt(T) {
  const w = IdleRules.world(1, IdleRules.LAYOUT), s = IdleRules.empty(w, T), field = w.sites.find((x) => x.kind === 'field');
  s.lab.done.push('ext.haulage');
  s.foremen.push(...IdleConfig.BUILDS.map((b) => b.id));
  const planets = w.sites.filter((x) => x.kind === 'planet');
  s.charted.push(...planets.map((x) => x.key));
  const hosts = [field.key, field.key, ...planets.flatMap((x) => [x.key, x.key])];
  IdleConfig.BUILDS.forEach((b, i) => {
    s.industry.stock[w.waystation.key] = { ...b.goods };
    s.credits += b.credits;
    assert(IdleRules.build(s, w, b.id, hosts[i], T), b.id);
  });
  s.credits = 1e6;
  return { w, s, field };
}

test('idle: the game\'s Industry is unchanged without a rate; the idle tables need no salvage but the recycler\'s', () => {
  const o = { recipe: 'make.steel-pipe' };
  assert.strictEqual(Industry.runTime(o, Industry.env(Research.empty()), 0), 20000);
  const salvage = (counts) => Object.keys(counts).some((k) => Goods.isSalvage(k));
  for (const R of Object.values(IdleConfig.RECIPES)) assert(R.bay === 'recycle' || !salvage(R.in), R.id);
  for (const p of Object.values(IdleConfig.PACKAGES)) assert(!salvage(p.cost), p.id);
  for (const p of Object.values(IdleConfig.PACKAGES)) for (const r of p.requires.flat()) assert(IdleConfig.PACKAGES[r], `${p.id} needs ${r}`);
  assert(IdleConfig.PACKAGES['bp.pulse-laser-2'] && !IdleConfig.PACKAGES['core.bool'], 'blueprints, not squad logic');
});

test('idle: research is paid from the credits and the waystation, needs its station built, and unlocks recipes', () => {
  const T = 1e12, w = IdleRules.world(1, IdleRules.LAYOUT), s0 = IdleRules.empty(w, T);
  assert.strictEqual(IdleRules.researchStatus(s0, w, 'ext.drill.1').away, 'waystation', 'nothing built: nowhere to research');
  const { s } = idleBuilt(T), way = w.waystation.key;
  s.industry.stock[way] = { 'steel-pipe': 10 };
  const c0 = s.credits;
  assert(IdleRules.research(s, w, 'ext.drill.1', T));
  assert.strictEqual(s.credits, c0 - IdleConfig.PACKAGES['ext.drill.1'].cost.credits);
  assert.strictEqual(IdleRules.industry.stockAt(s.industry, way)['steel-pipe'], 6);
  assert(!IdleRules.research(s, w, 'ext.drill.1', T), 'not twice');
  // Cancelled while building: half back.
  assert.deepStrictEqual(IdleRules.cancelResearch(s, w, 'ext.drill.1', T), ['ext.drill.1']);
  assert.strictEqual(IdleRules.industry.stockAt(s.industry, way)['steel-pipe'], 8);
  // A blueprint: the shipyard can make the gear once it's done.
  const ship = IdleRules.stationOf(w, 'build.shipyard').key;
  assert(!IdleRules.recipesAt(s, w, ship).some((R) => R.id === 'make.pulse-laser-2'));
  assert(!IdleRules.place(s, w, ship, 'make.pulse-laser-2', T), 'not before the blueprint');
  s.industry.stock[way] = { 'carbon-fibre': 20 };
  assert(IdleRules.research(s, w, 'bp.pulse-laser-2', T));
  const r = IdleRules.settle(s, w, T + IdleRules.lab.timeOf('bp.pulse-laser-2'));
  assert.deepStrictEqual(r.researched, ['bp.pulse-laser-2']);
  assert(IdleRules.recipesAt(s, w, ship).some((R) => R.id === 'make.pulse-laser-2'));
  // A v2 save (no lab) reads with an empty one.
  const old = JSON.parse(JSON.stringify(s));
  delete old.lab;
  old.version = IdleRules.VERSION;
  assert.deepStrictEqual(IdleRules.read(old).lab, IdleRules.lab.empty());
});

test('idle: research counts from when it finished, so time away comes out the same however it is settled', () => {
  const T = 1e12;
  const run = (steps) => {
    const { w, s, field } = idleBuilt(T);
    s.industry.stock[w.waystation.key] = { 'steel-pipe': 50, 'carbon-fibre': 50, electronics: 50 };
    assert(IdleRules.buyDrill(s, w, field.key, 'iron', T));
    assert(IdleRules.research(s, w, 'ext.drill.1', T));
    assert(IdleRules.research(s, w, 'ind.speed.1', T), 'queued behind');
    const end = T + 6 * 3600e3;
    for (let i = 1; i <= steps; i++) while (IdleRules.settle(s, w, T + ((end - T) * i) / steps, 300).truncated);
    return s;
  };
  const one = run(1);
  assert.deepStrictEqual(one.lab.done, ['ext.haulage', 'ext.drill.1', 'ind.speed.1']);
  assert.deepStrictEqual(run(23), one);
  const { w, s } = idleBuilt(T), e = IdleRules.env(one), o = { recipe: 'extract.iron' };
  assert(IdleRules.industry.runTime(o, e, T + 6 * 3600e3) < IdleRules.industry.runTime(o, IdleRules.env(s), T), 'drills faster');
  assert.strictEqual(IdleRules.env(s).slotsAt(w.waystation.key), IdleConfig.STATION_SLOTS);
});

test('idle: the transport hub runs routes, the chain says what to mend, orders take priority and switch', () => {
  const T = 1e12, w = IdleRules.world(1, IdleRules.LAYOUT), s0 = IdleRules.empty(w, T);
  assert(!IdleRules.canRoute(s0), 'no hub, no routes');
  const { s } = idleBuilt(T), camp = IdleRules.stationOf(w, 'build.ore').key, fab = IdleRules.stationOf(w, 'build.fabricator').key;
  s.industry.stock = {};
  // The ore works makes pipe, the fabricator wants it: nothing carries it there.
  const fo = IdleRules.place(s, w, fab, 'make.electronics', T);
  assert(fo);
  const f = IdleRules.fixes(s, w);
  assert(f.some((x) => x.kind === 'route' && x.from === camp && x.to === fab && x.good === 'steel-pipe'), 'route the pipe');
  assert(f.some((x) => x.kind === 'route' && x.good === 'carbon-fibre') || f.some((x) => x.kind === 'order' && x.good === 'carbon-fibre'), 'and the fibre');
  assert.deepStrictEqual(IdleRules.lineage(s, w, fo.id).find((x) => x.kind === 'steel-pipe').source, 'away');
  assert(IdleRules.addRoute(s, w, camp, fab, ['steel-pipe'], T));
  assert(!IdleRules.fixes(s, w).some((x) => x.good === 'steel-pipe'), 'mended');
  assert.strictEqual(IdleRules.lineage(s, w, fo.id).find((x) => x.kind === 'steel-pipe').source, 'route');
  // The same two places again: one route, carrying both.
  assert(IdleRules.addRoute(s, w, camp, fab, ['carbon-fibre'], T));
  assert.strictEqual(IdleRules.routes(s).length, 1);
  assert.deepStrictEqual(IdleRules.carries(IdleRules.routes(s)[0]).sort(), ['carbon-fibre', 'steel-pipe']);
  const way = w.waystation.key, minor = IdleRules.stationOf(w, 'build.volatiles').key;
  assert(IdleRules.addRoute(s, w, minor, fab, ['hydrazine'], T));
  assert(!IdleRules.addRoute(s, w, minor, way, ['hydrazine'], T), `${IdleConfig.ROUTES.routes} routes at most`);
  assert.strictEqual(IdleRules.routes(s)[0].haulers.length, IdleConfig.ROUTES.haulers);
  // Priority and switching.
  const a = IdleRules.place(s, w, camp, 'make.carbon-fibre', T);
  const ids = () => s.industry.orders.filter((o) => o.station === camp).map((o) => o.id);
  assert.strictEqual(ids()[1], a.id);
  assert(IdleRules.raise(s, w, a.id, T));
  assert.strictEqual(ids()[0], a.id);
  assert(!IdleRules.raise(s, w, a.id, T), 'already first');
  assert(IdleRules.change(s, w, a.id, 'make.steel-pipe', T) && a.recipe === 'make.steel-pipe');
  assert(!IdleRules.change(s, w, a.id, 'make.pulse-laser-2', T), 'not what the ore works makes');
  assert(IdleRules.pause(s, w, a.id, true, T) && IdleRules.industry.status(s.industry, a).id === 'paused');
});

test('idle: the wreck field turns out components at the salvage yard, and its recycler takes them', () => {
  const T = 1e12, { w, s } = idleBuilt(T), yard = IdleRules.stationOf(w, 'build.salvage').key;
  s.industry.stock = {};
  const comp = Goods.component('computer');
  assert(IdleRules.recipesAt(s, w, yard).some((R) => R.id === `salvage.${comp}`), 'no research needed');
  assert(!IdleRules.recipesAt(s, w, w.waystation.key).some((R) => R.bay === 'salvage'), 'only at the salvage yard');
  assert(IdleRules.place(s, w, yard, `salvage.${comp}`, T));
  const rec = IdleRules.place(s, w, yard, `recycle.${comp}`, T);
  assert(rec);
  assert.strictEqual(IdleRules.lineage(s, w, rec.id)[0].source, 'order', 'made here');
  while (IdleRules.settle(s, w, T + 3600e3).truncated);
  assert(rec.made > 10, 'recycled what was salvaged');
});

test('idle: contracts, a new set each day from the seed, paid when delivered from the waystation', () => {
  const T = 1e12, { w, s } = idleBuilt(T), way = w.waystation.key;
  s.industry.stock = {};
  IdleRules.settle(s, w, T);
  const list = IdleRules.contracts(s);
  assert.strictEqual(list.length, IdleConfig.CONTRACTS.slots);
  const again = idleBuilt(T).s;
  IdleRules.settle(again, w, T + 3600e3);
  assert.deepStrictEqual(IdleRules.contracts(again), list, 'the same all day');
  const c = list[0];
  assert(!IdleRules.canDeliver(s, w, c.id));
  IdleRules.industry.deposit(s.industry, way, c.kind, c.n, IdleRules.env(s), T);
  const c0 = s.credits;
  assert.strictEqual(IdleRules.deliver(s, w, c.id, T), c.reward);
  assert.strictEqual(s.credits, c0 + c.reward);
  assert(!IdleRules.canDeliver(s, w, c.id), 'once');
  assert.strictEqual(IdleRules.industry.stockAt(s.industry, way)[c.kind] || 0, 0);
  IdleRules.settle(s, w, T + 86400e3);
  assert.notDeepStrictEqual(IdleRules.contracts(s).map((x) => x.id), list.map((x) => x.id), 'a new day, new contracts');
  // Research: a fourth, and better pay.
  s.lab.done.push('trade.contracts', 'trade.bonus.1');
  IdleRules.settle(s, w, T + 2 * 86400e3);
  assert.strictEqual(IdleRules.contracts(s).length, IdleConfig.CONTRACTS.slots + 1);
  const x = IdleRules.contracts(s)[0];
  assert.strictEqual(IdleRules.contractPay(s, x), Math.round(x.reward * 1.25));
});

test('idle: auto-sell sells the picked goods at the waystation on the clock\'s steps, so time away comes out the same however it is settled', () => {
  const T = 1e12;
  const run = (steps) => {
    const { w, s, field } = idleBuilt(T);
    s.industry.stock = {};
    assert(!IdleRules.setAuto(s, 'iron', true), 'not before it is researched');
    s.lab.done.push('trade.auto');
    assert(IdleRules.setAuto(s, 'iron', true));
    assert(IdleRules.buyDrill(s, w, field.key, 'iron', T) && IdleRules.buyDrill(s, w, field.key, 'iron', T));
    IdleRules.setShuttle(s, w, field.key, w.waystation.key, T);
    const sold = { n: 0, credits: 0 }, end = T + 8 * 3600e3;
    for (let i = 1; i <= steps; i++) {
      for (;;) {
        const r = IdleRules.settle(s, w, T + ((end - T) * i) / steps, 200);
        if (r.sold.iron) { sold.n += r.sold.iron.n; sold.credits += r.sold.iron.credits; }
        if (!r.truncated) break;
      }
    }
    return { s, sold };
  };
  const one = run(1);
  assert(one.sold.n > 50, `iron sold while away: ${one.sold.n}`);
  const many = run(17);
  assert.deepStrictEqual(many.s, one.s, 'in steps: the same');
  assert.deepStrictEqual(many.sold, one.sold);
});

// Settles a state to `end` from T in `steps` equal slices, a few hundred events at a time; returns
// what the settles reported, added up.
function idleSettle(s, w, T, end, steps, max = 300) {
  const acc = { log: [], charted: [], delivered: [] };
  for (let i = 1; i <= steps; i++) {
    for (;;) {
      const r = IdleRules.settle(s, w, T + ((end - T) * i) / steps, max);
      acc.log.push(...r.log); acc.charted.push(...r.charted); acc.delivered.push(...r.delivered);
      if (!r.truncated) break;
    }
  }
  return acc;
}

test('idle: hauling by hand, then shuttles: a site fills and stops, a hauler sent by hand carries it, a shuttle carries it from then on', () => {
  const T = 1e12, w = IdleRules.world(1, IdleRules.LAYOUT), field = w.sites.find((x) => x.kind === 'field'), way = w.waystation.key;
  const run = (steps) => {
    const s = IdleRules.empty(w, T), I = IdleRules.industry;
    assert(IdleRules.build(s, w, 'build.waystation', field.key, T));
    assert(IdleRules.buyDrill(s, w, field.key, 'iron', T));
    assert(!IdleRules.canHaul(s, w, field.key), 'nothing to carry yet');
    idleSettle(s, w, T, T + 3600e3, steps);
    assert.strictEqual(I.stockAt(s.industry, field.key).iron, IdleConfig.SITE_STORAGE, 'full, and stopped');
    assert.strictEqual(I.stockAt(s.industry, way).iron || 0, 0, 'nothing carried');
    const t = T + 3600e3, h = IdleRules.sendHaul(s, w, field.key, t);
    assert(h && h.to === way && h.load.iron === IdleConfig.SITE_STORAGE && h.end > t);
    assert(!IdleRules.sendHaul(s, w, field.key, t), 'one hauler at a time from a place');
    assert.strictEqual(I.stockAt(s.industry, field.key).iron || 0, 0, 'taken aboard');
    const r = idleSettle(s, w, t, h.end + 1, steps);
    assert.deepStrictEqual(r.log.filter((x) => x.haul).map((x) => x.delivered), [{ iron: IdleConfig.SITE_STORAGE }], 'delivered once, on arrival');
    assert.strictEqual(I.stockAt(s.industry, way).iron, IdleConfig.SITE_STORAGE);
    assert(I.stockAt(s.industry, field.key).iron > 0, 'the drill went on once there was room');
    // A shuttle carries it from then on, and the next costs more.
    const c0 = s.credits = 1000, cost = IdleRules.shuttleCost(s);
    assert(IdleRules.buyShuttle(s, w, field.key, h.end + 1));
    assert.strictEqual(s.credits, c0 - cost);
    assert(IdleRules.shuttleCost(s) > cost);
    idleSettle(s, w, h.end + 1, T + 4 * 3600e3, steps);
    assert(I.stockAt(s.industry, way).iron > IdleConfig.SITE_STORAGE + 50, 'carried on its own');
    return s;
  };
  const one = run(1);
  assert.deepStrictEqual(run(13), one, 'in slices: the same');
  // What doesn't fit where it's going goes back where it came from.
  const s = IdleRules.empty(w, T), I = IdleRules.industry, e = IdleRules.env(s);
  assert(IdleRules.build(s, w, 'build.waystation', field.key, T) && IdleRules.buyDrill(s, w, field.key, 'iron', T));
  I.deposit(s.industry, field.key, 'silicates', 30, e, T);
  const h = IdleRules.sendHaul(s, w, field.key, T);
  I.deposit(s.industry, way, 'steel-pipe', IdleConfig.STATION_STORAGE - 10, e, T);
  idleSettle(s, w, T, h.end, 1);
  assert.strictEqual(I.stockAt(s.industry, way).silicates, 10, 'what fitted');
  assert(I.stockAt(s.industry, field.key).silicates === 20, 'the rest back at the field');
  // Haulage: shuttles cost nothing, and new links get theirs.
  s.lab.done.push('ext.haulage');
  assert.strictEqual(IdleRules.shuttleCost(s), 0);
  s.credits = 1000;
  assert(IdleRules.build(s, w, 'build.ore', field.key, h.end));
  assert.strictEqual(I.shuttle(s.industry, IdleRules.stationOf(w, 'build.ore').key)?.stops[1].station, way, 'a shuttle with the station');
  // A save read back keeps a hauler in flight.
  IdleRules.sendHaul(s, w, field.key, h.end);
  assert.deepStrictEqual(IdleRules.read(JSON.parse(JSON.stringify(s))).hauls, s.hauls);
});

test('idle: orders run in batches until a foreman keeps them going', () => {
  const T = 1e12, { w, s } = idleBuilt(T), I = IdleRules.industry, way = w.waystation.key;
  const camp = IdleRules.stationOf(w, 'build.ore').key, batch = IdleConfig.FOREMAN.batch;
  IdleConfig.FOREMAN.batch = 5 * IdleConfig.RECIPES['make.steel-pipe'].time * 1000; // five runs, for the test
  s.foremen = [];
  s.industry.orders = [];
  s.industry.stock = { [camp]: { iron: 90 } };
  const runs = IdleRules.batchOf(s, w, camp, 'make.steel-pipe');
  assert.strictEqual(IdleRules.batchOf(s, w, w.sites[0].key, 'extract.iron'), null, 'drills have no batches');
  assert.strictEqual(runs, 5);
  const o = IdleRules.place(s, w, camp, 'make.steel-pipe', T);
  assert.strictEqual(o.left + (o.next != null ? 1 : 0), runs, 'started, the rest to come');
  while (IdleRules.settle(s, w, T + 3 * 3600e3).truncated);
  assert.strictEqual(I.status(s.industry, o).id, 'done', 'the batch done, it waits');
  assert.strictEqual(o.made, runs);
  assert(IdleRules.rerun(s, w, o.id, T + 3 * 3600e3) && o.left + (o.next != null ? 1 : 0) === runs, 'run again');
  assert(!IdleRules.rerun(s, w, o.id, T + 3 * 3600e3), 'only once it is done');
  // A foreman: paid from the credits and the waystation, and the station's orders go on.
  const f = IdleRules.foremanStatus(s, w, 'build.ore');
  assert(f.ok, f.id);
  const c0 = s.credits;
  assert(IdleRules.hireForeman(s, w, 'build.ore', T + 3 * 3600e3));
  assert.strictEqual(s.credits, c0 - f.credits);
  assert.strictEqual(o.left, null);
  assert.strictEqual(IdleRules.foremanStatus(s, w, 'build.ore').id, 'done');
  assert.strictEqual(IdleRules.place(s, w, camp, 'make.carbon-fibre', T + 3 * 3600e3).left, null, 'new orders too');
  const vol = IdleRules.foremanStatus(s, w, 'build.volatiles');
  s.industry.stock[way] = {};
  assert(!IdleRules.foremanStatus(s, w, 'build.volatiles').ok && IdleRules.foremanStatus(s, w, 'build.volatiles').short.length === Object.keys(vol.goods).length, 'goods from the waystation');
  IdleConfig.FOREMAN.batch = batch;
});

test('idle: the contract clerk delivers on the clock\'s steps, keeps what the next station needs and what the player keeps', () => {
  const T = 1e12;
  const setUp = () => {
    const { w, s } = idleBuilt(T);
    s.industry.stock = {};
    s.built = s.built.slice(0, 2); // the ore works next: no goods kept back for the volatiles works but its own
    IdleRules.settle(s, w, T);
    return { w, s };
  };
  const { w, s } = setUp(), way = w.waystation.key, I = IdleRules.industry, e = IdleRules.env(s);
  const [a, b] = IdleRules.contracts(s);
  for (const c of [a, b]) I.deposit(s.industry, way, c.kind, c.n, e, T);
  IdleRules.settle(s, w, T + 3600e3);
  assert(!a.done && !b.done, 'by hand before the clerk');
  s.lab.done.push('trade.clerk');
  s.lab.doneAt['trade.clerk'] = T + 3600e3;
  assert(IdleRules.setKeep(s, b.id, true));
  const r = IdleRules.settle(s, w, T + 2 * 3600e3);
  assert(a.done && !b.done, 'delivered, but not the one kept');
  assert.deepStrictEqual(r.delivered.map((x) => x.id), [a.id]);
  assert.strictEqual(r.delivered[0].credits, IdleRules.contractPay(s, a));
  // What the next station needs stays.
  const t = setUp(), nb = IdleRules.nextBuild(t.s);
  const kind = Object.keys(nb.goods)[0];
  t.s.contracts.list = [{ id: 'x', kind, n: 5, reward: 100, from: 'x', done: false }];
  t.s.contracts.day = Math.floor((T + 3600e3) / 86400e3);
  t.s.lab.done.push('trade.clerk');
  I.deposit(t.s.industry, t.w.waystation.key, kind, nb.goods[kind] + 4, e, T);
  IdleRules.settle(t.s, t.w, T + 3600e3);
  assert(!t.s.contracts.list[0].done, 'not with only 4 to spare');
  I.deposit(t.s.industry, t.w.waystation.key, kind, 1, e, T + 3600e3);
  IdleRules.settle(t.s, t.w, T + 2 * 3600e3);
  assert(t.s.contracts.list[0].done, 'with 5');
  // Over days away, with a drill feeding the waystation: the same however it's settled.
  const run = (steps) => {
    const x = setUp(), field = x.w.sites.find((y) => y.kind === 'field');
    x.s.lab.done.push('trade.clerk', 'trade.auto');
    IdleRules.setAuto(x.s, 'silicates', true);
    assert(IdleRules.buyDrill(x.s, x.w, field.key, 'iron', T) && IdleRules.buyDrill(x.s, x.w, field.key, 'silicates', T));
    IdleRules.setShuttle(x.s, x.w, field.key, x.w.waystation.key, T);
    x.s.contracts.list.push({ id: 'iron', kind: 'iron', n: 30, reward: 300, from: 'x', done: false });
    const acc = idleSettle(x.s, x.w, T, T + 3 * 86400e3, steps);
    return { s: x.s, delivered: acc.delivered };
  };
  const one = run(1);
  assert(one.delivered.some((x) => x.id === 'iron'), 'the clerk delivered while away');
  const many = run(29);
  assert.deepStrictEqual(many.delivered, one.delivered);
  assert.deepStrictEqual(many.s, one.s, 'in slices: the same');
});

test('idle: the probe network starts the quickest survey on the clock\'s steps while the credits cover it', () => {
  const T = 1e12, w = IdleRules.world(1, IdleRules.LAYOUT), field = w.sites.find((x) => x.kind === 'field');
  const run = (steps) => {
    const s = IdleRules.empty(w, T);
    assert(IdleRules.build(s, w, 'build.waystation', field.key, T));
    s.credits = 5000;
    assert(!IdleRules.setAutoSurvey(s, false), 'not before it is researched');
    s.lab.done.push('ext.probes');
    const acc = idleSettle(s, w, T, T + 12 * 3600e3, steps);
    return { s, charted: acc.charted.map((c) => c.key) };
  };
  const one = run(1);
  assert(one.charted.length >= 3, `charted while away: ${one.charted.length}`);
  const s0 = IdleRules.empty(w, T);
  const first = w.sites.filter((x) => IdleRules.surveyable(s0, w, x.key)).sort((a, b) => IdleRules.surveyTime(s0, w, a.key) - IdleRules.surveyTime(s0, w, b.key) || (a.key < b.key ? -1 : 1))[0];
  assert.strictEqual(one.charted[0], first.key, 'the quickest first');
  assert(one.s.credits >= 0);
  const many = run(31);
  assert.deepStrictEqual(many.charted, one.charted);
  assert.deepStrictEqual(many.s, one.s, 'in slices: the same');
  // Switched off, it waits.
  const s = IdleRules.empty(w, T);
  IdleRules.build(s, w, 'build.waystation', field.key, T);
  s.credits = 5000;
  s.lab.done.push('ext.probes');
  assert(IdleRules.setAutoSurvey(s, false));
  IdleRules.settle(s, w, T + 3600e3);
  assert(!s.survey && s.charted.length === 1);
});

test('idle: a system rolled from the seed (layout 2): the bodies differ by seed, and each has every raw good the chain needs; layout 1 stays as it was', () => {
  const NEEDED = ['iron', 'silicates', 'deuterium', 'titanium-ore', 'tungsten', 'rare-earths', 'sulfur'];
  const makeup = (w) => w.sites.map((x) => `${x.kind}:${x.body?.type || ''}`).join(' ');
  const seen = new Set();
  for (let seed = 1; seed <= 8; seed++) {
    const w = IdleRules.world(seed, IdleRules.LAYOUT);
    assert.strictEqual(w.layout, IdleRules.LAYOUT);
    assert.strictEqual(w.stations.length, IdleConfig.BUILDS.length, `seed ${seed}: a station of each type`);
    const goods = new Set(w.sites.flatMap((x) => x.goods));
    for (const g of NEEDED) assert(goods.has(g), `seed ${seed}: ${g} somewhere`);
    assert.strictEqual(makeup(IdleRules.world(seed, IdleRules.LAYOUT)), makeup(w), 'the same every time');
    seen.add(makeup(w));
  }
  assert(seen.size >= 6, `systems differ: ${seen.size} of 8`);
  assert.strictEqual(makeup(IdleRules.world(1, 1)), makeup(IdleRules.world(2, 1)), 'layout 1: the same bodies for every seed');
  // A save from before layouts (version 4) keeps its system.
  const w = IdleRules.world(1, 1), d = JSON.parse(JSON.stringify(IdleRules.empty(w, 1e12)));
  delete d.layout;
  assert.strictEqual(IdleRules.read(d).layout, 1);
  assert.strictEqual(IdleRules.empty(IdleRules.world(3, 2), 1e12).layout, 2);
});

test('idle: selling a trade good by the hundred drives its price down there, and it recovers on the clock', () => {
  const T = 1e12, { w, s } = idleBuilt(T), way = w.waystation.key;
  const p0 = IdleRules.priceOf(s, w, way, 'iron', T);
  s.industry.stock[way] = { iron: 100 };
  const first = IdleRules.sell(s, w, way, 'iron', 50, T).credits;
  const second = IdleRules.sell(s, w, way, 'iron', 50, T).credits;
  assert(second < first, `the second fifty fetch less: ${second} < ${first}`);
  const low = IdleRules.priceOf(s, w, way, 'iron', T);
  assert(low < p0);
  const later = IdleRules.priceOf(s, w, way, 'iron', T + 2 * IdleConfig.TRADE_MARKET.halfLife);
  assert(later > low, 'recovering');
  assert.strictEqual(IdleRules.priceOf(s, w, way, 'iron', T + 60 * IdleConfig.TRADE_MARKET.halfLife), p0, 'back in time');
});

test('idle: blueprints are drawn up at the shipyard, and the higher Mks take longer', () => {
  const T = 1e12, w = IdleRules.world(1, IdleRules.LAYOUT), s = IdleRules.empty(w, T), field = w.sites.find((x) => x.kind === 'field');
  const planets = w.sites.filter((x) => x.kind === 'planet');
  s.charted.push(...planets.map((x) => x.key));
  const hosts = [field.key, field.key, ...planets.flatMap((x) => [x.key, x.key])];
  for (const [i, b] of IdleConfig.BUILDS.entries()) {
    if (b.type === 'capital') break;
    s.industry.stock[w.waystation.key] = { ...b.goods };
    s.credits += b.credits;
    assert(IdleRules.build(s, w, b.id, hosts[i], T), b.id);
  }
  s.credits = 1e7;
  s.industry.stock[w.waystation.key] = { 'carbon-fibre': 50, 'steel-pipe': 50, electronics: 50 };
  assert.strictEqual(IdleRules.researchStatus(s, w, 'bp.deflector-2').away, 'capital', 'not before the shipyard');
  const t = (id) => IdleConfig.PACKAGES[id].time;
  assert(t('bp.deflector-4') / t('bp.deflector-3') > Research.PACKAGES['bp.deflector-4'].time / Research.PACKAGES['bp.deflector-3'].time);
});

test('idle: contracts grow with the stations built, and some ask for the dearest things on offer', () => {
  const T = 1e12, pay = (n) => {
    const { w, s } = idleBuilt(T);
    s.built = s.built.slice(0, n);
    IdleRules.settle(s, w, T);
    return IdleRules.contracts(s).reduce((a, c) => a + c.reward, 0);
  };
  assert(pay(7) > 2 * pay(2), `${pay(7)} vs ${pay(2)}`);
});

test('idle: a new system once every station is built: legacy from what was earned, kept for good, faster and better paid', () => {
  const T = 1e12;
  const s0 = IdleRules.empty(IdleRules.world(1, IdleRules.LAYOUT), T);
  assert(!IdleRules.canJump(s0) && !IdleRules.jump(s0, IdleRules.world(1, IdleRules.LAYOUT), T), 'not before every station is built');
  const { w, s } = idleBuilt(T);
  assert.strictEqual(s.earned, 0, 'built, nothing earned yet');
  // Earned counts sales, contracts and finds; spending doesn't take from it.
  s.industry.stock[w.waystation.key] = { iron: 10 };
  const sold = IdleRules.sell(s, w, w.waystation.key, 'iron', 10, T).credits;
  assert(sold > 0 && s.earned === sold);
  s.earned = 4e6;
  assert(IdleRules.canJump(s));
  assert.strictEqual(IdleRules.jumpPoints(s), 20);
  const seed = IdleRules.nextSeed(s);
  assert(seed >= 1 && seed !== s.seed && seed === IdleRules.nextSeed(s), 'the next system is fixed by this one');
  const r = IdleRules.jump(s, w, T + 1);
  assert.strictEqual(r.state.seed, seed);
  assert.strictEqual(r.w.layout, IdleRules.LAYOUT);
  assert.deepStrictEqual(r.state.built, []);
  assert.strictEqual(r.state.credits, IdleConfig.START_CREDITS);
  assert.deepStrictEqual(r.state.lab.done, []);
  assert.strictEqual(r.state.earned, 0);
  assert.strictEqual(r.state.legacy.jumps, 1);
  assert.strictEqual(r.state.legacy.points, 20);
  assert.strictEqual(r.state.legacy.systems[0].name, w.galaxy.name);
  // The legacy speeds up every order and drill, and adds to what the markets pay.
  const e0 = IdleRules.env(IdleRules.empty(r.w, T)), e1 = IdleRules.env(r.state);
  assert(Math.abs(e1.speed(T) / e0.speed(T) - (1 + 20 * IdleConfig.LEGACY.speed)) < 1e-9);
  const plain = IdleRules.empty(r.w, T);
  for (const st of [plain, r.state]) { st.built = ['build.waystation']; st.hosts[r.w.waystation.key] = r.w.sites.find((x) => x.kind === 'field').key; }
  const p0 = IdleRules.priceOf(plain, r.w, r.w.waystation.key, 'iron', T), p1 = IdleRules.priceOf(r.state, r.w, r.w.waystation.key, 'iron', T);
  assert(p1 > p0, `${p1} vs ${p0}`);
  // Saved and read back, the legacy stays; a version 5 save gains none.
  const back = IdleRules.read(JSON.parse(JSON.stringify(r.state)));
  assert.deepStrictEqual(back.legacy, r.state.legacy);
  const old = JSON.parse(JSON.stringify(s));
  delete old.legacy; delete old.earned; old.version = 5;
  const migrated = IdleRules.read(Save.migrate(old, IdleSave.MIGRATIONS));
  assert(migrated && migrated.legacy.points === 0 && migrated.earned === 0);
  assert.deepStrictEqual(migrated.foremen, s.built, 'a save from before foremen keeps its orders going');
});

finish('idle');
