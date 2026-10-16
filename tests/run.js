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
load('security.js', ['Security']);
load('data/system-config.js', ['SYSTEM_CONFIG']);
load('solar-system.js', ['SolarSystem']);
load('galaxy.js', ['Galaxy']);
load('art/util.js', ['ArtUtil']);
load('art/culture.js', ['ArtCulture']);
load('art/blueprints.js', ['ArtBlueprints']);
load('art/items.js', ['ArtItems']);
load('art/sprite-cache.js', ['SpriteCache']);
load('entities.js', ['Entities']);
load('scene.js', ['Scene']);
load('interactions.js', ['Interactions']);
load('travel.js', ['Travel']);
load('knowledge.js', ['Knowledge']);
load('economy.js', ['Economy']);
load('mining.js', ['Mining']);
load('loadout.js', ['Loadout']);
load('logic.js', ['Logic']);
load('squad.js', ['Squad']);
load('research.js', ['Research']);
load('combat-core.js', ['CombatCore']);
load('combat.js', ['Combat']);
load('flight.js', ['Flight']);
load('combat-realtime.js', ['RealtimeCombat']);
load('intro.js', ['Intro']);
load('missions.js', ['Missions']);
const { Missions, Intro, Logic, Squad, SolarSystem, Galaxy, Scene, ArtCulture, ArtItems, Travel, Knowledge, Economy, Mining, Loadout, Combat, Goods, SYSTEM_CONFIG, Flight, RealtimeCombat, SpriteCache, ArtBlueprints, Entities, Interactions, CombatCore } = ctx;

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
const galaxies = new Map(SEEDS.map((s) => [s, Galaxy.generate(s, SYSTEM_CONFIG)]));
// A full-size system as the generator makes one from each seed on its own (the galaxy's first
// system is the small tutorial system: see its own test), and each galaxy's second, smaller one.
const systems = new Map(SEEDS.map((seed) => [seed, SolarSystem.generate(seed, { params: SYSTEM_CONFIG.params })]));
const tutorials = new Map([...galaxies].map(([seed, g]) => [seed, g.systems[0]]));
const outer = new Map([...galaxies].map(([seed, g]) => [seed, g.systems[1]]));
// The flight view's scene of a galaxy, built once per seed.
const scenes = new Map();
const sceneOf = (seed) => {
  if (!scenes.has(seed)) { const g = galaxies.get(seed); scenes.set(seed, Scene.create(g, ArtCulture.forGalaxy(g))); }
  return scenes.get(seed);
};
const thingsOf = (seed, kind) => sceneOf(seed).entities.filter((e) => e.kind === kind);
// What art/render.js can draw.
const STAR_CLASSES = ['M', 'K', 'G', 'A', 'B'];
const PLANET_TYPES = ['blue', 'terran', 'desert', 'ice', 'gas', 'lava'];
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
// The layout as data, without the lookup functions.
const layout = (s) => JSON.stringify(s, (k, v) => (typeof v === 'function' ? undefined : v));

// ---------- The solar system ----------

test('generation is deterministic', () => {
  for (const seed of [1, 'abc']) assert.strictEqual(layout(SolarSystem.generate(seed, SYSTEM_CONFIG)), layout(SolarSystem.generate(seed, SYSTEM_CONFIG)));
  for (const seed of [1, 'abc']) assert.strictEqual(layout(Galaxy.generate(seed, SYSTEM_CONFIG).systems), layout(Galaxy.generate(seed, SYSTEM_CONFIG).systems));
  assert.notStrictEqual(layout(systems.get(1)), layout(systems.get(2)));
});

// ---------- The galaxy ----------

test('two systems far apart, the first the tutorial, the second half the usual size, joined by a pair of gates', () => {
  const gap = Galaxy.params.gap;
  // About five minutes' flight between the edges at the starter Courier's top speed.
  assert(Math.abs(gap / Loadout.stats(Loadout.starter('courier')).maxSpeed - 300) < 1, `gap ${gap}`);
  for (const [seed, g] of galaxies) {
    const where = `seed ${seed}`;
    const [a, b] = g.systems;
    assert.strictEqual(g.systems.length, 2, where);
    assert.deepStrictEqual([a.origin.x, a.origin.y, a.star.x, a.star.y], [0, 0, 0, 0], `${where}: the first system is at the origin`);
    assert.strictEqual(b.radius, SolarSystem.params.radius / 2, `${where}: the second is half the usual size`);
    assert(Math.abs(dist(a.origin, b.origin) - a.radius - b.radius - gap) < 1e-6, `${where}: systems ${dist(a.origin, b.origin)} apart`);
    assert.strictEqual(g.systemAt(b.star.x, b.star.y), b);
    const mid = { x: (a.origin.x + b.origin.x) / 2, y: (a.origin.y + b.origin.y) / 2 };
    assert.strictEqual(g.systemAt(mid.x, mid.y), null, `${where}: deep space between them`);
    assert.strictEqual(g.securityAt(mid.x, mid.y), 0);
    // One gate each, linked to the other, in the outer system toward the other system.
    assert.strictEqual(g.gates.length, 2, `${where}: gates`);
    for (const gate of g.gates) {
      const home = g.systems[gate.system], there = g.gates[gate.link];
      assert(there.link === gate.id && there.system === gate.to && gate.system === there.to, `${where}: gate link`);
      const d = dist(gate, home.origin) / home.radius;
      assert(d > 0.6 && d < 0.9, `${where}: ${gate.name} at ${d.toFixed(2)} of the radius`);
      const toward = Math.atan2(g.systems[gate.to].origin.y - home.origin.y, g.systems[gate.to].origin.x - home.origin.x);
      const at = Math.atan2(gate.y - home.origin.y, gate.x - home.origin.x);
      assert(Math.cos(at - toward) > 0.5, `${where}: ${gate.name} is not on the side it leads to`);
      assert.strictEqual(gate.name, `${g.systems[gate.to].name} Gate`);
      for (const st of home.stations) assert(dist(st, gate) > 2000, `${where}: ${gate.name} by ${st.name}`);
      for (const k of home.packs) assert(dist(k, gate) > Security.PACK.clear, `${where}: pirates at ${gate.name}`);
    }
    // The second system: everything inside its edge, a capital and some stations to dock at.
    for (const o of [...b.planets, ...b.stations, ...b.asteroids, ...b.wrecks]) assert(dist(o, b.origin) < b.radius, `${where}: ${o.name || o.key} outside the second system`);
    for (const p of b.planets) assert(Math.abs(dist(p, b.origin) - p.orbit) < 1e-6, `${where}: ${p.name} is off its orbit`);
    assert(b.planets.length >= 2 && b.stations.length >= 3, `${where}: ${b.planets.length} planets, ${b.stations.length} stations`);
    assert.strictEqual(b.stations.filter((x) => x.market.type === 'capital').length, 1, `${where}: one capital`);
    for (const st of b.stations) assert.strictEqual(g.securityAt(st.x, st.y), 3, `${where}: ${st.name} is not high security`);
    // Lists together, every id an index into them, every reference to the right system.
    for (const k of ['planets', 'moons', 'stations', 'packs', 'gates']) g[k].forEach((o, i) => assert.strictEqual(o.id, i, `${where}: ${k} ${i}`));
    for (const m of b.moons) assert(g.planets[m.parent].moons.includes(m.id) && g.planets[m.parent].system === 1, `${where}: moon ${m.name}'s planet`);
    for (const st of b.stations) if (st.planet !== undefined) assert.strictEqual(g.planets[st.planet].system, 1, `${where}: ${st.name}'s planet`);
    for (const c of b.contacts) if (c.pack !== undefined) assert.strictEqual(g.packs[c.pack].system, 1, `${where}: ${c.id}'s pack`);
    assert.strictEqual(g.stations.length, a.stations.length + b.stations.length);
  }
});

test('the first system is the tutorial: one planet, a belt, a nebula, the waystation and the gate across from it, and no pirates', () => {
  for (const [seed, s] of tutorials) {
    const where = `seed ${seed}`, g = galaxies.get(seed);
    assert.strictEqual(s.planets.length, 1, `${where}: planets`);
    assert.strictEqual(s.belts.length, 1, `${where}: belts`);
    assert.strictEqual(s.belts[0].kind, 'main');
    assert.strictEqual(s.nebulae.length, 1, `${where}: nebulae`);
    assert.strictEqual(s.fields.length, 0, `${where}: free fields`);
    assert.deepStrictEqual(s.stations.map((st) => st.name), ['Waystation HD-1863'], `${where}: stations`);
    assert.strictEqual(g.stations[g.startStation], s.stations[0], `${where}: the game starts at the waystation`);
    assert.deepStrictEqual([s.packs.length, s.contacts.length, s.wrecks.length], [0, 0, 0], `${where}: no pirates, derelicts or wrecks`);
    assert(s.asteroids.length > 100, `${where}: only ${s.asteroids.length} asteroids in the belt`);
    assert(s.radius < SolarSystem.params.radius / 2, `${where}: radius ${s.radius}`);
    // The waystation on one edge, the gate on the other.
    const [gate] = s.gates, W = s.stations[0], O = s.origin;
    const at = (o) => Math.atan2(o.y - O.y, o.x - O.x);
    assert(Math.cos(at(W) - at(gate)) < -0.7, `${where}: the waystation isn't across from the gate`);
    assert(dist(W, O) / s.radius > 0.85, `${where}: the waystation isn't on the edge`);
    assert(dist(gate, O) / s.radius > 0.7, `${where}: the gate isn't on the edge`);
    assert(dist(W, s.nebulae[0]) > s.nebulae[0].r + 6000, `${where}: the nebula crowds the waystation`);
    // Safe throughout: high security, medium in the nebula only if anywhere.
    for (let i = 0; i < 200; i++) {
      const a = i * 2.39996, d = Math.sqrt(i / 200) * s.radius, x = O.x + Math.cos(a) * d, y = O.y + Math.sin(a) * d;
      assert(s.securityAt(x, y) >= 2, `${where}: security ${s.securityAt(x, y)} at ${x.toFixed(0)},${y.toFixed(0)}`);
    }
    assert(g.pockets.filter((q) => q.system === 0).length >= 3, `${where}: gas pockets`);
  }
});

test('a star, planets on widening orbits, belts, fields and nebulae, all inside the edge', () => {
  for (const [seed, s] of systems) {
    const where = `seed ${seed}`;
    assert(s.star.r > 0 && STAR_CLASSES.includes(s.star.cls), `${where}: star`);
    assert(s.planets.length >= 4, `${where}: only ${s.planets.length} planets`);
    for (let i = 1; i < s.planets.length; i++) assert(s.planets[i].orbit > s.planets[i - 1].orbit, `${where}: orbits out of order`);
    for (const p of s.planets) {
      assert(PLANET_TYPES.includes(p.type), `${where}: planet type ${p.type}`);
      assert(Math.abs(Math.hypot(p.x, p.y) - p.orbit) < 1e-6, `${where}: ${p.name} is off its orbit`);
      assert(p.orbit + p.extent < s.radius, `${where}: ${p.name} reaches past the edge`);
      assert(p.orbit - p.extent > s.star.reach, `${where}: ${p.name} is inside the star's glow`);
    }
    // Neighbouring planets (with their moons) and the belts keep apart.
    const rings = [...s.planets.map((p) => [p.orbit, p.extent, p.name]), ...s.belts.map((b) => [b.r, b.width / 2, b.name])].sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < rings.length; i++) assert(rings[i][0] - rings[i][1] > rings[i - 1][0] + rings[i - 1][1], `${where}: ${rings[i - 1][2]} and ${rings[i][2]} overlap`);
    for (const m of s.moons) {
      const p = s.planets[m.parent];
      assert(p.moons.includes(m.id) && dist(m, p) > p.body + m.r, `${where}: moon ${m.name}`);
    }
    assert(s.belts[0].kind === 'main' && s.belts.length <= 2, `${where}: belts`);
    assert(s.nebulae.length >= 1, `${where}: no nebula`);
    for (const n of s.nebulae) {
      assert(Math.hypot(n.x, n.y) + n.r < s.radius, `${where}: ${n.name} reaches past the edge`);
      for (const b of n.blobs) assert(Math.hypot(b.dx, b.dy) + b.r <= n.r + 1e-6, `${where}: a blob of ${n.name} sticks out`);
      assert.strictEqual(s.nebulaAt(n.x + n.blobs[0].dx, n.y + n.blobs[0].dy), n);
    }
    assert.strictEqual(s.nebulaAt(0, 0), null);
    for (const a of s.asteroids) assert(Math.hypot(a.x, a.y) < s.radius, `${where}: asteroid ${a.key} outside`);
  }
});

test('stations orbit planets in all three cultures, with bases out in space; the start is the capital', () => {
  for (const [seed, s] of systems) {
    const where = `seed ${seed}`;
    const types = s.stations.map((x) => x.market.type);
    assert.strictEqual(types.filter((t) => t === 'capital').length, 1, `${where}: one capital`);
    assert.strictEqual(s.stations[s.startStation].market.type, 'capital');
    assert(types.includes('major') && types.includes('mining camp'), `${where}: stations ${types}`);
    assert(s.stations.length >= 5, `${where}: only ${s.stations.length} stations`);
    assert.deepStrictEqual(s.cultures.map((c) => c.lineage), ['wedge', 'block', 'shard', 'android']);
    // The three settled (human) cultures; only the tutorial system's waystation is android.
    for (const c of s.cultures.filter((x) => x.id < SolarSystem.SETTLED)) assert(s.stations.some((x) => x.culture === c.id), `${where}: no ${c.name} stations`);
    assert.strictEqual(new Set(s.stations.map((x) => x.key)).size, s.stations.length, `${where}: station keys`);
    for (const st of s.stations) {
      if (st.market.kind === 'system') {
        const p = s.planets[st.planet];
        assert(dist(st, p) > p.body + st.reach && dist(st, p) < p.body + st.reach + 500, `${where}: ${st.name} isn't beside ${p.name}`);
      } else assert.strictEqual(st.planet, undefined);
      for (const p of s.planets) if (p.id !== st.planet) assert(dist(st, p) > p.extent + st.reach, `${where}: ${st.name} inside ${p.name}`);
      for (const m of s.moons) assert(dist(st, m) > m.r + st.reach, `${where}: ${st.name} on ${m.name}`);
      for (const a of s.asteroids) assert(dist(st, a) > st.reach + 100, `${where}: an asteroid under ${st.name}`);
      // A mining camp lives among rocks.
      if (st.market.type === 'mining camp') assert(s.asteroids.filter((a) => dist(a, st) < 1600).length >= 15, `${where}: ${st.name} has no rocks`);
      assert.strictEqual(s.securityAt(st.x, st.y), 3, `${where}: ${st.name} is not high security`);
    }
  }
});

test('the scene builds every system, filing everything where near() finds it', () => {
  for (const seed of [1, 2, 3, 'abc']) {
    const sc = sceneOf(seed), s = galaxies.get(seed);
    assert.strictEqual(thingsOf(seed, 'station').length, s.stations.length);
    assert.strictEqual(thingsOf(seed, 'asteroid').length, s.asteroids.length);
    assert.strictEqual(thingsOf(seed, 'planet').length, s.planets.length);
    assert.strictEqual(thingsOf(seed, 'moon').length, s.moons.length);
    assert.strictEqual(thingsOf(seed, 'star').length, 2);
    assert.strictEqual(thingsOf(seed, 'gate').length, s.gates.length);
    assert.strictEqual(thingsOf(seed, 'nebula').length, s.nebulae.length);
    assert.strictEqual(thingsOf(seed, 'ship').length, s.packs.reduce((n, k) => n + k.ships.length, 0));
    // Whatever is within range of a point (by where it is or circles) is among what near() returns.
    const r = mulberry32(5);
    for (let i = 0; i < 30; i++) {
      const home = s.systems[i % 2];
      const at = { x: home.origin.x + (r() - 0.5) * home.radius * 1.6, y: home.origin.y + (r() - 0.5) * home.radius * 1.6 }, range = 3000 + r() * 9000;
      const found = new Set(sc.near(at.x, at.y, range));
      for (const e of sc.entities) {
        const c = e.motion ? { x: e.motion.cx, y: e.motion.cy } : e;
        if (dist(c, at) - (e.motion ? e.motion.r : 0) - e.radius <= range) assert(found.has(e), `seed ${seed}: near() missed a ${e.kind}`);
      }
      assert(found.size < sc.entities.length, 'near() returns everything');
    }
  }
});

test('save keys differ between systems and galaxies and include the generator versions', () => {
  const keys = new Set([...systems.values()].map((s) => SolarSystem.saveKey(s)));
  assert.strictEqual(keys.size, systems.size);
  assert(SolarSystem.saveKey(systems.get(1)).endsWith(`:v${SolarSystem.VERSION}`));
  const gkeys = new Set([...galaxies.values()].map((g) => Galaxy.saveKey(g)));
  assert.strictEqual(gkeys.size, galaxies.size);
  assert(Galaxy.saveKey(galaxies.get(1)).endsWith(`:g${Galaxy.VERSION}`));
});

test('contacts: derelicts are hidden wrecks away from the stations; ambushes are packs lying in wait', () => {
  const seen = new Set();
  for (const [seed, s] of systems) {
    const where = `seed ${seed}`;
    assert.strictEqual(new Set(s.contacts.map((c) => c.id)).size, s.contacts.length, `${where}: contact ids`);
    for (const c of s.contacts) {
      const t = SolarSystem.CONTACT_TYPES[c.type];
      assert(t && t.label && t.name && t.prompt && t.color, `contact type ${c.type}`);
      assert.strictEqual(c.hostile, !!t.hostile, c.type);
      seen.add(c.type);
      const wrecks = s.wrecks.filter((w) => w.contact === c.id);
      assert(wrecks.length >= 1, `${where}: ${c.type} ${c.id} has no wreck`);
      for (const w of wrecks) assert(dist(w, c) <= c.r, `${where}: a wreck of ${c.id} lies outside its reach`);
      if (c.type === 'derelict') {
        assert(s.securityAt(c.x, c.y) < 3, `${where}: a derelict in high security`);
        for (const st of s.stations) assert(dist(st, c) >= 4000, `${where}: a derelict by ${st.name}`);
      } else {
        const k = s.packs[c.pack];
        assert(k && k.ambush && dist(k, c) < 1e-6, `${where}: ambush ${c.id} without its pack`);
      }
    }
    // Every nebula hides an ambush.
    for (const n of s.nebulae) assert(s.contacts.some((c) => c.type === 'ambush' && s.nebulaAt(c.x, c.y) === n), `${where}: no ambush in ${n.name}`);
    assert(s.contacts.filter((c) => c.type === 'derelict').length >= 4, `${where}: few derelicts`);
  }
  for (const type of Object.keys(SolarSystem.CONTACT_TYPES)) assert(seen.has(type), `no ${type} rolled`);
});

// ---------- Map travel and sensors ----------

const knowsNothing = () => ({ pass() {}, contactState: () => null });

test('map travel meets the contacts on its route in order, and an ambush interdicts it', () => {
  const system = {
    contacts: [
      { id: 'd1', type: 'derelict', x: 20000, y: 3000, r: 700, hostile: false },
      { id: 'a1', type: 'ambush', x: 40000, y: -1000, r: 900, hostile: true },
      { id: 'd2', type: 'derelict', x: 10000, y: -30000, r: 700, hostile: false }, // far off the route
      { id: 'd3', type: 'derelict', x: 30000, y: 0, r: 700, hostile: false },
    ],
  };
  const met = Travel.encounters(system, { x: 0, y: 0 }, { x: 60000, y: 0 }, { pingRange: 5000 });
  assert.deepStrictEqual(met.map((m) => m.contact.id), ['d1', 'd3', 'a1']);
  assert.deepStrictEqual(met.map((m) => m.kind), ['signal', 'signal', 'interdict']);
  // d1 is first within 5700 of the route where x = 20000 - sqrt(5700² - 3000²).
  assert(Math.abs(met[0].t - (20000 - Math.sqrt(5700 ** 2 - 3000 ** 2))) < 1e-6);
  // A cleared ambush, and the destination's own contact, are left out.
  const quiet = Travel.encounters(system, { x: 0, y: 0 }, { x: 60000, y: 0 }, { pingRange: 5000, cleared: (c) => c.id === 'a1', destId: 'd3' });
  assert.deepStrictEqual(quiet.map((m) => m.contact.id), ['d1']);
  // A trip: the first unidentified signal pauses it; ignoring goes on to the ambush.
  const pinged = [];
  const trip = Travel.create(system, { pass: (x, y) => pinged.push([x, y]), contactState: () => null }, { pingRange: () => 5000 });
  trip.start({ x: 0, y: 0 }, { kind: 'point', x: 60000, y: 0, name: '' });
  let ev = null;
  while (trip.active && !ev) ev = trip.step(0.1);
  assert.strictEqual(ev.type, 'prompt');
  assert.strictEqual(ev.prompt.contact.id, 'd1');
  assert(pinged.length === 1, 'the signal was pinged');
  trip.ignore();
  ev = null;
  while (trip.active && !ev) ev = trip.step(0.1);
  assert.strictEqual(ev.type, 'prompt');
  trip.ignore();
  ev = null;
  while (trip.active && !ev) ev = trip.step(0.1);
  assert.strictEqual(ev.type, 'interdict');
  assert.strictEqual(ev.contact.id, 'a1');
  assert(Math.abs(Math.hypot(ev.pos.x - 40000, ev.pos.y + 1000) - (900 + Travel.INTERDICT)) < 1e-6, 'interdicted at the ambush\'s reach');
  assert.strictEqual(trip.active, false);
});

test('map travel: a known derelict is passed by, and a trip from a contact leaves it behind', () => {
  const system = { contacts: [{ id: 'd1', type: 'derelict', x: 0, y: 500, r: 700, hostile: false }, { id: 'd2', type: 'derelict', x: 30000, y: 0, r: 700, hostile: false }] };
  const trip = Travel.create(system, { pass() {}, contactState: (id) => (id === 'd2' ? 'known' : null) }, { pingRange: () => 5000 });
  trip.start({ x: 0, y: 0 }, { kind: 'point', x: 50000, y: 0, name: '' });
  let ev = null;
  while (trip.active && !ev) ev = trip.step(0.1);
  assert.strictEqual(ev.type, 'arrive');
  assert(Math.abs(ev.pos.x - 50000) < 1e-6);
  // Fast-forward goes four times as fast.
  const slow = Travel.create(system, knowsNothing()), fast = Travel.create(system, knowsNothing());
  for (const t of [slow, fast]) t.start({ x: 0, y: -9000 }, { kind: 'point', x: 50000, y: -9000, name: '' });
  fast.toggleFast();
  slow.step(1); fast.step(1);
  assert(Math.abs((50000 - fast.remaining) / (50000 - slow.remaining) - Travel.config.fastForward) < 1e-9);
});

test('sensors identify contacts in range, ping those further out, and charts redraw the map', () => {
  const s = galaxies.get(1);
  const k = Knowledge.create(s, { fresh: true });
  const c = s.contacts.find((x) => x.type === 'derelict');
  assert.strictEqual(k.contactState(c.id), null);
  // From further than the sensors but within ping range: a signal.
  const at = (d) => [c.x + c.r + d, c.y];
  const v = k.version;
  assert.deepStrictEqual(k.sense(...at(5000), 3000, 7000), []);
  assert.strictEqual(k.contactState(c.id), 'ping');
  assert(k.version > v, 'version did not change');
  // Within sensor range: identified, once.
  assert.deepStrictEqual(k.sense(...at(2000), 3000, 7000).map((x) => x.id), [c.id]);
  assert.strictEqual(k.contactState(c.id), 'known');
  const v2 = k.version;
  assert.deepStrictEqual(k.sense(...at(2000), 3000, 7000), []);
  assert.strictEqual(k.version, v2);
  // A coarse pass only pings.
  const other = s.contacts.find((x) => x !== c && x.type === 'derelict');
  k.pass(other.x, other.y, 100);
  assert.strictEqual(k.contactState(other.id), 'ping');
  const n = k.counts();
  assert(n.known === 1 && n.pinged >= 1 && n.total === s.contacts.length, JSON.stringify(n));

  k.save(); // also clears the pending save timer so the process can exit
});

test('systems are charted by entering them; the start system from the start', () => {
  const k = Knowledge.create(galaxies.get(1), { fresh: true });
  assert(k.visited(0) && !k.visited(1));
  const v = k.version;
  assert.strictEqual(k.visit(1), true);
  assert.strictEqual(k.visit(1), false);
  assert(k.visited(1) && k.version > v);
  k.save();
});

test('a longer-range scanner finds contacts from further away', () => {
  const s = galaxies.get(1);
  const c = s.contacts.find((x) => x.type === 'derelict');
  const range = (mk) => Loadout.EQUIPMENT[`survey-scanner-${mk}`].stats;
  for (let mk = 1; mk < 5; mk++) {
    const lo = range(mk), hi = range(mk + 1);
    assert(hi.sensorRange >= lo.sensorRange && hi.pingRange > lo.pingRange, `Mk ${mk + 1} scanner`);
  }
  const k = Knowledge.create(s, { fresh: true });
  const d = (range(1).sensorRange + range(5).sensorRange) / 2;
  k.sense(c.x + c.r + d, c.y, range(1).sensorRange, range(1).pingRange);
  assert.strictEqual(k.contactState(c.id), 'ping', 'Mk I only pings it');
  k.sense(c.x + c.r + d, c.y, range(5).sensorRange, range(5).pingRange);
  assert.strictEqual(k.contactState(c.id), 'known', 'Mk V identifies it');
  k.save();
});

// ---------- Stations, markets and asteroids ----------

// Every station of a few systems, as the flight view sees them.
const STATION_SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const stationsOf = (seed) => thingsOf(seed, 'station');

test('every station has a dockable market with sane prices', () => {
  let n = 0;
  for (const seed of STATION_SEEDS) {
    const s = systems.get(seed);
    for (const st of stationsOf(seed)) {
      n++;
      assert(st.key && st.market && st.market.type, `station ${st.name} lacks key or market`);
      const m = Economy.market(s.seed, st);
      // Every trade good has a price here (components aren't traded); the station stocks a few categories.
      assert.strictEqual(m.goods.length, Goods.categories('trade').reduce((k, c) => k + Goods.ofCategory(c).length, 0));
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
      assert.strictEqual(JSON.stringify(Economy.market(s.seed, st)), JSON.stringify(m), 'market is not deterministic');
    }
  }
  assert(n > 50, `only ${n} stations`);
});

test('every system has a profitable trade run between its stations', () => {
  for (const seed of STATION_SEEDS) {
    const s = systems.get(seed), stations = stationsOf(seed);
    const markets = stations.map((st) => Economy.market(s.seed, st));
    let best = 0;
    for (let a = 0; a < stations.length; a++) for (let b = 0; b < stations.length; b++) {
      for (const ga of markets[a].goods) {
        if (ga.buy === null) continue;
        const gb = markets[b].goods.find((x) => x.kind === ga.kind);
        best = Math.max(best, (gb.sell - ga.buy) / ga.buy);
      }
    }
    assert(best > 0.3, `seed ${seed}: best margin only ${(best * 100).toFixed(0)}%`);
  }
});

test('asteroids have unique keys that survive a rebuild', () => {
  const s = galaxies.get(1);
  const a = thingsOf(1, 'asteroid'), b = Scene.create(s, ArtCulture.forGalaxy(s)).entities.filter((e) => e.kind === 'asteroid');
  assert(a.length > 300, `only ${a.length} asteroids`);
  assert.strictEqual(new Set(a.map((e) => e.key)).size, a.length, 'duplicate asteroid keys');
  assert.deepStrictEqual(a.map((e) => [e.key, e.x, e.y]), b.map((e) => [e.key, e.x, e.y]));
});

test('mined asteroids drop metals, minerals or gases, at the configured rates', () => {
  const byType = {};
  for (const seed of [1, 2, 3, 4]) {
    const s = systems.get(seed);
    for (const e of thingsOf(seed, 'asteroid')) {
      const y = Mining.yieldOf(s.seed, e);
      assert.deepStrictEqual(Mining.yieldOf(s.seed, e), y, 'yield is not deterministic');
      if (y) {
        const cat = Goods.type(y.kind)?.category;
        assert(['metal', 'mineral', 'gas'].includes(cat), `unexpected drop ${y.kind}`);
        assert(Number.isInteger(y.seed));
      }
      const t = (byType[e.ast.type] ||= { n: 0, drops: 0, metal: 0, gas: 0 });
      t.n++;
      if (y) { t.drops++; const cat = Goods.type(y.kind).category; if (cat === 'metal') t.metal++; if (cat === 'gas') t.gas++; }
    }
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

test('art ids name what an asset is built from, so a rebuilt scene finds its sprites again', () => {
  const s = galaxies.get(1);
  const cultures = ArtCulture.forGalaxy(s);
  const x = Scene.create(s, cultures).entities.filter((e) => e.art), y = Scene.create(s, cultures).entities.filter((e) => e.art);
  assert.deepStrictEqual(x.map((e) => e.art.id), y.map((e) => e.art.id), 'rebuilt with other ids');
  const seen = new Map(); // art id -> a fingerprint of the blueprint
  const print = (bp) => `${bp.type}|${bp.parts.length}|${bp.radius.toFixed(3)}|${bp.label}`;
  x.forEach((e, i) => {
    assert.notStrictEqual(e.art, y[i].art, 'a rebuild makes new blueprints');
    // Two blueprints may share an id only if they are the same asset.
    if (seen.has(e.art.id)) assert.strictEqual(seen.get(e.art.id), print(e.art), e.art.id);
    else seen.set(e.art.id, print(e.art));
  });
  assert.ok(seen.size > s.stations.length, `${seen.size} distinct assets`);
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
  let n = 0;
  for (const e of thingsOf(1, 'item')) {
    n++;
    assert.strictEqual(e.label, Goods.type(e.itemKind).name);
    assert.strictEqual(e.art.kind, e.itemKind);
    assert.ok(e.art.id.startsWith(`item:${e.itemKind}:`));
    assert.ok(Number.isFinite(e.angle) && Number.isFinite(e.tumble) && Number.isFinite(e.x));
  }
  assert.ok(n > 10, `${n} items`);
  const d = Entities.item({ key: 'k', kind: 'platinum', seed: 3, x: 5, y: 6, angle: 1, tumble: 0.1 });
  assert.deepStrictEqual([d.kind, d.label, d.category, d.itemKind, d.x, d.y], ['item', 'Platinum', 'trade', 'platinum', 5, 6]);
});

test('keys are unique across everything that can leave the world, and survive a rebuild', () => {
  for (const seed of [1, 2, 'abc']) {
    const keyed = sceneOf(seed).entities.filter((e) => e.key);
    assert.strictEqual(new Set(keyed.map((e) => e.key)).size, keyed.length, `seed ${seed}: duplicate keys`);
  }
  const s = galaxies.get(1);
  const a = thingsOf(1, 'ship'), b = Scene.create(s, ArtCulture.forGalaxy(s)).entities.filter((e) => e.kind === 'ship');
  assert(a.length > 15, `only ${a.length} ships`);
  assert(a.every((e) => e.role === 'fighter' || e.role === 'freighter'), 'ship without a role');
  assert.deepStrictEqual(a.map((e) => [e.key, e.role]), b.map((e) => [e.key, e.role]));
});

test('gas pockets: a few inside every nebula, clear of its ambush, keyed for good, and the rest of the system unchanged', () => {
  for (const [seed, g] of galaxies) {
    const where = `seed ${seed}`;
    for (const [i, n] of g.nebulae.entries()) {
      const own = g.pockets.filter((q) => q.nebula === i);
      assert(own.length >= SolarSystem.params.gas.count[0], `${where}: ${n.name} has ${own.length} pockets`);
      for (const q of own) {
        assert.strictEqual(g.nebulaAt(q.x, q.y), n, `${where}: ${q.key} outside its nebula`);
        assert.strictEqual(q.type, n.type);
        for (const k of g.packs) assert(dist(k, q) >= SolarSystem.params.gas.clear, `${where}: ${q.key} in an ambush`);
      }
    }
    const keys = g.pockets.map((q) => q.key);
    assert.strictEqual(new Set(keys).size, keys.length, `${where}: duplicate pocket keys`);
    assert.deepStrictEqual(Galaxy.generate(seed, SYSTEM_CONFIG).pockets, g.pockets, `${where}: the same every time`);
  }
  // In the scene, as things to collect, in their nebula's colour; each always yields gas.
  const things = thingsOf(1, 'gas'), g = galaxies.get(1);
  assert.strictEqual(things.length, g.pockets.length);
  for (const e of things) {
    assert.strictEqual(e.color, g.nebulae[e.pocket.nebula].color);
    assert.ok(e.art.id.startsWith('gas-pocket:') && e.radius > 30);
    const gas = Mining.gasOf(g.seed, e);
    assert(gas.length >= 1 && gas.length <= 3, `${gas.length} units`);
    assert(gas.every((x) => Goods.type(x.kind).category === 'gas'), 'gas only');
    assert.deepStrictEqual(Mining.gasOf(g.seed, e), gas, 'the same every time');
  }
  assert(Mining.duration(things[0]) > Mining.duration({ kind: 'asteroid' }), 'slower than mining');
  // E mines an asteroid or collects gas: both actions share the key, in order.
  const A = Interactions.create({ gap: () => 0, speed: () => 0 });
  A.add({ id: 'mine', kind: 'asteroid', verb: 'Mine', key: 'e', range: 100, run() {} });
  A.add({ id: 'collect', kind: 'gas', verb: 'Collect', key: 'e', range: 100, run() {} });
  assert.deepStrictEqual(A.forKeys('E').map((a) => a.id), ['mine', 'collect']);
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

test('security falls with the distance to the nearest station, a level lower in a nebula (but not by a station)', () => {
  const { high, medium, low } = SolarSystem.params.security;
  for (const [seed, s] of systems) {
    const r = mulberry32(seedToInt(seed));
    for (let i = 0; i < 400; i++) {
      const x = (r() * 2 - 1) * s.radius, y = (r() * 2 - 1) * s.radius;
      if (Math.hypot(x, y) > s.radius) continue;
      const d = s.stationDist(x, y), want = d <= high ? 3 : d <= medium ? 2 : d <= low ? 1 : 0;
      assert.strictEqual(s.securityAt(x, y), want < 3 && s.nebulaAt(x, y) ? Math.max(0, want - 1) : want, `seed ${seed} at ${x.toFixed(0)},${y.toFixed(0)}`);
    }
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
  // Floating items across a few systems.
  const found = [0, 0, 0, 0, 0, 0];
  for (const seed of STATION_SEEDS) for (const e of thingsOf(seed, 'item')) found[Goods.type(e.itemKind).rarity]++;
  assert(found[4] < found[2] && found[4] < found[3], `floating items: ${found.join('/')}`);
  // What stations stock, per type at each rarity.
  const stocked = [0, 0, 0, 0, 0, 0], types = [0, 0, 0, 0, 0, 0];
  for (const seed of STATION_SEEDS) {
    for (const st of stationsOf(seed)) {
      for (const x of Economy.market(seed, st).goods) { types[x.rarity]++; if (x.buy !== null) stocked[x.rarity]++; }
    }
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
  const g = systems.get(1);
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

test('security falls from the stations to the outer system, and sets how dangerous pirates are', () => {
  // By distance from the star: the inner system, where the stations are, is safer than the outer.
  const by = { inner: [], middle: [], outer: [] };
  for (const s of systems.values()) {
    for (let y = -s.radius; y < s.radius; y += 2000) {
      for (let x = -s.radius; x < s.radius; x += 2000) {
        const d = Math.hypot(x, y) / s.radius;
        if (d < 1) by[d < 0.35 ? 'inner' : d < 0.75 ? 'middle' : 'outer'].push(s.securityAt(x, y));
      }
    }
  }
  const mean = (a) => a.reduce((n, v) => n + v, 0) / a.length;
  assert(mean(by.inner) > mean(by.middle) && mean(by.middle) > mean(by.outer), JSON.stringify(Object.fromEntries(Object.entries(by).map(([k, v]) => [k, mean(v).toFixed(2)]))));
  assert(by.outer.filter((v) => v <= 1).length / by.outer.length > 0.6, 'the outer system is mostly low security or lawless');
  for (const l of [0, 1, 2, 3]) assert(by.inner.concat(by.middle, by.outer).includes(l), `no space at security ${l}`);
  for (let level = 0; level < 3; level++) {
    const lo = Security.pirates(level), hi = Security.pirates(level + 1);
    const max = (t) => Math.max(...t.map(([v]) => v)), min = (t) => Math.min(...t.map(([v]) => v));
    assert(lo.chance > hi.chance && max(lo.size) >= max(hi.size) && min(lo.tier) >= min(hi.tier), `pirates at ${level} vs ${level + 1}`);
    assert(Security.lootTier(level) > Security.lootTier(level + 1));
  }
});

test('pirates come in packs that follow the security level and can be fought one at a time', () => {
  const packs = [[], [], [], []]; // pack sizes, by security level
  const { orbit: [, o1] } = Security.PACK;
  // Standalone systems (not in a scene) for the numbers; the galaxies' second systems, in their
  // scenes, for the ships too.
  for (const [seed, s, scened] of [...[...systems].map(([k, v]) => [k, v, false]), ...[...outer].map(([k, v]) => [k, v, true])]) {
    const ships = new Map(scened ? thingsOf(seed, 'ship').map((e) => [e.key, e]) : []);
    const O = s.origin;
    for (const k of s.packs) {
      assert.strictEqual(k.level, s.securityAt(k.x, k.y));
      const P = Security.pirates(k.level);
      assert(k.ships.length >= 1, `seed ${seed}: an empty pack`);
      // Ambushes are one big pack on purpose; the rest follow the table for where they are.
      if (!k.ambush) {
        assert(P.tier.some(([t]) => t === k.tier), `seed ${seed}: tier ${k.tier} at security ${k.level}`);
        assert(P.size.some(([n]) => n === k.ships.length), `seed ${seed}: a pack of ${k.ships.length} at security ${k.level}`);
        packs[k.level].push(k.ships.length);
      }
      for (const m of scened ? k.ships : []) {
        const e = ships.get(m.key);
        assert(e && e.tier === k.tier && e.pack === k.id, `seed ${seed}: ${m.key} isn't in its pack`);
        assert(e.motion.r <= o1 && Math.hypot(e.motion.cx - k.x, e.motion.cy - k.y) < 1e-6);
      }
      // However they circle, members of different packs never come within groupRange of each
      // other, and no pack comes near a station, the star or a planet.
      for (const j of s.packs) if (j !== k) assert(dist(j, k) - 2 * o1 > CombatCore.config.groupRange, `seed ${seed}: packs ${j.id} and ${k.id} too close`);
      for (const st of s.stations) assert(dist(st, k) - o1 - st.reach >= Security.PACK.clear, `seed ${seed}: a pack by ${st.name}`);
      assert(dist(k, O) - o1 - s.star.reach >= Security.PACK.clear, `seed ${seed}: a pack by the star`);
      for (const p of s.planets) assert(dist(p, k) - o1 > p.extent, `seed ${seed}: a pack in ${p.name}`);
      assert(dist(k, O) + o1 < s.radius, `seed ${seed}: a pack past the edge`);
    }
  }
  const mean = (a) => a.reduce((n, v) => n + v, 0) / a.length;
  const share = (a, n) => a.filter((v) => v === n).length / a.length;
  assert(packs[0].length > 2 * systems.size && packs[1].length > 2 * systems.size, `packs per level: ${packs.map((b) => b.length)}`);
  assert(packs[2].length > packs[3].length, `packs per level: ${packs.map((b) => b.length)}`);
  assert(mean(packs[0]) > mean(packs[1]) && mean(packs[1]) > mean(packs[2]), `pack sizes: ${packs.map((b) => (b.length ? mean(b).toFixed(1) : '-'))}`);
  assert(share(packs[2], 1) > 0.6 && packs[3].every((n) => n === 1), 'safe space has mostly lone pirates');
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

// ---------- The waystation and the introduction ----------

test('the first system has an android waystation alone on its outer edge, in a safe zone', () => {
  for (const [seed, g] of galaxies) {
    const where = `seed ${seed}`, s = g.systems[0];
    const ways = g.stations.filter((st) => st.waystation);
    assert.strictEqual(ways.length, 1, `${where}: one waystation`);
    const w = ways[0];
    assert.strictEqual(g.stations[g.waystation], w);
    assert.strictEqual(w.system, 0, `${where}: in the first system`);
    assert.strictEqual(w.name, 'Waystation HD-1863');
    assert.strictEqual(w.culture, SolarSystem.ANDROID);
    assert.deepStrictEqual(w.market, { kind: 'outpost', type: 'waystation' });
    const out = Math.hypot(w.x - s.origin.x, w.y - s.origin.y) / s.radius;
    assert(out > 0.85 && out < 0.95, `${where}: ${out.toFixed(2)} of the radius out`);
    assert.strictEqual(g.securityAt(w.x, w.y), 3, `${where}: high security`);
    for (const o of g.stations) if (o !== w) assert(dist(o, w) > 7000, `${where}: ${o.name} too close`);
    for (const o of g.gates) assert(dist(o, w) > 7000, `${where}: ${o.name} too close`);
    for (const n of s.nebulae) assert(dist(n, w) > n.r + 6000, `${where}: ${n.name} too close`);
    for (const k of g.packs) assert(dist(k, w) > 6000, `${where}: pirates by the waystation`);
    assert.ok(Economy.market(g.seed, w).goods.some((x) => x.buy !== null), `${where}: something for sale`);
    // Every other station is built by humans; gates and wrecks too.
    for (const o of [...g.stations.filter((x) => x !== w), ...g.gates, ...g.wrecks]) assert(o.culture < SolarSystem.SETTLED, `${where}: ${o.key}`);
  }
  // Built in the androids' culture, the same one squad members are; pirates borrow only from humans.
  const g = galaxies.get(1), c = ArtCulture.forGalaxy(g);
  assert.strictEqual(c.of(SolarSystem.ANDROID).lineage, 'android');
  assert.strictEqual(c.of(SolarSystem.ANDROID).seed, ArtCulture.xeno(g.seed).android.seed);
  assert(c.pirates.donors.every((d) => d.lineage !== 'android'));
  assert.strictEqual(thingsOf(1, 'station').find((e) => e.station.waystation).art.culture.lineage, 'android');
});

test('the introduction: lines, questions that set the art style and movement, and two waits', () => {
  const picked = [];
  const run = Intro.create((k, v) => picked.push([k, v]));
  const says = [];
  // Answer each question with its last option; go past every line; signal each wait.
  for (let n = 0; run.step && n < 100; n++) {
    const st = run.step;
    if (st.wait) { says.push(`<${st.wait}>`); run.signal('wrong'); assert.strictEqual(run.step, st, 'a wait waits for its own signal'); run.signal(st.wait); continue; }
    says.push(st.say);
    if (st.ask) {
      run.next();
      assert.strictEqual(run.step, st, 'a question needs an answer');
      run.choose(st.options.length - 1);
    } else run.next();
  }
  assert.strictEqual(run.step, null, 'the script ends');
  assert.deepStrictEqual(picked, [['style', 'lowpoly'], ['move', 'direct']]);
  assert.deepStrictEqual(run.answers, { style: 'lowpoly', move: 'direct' });
  assert.strictEqual(says[0], 'This is Waystation HD-1863 to approaching escape pod. You are entering a safe zone.');
  // An answer's reply comes straight after its question.
  const reply = says.indexOf('Inertial dampeners. Responsive. Expensive. We will add that to your file.');
  assert(reply > 0 && says[reply - 1].startsWith('Diagnostic two'));
  // The flight comes before the security scan, docking at the very end.
  assert(says.indexOf('<approach>') < says.indexOf('Security scan in progress.'));
  assert.strictEqual(says[says.length - 1], '<docked>');
  assert.strictEqual(says[says.length - 2], 'Registration complete. Welcome to Waystation HD-1863.');
  // Every answer is a value its setting takes.
  const VALUES = { style: ['line', 'pixel', 'flat', 'lowpoly'], move: ['cruise', 'direct'], combat: ['rounds', 'realtime'] };
  for (const st of Intro.SCRIPT.filter((x) => x.ask)) assert.deepStrictEqual(st.options.map((o) => o.value).sort(), [...VALUES[st.ask]].sort(), st.ask);
  // The combat mode is asked on the first mission's launch instead, with the same choices.
  const ask = Missions.LIST.repayment.launch.filter((l) => l.ask);
  assert.deepStrictEqual(ask.map((l) => l.ask), ['combat']);
  assert.deepStrictEqual(ask[0].options.map((o) => o.value).sort(), [...VALUES.combat].sort());
  assert(ask[0].options.every((o) => o.reply));
  // Portraits show once the art style is picked; bold runs.
  const r2 = Intro.create();
  assert(!r2.portrait);
  r2.next(); r2.next(); r2.choose(0);
  assert(r2.portrait);
  assert.deepStrictEqual(Intro.runs('It has been **793** solar cycles'), [{ text: 'It has been ', bold: false }, { text: '793', bold: true }, { text: ' solar cycles', bold: false }]);
});

// ---------- Squad and AI logic modules ----------

test('logic modules: the first whose condition holds decides; with none, keep formation', () => {
  const enemies = [{ id: 'a', hull: 10 }, { id: 'b', hull: 10 }];
  const ctx = (o) => ({ self: {}, leader: {}, inFight: true, enemies, leaderTarget: 'b', ...o });
  assert.deepStrictEqual(Logic.decide([], ctx()).intent, { type: 'follow' });
  const d = Logic.decide(['assist-leader'], ctx());
  assert.strictEqual(d.module.id, 'assist-leader');
  assert.deepStrictEqual(d.intent, { type: 'attack', target: 'b' });
  // Out of a fight, with no target, or with the target gone: the rule doesn't apply.
  for (const o of [{ inFight: false }, { leaderTarget: null }, { leaderTarget: 'gone' }]) assert.deepStrictEqual(Logic.decide(['assist-leader'], ctx(o)).intent, { type: 'follow' });
  // Unknown ids and empty slots are skipped; order decides between rules that both apply.
  assert.strictEqual(Logic.decide([null, 'no-such-module', 'assist-leader'], ctx()).module.id, 'assist-leader');
  Logic.CONDITIONS['test-first'] = { label: 'there is an enemy', test: (c) => c.enemies[0] || null };
  Logic.MODULES['test-first'] = { id: 'test-first', category: 'combat', name: 'Test', if: 'test-first', then: 'attack' };
  try {
    assert.strictEqual(Logic.decide(['test-first', 'assist-leader'], ctx()).intent.target, 'a');
    assert.strictEqual(Logic.decide(['assist-leader', 'test-first'], ctx()).intent.target, 'b');
  } finally {
    delete Logic.CONDITIONS['test-first'];
    delete Logic.MODULES['test-first'];
  }
  // Every module names a known category, condition and action, and reads as a rule.
  for (const id of Object.keys(Logic.MODULES)) {
    const m = Logic.MODULES[id];
    assert(Logic.CATEGORIES[m.category] && Logic.CONDITIONS[m.if] && Logic.ACTIONS[m.then], id);
    assert.match(Logic.label(id), /logic module · /);
    assert.match(Logic.rule(id), /^If .+, then .+$/);
  }
  assert.strictEqual(Logic.label('assist-leader'), 'Combat logic module · Assist leader');
});

test('squad: an android wingman, in formation behind the leader, saved and restored', () => {
  const m = Squad.member(42, { modules: ['assist-leader'] });
  assert.match(m.name, /^[A-Z][a-z]+-\d\d$/, 'an android designation');
  assert.strictEqual(m.name, Squad.member(42).name, 'named by its seed');
  assert.deepStrictEqual(m.modules, ['assist-leader', null, null, null]);
  assert.strictEqual(m.modules.length, Squad.SLOTS);
  assert(m.hullPoints === Squad.stats(m).hull && !m.disabled);
  assert(Squad.stats(m).weapons.length >= 1, 'armed');
  // Formation: behind the leader, first on one side then the other.
  const leader = { x: 100, y: 50, angle: 0 };
  const a = Squad.formation(leader, 0), b = Squad.formation(leader, 1);
  assert(a.x < leader.x && b.x < leader.x && Math.sign(a.y - leader.y) === -Math.sign(b.y - leader.y));
  const turned = Squad.formation({ x: 0, y: 0, angle: Math.PI / 2 }, 0);
  assert(turned.y < -50, 'the formation turns with the leader');
  // Installing, removing and reordering modules.
  const w = Squad.member(7);
  assert(!Squad.install(w, 'no-such-module', 0) && !Squad.install(w, 'assist-leader', Squad.SLOTS));
  assert(Squad.install(w, 'assist-leader', 2) && Squad.move(w, 2, 0));
  assert.deepStrictEqual(Squad.modulesOf(w), ['assist-leader']);
  assert.strictEqual(w.modules[0], 'assist-leader');
  assert.strictEqual(Squad.remove(w, 0), 'assist-leader');
  assert.deepStrictEqual(Squad.modulesOf(w), []);
  // A save round trip; unknown modules are dropped, bad entries skipped.
  m.hullPoints = 12;
  m.disabled = true;
  const back = Squad.read(JSON.parse(JSON.stringify([m, { seed: 'x' }, { ...m, id: 'sq2', modules: ['gone', 'assist-leader'] }])));
  assert.strictEqual(back.length, 2);
  assert.deepStrictEqual([back[0].id, back[0].name, back[0].hullPoints, back[0].disabled, back[0].modules], [m.id, m.name, 12, true, m.modules]);
  assert.deepStrictEqual(back[1].modules, [null, 'assist-leader', null, null]);
  assert.strictEqual(Squad.read(undefined), null);
});

test('missions: offered, accepted, objectives in order, ready once all are met, then handed in', () => {
  const ID = 'repayment';
  const log = Missions.create();
  assert.strictEqual(log.status(ID), 'offered');
  assert(!log.set(ID, 'field', 1), 'no progress before it is accepted');
  assert(!log.complete(ID));
  assert(log.accept(ID) && !log.accept(ID));
  assert.strictEqual(log.status(ID), 'active');
  // Listed objectives (the android's call is tracked but not listed), each open once those before it are done.
  assert.deepStrictEqual(log.objectives(ID).map((o) => o.id), ['field', 'pirates', 'regulator', 'escort']);
  assert.strictEqual(log.current(ID).id, 'field');
  assert(log.set(ID, 'field', 1) && !log.set(ID, 'field', 1), 'only a change counts');
  assert(log.set(ID, 'pirates', 1));
  assert.deepStrictEqual([log.count(ID, 'pirates'), log.done(ID, 'pirates'), log.current(ID).id], [1, false, 'pirates']);
  assert(!log.open(ID, 'escort'), 'the escort waits for the call, which waits for the pirates');
  log.set(ID, 'pirates', 5);
  assert.strictEqual(log.count(ID, 'pirates'), 2, 'capped at what it needs');
  assert(log.open(ID, 'hail') && !log.open(ID, 'escort'));
  log.set(ID, 'hail', 1);
  assert.strictEqual(log.current(ID).id, 'regulator', 'the first open one not done');
  log.set(ID, 'escort', 1);
  assert.strictEqual(log.status(ID), 'active', 'the regulator is still missing');
  log.set(ID, 'regulator', 1);
  assert.strictEqual(log.status(ID), 'ready');
  assert.strictEqual(log.current(ID), null);
  // A save round trip, at every stage; junk is dropped.
  const back = Missions.create(JSON.parse(JSON.stringify({ ...log.save(), nope: { status: 'active' }, x: null })));
  assert.deepStrictEqual(back.save(), log.save());
  assert(back.complete(ID) && back.status(ID) === 'done' && !back.complete(ID));
  assert(back.objectives(ID).every((o) => o.done));
  const odd = Missions.create({ repayment: { status: 'active', progress: { pirates: 9, ghost: 1, field: -3 } } });
  assert.deepStrictEqual(odd.save(), { repayment: { status: 'active', progress: { pirates: 2 } } });
  assert.strictEqual(Missions.create({ repayment: { status: 'bogus' } }).status(ID), 'offered');
  const skipped = Missions.create();
  assert(skipped.finish(ID) && skipped.status(ID) === 'done' && skipped.done(ID, 'escort'));
  // Lines: names filled in, conditional lines by what's done.
  assert.strictEqual(Missions.fill('{ship} to {station}, {other}', { ship: 'Relay-42', station: 'HD' }), 'Relay-42 to HD, {other}');
  const hail = Missions.LIST[ID].hail, fresh = Missions.create();
  fresh.accept(ID);
  assert(Missions.lines(hail, fresh, ID).some((l) => /drifting nearby/.test(l)));
  fresh.set(ID, 'regulator', 1);
  const after = Missions.lines(hail, fresh, ID);
  assert(!after.some((l) => /drifting nearby/.test(l)) && after.some((l) => /recovered the coolant regulator/.test(l)));
  // What it provides is a Courier the player can fly, with both hardpoints armed.
  const provided = Missions.LIST[ID].provides.loadout;
  assert.deepStrictEqual(Loadout.slotsOf(provided.hull).map((x) => x.id).sort(), Object.keys(provided.fitted).sort());
  assert.strictEqual(Loadout.stats(provided).weaponsFitted, 2);
});

test('the first mission: a small asteroid field a short flight from the waystation, clear of everything else', () => {
  for (const [seed, g] of galaxies) {
    const where = `seed ${seed}`, site = Missions.site(g), W = g.stations[g.waystation], sys = g.systems[W.system];
    assert.deepStrictEqual(Missions.site(g), site, `${where}: the same every time`);
    const d = dist(site, W);
    assert(d >= 4500 - 1 && d <= 9000 + 1, `${where}: ${d.toFixed(0)} from the waystation`);
    assert(dist(site, sys.origin) < sys.radius - 1500, `${where}: inside the system`);
    assert(!g.nebulaAt(site.x, site.y), `${where}: not in a nebula`);
    for (const k of g.packs) assert(dist(k, site) > 4000, `${where}: another pack would join the fight`);
    for (const st of g.stations) if (st !== W) assert(dist(st, site) > 6000, `${where}: ${st.name} too close`);
    for (const p of g.planets) assert(dist(p, site) > p.extent + 2000, `${where}: ${p.name} too close`);
    assert(site.rocks.length >= Missions.SITE.rocks[0] && site.rocks.every((a) => dist(a, site) <= site.spread + 1), `${where}: rocks in the field`);
    assert.strictEqual(site.pirates.length, 2);
    assert(site.pirates.every((p) => p.orbit >= 300 && p.orbit <= 600));
    assert(dist(site.cargo, site) < 300, `${where}: the regulator beside the android`);
    // Keys are its own: nothing in the galaxy has them.
    const keys = [...site.rocks, ...site.pirates, site.android, site.cargo].map((x) => x.key);
    assert.strictEqual(new Set(keys).size, keys.length);
    const taken = new Set([...g.asteroids, ...g.wrecks, ...g.stations].map((x) => x.key).concat(g.packs.flatMap((k) => k.ships.map((x) => x.key))));
    assert(keys.every((k) => !taken.has(k)), `${where}: keys collide`);
  }
  // The android is the wingman a new game used to start with: its name doesn't change.
  const g = galaxies.get(1);
  assert.strictEqual(Missions.site(g).android.seed, hashInt(seedToInt(g.seed), 1, 0x5a0d));
  assert.strictEqual(Missions.site({ ...g, waystation: -1, stations: g.stations }), null, 'no waystation, no mission');
});

test('the first mission\'s fight: the provided Courier beats the two Mk I pirates in either combat mode', () => {
  const me = Loadout.stats(Missions.LIST.repayment.provides.loadout), fighter = Loadout.stats(Loadout.npc('fighter', Missions.SITE.tier));
  const N = 300;
  let wins = 0, hull = 0;
  for (let i = 0; i < N; i++) {
    const s = Combat.create(ctx.mulberry32(i * 104729 + 3), Combat.combatant('p', 'Me', me), [0, 1].map((k) => Combat.combatant(`f${k}`, 'Fighter', fighter)));
    while (!s.over) Combat.round(s);
    if (s.over === 'won') { wins++; hull += s.player.hull; }
  }
  assert(wins / N > 0.98, `rounds: won ${wins} of ${N}`);
  assert(hull / wins > me.hull * 0.5, `rounds: ${(hull / wins).toFixed(0)} hull left on average`);
  const face = (s, dt) => {
    const p = s.player, t = s.enemies.find((e) => e.id === s.focus && e.hull > 0);
    if (t) p.angle = Flight.turnToward(p.angle, Math.atan2(t.y - p.y, t.x - p.x), me.turnRate * dt);
  };
  wins = 0;
  for (let i = 0; i < 100; i++) {
    const rng = ctx.mulberry32(i * 7919 + 77);
    const enemies = [0, 1].map((k) => {
      const a = rng() * Math.PI * 2, r = 650 + rng() * 250;
      return RealtimeCombat.ship(`f${k}`, 'Fighter', fighter, { x: Math.cos(a) * r, y: Math.sin(a) * r, angle: a + Math.PI / 2, radius: 18 });
    });
    const s = RealtimeCombat.simulate(rng, RealtimeCombat.ship('player', 'Me', me, {}), enemies, face, { maxTime: 120 });
    if (s.over === 'won') wins++;
  }
  assert(wins > 97, `real time: won ${wins} of 100`);
});

test('the second mission: the nearest nebula, its pockets, and an android signal deep inside, clear of the pirates', () => {
  for (const [seed, g] of galaxies) {
    const where = `seed ${seed}`, first = Missions.site(g), S = Missions.salvageSite(g, first), W = g.stations[g.waystation];
    assert.deepStrictEqual(Missions.salvageSite(g, first), S, `${where}: the same every time`);
    const n = g.nebulae[S.nebula];
    assert.strictEqual(n.system, W.system, `${where}: in the waystation's system`);
    for (const o of g.nebulae) if (o.system === W.system) assert(dist(n, W) - n.r <= dist(o, W) - o.r + 1e-6, `${where}: not the nearest nebula`);
    assert(S.pockets.length >= 3, `${where}: only ${S.pockets.length} pockets`);
    assert(S.safe.every((k) => S.pockets.includes(k)));
    assert.strictEqual(g.nebulaAt(S.x, S.y), n, `${where}: the signal is outside the nebula`);
    for (const k of g.packs) assert(dist(k, S) >= Missions.SALVAGE.minClear, `${where}: pirates ${dist(k, S).toFixed(0)} from the signal`);
    for (const q of g.pockets.filter((x) => x.nebula === S.nebula)) assert(dist(q, S) >= Missions.SALVAGE.pocketClear, `${where}: a pocket on the signal`);
    assert(dist(S, first) > first.spread + 3000, `${where}: in the first mission's field`);
    assert.deepStrictEqual([S.module.x, S.module.y], [S.x, S.y]);
    assert.strictEqual(Goods.type(S.module.kind).name, 'AI cores', 'drawn as AI cores');
    const sign = (seed) => Squad.designation(seed).split('-')[0];
    assert.notStrictEqual(sign(S.hostile.seed), sign(first.android.seed), `${where}: the hostile shares the squad member's callsign`);
  }
  // Objectives: mining and gas in any order; the signal after the gas; then in turn.
  const ID = 'salvage', log = Missions.create();
  log.accept(ID);
  assert.deepStrictEqual(log.objectives(ID).map((o) => o.id), ['mine', 'gas'], 'the twist stays secret');
  log.set(ID, 'gas', 3);
  assert(log.open(ID, 'signal') && !log.open(ID, 'investigate'));
  assert.strictEqual(log.current(ID).id, 'mine');
  log.set(ID, 'mine', 3);
  for (const o of ['signal', 'investigate', 'hostile']) log.set(ID, o, 1);
  assert(log.open(ID, 'puzzle') && log.open(ID, 'module') && !log.open(ID, 'return'));
  assert(!Missions.lines(Missions.LIST[ID].puzzle, log, ID).some((l) => /You have recovered/.test(l)));
  log.set(ID, 'module', 1);
  assert(Missions.lines(Missions.LIST[ID].puzzle, log, ID).some((l) => /You have recovered/.test(l)));
  assert.deepStrictEqual(log.objectives(ID).map((o) => o.id), ['mine', 'gas', 'investigate', 'hostile', 'module', 'return'], 'each listed once open');
  log.set(ID, 'return', 1);
  assert.strictEqual(log.status(ID), 'active', 'the squad member has yet to speak');
  log.set(ID, 'puzzle', 1);
  assert.strictEqual(log.status(ID), 'ready');
  // The hostile android (Mk III) against the Courier the first mission provides: winnable alone,
  // since the squad member has no combat logic yet, but it gets through the shield.
  const me = Loadout.stats(Missions.LIST.repayment.provides.loadout), foe = Loadout.stats(Loadout.npc('fighter', Missions.SALVAGE.tier));
  let wins = 0, left = 0;
  for (let i = 0; i < 300; i++) {
    const f = Combat.create(ctx.mulberry32(i * 31337 + 5), Combat.combatant('p', 'Me', me), [Combat.combatant('h', 'Android', foe)]);
    while (!f.over) Combat.round(f);
    if (f.over === 'won') { wins++; left += f.player.hull + f.player.shield; }
  }
  assert(wins / 300 > 0.97, `rounds: won ${wins} of 300`);
  assert(left / wins < me.hull + me.shield * 0.5, `rounds: ${(left / wins).toFixed(0)} hull and shield left on average`);
  const face = (f, dt) => {
    const p = f.player, t = f.enemies.find((e) => e.id === f.focus && e.hull > 0);
    if (t) p.angle = Flight.turnToward(p.angle, Math.atan2(t.y - p.y, t.x - p.x), me.turnRate * dt);
  };
  wins = 0;
  for (let i = 0; i < 100; i++) {
    const rng = ctx.mulberry32(i * 7919 + 99), a = rng() * Math.PI * 2, r = 650 + rng() * 250;
    const f = RealtimeCombat.simulate(rng, RealtimeCombat.ship('player', 'Me', me, {}), [RealtimeCombat.ship('h', 'Android', foe, { x: Math.cos(a) * r, y: Math.sin(a) * r, angle: a + Math.PI / 2, radius: 18 })], face, { maxTime: 120 });
    if (f.over === 'won') wins++;
  }
  assert(wins > 95, `real time: won ${wins} of 100`);
});

const wingman = () => Squad.stats(Squad.member(3));

test('rounds: an ally fires on the target its orders name, and only then; a downed ally drops out', () => {
  const me = () => Combat.combatant('player', 'Me', COURIER), foe = (id) => Combat.combatant(id, 'Fighter', FIGHTER);
  const ally = () => Combat.combatant('w1', 'Cipher-07', wingman());
  // No orders: it holds fire.
  let s = Combat.create(ctx.mulberry32(1), me(), [foe('f1')], 'f1', [ally()]);
  let ev = Combat.round(s);
  assert(!ev.some((e) => e.from === 'w1'), 'no orders, no shots');
  // Ordered onto f2: every one of its volleys goes there.
  s = Combat.create(ctx.mulberry32(2), me(), [foe('f1'), foe('f2')], 'f1', [ally()]);
  Combat.setOrders(s, 'w1', { target: 'f2' });
  ev = Combat.round(s);
  const mine = ev.filter((e) => e.from === 'w1');
  assert(mine.length >= 1 && mine.every((e) => e.to === 'f2'), JSON.stringify(mine));
  // Enemies shoot at the ally now and then (about a third of them with one ally).
  let atAlly = 0;
  for (let i = 0; i < 300; i++) {
    const t = Combat.create(ctx.mulberry32(100 + i), me(), [foe('f1')], 'f1', [ally()]);
    if (t.enemies[0].aim === 'w1') atAlly++;
  }
  assert(atAlly > 60 && atAlly < 140, `${atAlly}/300 aimed at the ally`);
  // An ally shot down doesn't end the fight; the enemy turns on the player.
  s = Combat.create(ctx.mulberry32(3), me(), [foe('f1')], 'f1', [ally()]);
  s.enemies[0].aim = 'w1';
  s.allies[0].hull = 0;
  ev = Combat.round(s);
  assert(!s.over || s.over === 'won', s.over);
  assert(ev.filter((e) => e.from === 'f1').every((e) => e.to === 'player'));
  // With a wingman assisting, two fighters go down faster and the Courier keeps more hull.
  const duel = (withAlly) => {
    let rounds = 0, hull = 0;
    for (let i = 0; i < 200; i++) {
      const t = Combat.create(ctx.mulberry32(500 + i), me(), [foe('f1'), foe('f2')], 'f1', withAlly ? [ally()] : []);
      while (!t.over && t.round < 300) { if (withAlly) Combat.setOrders(t, 'w1', { target: t.focus }); Combat.round(t); }
      rounds += t.round;
      hull += Math.max(0, t.player.hull);
    }
    return { rounds: rounds / 200, hull: hull / 200 };
  };
  const alone = duel(false), helped = duel(true);
  assert(helped.rounds < alone.rounds * 0.8 && helped.hull > alone.hull + 10, `alone ${JSON.stringify(alone)}, helped ${JSON.stringify(helped)}`);
});

test('real time: an ally attacks its target, holds formation without one, and can be shot down', () => {
  const me = () => RealtimeCombat.ship('player', 'Me', COURIER, { radius: 16 });
  const foe = (id, x, y) => RealtimeCombat.ship(id, 'Fighter', FIGHTER, { x, y, angle: Math.PI, radius: 18 });
  const ally = (x, y) => RealtimeCombat.ship('w1', 'Cipher-07', wingman(), { x, y, radius: 18 });
  // Holding a station: it flies there and stays.
  let s = RealtimeCombat.create(ctx.mulberry32(1), me(), [foe('f1', 4000, 0)], { allies: [ally(-600, 300)] });
  RealtimeCombat.setOrders(s, 'w1', { station: { x: -120, y: -95 } });
  for (let i = 0; i < 30 * 8; i++) RealtimeCombat.step(s, 1 / 30);
  assert(Math.hypot(s.allies[0].x + 120, s.allies[0].y + 95) < 60, `ally at ${s.allies[0].x.toFixed(0)}, ${s.allies[0].y.toFixed(0)}`);
  // Ordered onto an enemy: it closes in, locks and shoots it.
  s = RealtimeCombat.create(ctx.mulberry32(2), me(), [foe('f1', 900, 0)], { allies: [ally(-100, 100)] });
  RealtimeCombat.setOrders(s, 'w1', { target: 'f1' });
  const shots = [];
  for (let i = 0; i < 30 * 20 && !s.over; i++) shots.push(...RealtimeCombat.step(s, 1 / 30).filter((e) => e.type === 'shot' && e.from === 'w1'));
  assert(shots.length > 0 && shots.every((e) => e.to === 'f1'), `${shots.length} ally shots`);
  // Shot down: it drops out, and the fight goes on without it.
  s = RealtimeCombat.create(ctx.mulberry32(3), me(), [foe('f1', 700, 0)], { allies: [ally(-100, 100)] });
  s.enemies[0].aim = 'w1';
  s.allies[0].hull = 1;
  s.allies[0].shield = 0;
  let downed = false;
  for (let i = 0; i < 30 * 30 && !s.over && !downed; i++) downed = RealtimeCombat.step(s, 1 / 30).some((e) => e.type === 'shot' && e.to === 'w1' && e.destroyed);
  assert(downed, 'the ally was shot down');
  assert(!s.over, 'the fight goes on');
  assert.strictEqual(CombatCore.aimAt(s, s.enemies[0]), s.player, 'and the enemy turns on the player');
});

if (failed) {
  console.log(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log('\nall tests passed');
