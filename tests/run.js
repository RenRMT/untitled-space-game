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
load('rng.js', ['hashInt', 'mulberry32', 'seedToInt', 'weightedPick']);
load('data/galaxy-config.js', ['GALAXY_CONFIG']);
load('galaxy.js', ['Galaxy']);
load('art/util.js', ['ArtUtil']);
load('art/culture.js', ['ArtCulture']);
load('art/blueprints.js', ['ArtBlueprints']);
load('art/items.js', ['ArtItems']);
load('sector.js', ['Sectors']);
load('travel.js', ['Travel']);
load('knowledge.js', ['Knowledge']);
load('economy.js', ['Economy']);
load('mining.js', ['Mining']);
load('loadout.js', ['Loadout']);
load('combat.js', ['Combat']);
const { Galaxy, Sectors, ArtCulture, Travel, Knowledge, Economy, Mining, Loadout, Combat, GALAXY_CONFIG } = ctx;

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
    assert.strictEqual(m.goods.length, Object.keys(Economy.GOODS).length);
    assert(m.goods.filter((x) => x.buy !== null).length >= Economy.config.minForSale, `${st.name} sells too little`);
    for (const x of m.goods) {
      assert(Number.isInteger(x.sell) && x.sell > 0, `${st.name}: bad sell price for ${x.kind}`);
      // Buying and selling back at the same station never makes money.
      if (x.buy !== null) assert(x.buy > x.sell, `${st.name}: ${x.kind} buy ${x.buy} <= sell ${x.sell}`);
      if (x.produced) assert(x.buy !== null, `${st.name}: produces ${x.kind} but doesn't sell it`);
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

test('mined asteroids drop only metal or mineral, at the configured rates', () => {
  const g = galaxies.get(1);
  const byType = {};
  for (const e of asteroidsOf(g)) {
    const y = Mining.yieldOf(g.seed, e);
    assert.deepStrictEqual(Mining.yieldOf(g.seed, e), y, 'yield is not deterministic');
    if (y) {
      assert(['metal', 'mineral'].includes(y.kind), `unexpected drop ${y.kind}`);
      assert(Economy.GOODS[y.kind], `${y.kind} is not a trade good`);
      assert(Number.isInteger(y.seed));
    }
    const t = (byType[e.ast.type] ||= { n: 0, drops: 0, metal: 0 });
    t.n++;
    if (y) { t.drops++; if (y.kind === 'metal') t.metal++; }
  }
  for (const [type, t] of Object.entries(byType)) {
    assert(Mining.YIELD[type], `no yield table for ${type} asteroids`);
    if (t.n < 100) continue;
    const rate = t.drops / t.n;
    assert(Math.abs(rate - Mining.YIELD[type].chance) < 0.1, `${type}: drop rate ${rate.toFixed(2)}`);
  }
  if (byType.metal?.drops) assert(byType.metal.metal / byType.metal.drops > 0.6, 'metallic asteroids should mostly give metal');
  if (byType.ice?.drops) assert.strictEqual(byType.ice.metal, 0, 'icy asteroids give no metal');
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
    for (const d of f) assert(Economy.SALVAGE[d.kind], `fighter dropped ${d.kind}`);
    fighterDrops += f.length;
    const fr = Combat.loot(g.seed, `x,y,s${i}`, 'freighter');
    assert(fr.length >= 1);
    for (const d of fr) assert(Economy.GOODS[d.kind] || Economy.SALVAGE[d.kind], `freighter dropped ${d.kind}`);
  }
  assert(fighterDrops > 120 && fighterDrops < 240, `fighters dropped ${fighterDrops} of 300`);
});

if (failed) {
  console.log(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log('\nall tests passed');
