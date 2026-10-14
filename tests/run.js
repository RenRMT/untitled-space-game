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
load('art/util.js', ['ArtUtil']);
load('art/culture.js', ['ArtCulture']);
load('art/blueprints.js', ['ArtBlueprints']);
load('art/items.js', ['ArtItems']);
load('art/sprite-cache.js', ['SpriteCache']);
load('sector.js', ['Sectors']);
load('travel.js', ['Travel']);
load('knowledge.js', ['Knowledge']);
load('economy.js', ['Economy']);
load('mining.js', ['Mining']);
load('loadout.js', ['Loadout']);
load('combat.js', ['Combat']);
load('flight.js', ['Flight']);
load('combat-realtime.js', ['RealtimeCombat']);
const { Galaxy, Sectors, ArtCulture, ArtItems, Travel, Knowledge, Economy, Mining, Loadout, Combat, Goods, GALAXY_CONFIG, Flight, RealtimeCombat, SpriteCache, ArtBlueprints } = ctx;

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
      JSON.stringify({ s: a.systems, o: a.outposts, r: a.routes, f: a.factions }),
      JSON.stringify({ s: b.systems, o: b.outposts, r: b.routes, f: b.factions }),
    );
  }
});

test('every territorial faction holds systems; routes join real systems', () => {
  for (const [seed, g] of galaxies) {
    for (const f of g.factions) {
      if (f.kind === 'network') continue;
      assert(g.systems.some((s) => s.faction === f.id), `seed ${seed}: ${f.name} has no systems`);
    }
    for (const r of g.routes) {
      assert(g.systems[r.a] && g.systems[r.b] && r.a !== r.b, `seed ${seed}: bad route ${JSON.stringify(r)}`);
    }
    assert.strictEqual(g.systems[g.startSystem].capital, true, `seed ${seed}: start is not a capital`);
  }
});

test('every gate has a partner gate at its destination', () => {
  for (const seed of SEEDS.slice(0, 8)) {
    const g = galaxies.get(seed);
    const sectors = Sectors.create(g, ArtCulture.forGalaxy(g), g.sectorUnits);
    for (const s of g.systems) {
      for (const gate of sectors.at(s.x, s.y).entities.filter((e) => e.kind === 'gate')) {
        const there = sectors.at(gate.dest.x, gate.dest.y).entities.find((e) => e.kind === 'gate' && e.link === gate.link);
        assert(there, `seed ${seed}: gate ${gate.link} at ${s.name} has no partner`);
      }
    }
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

test('learning a route through its gate bumps the knowledge version (map redraw)', () => {
  const g = galaxies.get(1);
  const k = Knowledge.create(g, { fresh: true });
  const hidden = g.routes.find((r) => r.kind === 'hidden');
  assert(hidden, 'seed 1 has a hidden route');
  assert(!k.knowsRoute(hidden.link));
  const v = k.version;
  assert.strictEqual(k.knowRoute(hidden.link), true);
  assert(k.version > v, 'version did not change');
  const v2 = k.version;
  k.knowRoute(hidden.link); // already known: no change
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
    // Every trade good and component has a price here; the station stocks a few categories.
    assert.strictEqual(m.goods.length, Goods.categories('trade').reduce((n, c) => n + Goods.ofCategory(c).length, 0));
    assert.strictEqual(m.salvage.length, Goods.categories('salvage').reduce((n, c) => n + Goods.ofCategory(c).length, 0));
    const stocked = m.goods.filter((x) => x.buy !== null);
    assert(new Set(stocked.map((x) => x.category)).size >= Economy.config.minForSale, `${st.name} stocks too little`);
    for (const x of m.goods) {
      assert(Number.isInteger(x.sell) && x.sell > 0, `${st.name}: bad sell price for ${x.kind}`);
      // Buying and selling back at the same station never makes money.
      if (x.buy !== null) assert(x.buy > x.sell, `${st.name}: ${x.kind} buy ${x.buy} <= sell ${x.sell}`);
      if (x.produced && x.rarity <= 2) assert(x.buy !== null, `${st.name}: produces ${x.kind} but doesn't sell it`);
      if (x.rarity === 5) assert.strictEqual(x.buy, null, `${st.name} sells exotic ${x.kind}`);
    }
    for (const x of m.salvage) assert(Number.isInteger(x.sell) && x.sell > 0);
    assert.strictEqual(JSON.stringify(Economy.market(g.seed, st)), JSON.stringify(m), 'market is not deterministic');
  }
  assert(stations.length > 200, `only ${stations.length} stations`);
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

test('the mining target is the nearest unmined asteroid in range', () => {
  const R = Mining.config.range;
  const rock = (key, x, r = 20) => ({ kind: 'asteroid', key, x, y: 0, radius: r, ast: { type: 'stony' } });
  const near = rock('near', 60), far = rock('far', 120), out = rock('out', R + 21 + 0.1);
  const list = [far, { kind: 'station', x: 10, y: 0, radius: 5 }, near, out];
  assert.strictEqual(Mining.targetIn(list, 0, 0), near);
  assert.strictEqual(Mining.targetIn(list, 0, 0, new Set(['near'])), far);
  assert.strictEqual(Mining.targetIn([out], 0, 0), null);
  assert.strictEqual(Mining.targetIn([rock('edge', R + 20)], 0, 0).key, 'edge');
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
  assert.ok(seen.size > 500, `${seen.size} distinct assets`);
  // The same item type and seed is the same art; another seed or type is not.
  assert.strictEqual(ArtItems.create('iron', 7).id, ArtItems.create('iron', 7).id);
  assert.notStrictEqual(ArtItems.create('iron', 7).id, ArtItems.create('iron', 8).id);
  assert.notStrictEqual(ArtItems.create('iron', 7).id, ArtItems.create('copper', 7).id);
  const c = cultures.of(0);
  assert.notStrictEqual(ArtBlueprints.create('station-major', c, 2).id, ArtBlueprints.tarsisStation(c).id);
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
    for (const key of Object.keys(hull.starter)) assert(slots.some((s) => s.id === key), `${id}: starter names unknown slot ${key}`);
    for (const s of Loadout.slots(Loadout.starter(id))) {
      const want = hull.starter[s.id];
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

test('Waystations carry unique registry codes', () => {
  for (const [seed, g] of galaxies) {
    const ws = g.systems.filter((s) => s.waystation);
    assert(ws.length >= 6, `seed ${seed}: only ${ws.length} Waystations`);
    for (const s of ws) assert(/^Waystation [A-Z]{2}-\d{3}$/.test(s.name), `seed ${seed}: ${s.name}`);
    assert.strictEqual(new Set(ws.map((s) => s.name)).size, ws.length, `seed ${seed}: duplicate codes`);
    assert(!g.factions.some((f) => /freeport/i.test(f.name)), 'a faction is still called Freeports');
  }
});

test('frontier start: the same galaxy plus a lone Waystation by the edge', () => {
  const kinds = new Set();
  for (const seed of SEEDS) {
    const core = galaxies.get(seed);
    const fr = Galaxy.generate(seed, { ...GALAXY_CONFIG, start: 'frontier' });
    assert.strictEqual(core.start, 'core');
    assert.strictEqual(core.systems[core.startSystem].capital, true);
    assert.strictEqual(fr.start, 'frontier');
    // Everything from the core galaxy is there, unchanged; the start Waystation comes last.
    assert.strictEqual(fr.systems.length, core.systems.length + 1);
    assert.strictEqual(JSON.stringify(fr.systems.slice(0, -1)), JSON.stringify(core.systems), `seed ${seed}: systems differ`);
    assert.strictEqual(JSON.stringify(fr.outposts), JSON.stringify(core.outposts));
    assert.strictEqual(JSON.stringify(fr.routes), JSON.stringify(core.routes));
    const s = fr.systems[fr.startSystem];
    assert(s.waystation && s.start && s.id === fr.systems.length - 1, `seed ${seed}: start is not the extra Waystation`);
    assert(/^Waystation [A-Z]{2}-\d{3}$/.test(s.name));
    const edge = Math.min(s.x, s.y, fr.size - 1 - s.x, fr.size - 1 - s.y);
    assert(edge >= 1 && edge <= 6 && fr.inFrontier(s.x, s.y), `seed ${seed}: start at ${s.x},${s.y}`);
    assert(!fr.routes.some((r) => r.a === s.id || r.b === s.id), 'the frontier start has a route');
    assert(!core.systems.some((o) => o.x === s.x && o.y === s.y) && !core.outposts.some((o) => o.x === s.x && o.y === s.y));
    assert.notStrictEqual(Galaxy.saveKey(fr), Galaxy.saveKey(core));
    const corner = Math.min(s.x, fr.size - 1 - s.x) <= 6 && Math.min(s.y, fr.size - 1 - s.y) <= 6;
    kinds.add(corner ? 'corner' : 'edge');
    // Nothing hostile waits next door.
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const c = fr.deepSector(s.x + dx, s.y + dy);
      assert(!c || !c.hostile, `seed ${seed}: hostile contact next to the start`);
    }
  }
  assert.deepStrictEqual([...kinds].sort(), ['corner', 'edge'], 'starts should land in corners and along edges');
  // Asking for the core style, or nothing, gives the same galaxy.
  const a = Galaxy.generate(3, { ...GALAXY_CONFIG, start: 'core' }), b = galaxies.get(3);
  assert.strictEqual(JSON.stringify(a.systems), JSON.stringify(b.systems));
  assert.strictEqual(Galaxy.saveKey(a), Galaxy.saveKey(b));
});

test('frontier start: only the start Waystation is charted, and no raiders wait nearby', () => {
  for (const seed of SEEDS.slice(0, 10)) {
    const g = Galaxy.generate(seed, { ...GALAXY_CONFIG, start: 'frontier' });
    const s = g.systems[g.startSystem];
    const k = Knowledge.create(g, { fresh: true });
    assert.strictEqual(k.counts().systems, 1);
    assert.strictEqual(k.counts().routes, 0);
    assert(k.knowsSystem(s.id));
    const territorial = g.factions.filter((f) => f.kind !== 'network');
    assert(territorial.every((f) => !k.knowsFaction(f.id)), `seed ${seed}: a faction is charted from the start`);
    let explored = 0;
    for (let y = 0; y < g.size; y++) for (let x = 0; x < g.size; x++) explored += k.isExplored(x, y) ? 1 : 0;
    assert(explored <= 1, `seed ${seed}: ${explored} sectors charted`);
    k.save();
    const sectors = Sectors.create(g, ArtCulture.forGalaxy(g), g.sectorUnits);
    const pirates = g.factions.find((f) => f.key === 'pirates').id;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const sec = sectors.at(s.x + dx, s.y + dy);
      if (sec) assert(!sec.entities.some((e) => e.kind === 'ship' && e.faction === pirates), `seed ${seed}: pirates next to the start`);
    }
    assert(sectors.at(s.x, s.y).entities.some((e) => e.kind === 'station' && e.name === s.name), 'no station at the start');
  }
});

// Perceived colour difference between two colours (the "redmean" weighted RGB distance, 0..~765).
function colourDistance(a, b) {
  const [r1, g1, b1] = ctx.ArtUtil.hexToRgb(a), [r2, g2, b2] = ctx.ArtUtil.hexToRgb(b);
  const rm = (r1 + r2) / 2;
  return Math.sqrt((2 + rm / 256) * (r1 - r2) ** 2 + 4 * (g1 - g2) ** 2 + (2 + (255 - rm) / 256) * (b1 - b2) ** 2);
}

test('the item catalogue: categories, rarity tiers and prices', () => {
  const ids = new Set();
  for (const [cat, info] of Object.entries(Goods.CATEGORIES)) {
    const list = Goods.ofCategory(cat);
    assert(list.length >= 5, `${cat}: only ${list.length} types`);
    const levels = list.map((t) => t.rarity);
    assert.deepStrictEqual(levels, [...levels].sort((a, b) => a - b), `${cat}: not listed commonest first`);
    assert.strictEqual(levels[0], 1, `${cat}: nothing common`);
    assert.strictEqual(levels[levels.length - 1], 5, `${cat}: nothing exotic`);
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
  // Picks by rarity, for one category with every level.
  const counts = [0, 0, 0, 0, 0, 0];
  const r = ctx.mulberry32(99);
  for (let i = 0; i < 20000; i++) counts[Goods.type(Goods.pick(r, 'metal')).rarity]++;
  for (let l = 1; l < 5; l++) assert(counts[l] > counts[l + 1], `picks: level ${l} ${counts[l]} vs ${l + 1} ${counts[l + 1]}`);
  assert(counts[5] > 0, 'no exotic ever picked');
  // Floating items across a galaxy.
  const g = galaxies.get(1);
  const sectors = Sectors.create(g, ArtCulture.forGalaxy(g), g.sectorUnits);
  const found = [0, 0, 0, 0, 0, 0];
  for (let y = 0; y < g.size; y++) for (let x = 0; x < g.size; x++) {
    for (const e of sectors.at(x, y).entities) if (e.kind === 'item') found[Goods.type(e.itemKind).rarity]++;
  }
  for (let l = 1; l < 4; l++) assert(found[l] > found[l + 1], `floating items: ${found.join('/')}`);
  // What stations stock.
  const stocked = [0, 0, 0, 0, 0, 0];
  for (const st of stationsOf(g)) for (const x of Economy.market(g.seed, st).goods) if (x.buy !== null) stocked[x.rarity]++;
  for (let l = 1; l < 4; l++) assert(stocked[l] > stocked[l + 1], `stock: ${stocked.join('/')}`);
  assert.strictEqual(stocked[5], 0, 'exotics are found, never sold');
});

test('old saves: item categories and labels become item types', () => {
  assert.strictEqual(Goods.resolve('metal'), 'iron');
  assert.strictEqual(Goods.resolve('gas'), 'hydrogen');
  assert.strictEqual(Goods.resolve('hull'), 'hull-simple');
  assert.strictEqual(Goods.resolve(undefined, 'Railgun barrel'), 'weapon-simple');
  assert.strictEqual(Goods.resolve(undefined, 'Ore crystals'), 'quartz');
  assert.strictEqual(Goods.resolve('gold'), 'gold');
  assert.strictEqual(Goods.resolve('unobtainium'), null);
  for (const cat of Object.keys(Goods.CATEGORIES)) assert.strictEqual(Goods.type(Goods.resolve(cat)).rarity, 1);
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
  assert.strictEqual(Combat.hitChance({ stats: { accuracy: 0.2 } }, { stats: { evasion: 0.9 } }), Combat.config.minHit);
  assert.strictEqual(Combat.hitChance({ stats: { accuracy: 2 } }, { stats: { evasion: 0 } }), Combat.config.maxHit);
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
  assert.deepStrictEqual(ev[ev.length - 1], { flee: false });
  assert.strictEqual(s.fleeing, true, 'a failed attempt keeps trying next round');
  assert.strictEqual(Combat.fleeChance(s), Combat.config.fleeBase);
  s.player.stats.maxSpeed = 5000;
  assert.strictEqual(Combat.fleeChance(s), Combat.config.fleeMax);
});

test('destroyed ships leave sellable loot', () => {
  const g = galaxies.get(1);
  let fighterDrops = 0;
  for (let i = 0; i < 300; i++) {
    const f = Combat.loot(g.seed, `x,y,s${i}`, 'fighter');
    assert.deepStrictEqual(Combat.loot(g.seed, `x,y,s${i}`, 'fighter'), f, 'loot is not deterministic');
    for (const d of f) assert(Goods.isSalvage(d.kind), `fighter dropped ${d.kind}`);
    fighterDrops += f.length;
    const fr = Combat.loot(g.seed, `x,y,s${i}`, 'freighter');
    assert(fr.length >= 1);
    for (const d of fr) assert(Goods.type(d.kind), `freighter dropped ${d.kind}`);
  }
  assert(fighterDrops > 120 && fighterDrops < 240, `fighters dropped ${fighterDrops} of 300`);
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
  assert.strictEqual(RealtimeCombat.hitChance(a, w, t), RealtimeCombat.config.minHit);
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
