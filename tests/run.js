'use strict';

// Node checks for the generators and map travel. No dependencies: `node tests/run.js`.
// Browser scripts are loaded into one shared context, in the same order as index.html.

const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
// Each script runs as its own classic script in Node's global context, then publishes its globals
// the way a browser would, so later scripts can see them.
const ctx = globalThis;
function load(file, names) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  vm.runInThisContext(`((require, module) => {${src}\n;${names.map((n) => `globalThis.${n} = ${n};`).join(' ')}\n})();`, { filename: file });
}
load('math.js', ['MathUtil']);
load('rng.js', ['hashInt', 'mulberry32', 'seedToInt', 'weightedPick']);
load('store.js', ['Params', 'Store']);
load('goods.js', ['Goods']);
load('data/galaxy-config.js', ['GALAXY_CONFIG']);
load('galaxy.js', ['Galaxy']);
load('security.js', ['Security']);
load('art/util.js', ['ArtUtil']);
load('art/culture.js', ['ArtCulture']);
load('art/blueprints.js', ['ArtBlueprints']);
load('art/items.js', ['ArtItems']);
load('art/sprite-cache.js', ['SpriteCache']);
load('entities.js', ['Entities']);
load('sector.js', ['Sectors']);
load('interactions.js', ['Interactions']);
load('travel.js', ['Travel']);
load('knowledge.js', ['Knowledge']);
load('economy.js', ['Economy']);
load('mining.js', ['Mining']);
load('loadout.js', ['Loadout']);
load('research.js', ['Research']);
load('combat-core.js', ['CombatCore']);
load('combat.js', ['Combat']);
load('flight.js', ['Flight']);
load('combat-realtime.js', ['RealtimeCombat']);
const { Galaxy, Sectors, ArtCulture, ArtItems, Travel, Knowledge, Economy, Mining, Loadout, Combat, Goods, GALAXY_CONFIG, Flight, RealtimeCombat, SpriteCache, ArtBlueprints, Entities, Interactions, CombatCore } = ctx;

let failed = 0;
function test(name, fn) {
  const t0 = Date.now();
  try {
    fn();
    console.log(`ok   ${name} (${Date.now() - t0} ms)`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n     ${e.stack.split('\n').slice(0, 3).join('\n     ')}`);
  }
}

const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1).concat(['abc', 'Untitled']);
const galaxies = new Map(SEEDS.map((s) => [s, Galaxy.generate(s, GALAXY_CONFIG)]));

test('generation is deterministic', () => {
  for (const seed of [1, 'abc']) {
    const a = Galaxy.generate(seed, GALAXY_CONFIG), b = Galaxy.generate(seed, GALAXY_CONFIG);
    assert.deepStrictEqual(
      JSON.stringify({ s: a.systems, o: a.outposts, p: a.pockets }),
      JSON.stringify({ s: b.systems, o: b.outposts, p: b.pockets }),
    );
  }
});

test('each of the three cultures builds systems; the start is the one capital', () => {
  for (const [seed, g] of galaxies) {
    assert.deepStrictEqual(g.cultures.map((c) => c.lineage), ['wedge', 'block', 'shard']);
    for (const c of g.cultures) assert(g.systems.some((s) => s.culture === c.id), `seed ${seed}: no ${c.name} systems`);
    for (const o of g.outposts) assert(g.cultures[o.culture], `seed ${seed}: outpost ${o.name} has no culture`);
    assert.strictEqual(g.systems.filter((s) => s.capital).length, 1, `seed ${seed}: one capital`);
    assert.strictEqual(g.systems[g.startSystem].capital, true, `seed ${seed}: start is not the capital`);
  }
});

test('every sector builds without errors', () => {
  const g = galaxies.get(1);
  const sectors = Sectors.create(g, ArtCulture.forGalaxy(g), g.sectorUnits);
  for (let y = 0; y < g.size; y++) for (let x = 0; x < g.size; x++) sectors.at(x, y);
});

test('save keys differ between galaxies and include the generator version', () => {
  const keys = new Set([...galaxies.values()].map((g) => Galaxy.saveKey(g)));
  assert.strictEqual(keys.size, galaxies.size);
  assert(Galaxy.saveKey(galaxies.get(1)).endsWith(`:v${Galaxy.VERSION}`));
});

test('every deep-space contact is a row of CONTACT_TYPES, and only hostile rows attack', () => {
  const seen = new Set();
  for (const g of galaxies.values()) {
    for (let y = 0; y < g.size; y++) {
      for (let x = 0; x < g.size; x++) {
        const c = g.deepSector(x, y);
        if (!c) continue;
        const t = Galaxy.CONTACT_TYPES[c.type];
        assert(t && t.label && t.name && t.prompt && t.color, `contact type ${c.type}`);
        assert.strictEqual(c.hostile, !!t.hostile, c.type);
        seen.add(c.type);
      }
    }
  }
  for (const type of ['derelict', 'ambush']) assert(seen.has(type), `no ${type} rolled`);
});

// Every sector a segment passes through, found by fine sampling (slow but obviously right).
function sampledCells(a, b) {
  const out = new Set();
  for (let i = 0; i <= 20000; i++) {
    const t = i / 20000;
    out.add(`${Math.floor(a.x + (b.x - a.x) * t)},${Math.floor(a.y + (b.y - a.y) * t)}`);
  }
  out.delete(`${Math.floor(a.x)},${Math.floor(a.y)}`);
  return out;
}

test('map travel enters every sector on its path', () => {
  const entered = [];
  const galaxy = { territoryOf: (x, y) => (entered.push(`${x},${y}`), { zone: 'deep' }), deepSector: () => null };
  const knowledge = { pass() {}, contactState: () => null };
  const r = ctx.mulberry32(7);
  for (let i = 0; i < 500; i++) {
    const a = { x: 10 + r() * 60, y: 10 + r() * 60 }, b = { x: 10 + r() * 60, y: 10 + r() * 60 };
    entered.length = 0;
    const trip = Travel.create(galaxy, knowledge);
    trip.start(a, { kind: 'sector', x: b.x, y: b.y, name: '' });
    while (trip.active) trip.step(0.05);
    const want = sampledCells(a, b);
    const missed = [...want].filter((c) => !entered.includes(c));
    assert.strictEqual(missed.length, 0, `trip ${JSON.stringify([a, b])} skipped ${missed}`);
  }
  // Axis-aligned and corner-crossing lines.
  const cells = (a, b) => Travel.crossings(a, b).map((c) => `${c.x},${c.y}`);
  assert.deepStrictEqual(cells({ x: 0.5, y: 0.5 }, { x: 0.5, y: 3.5 }), ['0,1', '0,2', '0,3']);
  assert.deepStrictEqual(cells({ x: 0.5, y: 0.5 }, { x: 2.5, y: 2.5 }), ['1,1', '2,2']);
  assert.deepStrictEqual(cells({ x: 3.5, y: 1.5 }, { x: 3.5, y: 1.5 }), []);
});

test('a hostile contact on the path interdicts at its sector', () => {
  const galaxy = {
    territoryOf: () => ({ zone: 'deep' }),
    deepSector: (x, y) => (x === 5 && y === 2 ? { type: 'ambush', hostile: true } : null),
  };
  const trip = Travel.create(galaxy, { pass() {}, contactState: () => null });
  trip.start({ x: 0.5, y: 2.5 }, { kind: 'sector', x: 9.5, y: 2.5, name: '' });
  let ev = null;
  while (trip.active && !ev) ev = trip.step(0.1);
  assert.strictEqual(ev && ev.type, 'interdict');
  assert.deepStrictEqual(ev.cell, { x: 5, y: 2 });
  assert(Math.abs(ev.pos.x - 5) < 1e-9, 'interdicted at the sector edge');
});

test('the start charts every settled system, and exploring bumps the knowledge version (map redraw)', () => {
  const g = galaxies.get(1);
  const k = Knowledge.create(g, { fresh: true });
  assert(g.systems.every((s) => k.knowsSystem(s.id)), 'a system is missing from the starting charts');
  // A deep-space sector nobody has seen yet.
  let x = 0, y = 0;
  while (k.isExplored(x, y)) { x++; if (x >= g.size) { x = 0; y++; } }
  const v = k.version;
  assert.strictEqual(k.revealSector(x, y), true);
  assert(k.version > v, 'version did not change');
  const v2 = k.version;
  k.revealSector(x, y); // already explored: no change
  assert.strictEqual(k.version, v2);
  k.save(); // also clears the pending save timer so the process can exit
});

// Every station in a galaxy, as the flight view sees them.
function stationsOf(g) {
  const sectors = Sectors.create(g, ArtCulture.forGalaxy(g), g.sectorUnits);
  const out = [];
  for (const s of [...g.systems, ...g.outposts]) out.push(...sectors.at(s.x, s.y).entities.filter((e) => e.kind === 'station'));
  return out;
}

test('every station has a dockable market with sane prices', () => {
  const g = galaxies.get(1);
  const stations = stationsOf(g);
  const keys = new Set();
  for (const st of stations) {
    assert(st.key && st.market && st.market.type, `station ${st.name} lacks key or market`);
    assert(!keys.has(st.key), `duplicate station key ${st.key}`);
    keys.add(st.key);
    const m = Economy.market(g.seed, st);
    // Every trade good has a price here (components aren't traded); the station stocks a few categories.
    assert.strictEqual(m.goods.length, Goods.categories('trade').reduce((n, c) => n + Goods.ofCategory(c).length, 0));
    assert.strictEqual(m.salvage, undefined);
    const stocked = m.goods.filter((x) => x.buy !== null);
    assert(new Set(stocked.map((x) => x.category)).size >= Economy.config.minForSale, `${st.name} stocks too little`);
    for (const x of m.goods) {
      assert(Number.isInteger(x.sell) && x.sell > 0, `${st.name}: bad sell price for ${x.kind}`);
      // Buying and selling back at the same station never makes money.
      if (x.buy !== null) assert(x.buy > x.sell, `${st.name}: ${x.kind} buy ${x.buy} <= sell ${x.sell}`);
      if (x.produced && x.rarity <= 2) assert(x.buy !== null, `${st.name}: produces ${x.kind} but doesn't sell it`);
      if (x.rarity === 5) assert.strictEqual(x.buy, null, `${st.name} sells exotic ${x.kind}`);
    }
    assert.strictEqual(JSON.stringify(Economy.market(g.seed, st)), JSON.stringify(m), 'market is not deterministic');
  }
  assert(stations.length > 40, `only ${stations.length} stations`);
});

test('there are profitable trade runs between nearby stations', () => {
  const g = galaxies.get(1);
  const stations = stationsOf(g).slice(0, 80);
  const markets = stations.map((st) => Economy.market(g.seed, st));
  let best = 0;
  for (let a = 0; a < stations.length; a++) for (let b = 0; b < stations.length; b++) {
    for (const ga of markets[a].goods) {
      if (ga.buy === null) continue;
      const gb = markets[b].goods.find((x) => x.kind === ga.kind);
      best = Math.max(best, (gb.sell - ga.buy) / ga.buy);
    }
  }
  assert(best > 0.3, `best margin only ${(best * 100).toFixed(0)}%`);
});

// Every asteroid in a galaxy, as the flight view sees them.
function asteroidsOf(g, sectors = Sectors.create(g, ArtCulture.forGalaxy(g), g.sectorUnits)) {
  const out = [];
  for (let y = 0; y < g.size; y++) for (let x = 0; x < g.size; x++) {
    out.push(...sectors.at(x, y).entities.filter((e) => e.kind === 'asteroid'));
  }
  return out;
}

test('asteroids have unique keys that survive a rebuild', () => {
  const g = galaxies.get(1);
  const a = asteroidsOf(g), b = asteroidsOf(g);
  assert(a.length > 500, `only ${a.length} asteroids`);
  assert.strictEqual(new Set(a.map((e) => e.key)).size, a.length, 'duplicate asteroid keys');
  assert.deepStrictEqual(a.map((e) => [e.key, e.x, e.y]), b.map((e) => [e.key, e.x, e.y]));
});

test('mined asteroids drop metals, minerals or gases, at the configured rates', () => {
  const g = galaxies.get(1);
  const byType = {};
  for (const e of asteroidsOf(g)) {
    const y = Mining.yieldOf(g.seed, e);
    assert.deepStrictEqual(Mining.yieldOf(g.seed, e), y, 'yield is not deterministic');
    if (y) {
      const cat = Goods.type(y.kind)?.category;
      assert(['metal', 'mineral', 'gas'].includes(cat), `unexpected drop ${y.kind}`);
      assert(Number.isInteger(y.seed));
    }
    const t = (byType[e.ast.type] ||= { n: 0, drops: 0, metal: 0, gas: 0 });
    t.n++;
    if (y) { t.drops++; const cat = Goods.type(y.kind).category; if (cat === 'metal') t.metal++; if (cat === 'gas') t.gas++; }
  }
  for (const [type, t] of Object.entries(byType)) {
    assert(Mining.YIELD[type], `no yield table for ${type} asteroids`);
    if (t.n < 100) continue;
    const rate = t.drops / t.n;
    assert(Math.abs(rate - Mining.YIELD[type].chance) < 0.1, `${type}: drop rate ${rate.toFixed(2)}`);
  }
  if (byType.metal?.drops) assert(byType.metal.metal / byType.metal.drops > 0.6, 'metallic asteroids should mostly give metal');
  if (byType.ice?.drops) assert(byType.ice.metal === 0 && byType.ice.gas === byType.ice.drops, 'icy asteroids give gas');
  if (byType.stony?.drops) assert.strictEqual(byType.stony.gas, 0, 'only icy asteroids give gas');
});

test('the Mine shortcut picks the nearest asteroid within mining range of its edge', () => {
  // As the flight view sets it up (game.js): a ship at the origin, gaps measured to the edge.
  const A = Interactions.create({ gap: (e) => Math.hypot(e.x, e.y) - e.radius, speed: () => 0 });
  const mine = A.add({ id: 'mine', kind: 'asteroid', verb: 'Mine', range: () => Mining.config.range, run() {} });
  const R = Mining.config.range;
  const rock = (key, x, r = 20) => ({ kind: 'asteroid', key, x, y: 0, radius: r, ast: { type: 'stony' } });
  const near = rock('near', 60), far = rock('far', 120), out = rock('out', R + 21 + 0.1);
  assert.strictEqual(A.target(mine, null, [far, { kind: 'station', x: 10, y: 0, radius: 5 }, near, out]), near);
  assert.strictEqual(A.target(mine, null, [far, out]), far);
  assert.strictEqual(A.target(mine, null, [out]), null);
  assert.strictEqual(A.target(mine, null, [rock('edge', R + 20)]).key, 'edge');
});

test('art ids name what an asset is built from, so a rebuilt sector finds its sprites again', () => {
  const g = galaxies.get(1);
  const cultures = ArtCulture.forGalaxy(g);
  const a = Sectors.create(g, cultures, g.sectorUnits), b = Sectors.create(g, cultures, g.sectorUnits);
  const seen = new Map(); // art id -> a fingerprint of the blueprint
  const print = (bp) => `${bp.type}|${bp.parts.length}|${bp.radius.toFixed(3)}|${bp.label}`;
  for (const s of g.systems) {
    const x = a.at(s.x, s.y).entities.filter((e) => e.art), y = b.at(s.x, s.y).entities.filter((e) => e.art);
    assert.deepStrictEqual(x.map((e) => e.art.id), y.map((e) => e.art.id), `sector ${s.x},${s.y} rebuilt with other ids`);
    for (const e of x) {
      assert.notStrictEqual(e.art, y[x.indexOf(e)], 'a rebuild makes new blueprints');
      // Two blueprints may share an id only if they are the same asset.
      if (seen.has(e.art.id)) assert.strictEqual(seen.get(e.art.id), print(e.art), e.art.id);
      else seen.set(e.art.id, print(e.art));
    }
  }
  assert.ok(seen.size > g.systems.length, `${seen.size} distinct assets`);
  // The same item type and seed is the same art; another seed or type is not.
  assert.strictEqual(ArtItems.create('iron', 7).id, ArtItems.create('iron', 7).id);
  assert.notStrictEqual(ArtItems.create('iron', 7).id, ArtItems.create('iron', 8).id);
  assert.notStrictEqual(ArtItems.create('iron', 7).id, ArtItems.create('titanium', 7).id);
  const c = cultures.of(0);
  assert.notStrictEqual(ArtBlueprints.create('station-major', c, 2).id, ArtBlueprints.create('station-minor', c, 2).id);
});

const fakeSprite = (w, h = w) => ({ canvas: { width: w, height: h } });

test('sprite cache: drops the least recently used by pixels, but never a sprite drawn this frame', () => {
  const budget = SpriteCache.budget({ ms: 1000 });
  const cache = SpriteCache.create({ budget, maxPixels: 300, maxEntries: 100 });
  for (const k of ['a', 'b', 'c']) cache.get(k, () => fakeSprite(10)); // 100 px each
  cache.get('a', () => assert.fail('a is cached'));
  cache.get('d', () => fakeSprite(10)); // 400 px: the oldest, b, goes
  assert.deepStrictEqual(['a', 'b', 'c', 'd'].map(cache.has), [true, false, true, true]);
  // A frame that needs more than the limit keeps all its sprites for now...
  budget.next();
  for (const k of ['a', 'c', 'd', 'e']) cache.get(k, () => fakeSprite(10));
  assert.deepStrictEqual(cache.stats(), { sprites: 4, pixels: 400, builds: 5, deferred: 0, dropped: 1 });
  // ...and the next one trims back to it, oldest first.
  budget.next();
  cache.get('f', () => fakeSprite(10));
  assert.deepStrictEqual(['a', 'c', 'd', 'e', 'f'].map(cache.has), [false, false, true, true, true]);
  assert.strictEqual(cache.stats().pixels, 300);
  // The count limit works the same way (here outside any frame, so nothing is held back).
  const few = SpriteCache.create({ budget: SpriteCache.budget(), maxPixels: Infinity, maxEntries: 2 });
  for (const k of ['a', 'b', 'c']) few.get(k, () => fakeSprite(1));
  assert.deepStrictEqual(['a', 'b', 'c'].map(few.has), [false, true, true]);
});

test('sprite cache: once the frame\'s budget is spent, an object keeps its last sprite', () => {
  let t = 0;
  const budget = SpriteCache.budget({ ms: 5, now: () => t });
  const cache = SpriteCache.create({ budget, maxPixels: Infinity, maxEntries: 100 });
  const slow = () => { t += 6; return fakeSprite(10); }; // every build takes 6 ms
  cache.get('ship@0', slow);
  cache.get('ship@1', slow, { fallback: 'ship@0' });
  assert.ok(cache.has('ship@1'), 'no budget before the first frame');
  budget.next();
  assert.strictEqual(cache.get('station', slow).key, 'station', 'the first build of a frame always runs');
  assert.strictEqual(cache.get('ship@2', slow, { fallback: 'ship@1' }).key, 'ship@1', 'over budget: the last sprite stands in');
  assert.ok(!cache.has('ship@2'));
  assert.strictEqual(cache.get('rock', slow, { fallback: 'nothing' }).key, 'rock', 'no stand-in: built anyway');
  assert.strictEqual(cache.get('ship@2', slow, { fallback: 'ship@1', force: true }).key, 'ship@2', 'force builds');
  budget.next();
  assert.strictEqual(cache.get('ship@3', slow, { fallback: 'ship@2' }).key, 'ship@3', 'a new frame builds again');
  assert.strictEqual(cache.stats().deferred, 1);
  // Two caches can share one budget.
  const other = SpriteCache.create({ budget, maxPixels: Infinity, maxEntries: 100 });
  other.get('a', slow);
  assert.strictEqual(other.get('b', slow, { fallback: 'a' }).key, 'a');
});

test('actions: one registry gives each its button state, the things it applies to and its shortcut target', () => {
  let speed = 0, refused = false, mining = null;
  const A = Interactions.create({ gap: (e) => e.gap, speed: () => speed });
  A.add({ id: 'dock', kind: 'station', verb: 'Dock', key: 'f', range: 320, maxSpeed: () => 150, allowed: () => (refused ? { ok: false, reason: 'Docking refused' } : { ok: true }), run() {} });
  A.add({ id: 'mine', kind: 'asteroid', verb: 'Mine', key: 'e', range: () => 160, busy: (e) => (mining && { ok: false, label: mining === e ? 'Mining · 3 sec' : 'Mine · busy', inRange: true, busy: mining === e }), run() {} });
  A.add({ id: 'attack', kind: 'ship', verb: 'Attack', when: (e) => e.hostile, range: 900, run() {} });
  const st = { kind: 'station', gap: 400 };
  assert.deepStrictEqual(A.state('dock', st), { ok: false, label: 'Dock · too far', inRange: false });
  st.gap = 300;
  speed = 200;
  assert.deepStrictEqual(A.state('dock', st), { ok: false, label: 'Dock · slow down', inRange: true });
  speed = 100;
  assert.deepStrictEqual(A.state(A.get('dock'), st), { ok: true, label: 'Dock', inRange: true });
  refused = true;
  assert.deepStrictEqual(A.state('dock', st), { ok: false, label: 'Docking refused', inRange: true });
  refused = false;
  // While busy, the busy state wins over everything else.
  const rock = { kind: 'asteroid', gap: 5000 }, other = { kind: 'asteroid', gap: 50 };
  mining = rock;
  assert.strictEqual(A.state('mine', rock).label, 'Mining · 3 sec');
  assert.strictEqual(A.state('mine', other).label, 'Mine · busy');
  mining = null;
  // What applies to what.
  assert.deepStrictEqual(A.of({ kind: 'ship', hostile: false }), []);
  assert.deepStrictEqual(A.of({ kind: 'ship', hostile: true }).map((a) => a.id), ['attack']);
  assert.strictEqual(A.forKey('F').id, 'dock');
  assert.strictEqual(A.forKey('x'), null);
  assert.strictEqual(A.range(A.get('mine')), 160);
  // A shortcut acts on the selected thing if the action applies to it, else on the nearest in reach.
  const near = { kind: 'station', gap: 100 }, mid = { kind: 'station', gap: 250 }, far = { kind: 'station', gap: 1000 };
  assert.strictEqual(A.target(A.get('dock'), null, [far, mid, near, other]), near);
  assert.strictEqual(A.target(A.get('dock'), far, [near]), far);
  assert.strictEqual(A.target(A.get('dock'), other, [far]), null);
});

test('floating items are named by their type, with art made from their type and seed', () => {
  const g = galaxies.get(1);
  const sectors = Sectors.create(g, ArtCulture.forGalaxy(g), g.sectorUnits);
  let n = 0;
  for (const s of g.systems.concat(g.outposts)) {
    for (const e of sectors.at(s.x, s.y).entities.filter((x) => x.kind === 'item')) {
      n++;
      assert.strictEqual(e.label, Goods.type(e.itemKind).name);
      assert.strictEqual(e.art.kind, e.itemKind);
      assert.ok(e.art.id.startsWith(`item:${e.itemKind}:`));
      assert.ok(Number.isFinite(e.angle) && Number.isFinite(e.tumble) && Number.isFinite(e.x));
    }
  }
  assert.ok(n > 20, `${n} items`);
  const d = Entities.item({ key: 'k', kind: 'platinum', seed: 3, x: 5, y: 6, angle: 1, tumble: 0.1 });
  assert.deepStrictEqual([d.kind, d.label, d.category, d.itemKind, d.x, d.y], ['item', 'Platinum', 'trade', 'platinum', 5, 6]);
});

test('ships have a role and unique keys that survive a rebuild', () => {
  const g = galaxies.get(1);
  const shipsOf = () => {
    const sectors = Sectors.create(g, ArtCulture.forGalaxy(g), g.sectorUnits);
    const out = [];
    for (let y = 0; y < g.size; y++) for (let x = 0; x < g.size; x++) out.push(...sectors.at(x, y).entities.filter((e) => e.kind === 'ship'));
    return out;
  };
  const a = shipsOf(), b = shipsOf();
  assert(a.length > 100, `only ${a.length} ships`);
  assert.strictEqual(new Set(a.map((e) => e.key)).size, a.length, 'duplicate ship keys');
  assert(a.every((e) => e.role === 'fighter' || e.role === 'freighter'), 'ship without a role');
  assert.deepStrictEqual(a.map((e) => [e.key, e.role]), b.map((e) => [e.key, e.role]));
});

test('the starter Courier flies, senses and mines as before', () => {
  const s = Loadout.stats(Loadout.starter('courier'));
  assert.deepStrictEqual(
    { name: s.name, maxSpeed: s.maxSpeed, accel: s.accel, turnRate: s.turnRate, radius: s.radius, cargo: s.cargo },
    { name: 'Courier', maxSpeed: 650, accel: 520, turnRate: 3.6, radius: 16, cargo: 20 });
  assert.strictEqual(s.sensorRange, Knowledge.SENSOR_RANGE);
  assert.strictEqual(s.pingRange, Knowledge.PING_RANGE);
  assert.strictEqual(Mining.config.duration / s.miningRate, 5);
  assert.strictEqual(s.weaponSlots, 2);
  assert(s.shield > 0 && s.firepower > 0, 'starter gear includes a shield and a weapon');
});

test('every ship class has 1–4 weapon slots and one of each system, with starter gear that fits', () => {
  for (const [id, hull] of Object.entries(Loadout.HULLS)) {
    assert(hull.weapons >= 1 && hull.weapons <= Loadout.MAX_WEAPONS, `${id}: ${hull.weapons} weapon slots`);
    const slots = Loadout.slotsOf(id);
    for (const type of Object.keys(Loadout.SLOT_TYPES)) {
      assert.strictEqual(slots.filter((s) => s.type === type).length, type === 'weapon' ? hull.weapons : 1, `${id}: ${type} slots`);
    }
    assert.strictEqual(new Set(slots.map((s) => s.id)).size, slots.length, `${id}: duplicate slot ids`);
    // Player hulls list their starter gear (the Courier) or come bare; NPC hulls name their lines.
    const gear = hull.starter || hull.npc || {};
    for (const key of Object.keys(gear)) assert(slots.some((s) => s.id === key), `${id}: starter names unknown slot ${key}`);
    for (const s of Loadout.slots(Loadout.starter(id))) {
      const want = hull.starter ? hull.starter[s.id] : hull.npc?.[s.id] && `${hull.npc[s.id]}-1`;
      if (want) assert(s.item && s.item.id === want, `${id}: ${want} missing from the equipment list`);
      if (s.item) assert.strictEqual(s.item.slot, s.type, `${id}: ${s.item.id} doesn't fit a ${s.type} slot`);
    }
  }
  for (const [id, item] of Object.entries(Loadout.EQUIPMENT)) {
    assert(Loadout.SLOT_TYPES[item.slot], `${id}: unknown slot type ${item.slot}`);
    assert(Loadout.summary(item).length > 0, `${id}: no summary`);
    // What real-time combat needs: a range and an arc for weapons, a lock for computers and scanners.
    if (item.slot === 'weapon') assert(item.stats.range > 0 && item.stats.arc > 0 && item.stats.arc <= 360, `${id}: range or arc`);
    if (item.slot === 'computer') assert(item.stats.lockTime > 0, `${id}: lock time`);
    if (item.slot === 'scanner') assert(item.stats.lockRange > 0, `${id}: lock range`);
  }
});

test('empty slots contribute nothing', () => {
  const full = Loadout.starter('courier');
  const bare = { hull: 'courier', fitted: Object.fromEntries(Object.keys(full.fitted).map((k) => [k, null])) };
  const s = Loadout.stats(bare);
  assert.deepStrictEqual([s.maxSpeed, s.accel, s.sensorRange, s.miningRate, s.shield, s.firepower, s.weaponsFitted], [0, 0, 0, 0, 0, 0, 0]);
  assert.strictEqual(s.cargo, 20, 'the hold belongs to the hull');
  assert(Loadout.slots(bare).every((x) => x.item === null));
});

test('a longer-range scanner charts more sectors', () => {
  const g = galaxies.get(1);
  // A spot in deep space, away from the charted start, so only the sensors explore around it.
  let spot = null;
  const start = Knowledge.create(g, { fresh: true });
  for (let y = 3; y < g.size - 3 && !spot; y++) for (let x = 3; x < g.size - 3 && !spot; x++) {
    let clear = true;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) clear = clear && !start.isExplored(x + dx, y + dy);
    if (clear) spot = { x, y };
  }
  start.save();
  assert(spot, 'no uncharted spot found');
  const explored = (range) => {
    const k = Knowledge.create(g, { fresh: true });
    k.sense(spot.x + 0.5, spot.y + 0.5, range, range + 1);
    let n = 0;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) n += k.isExplored(spot.x + dx, spot.y + dy) ? 1 : 0;
    k.save();
    return n;
  };
  assert.strictEqual(explored(1), 9);
  assert.strictEqual(explored(2), 25);
});

test('security falls with the distance to the nearest settled system', () => {
  for (const [seed, g] of galaxies) {
    const best = [Infinity, Infinity, Infinity, Infinity]; // nearest distance seen per level
    const worst = [-1, -1, -1, -1];
    for (let y = 0; y < g.size; y++) for (let x = 0; x < g.size; x++) {
      const t = g.territoryOf(x, y);
      best[t.security] = Math.min(best[t.security], t.settledDist);
      worst[t.security] = Math.max(worst[t.security], t.settledDist);
    }
    for (let l = 0; l < 3; l++) assert(worst[l + 1] <= best[l], `seed ${seed}: level ${l + 1} reaches ${worst[l + 1]}, level ${l} starts at ${best[l]}`);
    for (const s of g.systems) assert.strictEqual(g.securityOf(s.x, s.y), 3, `seed ${seed}: ${s.name} is not high security`);
  }
});

test('the item catalogue: categories, rarity tiers and prices', () => {
  const ids = new Set();
  for (const [cat, info] of Object.entries(Goods.CATEGORIES)) {
    const list = Goods.ofCategory(cat);
    // Trade goods are only what research uses, so a category can be short and start above common.
    assert(list.length >= 2, `${cat}: only ${list.length} types`);
    const levels = list.map((t) => t.rarity);
    assert.deepStrictEqual(levels, [...levels].sort((a, b) => a - b), `${cat}: not listed commonest first`);
    if (info.group === 'salvage') assert.deepStrictEqual(levels, [1, 2, 3, 4, 5], `${cat}: components should be one per tier`);
    // Every rarity level is worth more than everything below it.
    for (let r = 2; r <= 5; r++) {
      const below = list.filter((t) => t.rarity < r).map((t) => t.price), at = list.filter((t) => t.rarity === r).map((t) => t.price);
      if (at.length) assert(Math.min(...at) > Math.max(...below), `${cat}: rarity ${r} isn't worth more than below`);
    }
    for (const t of list) {
      assert(!ids.has(t.id), `duplicate type ${t.id}`);
      ids.add(t.id);
      assert.strictEqual(Goods.type(t.id), t);
    }
  }
  assert.strictEqual(ids.size, Object.keys(Goods.TYPES).length);
});

test('components are generic, one per tier, found by category and tier', () => {
  for (const cat of Goods.categories('salvage')) {
    Goods.ofCategory(cat).forEach((t, i) => {
      const tier = i + 1;
      assert.strictEqual(t.tier, tier);
      assert.strictEqual(t.rarity, tier, `${t.id}: tier and rarity differ`);
      assert.strictEqual(Goods.component(cat, tier), t.id);
      assert.strictEqual(t.name, `${Goods.TIERS[tier]} ${cat} components`);
    });
  }
  // The same tier has the same colour in every category.
  for (let tier = 1; tier <= 5; tier++) {
    const colours = Goods.categories('salvage').map((c) => JSON.stringify(Goods.type(Goods.component(c, tier)).color));
    assert.strictEqual(new Set(colours).size, 1, `tier ${tier} colours differ between categories`);
  }
  assert.strictEqual(Goods.component('computer', 6), null);
  assert.strictEqual(Goods.component('metal', 1), null);
});

// Perceived colour difference between two colours (the "redmean" weighted RGB distance, 0..~765).
function colourDistance(a, b) {
  const [r1, g1, b1] = ctx.ArtUtil.hexToRgb(a), [r2, g2, b2] = ctx.ArtUtil.hexToRgb(b);
  const rm = (r1 + r2) / 2;
  return Math.sqrt((2 + rm / 256) * (r1 - r2) ** 2 + 4 * (g1 - g2) ** 2 + (2 + (255 - rm) / 256) * (b1 - b2) ** 2);
}

test('every item type is drawn in its own colour within its category', () => {
  for (const cat of Object.keys(Goods.CATEGORIES)) {
    const arts = Goods.ofCategory(cat).map((t) => {
      const bp = ArtItems.create(t.id, 7);
      assert.strictEqual(bp.kind, t.id);
      assert.strictEqual(bp.rarity, t.rarity);
      assert.strictEqual(bp.label.split(' · ')[1], t.name);
      assert.strictEqual(bp.category, Goods.CATEGORIES[cat].group === 'salvage' ? 'loot' : 'trade');
      const pal = bp.culture.pal;
      return { id: t.id, fill: pal.good || pal.accent, line: pal.line };
    });
    for (let i = 0; i < arts.length; i++) {
      for (let j = i + 1; j < arts.length; j++) {
        const [a, b] = [arts[i], arts[j]];
        assert(colourDistance(a.fill, b.fill) >= 80, `${cat}: ${a.id} and ${b.id} look alike (${a.fill} / ${b.fill})`);
        assert(colourDistance(a.line, b.line) >= 40, `${cat}: ${a.id} and ${b.id} have similar outlines (${a.line} / ${b.line})`);
      }
    }
  }
});

test('rarer items turn up less often: picks, floating cargo and market stock', () => {
  // Picks by rarity, for the category with the most levels (conduits: common to very rare).
  const counts = [0, 0, 0, 0, 0, 0];
  const r = ctx.mulberry32(99);
  for (let i = 0; i < 20000; i++) counts[Goods.type(Goods.pick(r, 'tubes')).rarity]++;
  for (let l = 1; l < 4; l++) assert(counts[l] > counts[l + 1], `picks: level ${l} ${counts[l]} vs ${l + 1} ${counts[l + 1]}`);
  // Floating items across a galaxy.
  const g = galaxies.get(1);
  const sectors = Sectors.create(g, ArtCulture.forGalaxy(g), g.sectorUnits);
  const found = [0, 0, 0, 0, 0, 0];
  for (let y = 0; y < g.size; y++) for (let x = 0; x < g.size; x++) {
    for (const e of sectors.at(x, y).entities) if (e.kind === 'item') found[Goods.type(e.itemKind).rarity]++;
  }
  assert(found[4] < found[2] && found[4] < found[3], `floating items: ${found.join('/')}`);
  // What stations stock, per type at each rarity.
  const stocked = [0, 0, 0, 0, 0, 0], types = [0, 0, 0, 0, 0, 0];
  for (const st of stationsOf(g)) {
    for (const x of Economy.market(g.seed, st).goods) { types[x.rarity]++; if (x.buy !== null) stocked[x.rarity]++; }
  }
  const rate = stocked.map((n, l) => n / (types[l] || 1));
  for (let l = 2; l < 4; l++) assert(rate[l] > rate[l + 1], `stock rates: ${rate.map((v) => v.toFixed(2)).join('/')}`);
});

test('old saves: item categories and labels become item types', () => {
  assert.strictEqual(Goods.resolve('metal'), 'iron');
  assert.strictEqual(Goods.resolve('gas'), 'deuterium');
  assert.strictEqual(Goods.resolve('hull'), 'hull-simple');
  assert.strictEqual(Goods.resolve(undefined, 'Railgun barrel'), 'weapon-simple');
  assert.strictEqual(Goods.resolve(undefined, 'Ore crystals'), 'corundum');
  assert.strictEqual(Goods.resolve('titanium'), 'titanium');
  assert.strictEqual(Goods.resolve('unobtainium'), null);
  // Goods and categories taken out of the catalogue are dropped from old saves.
  assert.strictEqual(Goods.resolve('gold'), null);
  assert.strictEqual(Goods.resolve('perishables'), null);
  assert.strictEqual(Goods.resolve(undefined, 'Produce crate'), null);
  for (const cat of Object.keys(Goods.CATEGORIES)) assert.strictEqual(Goods.resolve(cat), Goods.ofCategory(cat)[0].id);
});

// A made-up ship for the combat rule checks.
const testShip = (o) => ({
  hull: 100, shield: 0, shieldRecharge: 0, accuracy: 1, evasion: 0, initiative: 1, maxSpeed: 500,
  weapons: [{ name: 'Gun', damage: 10, fireRate: 2 }], ...o,
});
const always = () => 0; // every roll succeeds

test('combat rounds: initiative, shields before hull, no shots from the dead, recharge', () => {
  // The player fires first and destroys the enemy, which never gets to shoot back.
  let s = Combat.create(always,
    Combat.combatant('p', 'Me', testShip({ initiative: 3, shield: 10 })),
    [Combat.combatant('e', 'Them', testShip({ hull: 15, shield: 5, weapons: [{ name: 'Pea', damage: 1, fireRate: 2 }] }))]);
  let ev = Combat.round(s);
  assert.strictEqual(ev.length, 1);
  assert.deepStrictEqual([ev[0].shots, ev[0].hits, ev[0].shieldDamage, ev[0].hullDamage, ev[0].destroyed], [3, 3, 5, 15, true]);
  assert.strictEqual(s.over, 'won');
  assert.strictEqual(s.player.shield, 10, 'untouched');

  // With more initiative the enemy fires first; shields soak damage, then recharge up to full.
  s = Combat.create(always,
    Combat.combatant('p', 'Me', testShip({ shield: 20, shieldRecharge: 4, weapons: [] })),
    [Combat.combatant('e', 'Them', testShip({ initiative: 5, weapons: [{ name: 'Gun', damage: 5, fireRate: 2 }] }))]);
  ev = Combat.round(s);
  assert.strictEqual(ev[0].from, 'e');
  assert.deepStrictEqual([ev[0].damage, ev[0].shieldDamage, ev[0].hullDamage], [15, 15, 0]);
  assert.strictEqual(s.player.shield, 5 + 4 * Combat.config.round);
  Combat.round(s);
  assert.strictEqual(s.player.hull, 100 - (15 - 11), 'second volley breaks through the recharged shield');

  // Hit chance stays within its bounds.
  assert.strictEqual(Combat.hitChance({ stats: { accuracy: 0.2 } }, { stats: { evasion: 0.9 } }), CombatCore.config.minHit);
  assert.strictEqual(Combat.hitChance({ stats: { accuracy: 2 } }, { stats: { evasion: 0 } }), CombatCore.config.maxHit);
});

test('the player switches to the next enemy when the focused one is destroyed', () => {
  const s = Combat.create(always,
    Combat.combatant('p', 'Me', testShip({ initiative: 9, weapons: [{ name: 'A', damage: 10, fireRate: 2 }, { name: 'B', damage: 10, fireRate: 2 }] })),
    [Combat.combatant('a', 'A', testShip({ hull: 20, weapons: [] })), Combat.combatant('b', 'B', testShip({ hull: 100, weapons: [] }))], 'a');
  const ev = Combat.round(s);
  assert.deepStrictEqual(ev.map((e) => e.to), ['a', 'b']);
  assert.strictEqual(s.focus, 'b');
});

test('the starter Courier against pirate fighters: easy alone, costly in pairs, flee from ambushes', () => {
  const me = Loadout.stats(Loadout.starter('courier'));
  const fighter = Loadout.stats(Loadout.starter('fighter'));
  const N = 1000;
  const fight = (n, flee) => {
    let wins = 0, escapes = 0, hull = 0;
    for (let i = 0; i < N; i++) {
      const s = Combat.create(ctx.mulberry32(i * 7919 + n), Combat.combatant('p', 'Me', me),
        Array.from({ length: n }, (_, k) => Combat.combatant(`f${k}`, 'Fighter', fighter)));
      while (!s.over) { s.fleeing = flee; Combat.round(s); }
      if (s.over === 'won') { wins++; hull += s.player.hull; }
      if (s.over === 'fled') escapes++;
    }
    return { win: wins / N, escape: escapes / N, hull: hull / Math.max(1, wins) };
  };
  const [one, two, three, four] = [1, 2, 3, 4].map((n) => fight(n, false));
  assert(one.win > 0.99 && one.hull > 100, `vs 1: ${JSON.stringify(one)}`);
  assert(two.win > 0.8 && two.hull < me.hull - 10, `vs 2: ${JSON.stringify(two)}`);
  assert(three.win > 0.03 && three.win < 0.5, `vs 3: ${JSON.stringify(three)}`);
  assert(four.win < 0.1, `vs 4: ${JSON.stringify(four)}`);
  const run = fight(4, true);
  assert(run.escape > 0.8, `fleeing 4: ${JSON.stringify(run)}`);
});

test('fleeing skips the player\'s shots and depends on top speed', () => {
  const s = Combat.create(() => 0.99, Combat.combatant('p', 'Me', testShip({ maxSpeed: 500 })),
    [Combat.combatant('e', 'Them', testShip({ maxSpeed: 500, weapons: [] }))]);
  s.fleeing = true;
  const ev = Combat.round(s);
  assert(!ev.some((e) => e.from === 'p'), 'the player fired while fleeing');
  assert.deepStrictEqual(ev[ev.length - 1], { type: 'flee', ok: false });
  assert.strictEqual(s.fleeing, true, 'a failed attempt keeps trying next round');
  assert.strictEqual(Combat.fleeChance(s), Combat.config.fleeBase);
  s.player.stats.maxSpeed = 5000;
  assert.strictEqual(Combat.fleeChance(s), Combat.config.fleeMax);
});

test('pirates leave components at their gear tier and some cargo; freighters spill trade goods', () => {
  const g = galaxies.get(1);
  const tiersAt = { 1: new Set(), 4: new Set() };
  let components = 0, goods = 0;
  for (let i = 0; i < 300; i++) {
    for (const tier of [1, 4]) {
      const f = CombatCore.loot(g.seed, `x,y,s${i}`, 'fighter', tier);
      assert.deepStrictEqual(CombatCore.loot(g.seed, `x,y,s${i}`, 'fighter', tier), f, 'loot is not deterministic');
      for (const d of f) {
        assert(Goods.type(d.kind), `fighter dropped ${d.kind}`);
        if (Goods.isSalvage(d.kind)) tiersAt[tier].add(Goods.type(d.kind).tier);
        if (tier === 1) Goods.isSalvage(d.kind) ? components++ : goods++;
      }
    }
    const fr = CombatCore.loot(g.seed, `x,y,s${i}`, 'freighter');
    assert(fr.length >= 1);
    for (const d of fr) assert(Goods.type(d.kind), `freighter dropped ${d.kind}`);
  }
  assert.deepStrictEqual([...tiersAt[1]].sort(), [1, 2], 'Mk I pirates carry simple and standard components');
  assert.deepStrictEqual([...tiersAt[4]].sort(), [3, 4, 5], 'Mk IV pirates carry advanced to exotic ones');
  assert(components > 280 && components < 420, `${components} components from 300 pirates`);
  assert(goods > 140 && goods < 270, `${goods} trade goods from 300 pirates`);
});

// ---------- Progression: security, equipment tiers, research ----------

test('security falls from the charted pockets to the frontier, and sets how dangerous pirates are', () => {
  const g = galaxies.get(1);
  const by = { pocket: [], deep: [], frontier: [] };
  for (let y = 0; y < g.size; y++) for (let x = 0; x < g.size; x++) { const t = g.territoryOf(x, y); by[t.zone].push(t.security); }
  const mean = (a) => a.reduce((n, v) => n + v, 0) / a.length;
  assert(mean(by.pocket) > mean(by.deep) && mean(by.deep) > mean(by.frontier), JSON.stringify(Object.fromEntries(Object.entries(by).map(([k, v]) => [k, mean(v).toFixed(2)]))));
  // Outposts aren't settled systems, so their pockets can lie in rougher space.
  const sysPocket = [];
  for (let y = 0; y < g.size; y++) for (let x = 0; x < g.size; x++) { const t = g.territoryOf(x, y); if (t.pocket?.kind === 'system') sysPocket.push(t.security); }
  assert(sysPocket.filter((v) => v === 3).length / sysPocket.length > 0.9, 'systems\' pockets are mostly high security');
  assert(by.frontier.filter((v) => v <= 1).length / by.frontier.length > 0.8, 'the frontier is mostly low security or lawless');
  for (let level = 0; level < 3; level++) {
    const lo = Security.pirates(level), hi = Security.pirates(level + 1);
    const max = (t) => Math.max(...t.map(([v]) => v)), min = (t) => Math.min(...t.map(([v]) => v));
    assert(lo.chance > hi.chance && max(lo.size) >= max(hi.size) && min(lo.tier) >= min(hi.tier), `pirates at ${level} vs ${level + 1}`);
    assert(Security.lootTier(level) > Security.lootTier(level + 1));
  }
});

test('pirates come in packs that follow the security level and can be fought one at a time', () => {
  const g = galaxies.get(1);
  const S = Sectors.create(g, ArtCulture.forGalaxy(g), g.sectorUnits);
  const packs = [[], [], [], []]; // pack sizes, by security level
  const perSector = [[], [], [], []]; // pirates per sector that has any, by level
  const { orbit: [, o1] } = Security.PACK;
  for (let y = 0; y < g.size; y++) {
    for (let x = 0; x < g.size; x++) {
      const sec = S.at(x, y);
      if (sec.contact) continue; // an ambush is one pack on purpose
      const ps = sec.entities.filter((e) => e.kind === 'ship' && e.pirate);
      if (!ps.length) continue;
      const level = sec.territory.security, P = Security.pirates(level);
      const byPack = new Map();
      for (const p of ps) {
        assert(P.tier.some(([t]) => t === p.tier), `tier ${p.tier} at security ${level}`);
        (byPack.get(p.pack) || byPack.set(p.pack, []).get(p.pack)).push(p);
      }
      for (const pack of byPack.values()) {
        assert(new Set(pack.map((p) => p.tier)).size === 1, 'a pack shares its gear');
        packs[level].push(pack.length);
      }
      perSector[level].push(ps.length);
      // However they circle, members of different packs never come within groupRange of each other,
      // and no pack comes near a station or star.
      const centre = (p) => [p.motion.cx, p.motion.cy];
      for (const a of ps) {
        for (const b of ps) {
          if (a.pack === b.pack) continue;
          const [ax, ay] = centre(a), [bx, by] = centre(b);
          assert(Math.hypot(ax - bx, ay - by) - a.motion.r - b.motion.r > CombatCore.config.groupRange, `packs ${a.pack} and ${b.pack} at ${x},${y} too close`);
        }
        for (const e of sec.entities.filter((q) => q.kind === 'station' || q.kind === 'star')) {
          const [ax, ay] = centre(a);
          assert(Math.hypot(ax - e.x, ay - e.y) - a.motion.r - e.radius >= Security.PACK.clear, `a pack by a ${e.kind} at ${x},${y}`);
        }
      }
    }
  }
  const mean = (a) => a.reduce((n, v) => n + v, 0) / a.length;
  const share = (a, n) => a.filter((v) => v === n).length / a.length;
  assert(perSector[0].length > 50 && perSector[3].length < perSector[0].length / 3, `sectors with pirates per level: ${perSector.map((b) => b.length)}`);
  assert(mean(packs[0]) > mean(packs[1]) && mean(packs[1]) > mean(packs[2]), `pack sizes: ${packs.map((b) => (b.length ? mean(b).toFixed(1) : '-'))}`);
  assert(share(packs[2], 1) > 0.6 && share(packs[3], 1) === 1, 'safe space has mostly lone pirates');
  assert(mean(perSector[2]) >= 2.5, `medium-security sectors with pirates hold ${mean(perSector[2]).toFixed(1)} on average`);
  assert(Security.PACK.spacing > CombatCore.config.groupRange + 2 * o1, 'pack spacing keeps packs out of each other\'s fights');
});

test('equipment lines run Mk I–V and each Mk is better than the last', () => {
  const lines = {};
  for (const [id, e] of Object.entries(Loadout.EQUIPMENT)) (lines[e.line] ||= []).push([e.tier, e, id]);
  const score = (e) => (e.slot === 'weapon' ? e.stats.damage * e.stats.fireRate : e.slot === 'shield' ? e.stats.strength
    : e.slot === 'computer' ? e.stats.accuracy : e.slot === 'engine' ? e.stats.maxSpeed : e.stats.lockRange);
  for (const [line, list] of Object.entries(lines)) {
    list.sort((a, b) => a[0] - b[0]);
    assert.strictEqual(list[list.length - 1][0], 5, `${line} ends at Mk V`);
    for (let i = 1; i < list.length; i++) {
      const [, prev] = list[i - 1], [, cur, id] = list[i];
      if (line !== 'freighter-drive') assert(score(cur) > score(prev), `${id} is no better than the Mk before`);
      if (!cur.npc) assert(cur.price > prev.price, `${id} costs no more than the Mk before`);
    }
  }
  assert.deepStrictEqual(Loadout.STARTER_GEAR.sort(), Object.values(Loadout.HULLS.courier.starter).filter(Boolean).sort(), 'the Courier starts with the Mk I gear');
  // Better-armed pirates are tougher all round.
  const t1 = Loadout.stats(Loadout.npc('fighter', 1)), t4 = Loadout.stats(Loadout.npc('fighter', 4));
  assert(t4.firepower > t1.firepower && t4.hull > t1.hull && t4.shield > t1.shield && t4.accuracy > t1.accuracy);
  assert.deepStrictEqual(Loadout.stats(Loadout.npc('fighter', 1)), Loadout.stats(Loadout.starter('fighter')));
});

test('hulls: handling, hull upgrades and moving gear to another hull', () => {
  const courier = Loadout.starter('courier');
  const up = Loadout.stats(courier, { cargo: 0.4, hull: 0.3, weapons: 1 });
  assert.deepStrictEqual([up.cargo, up.hull, up.weaponSlots], [28, 156, 3]);
  assert.strictEqual(Loadout.slotsOf('gunship', { weapons: 1 }).filter((s) => s.type === 'weapon').length, Loadout.MAX_WEAPONS, 'four hardpoints at most');
  // A Hauler turns and accelerates slower with the same engine.
  const hauler = Loadout.refit(courier, 'hauler').loadout;
  assert(Loadout.stats(hauler).turnRate < Loadout.stats(courier).turnRate);
  // Gear moves across; what doesn't fit comes back.
  const armed = { hull: 'corvette', fitted: { ...Loadout.refit(courier, 'corvette').loadout.fitted, 'weapon-2': 'pulse-laser-2', 'weapon-3': 'pulse-laser-3' } };
  const { loadout, left } = Loadout.refit(armed, 'hauler');
  assert.strictEqual(loadout.fitted['weapon-1'], 'pulse-laser-1');
  assert.strictEqual(loadout.fitted.shield, 'deflector-1');
  assert.deepStrictEqual(left.sort(), ['pulse-laser-2', 'pulse-laser-3']);
  for (const id of Loadout.FOR_SALE) assert(Loadout.HULLS[id].price > 0 && !Loadout.HULLS[id].npc);
});

test('research: every node costs components of its kind plus goods, and builds on the Mk before', () => {
  const kindOf = { weapons: ['weapon'], shields: ['hull'], computers: ['computer'], scanners: ['computer'], engines: ['drive'], hull: ['hull', 'weapon'] };
  for (const n of Object.values(Research.NODES)) {
    const kinds = Object.keys(n.cost);
    for (const k of kinds) assert(Goods.type(k), `${n.id}: unknown cost ${k}`);
    const comps = kinds.filter((k) => Goods.isSalvage(k)), goods = kinds.filter((k) => !Goods.isSalvage(k));
    assert(comps.length && goods.length, `${n.id} needs both components and trade goods`);
    for (const k of comps) assert(kindOf[n.group].includes(Goods.type(k).category), `${n.id} uses ${k}`);
    for (const k of goods) assert(Goods.type(k).rarity < 5, `${n.id} needs exotic ${k}, which no station sells`);
    if (n.equipment && n.tier === 5) assert(comps.some((k) => Goods.type(k).tier === 5), `${n.id} needs an exotic component`);
    for (const r of n.requires) assert(Research.NODES[r], `${n.id} requires unknown ${r}`);
    if (n.equipment) assert(Loadout.EQUIPMENT[n.equipment] && !Loadout.EQUIPMENT[n.equipment].npc);
  }
  // Every buyable piece of equipment is either starter gear or researched.
  for (const [id, e] of Object.entries(Loadout.EQUIPMENT)) if (!e.npc) assert(Loadout.STARTER_GEAR.includes(id) || Research.NODES[id], `${id} can never be had`);
  // Status, upgrades and what's known.
  const done = new Set(), stock = {};
  const have = (k) => stock[k] || 0;
  assert.strictEqual(Research.status('pulse-laser-3', done, have).state, 'locked');
  assert.deepStrictEqual(Research.status('pulse-laser-3', done, have).needs, ['pulse-laser-2']);
  const st = Research.status('pulse-laser-2', done, have);
  assert.strictEqual(st.state, 'available');
  assert.strictEqual(st.ok, false);
  for (const c of st.cost) stock[c.kind] = c.need;
  assert.strictEqual(Research.status('pulse-laser-2', done, have).ok, true);
  done.add('pulse-laser-2');
  assert.strictEqual(Research.status('pulse-laser-2', done, have).state, 'done');
  assert.strictEqual(Research.status('heavy-cannon-2', done, have).state, 'available', 'the cannon branches off Mk II');
  assert(Research.known(done).has('pulse-laser-2') && Research.known(done).has('pulse-laser-1') && !Research.known(done).has('pulse-laser-3'));
  for (const id of ['armour-1', 'armour-2', 'cargo-racks-1', 'hardpoint-retrofit']) done.add(id);
  const u = Research.upgrades(done);
  assert.strictEqual(u.weapons, 1);
  assert(Math.abs(u.hull - 0.3) < 1e-9 && Math.abs(u.cargo - 0.2) < 1e-9);
});

test('each step up the gear ladder takes on the next pirate band', () => {
  const fit = (hull, mk, weapons) => {
    const fitted = {};
    let w = 0;
    for (const s of Loadout.slotsOf(hull)) {
      fitted[s.id] = s.type === 'weapon' ? (w++ < weapons ? `pulse-laser-${mk}` : null)
        : { shield: 'deflector', computer: 'flight-computer', engine: 'courier-drive', scanner: 'survey-scanner' }[s.type] + `-${mk}`;
    }
    return Loadout.stats({ hull, fitted });
  };
  const winRate = (stats, tier, n) => {
    let wins = 0;
    for (let i = 0; i < 100; i++) {
      const enemies = Array.from({ length: n }, (_, k) => Combat.combatant(`e${k}`, 'Fighter', Loadout.stats(Loadout.npc('fighter', tier))));
      if (Combat.simulate(ctx.mulberry32(i * 7919 + tier * 31 + n), Combat.combatant('player', 'Me', stats), enemies).over === 'won') wins++;
    }
    return wins / 100;
  };
  assert(winRate(fit('courier', 1, 1), 1, 2) > 0.9, 'the starter ship beats two Mk I pirates');
  assert(winRate(fit('courier', 1, 1), 2, 2) < 0.2, '... but not two Mk II');
  assert(winRate(fit('courier', 2, 2), 2, 3) > 0.9, 'Mk II gear with two lasers beats three Mk II pirates');
  assert(winRate(fit('courier', 2, 2), 3, 3) < 0.2, '... but not three Mk III');
  assert(winRate(fit('corvette', 3, 3), 3, 4) > 0.9, 'a Corvette with Mk III gear beats four Mk III pirates');
  assert(winRate(fit('gunship', 5, 4), 4, 6) > 0.9, 'a Gunship with Mk V gear beats the largest band');
});

// ---------- Flight and real-time combat ----------

const COURIER = Loadout.stats(Loadout.starter('courier'));
const FIGHTER = Loadout.stats(Loadout.starter('fighter'));
const FREIGHTER = Loadout.stats(Loadout.starter('freighter'));
const speedOf = (b) => Math.hypot(b.vx, b.vy);

test('flight: both movement modes turn and change speed by the engine\'s numbers', () => {
  const dt = 1 / 60;
  for (const mode of ['cruise', 'direct']) {
    // Speeding up from rest takes maxSpeed / accel seconds.
    const b = { x: 0, y: 0, vx: 0, vy: 0, angle: 0, thrust: 0 };
    for (let i = 0; i < 30; i++) Flight.step(b, COURIER, { targetAngle: 0, targetSpeed: COURIER.maxSpeed, mode }, dt);
    assert(Math.abs(speedOf(b) - COURIER.accel * 0.5) < 2, `${mode}: ${speedOf(b)} after half a second`);
    for (let i = 0; i < 60; i++) Flight.step(b, COURIER, { targetAngle: 0, targetSpeed: COURIER.maxSpeed, mode }, dt);
    assert(Math.abs(speedOf(b) - COURIER.maxSpeed) < 1e-6, `${mode}: top speed`);
    // Turning round takes pi / turnRate seconds.
    let t = 0;
    while (Math.abs(Math.cos(b.angle) + 1) > 1e-9 && t < 5) { Flight.step(b, COURIER, { targetAngle: Math.PI, targetSpeed: COURIER.maxSpeed, mode }, dt); t += dt; }
    assert(Math.abs(t - Math.PI / COURIER.turnRate) < 2 * dt, `${mode}: turned round in ${t.toFixed(2)} s`);
    // Letting go: slowing down takes as long as speeding up.
    const v0 = speedOf(b);
    for (let i = 0; i < 30; i++) Flight.step(b, COURIER, { targetAngle: Math.PI, targetSpeed: 0, mode }, dt);
    assert(v0 - speedOf(b) <= COURIER.accel * 0.5 + 2, `${mode}: stopped too fast`);
  }
  // Direct never drifts: velocity points along the heading. Cruise drifts through a turn.
  const d = { x: 0, y: 0, vx: COURIER.maxSpeed, vy: 0, angle: 0 }, c = { ...d };
  for (let i = 0; i < 20; i++) {
    Flight.step(d, COURIER, { targetAngle: Math.PI / 2, targetSpeed: COURIER.maxSpeed, mode: 'direct' }, dt);
    Flight.step(c, COURIER, { targetAngle: Math.PI / 2, targetSpeed: COURIER.maxSpeed, mode: 'cruise' }, dt);
  }
  assert(Math.abs(Math.atan2(d.vy, d.vx) - d.angle) < 1e-9, 'direct mode drifted');
  assert(Math.abs(Math.atan2(c.vy, c.vx) - c.angle) > 0.1, 'cruise mode did not drift');
});

// A duel set-up: the player at the origin facing +x, one enemy, fixed rolls.
function duel(enemyStats, at, o = {}) {
  const me = RealtimeCombat.ship('player', 'Me', o.me || COURIER, { x: 0, y: 0, angle: o.angle || 0 });
  const them = RealtimeCombat.ship('e', 'Them', enemyStats, { x: at[0], y: at[1], angle: Math.atan2(-at[1], -at[0]), radius: 18 });
  return RealtimeCombat.create(o.rng || (() => 0), me, [them], { focus: 'e' });
}
const holdStill = (s) => { for (const e of s.enemies) { e.x = e.x0 ?? e.x; e.vx = e.vy = 0; } };
// Run with the enemy pinned in place (so only the rules under test matter); returns shots by side.
function runPinned(s, secs, dt = 1 / 30) {
  const shots = { player: [], e: [] };
  for (const e of s.enemies) Object.assign(e, { x0: e.x, y0: e.y, a0: e.angle });
  for (let t = 0; t < secs - 1e-9 && !s.over; t += dt) {
    for (const ev of RealtimeCombat.step(s, dt)) if (ev.type === 'shot') shots[ev.from].push(ev);
    for (const e of s.enemies) Object.assign(e, { x: e.x0, y: e.y0, vx: 0, vy: 0, angle: e.a0 });
  }
  return shots;
}

test('real-time combat: guns fire once locked, at the weapon\'s rate, only in range and in arc', () => {
  const unarmed = { ...FIGHTER, weapons: [], hull: 1e6 };
  // Ahead and in range: nothing until the lock, then fireRate shots a second.
  let s = duel(unarmed, [500, 0]);
  let shots = runPinned(s, COURIER.lockTime + 5);
  assert(shots.player.length >= 19 && shots.player.length <= 21, `${shots.player.length} shots in 5 s`);
  assert(s.locked);
  // Behind the ship, or out of range: no shots, though locked.
  s = duel(unarmed, [-500, 0]);
  assert.strictEqual(runPinned(s, 3).player.length, 0, 'fired backwards');
  assert(s.locked);
  s = duel(unarmed, [COURIER.weapons[0].range + 18 + 50, 0]);
  assert.strictEqual(runPinned(s, 3).player.length, 0, 'fired out of range');
  // Out of lock range: no lock at all.
  s = duel(unarmed, [COURIER.lockRange + 200, 0]);
  runPinned(s, 3);
  assert(!s.locked && s.lockT === 0);
  // A turret fires all round; a forward gun only ahead.
  const pinned = (stats, at) => { const x = duel(stats, at, { me: { ...COURIER, weapons: [] } }); return runPinned(x, 3).e.length; };
  assert(pinned(FREIGHTER, [0, 400]) > 0, 'turret did not fire');
  const sideways = duel(FIGHTER, [0, 400], { me: { ...COURIER, weapons: [] } });
  sideways.enemies[0].angle = 0; // pointing along +x, the player off its left side
  assert.strictEqual(runPinned(sideways, 3).e.length, 0, 'forward gun fired sideways');
});

test('real-time combat: hit chance falls with crossing speed and range; evasion needs speed', () => {
  const w = COURIER.weapons[0];
  const a = RealtimeCombat.ship('a', 'A', COURIER, { x: 0, y: 0 });
  const t = RealtimeCombat.ship('t', 'T', FIGHTER, { x: 200, y: 0, radius: 18 });
  const still = RealtimeCombat.hitChance(a, w, t);
  assert(Math.abs(still - (COURIER.accuracy - RealtimeCombat.config.rangePenalty * (182 / w.range) ** 2)) < 1e-9, 'a ship at rest has no evasion');
  t.vx = 300; // moving along the line of fire: evasion only
  const along = RealtimeCombat.hitChance(a, w, t);
  t.vx = 0; t.vy = 300; // the same speed across it: harder
  const across = RealtimeCombat.hitChance(a, w, t);
  assert(across < along && along < still, `${still} ${along} ${across}`);
  t.x = 650;
  assert(RealtimeCombat.hitChance(a, w, t) < across, 'range does not count');
  t.vy = 5000;
  assert.strictEqual(RealtimeCombat.hitChance(a, w, t), CombatCore.config.minHit);
});

test('real-time combat: shields soak damage first and recharge only after a pause', () => {
  const s = duel({ ...FIGHTER, weapons: [] }, [400, 0]);
  const e = s.enemies[0];
  runPinned(s, COURIER.lockTime + 0.5);
  assert(e.shield < FIGHTER.shield && e.hull === FIGHTER.hull, 'shield first');
  // Stop shooting (turn away): nothing comes back until shieldDelay has passed.
  s.player.angle = Math.PI;
  const low = e.shield;
  runPinned(s, RealtimeCombat.config.shieldDelay - 0.5);
  assert.strictEqual(e.shield, low, 'recharged during the pause');
  runPinned(s, 1.5);
  assert(e.shield > low, 'never recharged');
});

test('real-time combat: targets and locks', () => {
  const unarmed = { ...FIGHTER, weapons: [] };
  const mk = (id, x, y) => RealtimeCombat.ship(id, id, unarmed, { x, y, radius: 18 });
  // An ambush: the nearest is targeted; a pick starts a new lock.
  const s = RealtimeCombat.create(() => 0.5, RealtimeCombat.ship('player', 'Me', COURIER, {}), [mk('far', 900, 0), mk('near', 300, 0)]);
  let ev = RealtimeCombat.step(s, 0.1);
  assert.strictEqual(s.focus, 'near');
  assert(ev.some((x) => x.type === 'target' && x.auto));
  for (let i = 0; i < 12; i++) ev = ev.concat(RealtimeCombat.step(s, 0.1));
  assert(s.locked && ev.some((x) => x.type === 'locked' && x.id === 'near'));
  assert(RealtimeCombat.setFocus(s, 'far'));
  assert(!s.locked && s.lockT === 0 && s.manual);
  // A destroyed target: the next one is picked.
  s.enemies.find((e) => e.id === 'far').hull = 0;
  RealtimeCombat.step(s, 0.1);
  assert.strictEqual(s.focus, 'near');
});

test('real-time combat: fighters make attack runs, turrets keep their distance', () => {
  const s = duel(FIGHTER, [1200, 0], { me: { ...COURIER, weapons: [], hull: 1e6 }, rng: ctx.mulberry32(3) });
  const f = s.enemies[0];
  let closest = Infinity, firstShot = null, breakOffs = 0, mode = f.ai.mode;
  for (let t = 0; t < 20; t += 1 / 30) {
    const ev = RealtimeCombat.step(s, 1 / 30);
    if (firstShot === null && ev.some((x) => x.type === 'shot')) firstShot = t;
    closest = Math.min(closest, Math.hypot(f.x, f.y));
    if (f.ai.mode === 'extend' && mode !== 'extend') breakOffs++;
    mode = f.ai.mode;
  }
  assert(firstShot !== null && firstShot < 4, `first shot at ${firstShot}`);
  assert(closest > 100, `rammed the player: ${closest}`);
  assert(breakOffs >= 2, `${breakOffs} attack runs`);
  const t = duel(FREIGHTER, [1000, 0], { me: { ...COURIER, weapons: [], hull: 1e6 }, rng: ctx.mulberry32(4) });
  const fr = t.enemies[0], range = FREIGHTER.weapons[0].range;
  let inBand = 0, n = 0;
  for (let k = 0; k < 30 * 30; k++) {
    RealtimeCombat.step(t, 1 / 30);
    if (k < 30 * 8) continue; // time to close in
    const d = Math.hypot(fr.x, fr.y);
    n++;
    if (d > range * 0.35 && d < range * 0.95) inBand++;
  }
  assert(inBand / n > 0.9, `freighter kept its distance ${Math.round((inBand / n) * 100)}% of the time`);
});

test('real-time combat is deterministic for a seed', () => {
  const run = () => {
    const rng = ctx.mulberry32(42);
    const enemies = [0, 1, 2].map((k) => RealtimeCombat.ship(`f${k}`, 'F', FIGHTER, { x: 700 * Math.cos(k * 2), y: 700 * Math.sin(k * 2), radius: 18 }));
    const s = RealtimeCombat.simulate(rng, RealtimeCombat.ship('player', 'Me', COURIER, {}), enemies, null, { maxTime: 30 });
    return [s.over, s.t.toFixed(3), s.player.hull, ...s.enemies.map((e) => [e.hull, e.x.toFixed(3)])];
  };
  assert.deepStrictEqual(run(), run());
});

test('real-time combat: the starter Courier against pirate fighters, and getting away', () => {
  // A pilot who sits still and turns to face the target, and one who flies flat out away.
  const face = (s, dt) => {
    const p = s.player, t = s.enemies.find((e) => e.id === s.focus && e.hull > 0);
    if (t) p.angle = Flight.turnToward(p.angle, Math.atan2(t.y - p.y, t.x - p.x), COURIER.turnRate * dt);
  };
  const run = (s, dt) => Flight.step(s.player, COURIER, { targetAngle: Math.atan2(s.player.y - s.anchor.y, s.player.x - s.anchor.x) || 0, targetSpeed: COURIER.maxSpeed, mode: 'cruise' }, dt);
  const N = 150;
  const fight = (n, pilot) => {
    let wins = 0, escapes = 0, hull = 0, left = 0;
    for (let i = 0; i < N; i++) {
      const rng = ctx.mulberry32(i * 7919 + n * 31);
      const enemies = Array.from({ length: n }, (_, k) => {
        const a = rng() * Math.PI * 2, r = 650 + rng() * 250;
        return RealtimeCombat.ship(`f${k}`, 'Fighter', FIGHTER, { x: Math.cos(a) * r, y: Math.sin(a) * r, angle: a + Math.PI / 2, radius: 18 });
      });
      const s = RealtimeCombat.simulate(rng, RealtimeCombat.ship('player', 'Me', COURIER, {}), enemies, pilot, { maxTime: 120 });
      if (s.over === 'won') { wins++; hull += s.player.hull; }
      if (s.over === 'fled') { escapes++; left += s.player.hull + s.player.shield; }
    }
    return { win: wins / N, escape: escapes / N, hull: hull / Math.max(1, wins), left: left / Math.max(1, escapes) };
  };
  const [one, two, three, four] = [1, 2, 3, 4].map((n) => fight(n, face));
  assert(one.win > 0.99 && one.hull > 100, `vs 1: ${JSON.stringify(one)}`);
  assert(two.win > 0.8 && two.hull < COURIER.hull - 10, `vs 2: ${JSON.stringify(two)}`);
  assert(three.win < 0.5, `vs 3: ${JSON.stringify(three)}`);
  assert(four.win < 0.1, `vs 4: ${JSON.stringify(four)}`);
  const away = fight(4, run);
  assert(away.escape > 0.8 && away.left > 100, `running from 4: ${JSON.stringify(away)}`);
});

if (failed) {
  console.log(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log('\nall tests passed');
