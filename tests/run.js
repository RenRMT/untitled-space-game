// Node checks for the generators and map travel. No dependencies: `node tests/run.js`.
// Imports the game's modules that run without a browser.

import assert from 'node:assert';
import fs from 'node:fs';
import { hashInt, mulberry32, seedToInt } from '../src/core/rng.js';
import { Save } from '../src/core/save.js';
import { Goods } from '../src/rules/goods.js';
import { Security } from '../src/world/security.js';
import { SYSTEM_CONFIG } from '../src/world/system-config.js';
import { SolarSystem } from '../src/world/solar-system.js';
import { Galaxy } from '../src/world/galaxy.js';
import { Factions } from '../src/world/factions.js';
import { ArtUtil } from '../src/art/util.js';
import { ArtCulture } from '../src/art/culture.js';
import { ArtBlueprints } from '../src/art/blueprints.js';
import { ArtItems } from '../src/art/items.js';
import { SpriteCache } from '../src/art/sprite-cache.js';
import { Entities } from '../src/flight/entities.js';
import { Scene } from '../src/flight/scene.js';
import { Interactions } from '../src/flight/interactions.js';
import { Collide } from '../src/flight/collide.js';
import { Hazards } from '../src/rules/hazards.js';
import { Travel } from '../src/flight/travel.js';
import { Flight } from '../src/flight/flight.js';
import { Knowledge } from '../src/rules/knowledge.js';
import { Economy } from '../src/rules/economy.js';
import { Reputation } from '../src/rules/reputation.js';
import { Mining } from '../src/rules/mining.js';
import { Loadout } from '../src/rules/loadout.js';
import { Logic } from '../src/rules/logic.js';
import { Squad } from '../src/rules/squad.js';
import { HullMods } from '../src/rules/hullmods.js';
import { Research } from '../src/rules/research.js';
import { Recipes } from '../src/rules/recipes.js';
import { Industry } from '../src/rules/industry.js';
import { Mods } from '../src/rules/mods.js';
import { Abilities } from '../src/rules/abilities.js';
import { CombatCore } from '../src/combat/combat-core.js';
import { Combat } from '../src/combat/combat.js';
import { RealtimeCombat } from '../src/combat/combat-realtime.js';
import { Intro } from '../src/story/intro.js';
import { JobTexts } from '../src/story/job-texts.js';
import { Jobs } from '../src/story/jobs.js';
import { Missions } from '../src/story/missions.js';
import { Glyphs } from '../src/ui/glyphs.js';

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
// A system as the generator makes one from each seed on its own, with its default params (the
// galaxy's one system is a showcase of one of each thing: see its own test).
const systems = new Map(SEEDS.map((seed) => [seed, SolarSystem.generate(seed, { params: SYSTEM_CONFIG.params })]));
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

test('the galaxy is one system: one of each planet, moon and station, a field, a nebula, and a gate and wormhole into each other', () => {
  const MOON_TYPES = ['grey', 'ice', 'rust', 'dark', 'sulfur'];
  for (const [seed, g] of galaxies) {
    const where = `seed ${seed}`;
    assert.strictEqual(g.systems.length, 1, `${where}: systems`);
    const [s] = g.systems;
    assert.deepStrictEqual([s.index, s.origin.x, s.origin.y, s.star.x, s.star.y], [0, 0, 0, 0, 0], `${where}: the system is at the origin`);
    assert.deepStrictEqual(g.links, [], `${where}: no links to other systems`);
    assert.strictEqual(g.systemAt(0, 0), s);
    assert.strictEqual(g.systemAt(s.radius * 2, 0), null, `${where}: deep space beyond the edge`);
    assert.strictEqual(g.securityAt(s.radius * 2, 0), 0);
    // One of each planet and moon type, no belts, one field and one nebula.
    assert.deepStrictEqual(s.planets.map((p) => p.type).sort(), [...PLANET_TYPES].sort(), `${where}: planets`);
    assert.deepStrictEqual(s.moons.map((m) => m.type).sort(), [...MOON_TYPES].sort(), `${where}: moons`);
    assert.deepStrictEqual([s.belts.length, s.fields.length, s.nebulae.length], [0, 1, 1], `${where}: belts, fields, nebulae`);
    // One of each station: the capital first (the start), with the waystation on the outer edge.
    const types = s.stations.map((st) => (st.waystation ? 'waystation' : st.market.type));
    assert.deepStrictEqual([...types].sort(), ['capital', 'major', 'minor', 'mining camp', 'salvage yard', 'waystation'].sort(), `${where}: stations`);
    assert.strictEqual(g.stations[g.startStation].market.type, 'capital', `${where}: the start`);
    assert.strictEqual(g.stations[g.waystation].name, Galaxy.params.waystation.name, `${where}: the waystation`);
    for (const p of s.planets) assert(dist(p, s.origin) + p.extent < s.radius, `${where}: ${p.name} reaches past the edge`);
    // A Wedge jump gate and a wormhole, each leading to the other, out in the system away from the
    // stations and the pirates; the waystation across from the gate.
    const gate = g.gates.find((x) => !x.wormhole), hole = g.gates.find((x) => x.wormhole);
    assert(gate && hole && g.gates.length === 2, `${where}: gates`);
    assert.strictEqual(SolarSystem.CULTURES[gate.culture].lineage, 'wedge', `${where}: the gate is Wedge-built`);
    assert.deepStrictEqual([gate.link, hole.link, gate.to, hole.to], [hole.id, gate.id, 0, 0], `${where}: gate links`);
    for (const x of g.gates) {
      const d = dist(x, s.origin) / s.radius;
      assert(d > 0.6 && d < 0.9, `${where}: ${x.name} at ${d.toFixed(2)} of the radius`);
      for (const st of s.stations) assert(dist(st, x) > 2000, `${where}: ${x.name} by ${st.name}`);
      for (const k of s.packs) assert(dist(k, x) > Security.PACK.clear, `${where}: pirates at ${x.name}`);
    }
    assert(dist(gate, hole) > 4000, `${where}: the gate by the wormhole`);
    const at = (o) => Math.atan2(o.y - s.origin.y, o.x - s.origin.x), W = g.stations[g.waystation];
    assert(Math.cos(at(W) - at(gate)) < -0.5, `${where}: the waystation isn't across from the gate`);
    // Lists together, every id an index into them, every key unique.
    for (const k of ['planets', 'moons', 'stations', 'packs', 'gates']) g[k].forEach((o, i) => assert.strictEqual(o.id, i, `${where}: ${k} ${i}`));
    for (const m of g.moons) assert(g.planets[m.parent].moons.includes(m.id), `${where}: moon ${m.name}'s planet`);
    for (const k of ['stations', 'asteroids', 'wrecks', 'gates', 'pockets']) assert.strictEqual(new Set(g[k].map((o) => o.key)).size, g[k].length, `${where}: ${k} keys`);
    assert(g.pockets.length >= 3, `${where}: gas pockets`);
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
    assert.deepStrictEqual(s.cultures.map((c) => c.lineage), ['wedge', 'block', 'shard', 'android', 'kitbash']);
    // The three settled (human) cultures; only a waystation is android.
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
      assert.strictEqual(s.securityAt(st.x, st.y), 2, `${where}: ${st.name} is not high security`);
    }
  }
});

// ---------- Factions and the politics of each system ----------

test('six factions, one per culture: all neutral to each other but the aliens, hostile to all', () => {
  assert.deepStrictEqual(Factions.LIST.map((f) => f.id), ['wedge', 'block', 'shard', 'drifter', 'alien', 'android']);
  for (const f of Factions.LIST) {
    for (const k of ['name', 'abbr', 'ideals', 'color']) assert(typeof f[k] === 'string' && f[k].length, `${f.id}: ${k}`);
    assert.strictEqual(f.kind, 'culture', f.id);
    assert(f.culture === 'kitbash' || ArtCulture.LINEAGES[f.culture], `${f.id}: culture ${f.culture}`);
    assert.strictEqual(Factions.ofCulture(f.culture), f);
    // Neutral toward the player at the start, but the aliens, who are hostile.
    assert.strictEqual(Reputation.tier(f.start).id, f.id === 'alien' ? 'hostile' : 'neutral', `${f.id}: starts ${f.start}`);
  }
  assert.strictEqual(Factions.MATRIX.length, Factions.LIST.length);
  for (const a of Factions.LIST) {
    for (const b of Factions.LIST) {
      const v = Factions.standing(a.id, b.id);
      if (a === b) assert.strictEqual(v, 0, `${a.id}: itself`);
      else if (a.id === 'alien' || b.id === 'alien') assert(Factions.hostile(a.id, b.id) && v <= Factions.HOSTILE, `${a.id} and ${b.id}`);
      else assert.strictEqual(v, 0, `${a.id} toward ${b.id}`);
    }
  }
  assert(Factions.get(Factions.PIRATES) && Factions.get(Factions.WAYSTATION));
});

test('the system has its region, factions and stations owned by the faction of their culture', () => {
  for (const [seed, g] of galaxies) {
    const where = `seed ${seed}`, [s] = g.systems;
    assert.deepStrictEqual([s.region.key, s.holder, s.branch, s.situations], ['home', null, null, []], where);
    const here = new Set(s.factions.map((f) => f.id));
    assert.strictEqual(here.size, s.factions.length, `${where}: a faction twice`);
    for (const st of s.stations) {
      assert.strictEqual(st.owner, Factions.ofCulture(SolarSystem.CULTURES[st.culture].lineage).id, `${where}: ${st.name}`);
      assert(here.has(st.owner), `${where}: ${st.name}'s owner isn't here`);
      if (!st.waystation) assert.strictEqual(st.culture, Galaxy.params.cultures[st.market.type], `${where}: ${st.name}'s culture`);
    }
    assert.strictEqual(g.stations[g.waystation].owner, Factions.WAYSTATION, `${where}: the waystation`);
    assert(here.has(Factions.PIRATES), `${where}: the pirates are here`);
  }
});

test('the scene builds every system, filing everything where near() finds it', () => {
  for (const seed of [1, 2, 3, 'abc']) {
    const sc = sceneOf(seed), s = galaxies.get(seed);
    assert.strictEqual(thingsOf(seed, 'station').length, s.stations.length);
    assert.strictEqual(thingsOf(seed, 'asteroid').length, s.asteroids.length);
    assert.strictEqual(thingsOf(seed, 'planet').length, s.planets.length);
    assert.strictEqual(thingsOf(seed, 'moon').length, s.moons.length);
    assert.strictEqual(thingsOf(seed, 'star').length, s.systems.length);
    assert.strictEqual(thingsOf(seed, 'gate').length, s.gates.length);
    assert.strictEqual(thingsOf(seed, 'nebula').length, s.nebulae.length);
    assert.strictEqual(thingsOf(seed, 'ship').length, s.packs.reduce((n, k) => n + k.ships.length, 0));
    // Whatever is within range of a point (by where it is or circles) is among what near() returns.
    const r = mulberry32(5);
    for (let i = 0; i < 30; i++) {
      const home = s.systems[i % s.systems.length];
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
        assert(s.securityAt(c.x, c.y) < 2, `${where}: a derelict in high security`);
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
        if (x.produced && x.rarity <= 2 && !Goods.type(x.kind).surface) assert(x.buy !== null, `${st.name}: produces ${x.kind} but doesn't sell it`);
        if (Goods.type(x.kind).surface) assert.strictEqual(x.buy, null, `${st.name} sells ${x.kind}, found only on surfaces`);
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
  assert(a.length > 100, `only ${a.length} asteroids`);
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
  // As the flight view sets it up (game/docking.js): a ship at the origin, gaps measured to the edge.
  // (Mining reaches as far as a lock, less a margin: game/mining.js.)
  const R = 1400;
  const A = Interactions.create({ gap: (e) => Math.hypot(e.x, e.y) - e.radius, speed: () => 0 });
  const mine = A.add({ id: 'mine', kind: 'asteroid', verb: 'Mine', range: () => R, run() {} });
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
  assert.notStrictEqual(ArtItems.create('iron', 7).id, ArtItems.create('silicates', 7).id);
  const c = cultures.of(0);
  assert.notStrictEqual(ArtBlueprints.create('station-major', c, 2).id, ArtBlueprints.create('station-minor', c, 2).id);
});

test('pirate fighter classes: mixed packs, heavier in dangerous space, the same size in a fight', () => {
  const count = (tier) => {
    const n = { 'fighter-light': 0, fighter: 0, 'fighter-heavy': 0 };
    for (let seed = 1; seed <= 600; seed++) n[Entities.fighterClass(tier, seed)]++;
    return n;
  };
  const t1 = count(1), t4 = count(4);
  assert.strictEqual(t1['fighter-heavy'], 0, 'no heavies in safe space');
  assert.ok(t1['fighter-light'] > t1.fighter, 'mostly light ones there');
  assert.ok(t4['fighter-heavy'] > t4['fighter-light'], 'more heavies than light ones in the most dangerous');
  assert.strictEqual(Entities.fighterClass(3, 42), Entities.fighterClass(3, 42), 'the same seed, the same class');
  // Drawn smaller or bigger, but hit as a plain fighter would be (within a fifth).
  const cul = ArtCulture.forGalaxy(Galaxy.generate(1, SYSTEM_CONFIG)).pirates;
  const hit = (type) => {
    let t = 0;
    for (let seed = 1; seed <= 40; seed++) t += Entities.fighter({ key: 'k', art: ArtBlueprints.create(type, cul, seed), x: 0, y: 0, orbit: 1, speed: 1, a0: 0, tier: 1 }).hitRadius;
    return t / 40;
  };
  const mid = hit('fighter');
  for (const type of ['fighter-light', 'fighter-heavy']) assert.ok(Math.abs(hit(type) / mid - 1) < 0.2, `${type}: ${hit(type).toFixed(1)} vs ${mid.toFixed(1)}`);
  const [light, heavy] = ['fighter-light', 'fighter-heavy'].map((t) => ArtBlueprints.create(t, cul, 5).radius);
  assert.ok(light < heavy, 'a light fighter is drawn smaller than a heavy one');
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
  A.add({ id: 'dock', kind: 'station', verb: 'Dock', key: 'f', range: 320, maxSpeed: () => 150, allowed: () => (refused ? { ok: false, reason: 'Docking refused' } : { ok: true }), hold: true, run() {} });
  A.add({ id: 'mine', kind: 'asteroid', verb: 'Mine', key: 'e', range: () => 160, busy: (e) => (mining && { ok: false, label: mining === e ? 'Mining · 3 sec' : 'Mine · busy', inRange: true, busy: mining === e }), run() {} });
  A.add({ id: 'attack', kind: 'ship', verb: 'Attack', when: (e) => e.hostile, range: 900, run() {} });
  const st = { kind: 'station', gap: 400 };
  assert.deepStrictEqual(A.state('dock', st), { ok: false, label: 'Dock · too far', inRange: false, approach: true });
  st.gap = 300;
  speed = 200;
  assert.deepStrictEqual(A.state('dock', st), { ok: false, label: 'Dock · slow down', inRange: true, approach: true });
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
  // A long press does the action marked hold; nothing for things without one.
  assert.strictEqual(A.held({ kind: 'station' }).id, 'dock');
  assert.strictEqual(A.held({ kind: 'ship', hostile: true }), null);
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
  const d = Entities.item({ key: 'k', kind: 'deuterium', seed: 3, x: 5, y: 6, angle: 1, tumble: 0.1 });
  assert.deepStrictEqual([d.kind, d.label, d.category, d.itemKind, d.x, d.y], ['item', 'Deuterium', 'trade', 'deuterium', 5, 6]);
});

test('keys are unique across everything that can leave the world, and survive a rebuild', () => {
  for (const seed of [1, 2, 'abc']) {
    const keyed = sceneOf(seed).entities.filter((e) => e.key);
    assert.strictEqual(new Set(keyed.map((e) => e.key)).size, keyed.length, `seed ${seed}: duplicate keys`);
  }
  assert.strictEqual(thingsOf(1, 'ship').length, 0, 'the showcase has no pirates');
  // With the pirates turned back on, their ships keep their keys through a rebuild.
  const s = Galaxy.generate(1, { ...SYSTEM_CONFIG, galaxy: { system: { pirates: { density: 0.5, lawlessAmbushes: [1, 2], nebulaAmbushes: true } } } });
  const a = Scene.create(s, ArtCulture.forGalaxy(s)).entities.filter((e) => e.kind === 'ship'), b = Scene.create(s, ArtCulture.forGalaxy(s)).entities.filter((e) => e.kind === 'ship');
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
    assert.ok(e.gas.type === g.nebulae[e.pocket.nebula].type && e.gas.seed === e.pocket.seed && e.radius > 30);
    const gas = Mining.gasOf(g.seed, e);
    assert(gas.length >= 1 && gas.length <= 3, `${gas.length} units`);
    assert(gas.every((x) => Goods.type(x.kind).category === 'gas'), 'gas only');
    assert.deepStrictEqual(Mining.gasOf(g.seed, e), gas, 'the same every time');
  }
  assert(things.every((e) => Mining.material(e) === 'gas' && Mining.integrity(e) > 0), 'gas to siphon');
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
  assert.strictEqual(s.miningRate, 1);
  assert.deepStrictEqual(s.weapons.map((w) => w.name), ['Mining laser Mk I', 'Gas siphon Mk I'], 'a laser for rock, a siphon for gas');
  assert.strictEqual(s.weaponSlots, 2);
  assert(s.shield > 0 && s.firepower > 0, 'starter gear includes a shield and a weapon');
});

test('every ship class has 1–4 weapon slots, one of each system and its utility slots, with starter gear that fits', () => {
  for (const [id, hull] of Object.entries(Loadout.HULLS)) {
    assert(hull.weapons >= 1 && hull.weapons <= Loadout.MAX_WEAPONS, `${id}: ${hull.weapons} weapon slots`);
    const slots = Loadout.slotsOf(id);
    for (const type of Object.keys(Loadout.SLOT_TYPES)) {
      assert.strictEqual(slots.filter((s) => s.type === type).length, type === 'weapon' ? hull.weapons : type === 'utility' ? hull.utility || 0 : 1, `${id}: ${type} slots`);
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
  const { high, low } = SolarSystem.params.security;
  for (const [seed, s] of systems) {
    const r = mulberry32(seedToInt(seed));
    for (let i = 0; i < 400; i++) {
      const x = (r() * 2 - 1) * s.radius, y = (r() * 2 - 1) * s.radius;
      if (Math.hypot(x, y) > s.radius) continue;
      const d = s.stationDist(x, y), want = d <= high ? 2 : d <= low ? 1 : 0;
      assert.strictEqual(s.securityAt(x, y), want < 2 && s.nebulaAt(x, y) ? Math.max(0, want - 1) : want, `seed ${seed} at ${x.toFixed(0)},${y.toFixed(0)}`);
    }
  }
});

test('the item catalogue: one type per category, and raw goods found only on surfaces; each with its rarity, price and stage', () => {
  const ids = new Set();
  for (const [cat, info] of Object.entries(Goods.CATEGORIES)) {
    const list = Goods.ofCategory(cat);
    assert.strictEqual(list.filter((t) => !t.surface).length, 1, `${cat}: ${list.length} types`);
    assert(!list[0].surface, `${cat}: its first type is the one from space`);
    for (const t of list) {
      assert(t.rarity >= 1 && t.rarity <= 5 && t.price > 0, `${t.id}: rarity ${t.rarity}, price ${t.price}`);
      assert.strictEqual(t.stage === 'salvage', info.group === 'salvage', `${t.id}: stage ${t.stage}`);
      assert(Goods.STAGES.includes(t.stage), `${t.id}: stage ${t.stage}`);
      if (t.surface) assert.strictEqual(t.stage, 'raw', `${t.id}: a surface good is raw`);
      assert(!ids.has(t.id), `duplicate type ${t.id}`);
      ids.add(t.id);
      assert.strictEqual(Goods.type(t.id), t);
    }
  }
  assert.deepStrictEqual(Object.values(Goods.TYPES).filter((t) => t.surface).map((t) => t.id).sort(), [...Goods.SURFACE_RAW].sort());
  assert.strictEqual(ids.size, Object.keys(Goods.TYPES).length);
  // Prices rise along the chain: refined goods over raw ones, parts over refined.
  const priceOf = (stage) => Object.values(Goods.TYPES).filter((t) => t.stage === stage).map((t) => t.price);
  assert(Math.min(...priceOf('refined')) > Math.min(...priceOf('raw')) && Math.min(...priceOf('part')) > Math.max(...priceOf('refined')));
});

test('components are generic, one per salvage category', () => {
  for (const cat of Goods.categories('salvage')) {
    const [t] = Goods.ofCategory(cat);
    assert.strictEqual(Goods.component(cat), t.id);
    assert.strictEqual(t.id, `${cat}-components`);
    assert.strictEqual(t.name, `${cat[0].toUpperCase()}${cat.slice(1)} components`);
    assert(Goods.isSalvage(t.id));
  }
  assert.strictEqual(Goods.component('metal'), null);
  // Older saves' tiered components become their category's one.
  assert.strictEqual(Goods.resolve('computer-exotic'), 'computer-components');
  assert.strictEqual(Goods.resolve('hull-simple'), 'hull-components');
});

// Perceived colour difference between two colours (the "redmean" weighted RGB distance, 0..~765).
function colourDistance(a, b) {
  const [r1, g1, b1] = ArtUtil.hexToRgb(a), [r2, g2, b2] = ArtUtil.hexToRgb(b);
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

test('rarer items are stocked less often', () => {
  // What stations stock, per type at each rarity.
  const stocked = [0, 0, 0, 0, 0, 0], types = [0, 0, 0, 0, 0, 0];
  for (const seed of STATION_SEEDS) {
    for (const st of stationsOf(seed)) {
      for (const x of Economy.market(seed, st).goods) { types[x.rarity]++; if (x.buy !== null) stocked[x.rarity]++; }
    }
  }
  const rate = stocked.map((n, l) => n / (types[l] || 1));
  assert(rate[1] > rate[2], `stock rates: ${rate.map((v) => v.toFixed(2)).join('/')}`);
});

// ---------- Industry ----------

const STAGE_RANK = { raw: 0, salvage: 0, refined: 1, part: 3, item: 4 };
test('recipes: real goods in and out, made from earlier stages, and no loops', () => {
  assert.strictEqual(new Set(Recipes.LIST.map((r) => r.id)).size, Recipes.LIST.length);
  for (const r of Recipes.LIST) {
    assert(Recipes.BAYS[r.bay], `${r.id}: bay ${r.bay}`);
    assert(r.time > 0 && Object.keys(r.in).length && Object.keys(r.out).length, r.id);
    for (const [kind, n] of [...Object.entries(r.in), ...Object.entries(r.out)]) assert(Recipes.item(kind) && Number.isInteger(n) && n > 0, `${r.id}: ${kind} × ${n}`);
    for (const kind of Object.keys(r.in)) assert(Recipes.item(kind).kind !== 'gear', `${r.id}: gear goes in`);
    assert(r.unlock === null || Research.PACKAGES[r.unlock], `${r.id}: unlock ${r.unlock}`);
    const rank = (k) => STAGE_RANK[Recipes.item(k).stage];
    assert(Math.min(...Object.keys(r.out).map(rank)) >= Math.max(...Object.keys(r.in).map(rank)), `${r.id} goes back down the chain`);
  }
  // No loops: everything made can be made, in some order, from raw materials and salvage.
  const have = new Set(Object.values(Goods.TYPES).filter((t) => t.stage === 'raw' || t.stage === 'salvage').map((t) => t.id));
  for (let changed = true; changed;) {
    changed = false;
    for (const r of Recipes.LIST) {
      if (!Object.keys(r.in).every((k) => have.has(k))) continue;
      for (const k of Object.keys(r.out)) if (!have.has(k)) { have.add(k); changed = true; }
    }
  }
  for (const t of Object.values(Goods.TYPES)) assert(have.has(t.id), `${t.id} can't be had`);
  for (const [id, e] of Object.entries(Loadout.EQUIPMENT)) if (!e.npc) assert(have.has(id), `${id} can't be made`);
  for (const m of Mods.LIST) assert(have.has(m.id), `${m.id} can't be made`);
  for (const a of Abilities.LIST) assert(have.has(a.id) && Recipes.item(a.id).kind === 'consumable', `${a.id} can't be made`);
});

test('mods: a trade each, made at an assembler once researched, fitted as far as the gear has room', () => {
  for (const m of Mods.LIST) {
    const fx = Object.entries(m.effects).map(([k, f]) => (Mods.LOWER.has(k) ? -f : f));
    assert(fx.some((f) => f > 0) && fx.some((f) => f < 0), `${m.id} is a trade, not just better`);
    const stats = Object.values(Loadout.EQUIPMENT).find((e) => e.slot === m.slot && !e.npc).stats;
    for (const k of Object.keys(m.effects)) assert(k in stats, `${m.id}: ${k} isn't a ${m.slot} stat`);
    const R = Recipes.RECIPES[`make.${m.id}`];
    assert(R && R.bay === 'assembler' && R.unlock === `mods.${m.slot}` && Research.PACKAGES[R.unlock].mods.includes(m.id), m.id);
  }
  const lo = { hull: 'courier', fitted: { 'weapon-1': 'pulse-laser-1', 'weapon-2': 'pulse-laser-4' }, mods: { 'weapon-1': ['mod.overcharger'], 'weapon-2': ['mod.overcharger', 'mod.overcharger', 'mod.overcharger'] } };
  const w = Loadout.stats(lo).weapons;
  assert.strictEqual(w[0].damage, Loadout.EQUIPMENT['pulse-laser-1'].stats.damage, 'Mk I: no room, no effect');
  assert(Math.abs(w[1].damage - Loadout.EQUIPMENT['pulse-laser-4'].stats.damage * 1.3) < 1e-9, 'Mk IV: two of them count');
  // Cut to the room the gear has; a mod that doesn't fit the gear comes out too.
  const t = Loadout.trimMods({ ...lo, mods: { ...lo.mods, shield: ['mod.overcharger'] }, fitted: { ...lo.fitted, shield: 'deflector-3' } });
  assert.deepStrictEqual(t.loadout.mods, { 'weapon-2': ['mod.overcharger', 'mod.overcharger'] });
  assert.deepStrictEqual(t.left, ['mod.overcharger', 'mod.overcharger', 'mod.overcharger']);
  // Moving to a hull with fewer hardpoints hands back that slot's mods.
  const r = Loadout.refit({ hull: 'courier', fitted: { 'weapon-1': 'pulse-laser-2', 'weapon-2': 'pulse-laser-2' }, mods: { 'weapon-2': ['mod.gimbal-mount'] } }, 'hauler');
  assert.deepStrictEqual([r.left, r.leftMods], [['pulse-laser-2'], ['mod.gimbal-mount']]);
});

test('gear is assembled: one recipe per piece, Mk I known, the rest by blueprint, the best with salvage', () => {
  for (const [id, e] of Object.entries(Loadout.EQUIPMENT)) {
    const R = Recipes.gearRecipe(id);
    if (e.npc) { assert.strictEqual(R, null, `${id} is NPC gear`); continue; }
    assert(R && R.bay === 'assembler' && R.out[id] === 1 && Recipes.producers(id).length === 1, id);
    assert.strictEqual(R.unlock, e.tier === 1 ? null : `bp.${id}`);
    assert.strictEqual(Research.blueprintFor(id), e.tier === 1 ? null : `bp.${id}`);
    const salvage = Object.entries(R.in).filter(([k]) => Goods.isSalvage(k));
    assert.strictEqual(salvage.length, e.tier >= 4 ? 1 : 0, `${id}: salvaged components`);
    if (e.tier === 5) assert(salvage[0][1] > Recipes.gearRecipe(`${e.line}-4`).in[salvage[0][0]], `${id}: more components than Mk IV`);
  }
  // Blueprints: each needs the Mk before it in its line, and more components the higher the Mk.
  for (const p of Object.values(Research.PACKAGES).filter((x) => x.kind === 'blueprint')) {
    assert(Loadout.EQUIPMENT[p.gear] && p.id === `bp.${p.gear}` && Recipes.known([p.id]).has(`make.${p.gear}`));
    const before = `bp.${p.line}-${p.tier - 1}`;
    assert.deepStrictEqual(p.requires, Research.PACKAGES[before] ? [before] : []);
    const parts = (q) => Object.entries(q.cost).filter(([k]) => Goods.isSalvage(k)).reduce((n, [, k]) => n + k, 0);
    if (Research.PACKAGES[before]) assert(parts(p) > parts(Research.PACKAGES[before]), `${p.id} takes no more components than ${before}`);
  }
  // Schematics name gear with a blueprint.
  for (let i = 0; i < 2000; i++) {
    const id = CombatCore.schematic(1, `p${i}`, 'fighter', 4);
    if (id) assert(Research.blueprintFor(id), `${id} has no blueprint`);
  }
});

test('refinements tune every piece of a gear line, a few % a step, after its blueprints', () => {
  const lines = Object.entries(Loadout.LINES).filter(([, L]) => !L.npc).map(([id]) => id);
  for (const line of lines) {
    const steps = [1, 2, 3].map((n) => Research.PACKAGES[`ref.${line}.${n}`]);
    assert(steps.every((p) => p && p.kind === 'refine' && p.refine.line === line), line);
    for (const p of steps) assert(p.requires.some((r) => Research.PACKAGES[r].kind === 'blueprint'), `${p.id} needs a blueprint`);
  }
  const u = Research.upgrades(['ref.pulse-laser.1', 'ref.pulse-laser.2', 'ref.pulse-laser.3', 'ref.deflector.1']);
  assert(Math.abs(u.lines['pulse-laser'].damage - 0.12) < 1e-9);
  assert(Math.abs(u.lines.deflector.strength - 0.04) < 1e-9 && Math.abs(u.lines.deflector.recharge - 0.04) < 1e-9);
  const plain = Loadout.stats(Loadout.starter('courier')), tuned = Loadout.stats(Loadout.starter('courier'), u);
  assert(Math.abs(tuned.weapons[0].damage - plain.weapons[0].damage * 1.12) < 1e-9);
  assert(Math.abs(tuned.shield - plain.shield * 1.04) < 1e-9);
  // Every refinement done: better, but Mk still counts for more than tuning.
  const all = Research.upgrades(Object.keys(Research.PACKAGES));
  for (const line of lines) {
    for (let t = 1; t < 5; t++) {
      const a = Loadout.EQUIPMENT[`${line}-${t}`], b = Loadout.EQUIPMENT[`${line}-${t + 1}`];
      if (!a || !b) continue;
      for (const [k, f] of Object.entries(all.lines[line])) assert(a.stats[k] * (1 + f) <= b.stats[k] * 1.15 || b.stats[k] === a.stats[k], `${line} Mk ${t} tuned against Mk ${t + 1}: ${k}`);
    }
  }
});

test('industry research: faster orders, more order slots and room, a longer lab queue, other recipes', () => {
  const lab = Research.empty(), T = 1e12;
  const env = () => Industry.env(lab);
  assert.deepStrictEqual([env().speed(T), env().room(T), Industry.slots(env()), Research.queueMax(lab)], [1, 0, Industry.SLOTS, Research.QUEUE_MAX]);
  for (const id of ['ind.speed.1', 'ind.speed.2', 'ind.storage.1', 'ind.bays.1', 'ind.lab.1']) { lab.done.push(id); lab.doneAt[id] = T; }
  assert(Math.abs(env().speed(T) - 1.3) < 1e-9 && env().speed(T - 1) === 1, 'from when it finished');
  assert.deepStrictEqual([env().room(T), Industry.slots(env()), Research.queueMax(lab)], [100, Industry.SLOTS + 1, Research.QUEUE_MAX + 1]);
  // A longer queue takes one more.
  Research.enqueue(lab, 'core.bool', T);
  for (const id of ['maint.sense', 'squad.link', 'combat.select', 'mem.ext.1']) assert(Research.enqueue(lab, id, T), id);
  assert(!Research.enqueue(lab, 'bp.pulse-laser-2', T));
  // Alternative recipes, once researched.
  assert(!Recipes.known([]).has('alt.electronics') && Recipes.known(['ind.alt.electronics']).has('alt.electronics'));
  assert.deepStrictEqual(Recipes.producers('electronics').map((r) => r.id).sort(), ['alt.electronics', 'make.electronics', 'recycle.computer-components']);
});

test('a blueprint can be granted (a schematic): done at once, refunded in full if it was queued', () => {
  const lab = Research.empty(), T = 1e12;
  Research.enqueue(lab, 'bp.pulse-laser-2', T);
  Research.enqueue(lab, 'bp.pulse-laser-3', T);
  assert.deepStrictEqual(Research.grant(lab, 'bp.pulse-laser-2', T + 1000), [{ id: 'bp.pulse-laser-2', refund: 1 }]);
  assert.deepStrictEqual(lab.active, { id: 'bp.pulse-laser-3', start: T + 1000, end: T + 1000 + Research.timeOf('bp.pulse-laser-3') }, 'the next one starts');
  assert.strictEqual(lab.doneAt['bp.pulse-laser-2'], T + 1000);
  assert.deepStrictEqual(Research.grant(lab, 'bp.pulse-laser-2', T), [], 'already done');
  assert.deepStrictEqual(Research.grant(lab, 'bp.deflector-5', T), [], 'not queued: nothing to refund');
  assert(lab.done.includes('bp.deflector-5'));
});

test('every trade good has a source and a use beyond selling', () => {
  // Sources: mined, collected or made; mined on a surface (a deposit of the body's goods).
  const mined = new Set();
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const s = systems.get(seed);
    for (const e of thingsOf(seed, 'asteroid')) { const y = Mining.yieldOf(s.seed, e); if (y) mined.add(y.kind); }
    for (const e of thingsOf(seed, 'gas')) for (const y of Mining.gasOf(s.seed, e)) mined.add(y.kind);
  }
  const g = galaxies.get(1);
  for (const p of g.planets) for (const [kind] of Hazards.surface('planet', p.type, p.seed).deposits) mined.add(kind);
  for (const m of g.moons) for (const [kind] of Hazards.surface('moon', m.type, m.seed, g.planets[m.parent].type).deposits) mined.add(kind);
  const research = new Set(Object.values(Research.PACKAGES).flatMap((p) => Object.keys(p.cost)));
  for (const cat of Goods.categories('trade')) {
    for (const t of Goods.ofCategory(cat)) {
      if (t.stage === 'raw') assert(mined.has(t.id), `${t.id} is raw but never mined or collected`);
      else assert(Recipes.producers(t.id).length, `${t.id} is never made`);
      assert(Recipes.consumers(t.id).length || research.has(t.id), `${t.id} has no use`);
    }
  }
  for (const t of Object.values(Goods.TYPES)) if (t.stage === 'raw' || t.stage === 'salvage') assert(!Recipes.producers(t.id).some((r) => !Object.keys(r.in).some(Goods.isSalvage)), `${t.id} is raw, not made`);
});

test('a recipe makes something worth more than what goes in, but not absurdly more', () => {
  for (const r of Recipes.LIST) {
    const k = Recipes.value(r.out) / Recipes.value(r.in);
    assert(k >= 1.1 && k <= 4, `${r.id}: worth ×${k.toFixed(2)} what goes in`);
  }
});

test('markets: raw and refined goods are stocked, parts less often, the rarest parts never', () => {
  const stocked = {}, offered = {};
  for (const seed of STATION_SEEDS) {
    for (const st of stationsOf(seed)) {
      for (const g of Economy.market(seed, st).goods) {
        if (Goods.type(g.kind).surface) continue; // never stocked (the test above)
        const stage = Goods.type(g.kind).stage;
        offered[stage] = (offered[stage] || 0) + 1;
        if (g.buy !== null) stocked[stage] = (stocked[stage] || 0) + 1;
        if (stage === 'part' && g.rarity >= Economy.config.madeOnly) assert.strictEqual(g.buy, null, `${g.kind} sold at ${st.name}`);
      }
    }
  }
  const rate = (s) => (stocked[s] || 0) / offered[s];
  assert(rate('raw') > rate('part') && rate('refined') > rate('part'), JSON.stringify(stocked));
});

test('markets: stockpiles move prices, run out, and drift back to rest', () => {
  const seed = 7, H = Economy.config.halfLife, T = 1e12;
  const st = { key: 'st-camp', market: { kind: 'outpost', type: 'mining camp' } };
  const rest = Economy.market(seed, st);
  const good = (m, kind) => m.goods.find((g) => g.kind === kind);
  // An untouched state is the seeded market.
  assert.deepStrictEqual(Economy.market(seed, st, Economy.empty(), T), rest);
  const ore = rest.goods.find((g) => g.buy !== null && g.produced && g.rarity === 1);
  assert(ore.produced && ore.stock > ore.target, 'a camp rests above target in what it produces');
  // Selling a lot drives the price down, unit by unit, and never below the clamp.
  const state = Economy.empty();
  let last = ore.sell;
  for (let i = 0; i < 2000; i++) {
    Economy.trade(state, seed, st, ore.kind, 1, T);
    const now = good(Economy.market(seed, st, state, T), ore.kind).sell;
    assert(now <= last, `sell price rose after unit ${i}: ${last} -> ${now}`);
    last = now;
  }
  assert(last < ore.sell * 0.5, `the price only fell to ${last} from ${ore.sell}`);
  const floor = Goods.type(ore.kind).price * Economy.config.clamp[0] * (1 - Economy.config.spread);
  assert(last >= Math.round(floor) - 1, `below the clamp: ${last}`);
  // Half the push is gone after a half-life, and almost all after many.
  const pushed = good(Economy.market(seed, st, state, T), ore.kind).stock - ore.stock;
  const half = good(Economy.market(seed, st, state, T + H), ore.kind).stock - ore.stock;
  assert(Math.abs(half - pushed / 2) < 1e-6, `${half} is not half of ${pushed}`);
  assert(Math.abs(good(Economy.market(seed, st, state, T + 20 * H), ore.kind).sell - ore.sell) <= 1, 'back at its usual price');
  // Buying empties the stockpile; then it's sold out, and buying it up raised the price.
  const buys = Economy.empty();
  for (let i = 0; i < ore.left; i++) Economy.trade(buys, seed, st, ore.kind, -1, T);
  const out = good(Economy.market(seed, st, buys, T), ore.kind);
  assert.strictEqual(out.left, 0, 'sold out');
  assert(out.buy > ore.buy * 3, `an empty stockpile is dear: ${out.buy} vs ${ore.buy}`);
  // A round trip never pays: what a unit sells back for is less than it cost.
  const rt = Economy.empty();
  const cost = good(Economy.market(seed, st, rt, T), ore.kind).buy;
  Economy.trade(rt, seed, st, ore.kind, -1, T);
  assert(good(Economy.market(seed, st, rt, T), ore.kind).sell < cost);
  // A stockpile back at rest is forgotten: by trading it back, or by pruning once settled.
  Economy.trade(rt, seed, st, ore.kind, 1, T);
  assert.deepStrictEqual(rt, {}, 'traded back to rest');
  assert.deepStrictEqual(Economy.prune(state, T + 40 * H), {}, 'pruned');
  // Saved state is checked: unknown goods, salvage and nonsense are dropped.
  const read = Economy.read({ a: { [ore.kind]: { stock: 5, at: T }, nope: { stock: 1, at: T }, 'hull-components': { stock: 1, at: T } }, b: { iron: { stock: NaN, at: T } }, c: 3 });
  assert.deepStrictEqual(read, { a: { [ore.kind]: { stock: 5, at: T } } });
});

// Stations of each type, as the scene names them.
const CAMP = { key: 'st-camp', name: 'Almar Camp', type: 'mining camp' };
const PORT = { key: 'st-port', name: 'Rito Port', type: 'minor' };
const HUB = { key: 'st-hub', name: 'Corlital Hub', type: 'major' };
const YARD = { key: 'st-yard', name: 'Kesh Yard', type: 'salvage yard' };
// A refinery order at a mining camp making steel pipe, and a fabricator order at a minor station
// making electronics from it (and carbon fibre), through the one storage.
function pipeWorks(T, { iron = 40, fibre = 20 } = {}) {
  const state = Industry.empty(), env = Industry.env(Research.empty());
  Industry.deposit(state, 'iron', iron, env, T);
  Industry.deposit(state, 'carbon-fibre', fibre, env, T);
  const a = Industry.place(state, CAMP, 'make.steel-pipe', null, env, T);
  const b = Industry.place(state, PORT, 'make.electronics', null, env, T);
  return { state, env, a, b };
}
const statusOf = (state, o) => Industry.status(state, o).id;

test('production: a refinery order feeds a fabricator order at another station through storage, while away too', () => {
  const T = 1e12, { state, env, a, b } = pipeWorks(T);
  assert.strictEqual(statusOf(state, a), 'running');
  assert.deepStrictEqual(Industry.status(state, b), { id: 'starved', missing: 'steel-pipe' }, 'no pipe yet: the input is named');
  const { log } = Industry.settle(state, T + 3600e3, env);
  // 40 iron make 20 pipes, and with 20 carbon fibre 20 electronics from them.
  assert.strictEqual(state.storage.electronics, 20);
  assert.strictEqual(state.storage['steel-pipe'], undefined);
  assert.strictEqual(state.storage.iron, undefined);
  assert.strictEqual(log.length, 40);
  assert(log.every((x, i) => !i || x.at >= log[i - 1].at), 'in time order');
  assert.deepStrictEqual([statusOf(state, a), statusOf(state, b)], ['starved', 'starved'], 'out of inputs');
  assert.deepStrictEqual(Industry.summary(state, log), ['Almar Camp: 20 × Steel pipe', 'Rito Port: 20 × Electronics']);
  // More iron, and the refinery takes it up at once.
  Industry.deposit(state, 'iron', 2, env, T + 3600e3);
  assert.strictEqual(statusOf(state, a), 'running');
  // One order per station; a shipyard takes the next step.
  assert.strictEqual(Industry.place(state, CAMP, 'make.hydrazine', null, env, T), null, 'one order per station');
  assert(Industry.place(state, HUB, 'make.flight-computer-1', 2, env, T), 'Mk I flight computers from the electronics');
});

test('production: settling in many steps comes out the same as in one, and a clock set back undoes nothing', () => {
  const T = 1e12, end = T + 30 * 60e3;
  const once = pipeWorks(T);
  Industry.settle(once.state, end, once.env);
  const r = mulberry32(5);
  for (let trial = 0; trial < 20; trial++) {
    const many = pipeWorks(T);
    const times = Array.from({ length: 10 }, () => T + r() * (end - T)).sort((a, b) => a - b);
    for (const t of times) Industry.settle(many.state, t, many.env);
    Industry.settle(many.state, T, many.env); // the clock set back
    Industry.settle(many.state, end, many.env);
    assert.deepStrictEqual(many.state, once.state);
  }
  // A cap on runs per call stops part way, and the next call goes on to the same end.
  const capped = pipeWorks(T);
  assert(Industry.settle(capped.state, end, capped.env, 5).truncated);
  while (Industry.settle(capped.state, end, capped.env, 5).truncated);
  assert.deepStrictEqual(capped.state, once.state);
});

test('production: stages by station type, room in storage, counts, pausing, cancelling and priority', () => {
  const T = 1e12, env = Industry.env(Research.empty()), state = Industry.empty();
  // Each station type does one stage.
  assert(Industry.canMake('mining camp', 'make.steel-pipe') && Industry.canMake('salvage yard', 'recycle.hull-components'));
  assert(Industry.canMake('minor', 'make.electronics') && Industry.canMake('waystation', 'make.electronics'));
  assert(Industry.canMake('capital', 'make.pulse-laser-1') && Industry.canMake('major', 'make.shield-cell'));
  assert(!Industry.canMake('mining camp', 'make.pulse-laser-1') && !Industry.canMake('capital', 'make.steel-pipe') && !Industry.canMake('minor', 'make.hydrazine'));
  assert.strictEqual(Industry.place(state, HUB, 'make.steel-pipe', null, env, T), null, 'a shipyard does not refine ore');
  // Room: only as much as fits.
  const cap = Industry.capacity(state, env, T);
  assert.strictEqual(cap, Industry.STORAGE.base);
  assert.strictEqual(Industry.deposit(state, 'iron', 1000, env, T), cap, 'only as much as there is room for');
  assert.strictEqual(Industry.free(state, env, T), 0);
  // Full, a run that makes no more than it takes still starts (2 iron make 1 pipe).
  const o = Industry.place(state, CAMP, 'make.steel-pipe', 3, env, T);
  assert.strictEqual(statusOf(state, o), 'running');
  const run = Industry.runTime(o, env, T);
  assert.strictEqual(run, Recipes.RECIPES['make.steel-pipe'].time * 1000);
  Industry.settle(state, T + 10 * run, env);
  assert.deepStrictEqual([state.storage['steel-pipe'], o.made, statusOf(state, o)], [3, 3, 'done'], 'a count of runs, then it stops');
  // Blocked: a run that makes more than it takes, with storage full (a recycled hull makes 2 pipes).
  Industry.withdraw(state, 'iron', 1000);
  Industry.deposit(state, 'hull-components', 1, env, T);
  Industry.deposit(state, 'iron', 1000, env, T);
  const rec = Industry.place(state, YARD, 'recycle.hull-components', null, env, T);
  assert.strictEqual(statusOf(state, rec), 'blocked', 'storage is full');
  Industry.withdraw(state, 'iron', 10);
  Industry.kick(state, env, T);
  assert.strictEqual(statusOf(state, rec), 'running');
  // Changing an order part way gives the run's inputs back; cancelling one too.
  const t = T + 10 * run;
  assert(Industry.change(state, o.id, 'make.steel-pipe', null, env, t));
  assert.strictEqual(statusOf(state, o), 'running');
  const iron = state.storage.iron;
  assert(Industry.cancel(state, o.id));
  assert.strictEqual(state.storage.iron, iron + 2);
  assert(!state.orders.includes(o));
  // Paused: no new runs once the one under way finishes; resumed, it starts again.
  const p = Industry.place(state, CAMP, 'make.steel-pipe', null, env, t);
  Industry.pause(state, p.id, true, env, t);
  Industry.settle(state, t + run, env);
  assert.strictEqual(statusOf(state, p), 'paused');
  Industry.pause(state, p.id, false, env, t + run);
  assert.strictEqual(statusOf(state, p), 'running');
  // Two orders after the same inputs: the first in the list goes first.
  const two = Industry.empty();
  Industry.deposit(two, 'iron', 2, env, T);
  const x = Industry.place(two, CAMP, 'make.steel-pipe', null, env, T);
  const y = Industry.place(two, YARD, 'make.steel-pipe', null, env, T);
  assert.deepStrictEqual([statusOf(two, x), statusOf(two, y)], ['running', 'starved']);
  Industry.cancel(two, x.id);
  Industry.place(two, CAMP, 'make.steel-pipe', null, env, T);
  assert.deepStrictEqual(two.orders.map((q) => statusOf(two, q)), ['running', 'starved'], 'the inputs back: the first in line takes them');
  // Moved up, an order gets the next inputs first.
  Industry.settle(two, T + run, env);
  assert(Industry.move(two, 1, 0) && two.orders[0].station === CAMP.key);
  Industry.deposit(two, 'iron', 2, env, T + run);
  assert.deepStrictEqual(two.orders.map((q) => [q.station, statusOf(two, q)]), [[CAMP.key, 'running'], [YARD.key, 'starved']]);
  assert.strictEqual(Industry.withdraw(two, 'iron', 5), 0);
});

test('production: slots grow with research, and a station takes orders only when it trusts the player', () => {
  const T = 1e12, lab = Research.empty(), state = Industry.empty();
  const env = Industry.env(lab);
  assert(Industry.place(state, CAMP, 'make.steel-pipe', null, env, T));
  assert.strictEqual(Industry.place(state, CAMP, 'make.hydrazine', null, env, T), null);
  lab.done.push('ind.bays.1');
  lab.doneAt['ind.bays.1'] = T;
  assert(Industry.place(state, CAMP, 'make.hydrazine', null, env, T), 'a second slot');
  assert.strictEqual(Industry.place(state, CAMP, 'make.carbon-fibre', null, env, T), null);
  // Loyalty: a station takes orders once missions done for it have raised its loyalty.
  assert(!Industry.trusted({}, HUB.key) && !Industry.trusted({ [HUB.key]: 0 }, HUB.key));
  assert.strictEqual(Industry.place(state, HUB, 'make.pulse-laser-1', null, env, T, {}), null, 'untrusted: refused');
  assert(Industry.place(state, HUB, 'make.pulse-laser-1', null, env, T, { [HUB.key]: 1 }), 'trusted: taken');
});

test('production: the pipeline links orders by what they make, and shows the gaps', () => {
  const T = 1e12, env = Industry.env(Research.empty()), state = Industry.empty();
  // Iron → steel pipe (camp) → electronics (port, with carbon fibre no order makes) → Mk I flight
  // computers (hub), and the pipe into Mk I pulse lasers (capital); hydrazine at a yard, linked
  // to nothing.
  const pipe = Industry.place(state, CAMP, 'make.steel-pipe', null, env, T);
  const elec = Industry.place(state, PORT, 'make.electronics', null, env, T);
  const laser = Industry.place(state, { key: 'st-cap', name: 'Cormar Station', type: 'capital' }, 'make.pulse-laser-1', null, env, T);
  const fc = Industry.place(state, HUB, 'make.flight-computer-1', null, env, T);
  const lone = Industry.place(state, YARD, 'make.hydrazine', null, env, T);
  const groups = Industry.pipelines(state);
  const chain = groups.find((g) => !g.standalone);
  assert.deepStrictEqual(chain.orders.map((o) => o.id).sort(), [pipe.id, elec.id, laser.id, fc.id].sort());
  const link = (a, b, kind) => chain.links.some((l) => l.from === a.id && l.to === b.id && l.kind === kind);
  assert(link(pipe, elec, 'steel-pipe') && link(pipe, laser, 'steel-pipe') && link(elec, fc, 'electronics'));
  assert.deepStrictEqual(chain.end.sort(), ['flight-computer-1', 'pulse-laser-1'], 'what no order uses is an end product, not a gap');
  // Carbon fibre isn't raw and no order makes it: a gap, for a refinery. Iron is raw: not flagged.
  assert.deepStrictEqual(chain.gaps, [{ order: elec.id, kind: 'carbon-fibre', stage: 'refinery' }]);
  const solo = groups.find((g) => g.standalone);
  assert.deepStrictEqual([solo.orders.map((o) => o.id), solo.links, solo.gaps], [[lone.id], [], []], 'linked to nothing: standalone');
  // Lineage: where an order's inputs come from.
  Industry.deposit(state, 'carbon-fibre', 3, env, T);
  assert.deepStrictEqual(Industry.lineage(state, 'make.electronics', Recipes.known()).map((x) => [x.kind, x.source]), [['steel-pipe', 'order'], ['carbon-fibre', 'storage']]);
  assert.deepStrictEqual(Industry.lineage(state, 'make.steel-pipe', Recipes.known()).map((x) => [x.kind, x.source]), [['iron', 'raw']]);
});

test('industry research counts from when it finished, even part way through a long absence', () => {
  const T = 1e12, lab = Research.empty();
  Research.PACKAGES['core.bool'].industry = { speed: 1 }; // twice as fast, as an industry package would make it
  try {
    lab.done.push('core.bool');
    lab.doneAt['core.bool'] = T + 60e3;
    const env = Industry.env(lab), state = Industry.empty();
    Industry.deposit(state, 'iron', 20, env, T);
    Industry.place(state, CAMP, 'make.steel-pipe', null, env, T);
    const { log } = Industry.settle(state, T + 120e3, env);
    // 20 s runs until the minute is up, then 10 s.
    assert.deepStrictEqual(log.map((x) => (x.at - T) / 1000), [20, 40, 60, 70, 80, 90, 100, 110, 120]);
  } finally { delete Research.PACKAGES['core.bool'].industry; }
});

test('saves: old data steps up a version at a time; a burst of changes is one write', () => {
  const steps = [(d) => { d.a = 1; }, (d) => { d.b = d.a + 1; }];
  assert.deepStrictEqual(Save.migrate({}, steps), { a: 1, b: 2, version: 2 }, 'from before versions');
  assert.deepStrictEqual(Save.migrate({ a: 5, version: 1 }, steps), { a: 5, b: 6, version: 2 }, 'from version 1');
  assert.deepStrictEqual(Save.migrate({ version: 3 }, steps), { version: 3 }, 'from a newer game: left alone');
  let writes = 0;
  const w = Save.debounced(() => writes++, 1e6);
  w.change(); w.change(); w.change();
  assert(w.pending && writes === 0, 'nothing written straight away');
  w.flush();
  assert(!w.pending && writes === 1, 'flushed: one write');
  w.flush();
  assert.strictEqual(writes, 1, 'nothing waiting: no write');
  w.now();
  assert.strictEqual(writes, 2, 'now() writes regardless');
});

test('old saves: item categories and labels become item types', () => {
  assert.strictEqual(Goods.resolve('metal'), 'iron');
  assert.strictEqual(Goods.resolve('gas'), 'deuterium');
  assert.strictEqual(Goods.resolve('hull'), 'hull-components');
  assert.strictEqual(Goods.resolve(undefined, 'Railgun barrel'), 'weapon-components');
  assert.strictEqual(Goods.resolve(undefined, 'Ore crystals'), 'silicates');
  assert.strictEqual(Goods.resolve('iron'), 'iron');
  // Types from before the catalogue was pared back to one per category become their category's.
  assert.strictEqual(Goods.resolve('titanium'), 'iron');
  assert.strictEqual(Goods.resolve('ai-cores'), 'electronics');
  assert.strictEqual(Goods.resolve('plasma-conduit'), 'steel-pipe');
  assert.strictEqual(Goods.resolve('drive-exotic'), 'drive-components');
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

test('abilities: a charge on a target that needs it, a cooldown, and timed effects that wear off', () => {
  const ship = (id, o = {}) => Combat.combatant(id, id, testShip({ shield: 50, ...o }));
  const me = ship('me'), foe = ship('foe');
  // Repairs and shields only when they'd help.
  assert(!Abilities.ready(me, 'repair-nanites', me, 0), 'not damaged');
  me.hull = 40;
  const rep = Abilities.use(me, 'repair-nanites', me, 0);
  assert.deepStrictEqual([rep.type, rep.amount, me.hull], ['ability', 30, 70]);
  assert(!Abilities.ready(me, 'repair-nanites', me, 5) && Abilities.ready(me, 'repair-nanites', me, 12), 'cooling down for 12 s');
  me.shield = 0;
  assert(Abilities.use(me, 'shield-cell', me, 0) && me.shield === 50);
  // An EMP silences the target, then it shrugs off another for a while.
  assert(Abilities.use(me, 'emp-charge', foe, 0));
  assert(Abilities.disabled(foe, 3.9) && !Abilities.disabled(foe, 4));
  assert(!Abilities.ready({ ...me, cooldowns: {} }, 'emp-charge', foe, 6), 'immune for 8 s after');
  assert(Abilities.ready({ ...me, cooldowns: {} }, 'emp-charge', foe, 12));
  // A jammer cuts its accuracy until it wears off; the stats come back as they were.
  const base = foe.stats;
  assert(Abilities.use(me, 'jammer-pod', foe, 0));
  assert.strictEqual(foe.stats.accuracy, 0.75);
  Abilities.tick(foe, 6);
  assert.strictEqual(foe.stats, base);
  assert(!Abilities.ready(me, 'jammer-pod', { ...foe, hull: 0 }, 20), 'not on the destroyed');
});

test('abilities in a fight: a silenced ship holds fire, in rounds and in real time', () => {
  const s = Combat.create(always, Combat.combatant('p', 'Me', testShip({ initiative: 1 })), [Combat.combatant('e', 'Them', testShip({ initiative: 3, hull: 1000 }))]);
  Abilities.use(s.player, 'emp-charge', s.enemies[0], s.t);
  const ev = Combat.round(s);
  assert(ev.every((e) => e.from === 'p'), 'only the player fired');
  s.t = 5;
  assert(Combat.round(s).some((e) => e.from === 'e'), 'and it fires again once it wears off');
  // Real time: an enemy with its guns on you, silenced, does no damage while it lasts.
  const body = (x) => ({ x, y: 0, vx: 0, vy: 0, angle: x > 0 ? Math.PI : 0, radius: 16 });
  const p = RealtimeCombat.ship('player', 'Me', Loadout.stats(Loadout.starter('courier')), body(0));
  const e = RealtimeCombat.ship('e', 'Them', Loadout.stats(Loadout.npc('fighter', 1)), body(300));
  const rt = RealtimeCombat.create(mulberry32(3), p, [e], { focus: 'e' });
  Abilities.use(p, 'emp-charge', e, rt.t);
  for (let i = 0; i < 60; i++) RealtimeCombat.step(rt, 1 / 30, p); // two seconds
  assert.strictEqual(p.hull, p.stats.hull, 'no shots landed while silenced');
});

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

  // An invulnerable ship (god mode, ?dev) takes nothing, shields or hull.
  const god = { hull: 50, shield: 20, invulnerable: true };
  assert.deepStrictEqual(CombatCore.applyDamage(god, 1000), { shieldDamage: 0, hullDamage: 0 });
  assert.deepStrictEqual([god.hull, god.shield], [50, 20]);

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
      const s = Combat.create(mulberry32(i * 7919 + n), Combat.combatant('p', 'Me', me),
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

test('pirates leave more components the better armed they are, and some cargo; freighters spill trade goods', () => {
  const g = systems.get(1);
  const componentsAt = { 1: 0, 4: 0 };
  let goods = 0;
  for (let i = 0; i < 300; i++) {
    for (const tier of [1, 4]) {
      const f = CombatCore.loot(g.seed, `x,y,s${i}`, 'fighter', tier);
      assert.deepStrictEqual(CombatCore.loot(g.seed, `x,y,s${i}`, 'fighter', tier), f, 'loot is not deterministic');
      for (const d of f) {
        assert(Goods.type(d.kind), `fighter dropped ${d.kind}`);
        if (Goods.isSalvage(d.kind)) componentsAt[tier]++;
        else if (tier === 1) goods++;
      }
    }
    const fr = CombatCore.loot(g.seed, `x,y,s${i}`, 'freighter');
    assert(fr.length >= 1);
    for (const d of fr) assert(Goods.type(d.kind), `freighter dropped ${d.kind}`);
  }
  const components = componentsAt[1];
  assert(componentsAt[4] > components * 2.5, `Mk IV pirates: ${componentsAt[4]} components against ${components}`);
  assert(components > 300 && components < 500, `${components} components from 300 pirates`);
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
  for (const l of [0, 1, 2]) assert(by.inner.concat(by.middle, by.outer).includes(l), `no space at security ${l}`);
  for (let level = 0; level < 2; level++) {
    const lo = Security.pirates(level), hi = Security.pirates(level + 1);
    const max = (t) => Math.max(...t.map(([v]) => v)), min = (t) => Math.min(...t.map(([v]) => v));
    assert(lo.chance > hi.chance && max(lo.size) >= max(hi.size) && min(lo.tier) >= min(hi.tier), `pirates at ${level} vs ${level + 1}`);
    assert(Security.lootTier(level) > Security.lootTier(level + 1));
  }
});

test('pirates come in packs that follow the security level and can be fought one at a time', () => {
  const packs = [[], [], []]; // pack sizes, by security level
  const { orbit: [, o1] } = Security.PACK;
  // Standalone systems (not in a scene) for the numbers; the galaxies' systems, in their scenes,
  // for the ships too.
  for (const [seed, s, scened] of [...[...systems].map(([k, v]) => [k, v, false]), ...[...galaxies].map(([k, v]) => [k, v.systems[0], true])]) {
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
  assert(packs[1].length > packs[2].length, `packs per level: ${packs.map((b) => b.length)}`);
  assert(mean(packs[0]) > mean(packs[1]) && mean(packs[1]) > mean(packs[2]), `pack sizes: ${packs.map((b) => (b.length ? mean(b).toFixed(1) : '-'))}`);
  assert(share(packs[1], 1) > 0.35 && packs[2].every((n) => n === 1), 'safer space has mostly lone pirates');
  assert(Security.PACK.spacing > CombatCore.config.groupRange + 2 * o1, 'pack spacing keeps packs out of each other\'s fights');
});


test('equipment lines run Mk I–V and each Mk is better than the last', () => {
  const lines = {};
  for (const [id, e] of Object.entries(Loadout.EQUIPMENT)) (lines[e.line] ||= []).push([e.tier, e, id]);
  const score = (e) => (e.slot === 'weapon' ? e.stats.damage * e.stats.fireRate : e.slot === 'shield' ? e.stats.strength
    : e.slot === 'computer' ? e.stats.accuracy : e.slot === 'engine' ? e.stats.maxSpeed : e.slot === 'utility' ? Object.values(e.stats)[0] : e.stats.lockRange);
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

test('utility gear: radiators, shielding, tanks and pods add up, take no mods, and change what hazards do', () => {
  assert.deepStrictEqual(Loadout.slotsOf('courier').filter((s) => s.type === 'utility').map((s) => s.id), ['utility-1', 'utility-2']);
  assert.strictEqual(Loadout.slotsOf('hauler').filter((s) => s.type === 'utility').length, 3);
  assert.strictEqual(Loadout.slotsOf('fighter').filter((s) => s.type === 'utility').length, 0, 'NPC hulls have none');
  const bare = Loadout.starter('courier');
  const fit = (a, b) => ({ ...bare, fitted: { ...bare.fitted, 'utility-1': a, 'utility-2': b } });
  const base = Loadout.stats(bare);
  assert.deepStrictEqual([base.cool, base.radGuard], [0, 0], 'nothing without utility gear');
  const pods = Loadout.stats(fit('cargo-pod-1', 'cargo-pod-3')), tanks = Loadout.stats(fit('aux-tank-2', 'aux-tank-1'));
  assert.strictEqual(pods.cargo, base.cargo + 6 + 11);
  assert.strictEqual(tanks.fuel, base.fuel + 55 + 40);
  const two = Loadout.stats(fit('rad-shielding-1', 'rad-shielding-1'));
  assert(Math.abs(two.radGuard - (1 - 0.7 * 0.7)) < 1e-9, 'two shields: each stops its share of what gets through');
  const hot = Loadout.stats(fit('radiator-5', 'radiator-1'));
  assert.strictEqual(Hazards.shed(hot), Hazards.config.heat.cool + 12);
  assert.strictEqual(Hazards.shed(base), Hazards.config.heat.cool);
  assert(Math.abs(Hazards.radTaken(10, two) - 4.9) < 1e-9 && Hazards.radTaken(10, base) === 10);
  // Refinements stay whole units of hold and fuel.
  const tuned = Loadout.stats(fit('cargo-pod-1', null), { lines: { 'cargo-pod': { cargo: 0.12 } } });
  assert(Number.isInteger(tuned.cargo) && tuned.cargo === base.cargo + 7);
  // No mod fits utility gear, so it has no room for one, whatever its Mk.
  assert.strictEqual(Loadout.modRoom(fit('radiator-4', null), 'utility-1'), 0);
  assert.strictEqual(Loadout.modRoom({ ...bare, fitted: { ...bare.fitted, shield: 'deflector-4' } }, 'shield'), 2);
  for (const id of Object.keys(Loadout.EQUIPMENT).filter((e) => Loadout.EQUIPMENT[e].slot === 'utility')) {
    assert(Recipes.gearRecipe(id), `${id} is assembled`);
    if (Loadout.EQUIPMENT[id].tier > 1) assert(Research.PACKAGES[`bp.${id}`], `${id} has a blueprint`);
  }
  assert(Research.LIST.some((p) => p.kind === 'blueprint' && Research.CATEGORIES.find((c) => c.id === p.cat).group === 'utility'), 'blueprints under Utility');
});

test('consumables in the field: each helps only when it would, and changes only its meter', () => {
  const m = { heat: 70, rad: 20, fuel: 90, fuelMax: 100, hull: 60, hullMax: 120, shield: 0, shieldMax: 80, rock: { hull: 30, material: 'rock' } };
  assert.deepStrictEqual(Abilities.FIELD.map((a) => a.id), ['repair-nanites', 'shield-cell', 'coolant-flush', 'rad-purge', 'fuel-canister', 'seismic-charge']);
  assert.deepStrictEqual(Abilities.fieldUse('coolant-flush', m), { heat: 20, amount: 50 });
  assert.deepStrictEqual(Abilities.fieldUse('rad-purge', m), { rad: 0, amount: 20 });
  assert.deepStrictEqual(Abilities.fieldUse('fuel-canister', m), { fuel: 100, amount: 10 }, 'up to a full tank');
  assert.deepStrictEqual(Abilities.fieldUse('repair-nanites', m), { hull: 96, amount: 36 });
  assert.deepStrictEqual(Abilities.fieldUse('shield-cell', m), { shield: 80, amount: 80 });
  assert.deepStrictEqual(Abilities.fieldUse('seismic-charge', m), { rockDamage: 40, amount: 40 });
  const fine = { heat: 0, rad: 0, fuel: 100, fuelMax: 100, hull: 120, hullMax: 120, shield: 80, shieldMax: 80, rock: null };
  for (const a of Abilities.FIELD) assert(!Abilities.fieldReady(a.id, fine), `${a.id}: nothing to do`);
  assert(!Abilities.fieldReady('seismic-charge', { ...m, rock: { hull: 30, material: 'gas' } }), 'not on gas');
  assert(!Abilities.fieldReady('emp-charge', m), 'the EMP is for fights');
  // The field-only ones never go off in a fight (a squad member's use line).
  const me = { id: 'p', hull: 50, shield: 0, stats: { hull: 100, shield: 50 } };
  for (const a of Abilities.LIST.filter((x) => x.on === 'self')) assert(!Abilities.ready(me, a.id, me, 0), `${a.id} in a fight`);
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

test('hull refits are researched: each costs credits and hull components, and builds on the step before', () => {
  for (const n of HullMods.LIST) {
    const p = Research.PACKAGES[`hull.${n.id}`];
    assert(p && p.kind === 'hull' && p.cat === 'hull', `${n.id} is researched`);
    assert(p.cost.credits === n.credits && n.credits > 0, `${n.id} costs credits`);
    for (const k of Object.keys(n.cost)) assert(Goods.isSalvage(k) && p.cost[k] === n.cost[k], `${n.id}: ${k} is a component`);
    assert.deepStrictEqual(p.requires, n.requires.map((r) => `hull.${r}`));
    assert(Research.gives(p.id).some((g) => g.kind === 'upgrade'));
  }
  const lab = Research.empty(), stock = {};
  const have = (k) => stock[k] || 0;
  assert.strictEqual(Research.status('hull.armour-2', lab, 1e6, have).state, 'locked');
  assert.deepStrictEqual(Research.status('hull.armour-2', lab, 1e6, have).needs, ['hull.armour-1']);
  const st = Research.status('hull.armour-1', lab, 0, have);
  assert(st.state === 'available' && !st.ok);
  for (const c of st.cost) stock[c.kind] = c.need;
  assert.strictEqual(Research.status('hull.armour-1', lab, st.credits - 1, have).ok, false, 'short of credits');
  assert.strictEqual(Research.status('hull.armour-1', lab, st.credits, have).ok, true);
  const u = Research.upgrades(['hull.armour-1', 'hull.armour-2', 'hull.cargo-racks-1', 'hull.hardpoint-retrofit', 'core.bool']);
  assert.strictEqual(u.weapons, 1);
  assert(Math.abs(u.hull - 0.3) < 1e-9 && Math.abs(u.cargo - 0.2) < 1e-9);
  assert.deepStrictEqual(Research.upgrades([]), { cargo: 0, hull: 0, weapons: 0, lines: {} });
});

test('research groups lay out as trees: one cell per package, requirements to the left, four columns at most', () => {
  for (const g of Research.GROUPS) {
    const L = Research.layout(g.id), shown = Research.LIST.filter((p) => Research.CATEGORIES.find((c) => c.id === p.cat).group === g.id);
    assert.deepStrictEqual(L.nodes.map((n) => n.id).sort(), shown.map((p) => p.id).sort(), `${g.id}: every package once`);
    assert(L.nodes.length, `${g.id} has packages`);
    const cells = new Set(L.nodes.map((n) => `${n.row}:${n.col}`));
    assert.strictEqual(cells.size, L.nodes.length, `${g.id}: no two in one cell`);
    assert(L.cols <= Research.MAX_COLS, `${g.id}: ${L.cols} columns`);
    const at = Object.fromEntries(L.nodes.map((n) => [n.id, n]));
    for (const [a, b] of L.edges) assert(at[a].col < at[b].col, `${a} -> ${b} runs left to right`);
    for (const n of L.nodes) assert(n.row >= 0 && n.row < L.rows && n.col >= 0 && n.col < L.cols);
    assert.deepStrictEqual(L.lanes.map((l) => l.row), [...L.lanes.map((l) => l.row)].sort((x, y) => x - y));
  }
  // A chain stays on its row: the hull refits are a row each, the hardpoint off armour II.
  const hull = Object.fromEntries(Research.layout('hull').nodes.map((n) => [n.id, n]));
  assert.deepStrictEqual(['hull.cargo-racks-1', 'hull.cargo-racks-2', 'hull.cargo-racks-3'].map((id) => [hull[id].row, hull[id].col]), [[0, 0], [0, 1], [0, 2]]);
  assert.deepStrictEqual([hull['hull.hardpoint-retrofit'].row, hull['hull.hardpoint-retrofit'].col], [2, 2]);
});

test('research records when each package finished, and bonuses count from then', () => {
  const lab = Research.empty(), T = 1e12;
  Research.enqueue(lab, 'hull.armour-1', T);
  Research.settle(lab, T + 1e9);
  assert.strictEqual(lab.doneAt['hull.armour-1'], T + Research.timeOf('hull.armour-1'));
  Research.PACKAGES['hull.armour-1'].industry = { speed: 0.15 }; // as an industry package would
  try {
    assert.strictEqual(Research.bonusAt(lab, T, 'speed'), 0);
    assert.strictEqual(Research.bonusAt(lab, T + Research.timeOf('hull.armour-1'), 'speed'), 0.15);
  } finally { delete Research.PACKAGES['hull.armour-1'].industry; }
});

test('gear tuned by research: fractions added to its line, kept within limits, none for other lines', () => {
  const plain = Loadout.stats(Loadout.starter('courier'));
  assert.deepStrictEqual(Loadout.stats(Loadout.starter('courier'), { lines: {} }), plain, 'no bonus, no change');
  const up = Loadout.stats(Loadout.starter('courier'), { lines: { 'pulse-laser': { damage: 0.5 }, 'flight-computer': { accuracy: 1 }, autocannon: { damage: 1 } } });
  assert.strictEqual(up.weapons[0].damage, plain.weapons[0].damage * 1.5);
  assert.strictEqual(up.accuracy, Loadout.LIMITS.accuracy[1], 'accuracy stops short of certain');
  assert.strictEqual(up.maxSpeed, plain.maxSpeed);
  assert.deepStrictEqual(Loadout.tuned({ lockTime: 0.4 }, { lockTime: -0.9 }), { lockTime: 0.2 });
});

test('schematics: only from armed pirates, for gear of their tier or one better', () => {
  for (let i = 0; i < 6000; i++) {
    assert.strictEqual(CombatCore.schematic(1, `p${i}`, 'fighter', 1), null, 'tier 1 pirates carry none');
    assert.strictEqual(CombatCore.schematic(1, `p${i}`, 'freighter', 4), null, 'freighters carry none');
    for (const tier of [2, 3, 4]) {
      const id = CombatCore.schematic(1, `p${i}`, 'fighter', tier);
      if (id) assert(!Loadout.EQUIPMENT[id].npc && Loadout.EQUIPMENT[id].tier >= tier && Loadout.EQUIPMENT[id].tier <= tier + 1);
    }
  }
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
      if (Combat.simulate(mulberry32(i * 7919 + tier * 31 + n), Combat.combatant('player', 'Me', stats), enemies).over === 'won') wins++;
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

test('flight: a dash throws the ship the way it points, coasting, then it slows by the engine', () => {
  const dt = 1 / 60, b = { x: 0, y: 0, vx: 0, vy: 0, angle: 0, thrust: 0 };
  Flight.dash(b, Math.PI / 2, COURIER.maxSpeed);
  assert(Math.abs(b.vy - COURIER.maxSpeed * Flight.DASH.speed) < 1e-9 && Math.abs(b.vx) < 1e-9 && b.angle === Math.PI / 2);
  // Coasting: no steering, no slowing, whatever is set.
  for (let i = 0; i < 6; i++) Flight.step(b, COURIER, { targetAngle: 0, targetSpeed: 0, mode: 'cruise', coast: true }, dt);
  assert(Math.abs(speedOf(b) - COURIER.maxSpeed * Flight.DASH.speed) < 1e-9 && b.angle === Math.PI / 2, 'coasted');
  assert(Math.abs(b.y - 0.1 * COURIER.maxSpeed * Flight.DASH.speed) < 1e-6, 'moved');
  // After: slowing toward the set speed at the engine's acceleration.
  const v0 = speedOf(b);
  for (let i = 0; i < 30; i++) Flight.step(b, COURIER, { targetAngle: 0, targetSpeed: 0, mode: 'cruise' }, dt);
  assert(Math.abs(v0 - speedOf(b) - COURIER.accel * 0.5) < 2, 'slowing by the engine');
});

// A duel set-up: the player at the origin facing +x, one enemy, fixed rolls.
function duel(enemyStats, at, o = {}) {
  const me = RealtimeCombat.ship('player', 'Me', o.me || COURIER, { x: 0, y: 0, angle: o.angle || 0 });
  const them = RealtimeCombat.ship('e', 'Them', enemyStats, { x: at[0], y: at[1], angle: Math.atan2(-at[1], -at[0]), radius: 18 });
  return RealtimeCombat.create(o.rng || (() => 0), me, [them], { focus: 'e' });
}
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
  const s = duel(FIGHTER, [1200, 0], { me: { ...COURIER, weapons: [], hull: 1e6 }, rng: mulberry32(3) });
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
  const t = duel(FREIGHTER, [1000, 0], { me: { ...COURIER, weapons: [], hull: 1e6 }, rng: mulberry32(4) });
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
    const rng = mulberry32(42);
    const enemies = [0, 1, 2].map((k) => RealtimeCombat.ship(`f${k}`, 'F', FIGHTER, { x: 700 * Math.cos(k * 2), y: 700 * Math.sin(k * 2), radius: 18 }));
    const s = RealtimeCombat.simulate(rng, RealtimeCombat.ship('player', 'Me', COURIER, {}), enemies, null, { maxTime: 30 });
    return [s.over, s.t.toFixed(3), s.player.hull, ...s.enemies.map((e) => [e.hull, e.x.toFixed(3)])];
  };
  assert.deepStrictEqual(run(), run());
});

// Mining: a rock is a passive target in a real-time fight (game/combat.js extract).
function mine(stats, target, pilot, maxTime = 60) {
  const me = RealtimeCombat.ship('player', 'Me', stats, { x: 0, y: 0, angle: 0 });
  const rock = RealtimeCombat.ship(target.key, 'Rock', Mining.stats(target), { x: target.x, y: target.y, radius: target.radius }, undefined, { passive: true, material: Mining.material(target) });
  return RealtimeCombat.simulate(mulberry32(7), me, [rock], pilot, { focus: target.key, maxTime });
}

test('mining is real-time combat against a rock that never fights back', () => {
  const rock = { kind: 'asteroid', key: 'r', x: 300, y: 0, radius: 24, ast: { type: 'stony' } };
  assert.strictEqual(Mining.integrity(rock), 96);
  const still = mine(COURIER, rock);
  assert.strictEqual(still.over, 'won', 'broken up');
  assert(still.t > 3 && still.t < 8, `a medium rock in ${still.t.toFixed(1)} s`);
  assert.strictEqual(still.player.hull, COURIER.hull, 'it never fires back');
  assert.strictEqual(still.player.shield, COURIER.shield);
  // Drifting across the rock while mining misses more: slower.
  const drifting = mine(COURIER, rock, (s, dt) => { s.player.vy = 350; s.player.y = 200 * Math.sin(s.t); });
  assert(drifting.t > still.t, `drifting ${drifting.t.toFixed(1)} s, still ${still.t.toFixed(1)} s`);
  // Out past lock range, the session ends.
  const away = mine(COURIER, rock, (s) => { s.player.x = -3000; });
  assert.strictEqual(away.over, 'fled');
});

test('mining tools: each bites by the material, and a tool that does nothing to it holds its fire', () => {
  const gas = { kind: 'gas', key: 'g', x: 250, y: 0, radius: 70, pocket: { r: 70 } };
  const laser = Loadout.EQUIPMENT['pulse-laser-1'].stats, drill = Loadout.EQUIPMENT['heavy-cannon-2'].stats, siphon = Loadout.EQUIPMENT['beam-turret-1'].stats;
  assert(drill.vs.rock > laser.vs.rock && drill.range < laser.range, 'the drill bites harder, closer in');
  const me = RealtimeCombat.ship('player', 'Me', COURIER, { x: 0, y: 0, angle: 0 });
  const g = RealtimeCombat.ship('g', 'Gas', Mining.stats(gas), { x: 250, y: 0, radius: 70 }, undefined, { passive: true, material: 'gas' });
  const r = RealtimeCombat.ship('r', 'Rock', Mining.stats({ ...gas, kind: 'asteroid' }), { x: 250, y: 0, radius: 24 }, undefined, { passive: true, material: 'rock' });
  assert.strictEqual(RealtimeCombat.canFire(me, drill, g), false, 'a drill does nothing to gas');
  assert.strictEqual(RealtimeCombat.canFire(me, siphon, r), false, 'a siphon does nothing to rock');
  assert.strictEqual(RealtimeCombat.canFire(me, siphon, g), true);
  // The starting Courier siphons a pocket mostly with its siphon, and faster with it than without.
  const both = mine(COURIER, gas);
  const laserOnly = mine(Loadout.stats({ ...Loadout.starter('courier'), fitted: { ...Loadout.starter('courier').fitted, 'weapon-2': null } }), gas);
  assert.strictEqual(both.over, 'won');
  assert(both.t < laserOnly.t, `with the siphon ${both.t.toFixed(1)} s, without ${laserOnly.t.toFixed(1)} s`);
  // A siphon never fires at a ship (the fights still in the game: the opening missions).
  const s = duel({ ...FIGHTER, weapons: [] }, [200, 0]);
  const shots = runPinned(s, 3);
  assert(shots.player.length > 0 && shots.player.every((ev) => ev.weapon === 0), 'only the laser fires at a ship');
});

test('hazards: flares come once a stretch, warned of first, and the same every time', () => {
  const F = Hazards.config.flare;
  let waves = 0, last = 'calm';
  for (let t = 0; t < F.period * 10; t += 0.5) {
    const f = Hazards.flare(1, t);
    if (f.phase === 'wave' && last !== 'wave') {
      waves++;
      assert.strictEqual(last, 'warning', `a wave at ${t} with no warning`);
    }
    if (f.phase === 'warning') assert(f.in > 0 && f.in <= F.warn, `warned ${f.in} s ahead`);
    last = f.phase;
  }
  assert(waves >= 9 && waves <= 11, `${waves} flares in ten stretches`);
  assert.deepStrictEqual(Hazards.flare(1, 1234.5), Hazards.flare(1, 1234.5));
  assert.notDeepStrictEqual([0, 1, 2, 3].map((i) => Hazards.flare(1, i * F.period).start), [0, 1, 2, 3].map((i) => Hazards.flare(2, i * F.period).start), 'another sky for another seed');
});

test('hazards: a planet, a moon or a big rock between the star and the ship shades it', () => {
  const place = { stars: [{ x: 0, y: 0 }], planets: [{ x: 5000, y: 0, r: 200 }], moons: [] };
  assert.ok(Hazards.shadowed(place, 7000, 50), 'behind the planet');
  assert.strictEqual(Hazards.shadowed(place, 7000, 600), null, 'beside its shadow');
  assert.strictEqual(Hazards.shadowed(place, 3000, 0), null, 'between the star and the planet');
  assert.ok(Hazards.shadowed(place, 2000, 0, [{ x: 1000, y: 10, r: 30 }]), 'behind a rock');
});

test('hazards: the star heats the inner system, giants and moons irradiate, stations shelter', () => {
  const g = galaxies.get(1), H = Hazards.config;
  const calm = (() => { let t = 0; while (Hazards.flare(g.seed, t).phase !== 'calm') t += 1; return t; })();
  const at = (x, y, o) => Hazards.exposure(g, g.seed, x, y, calm, o);
  const near = (p, out) => [p.x + (p.body ?? p.r) + out, p.y];
  const lava = g.planets.find((p) => p.type === 'lava'), terran = g.planets.find((p) => p.type === 'terran');
  assert(at(...near(lava, 100)).heat > H.heat.cool, 'the lava planet is too hot to stay by');
  assert(at(...near(terran, 100)).heat < H.heat.cool, 'the terran planet sheds heat');
  assert(at(...near(lava, 100), { thrust: 1 }).heat > at(...near(lava, 100)).heat, 'thrust adds heat');
  const sheltered = (x, y) => g.stations.some((st) => Math.hypot(x - st.x, y - st.y) < H.rad.shelter);
  for (const m of g.moons) if (!sheltered(m.x + m.r + 50, m.y)) assert(at(m.x + m.r + 50, m.y).rad > 0, `${m.name} is radioactive`);
  const giant = g.planets.find((p) => p.type === 'gas'), mid = (giant.body ?? giant.r) + (H.rad.beltIn + H.rad.beltOut) / 2;
  const [gap] = Hazards.beltGaps(giant), inGap = (gap[0] + gap[1]) / 2;
  const deepest = Math.max(...Array.from({ length: 72 }, (_, i) => Hazards.belt(giant, giant.x + Math.cos(i / 11.46) * mid, giant.y + Math.sin(i / 11.46) * mid)));
  assert(deepest > 0.99, 'the thick of the belt, round most of it');
  assert.strictEqual(Hazards.belt(giant, giant.x + Math.cos(inGap) * mid, giant.y + Math.sin(inGap) * mid), 0, 'a gap to thread');
  assert.strictEqual(Hazards.belt(giant, giant.x + mid * 3, giant.y), 0, 'outside the belt');
  assert.strictEqual(Hazards.belt(terran, terran.x + mid, terran.y), 0, 'only giants have belts');
  for (const st of g.stations) assert.strictEqual(at(st.x, st.y).rad, 0, `${st.name}: a station shelters its approach`);
  // A flare's wave adds heat and radiation, unless the ship is in a shadow.
  const wave = (() => { let t = 0; while (Hazards.flare(g.seed, t).phase !== 'wave') t += 1; return t; })();
  const behind = [terran.x * 1.1, terran.y * 1.1], open = [terran.x * 1.1 + 3000, terran.y * 1.1 - 3000];
  const sun = (pt) => Hazards.exposure(g, g.seed, pt[0], pt[1], wave);
  assert.ok(sun(behind).shadow, 'behind the terran planet');
  assert(sun(open).rad > 0 && !sun(open).shadow, 'out in the open, the wave comes through');
  assert(sun(open).heat > Hazards.exposure(g, g.seed, open[0], open[1], calm).heat, 'and heats');
  assert.strictEqual(sun(behind).rad, at(...behind).rad, 'sheltered');
});

test('hazards: ion storms in a nebula push the ship, and fuel: dashes, take-offs and map travel spend it', () => {
  const n = galaxies.get(1).nebulae[0], S = Hazards.config.storm;
  let stormy = 0;
  for (let t = 0; t < S.period * 4; t += 1) {
    const st = Hazards.storm(1, n, t);
    if (!st) continue;
    stormy++;
    assert(Math.abs(Math.hypot(...st.wind) - S.wind) < 1e-6);
  }
  assert(stormy >= S.length * 3.5 && stormy <= S.length * 4 + 4, `${stormy} s of storm in four stretches`);
  assert.strictEqual(Hazards.travelFuel(Hazards.config.fuel.travel * 3), 3);
  const courier = Loadout.stats(Loadout.starter('courier'));
  assert.strictEqual(courier.fuel, 100);
  assert(courier.fuel / Hazards.config.fuel.dash >= 40, 'a tank holds dozens of dashes');
  assert(Hazards.takeoffFuel(1.6, 1) < courier.fuel / 5, 'and several heavy take-offs');
  assert(Hazards.travelFuel(2 * 40000) < courier.fuel / 2, 'crossing the system by map travel takes less than half a tank');
});

test('surface bursts: vents erupt and lightning strikes on their own seeded rhythms, a warning first', () => {
  const E = Hazards.config.surface.erupt, S = Hazards.config.surface.strike, dt = 0.05, T = 300;
  for (const seed of [1, 2, 77, 12345]) {
    let on = 0, starts = 0, last = null;
    for (let t = 0; t < T; t += dt) {
      const p = Hazards.eruption({ seed }, t);
      if (p.phase === 'on') on += dt;
      if (p.phase === 'on' && last && last !== 'on') { starts++; assert.strictEqual(last, 'warning', 'a warning comes first'); }
      last = p.phase;
    }
    assert(starts >= T / E.period[1] - 2 && starts <= T / E.period[0] + 1, `${starts} eruptions in ${T} s`);
    assert(Math.abs(on / (starts + 1) - E.length) < 0.2, 'each lasts its length');
  }
  assert.notDeepStrictEqual(Hazards.eruption({ seed: 1 }, 50), Hazards.eruption({ seed: 2 }, 50), 'each vent its own rhythm');
  const pocket = { x: 100, y: -50, r: 30, seed: 9 }, spots = new Set();
  for (let t = 0; t < 120; t += 0.5) {
    const st = Hazards.strike(pocket, t), d = Math.hypot(st.at[0] - 100, st.at[1] + 50) - 30;
    assert(d >= S.from - 1e-6 && d <= S.to + 1e-6, `${d} past the rim`);
    spots.add(st.at.map(Math.round).join(','));
  }
  assert(spots.size > 8, 'each strike lands somewhere new');
  assert.deepStrictEqual(Hazards.strike(pocket, 42), Hazards.strike(pocket, 42), 'the same moment, the same strike');
});

test('surfaces: each body has its hazard and goods; the day comes round, hot on lava, desert and moons', () => {
  const H = Hazards.config, cool = H.heat.cool;
  const lava = Hazards.surface('planet', 'lava', 5), desert = Hazards.surface('planet', 'desert', 5), terran = Hazards.surface('planet', 'terran', 5);
  const ice = Hazards.surface('planet', 'ice', 5), gas = Hazards.surface('planet', 'blue', 5);
  const moon = Hazards.surface('moon', 'grey', 5, 'terran'), giantMoon = Hazards.surface('moon', 'sulfur', 5, 'gas');
  assert.deepStrictEqual([lava.id, desert.id, terran.id, ice.id, gas.id, moon.id], ['lava', 'desert', 'terran', 'ice', 'gas', 'moon-grey']);
  assert(lava.vents && desert.dust && gas.pockets && ice.fuelBurn > 1, 'each its own hazard');
  assert.strictEqual(giantMoon.rad, 2 * moon.rad, 'a giant\'s moon is twice as radioactive');
  assert.deepStrictEqual(lava.deposits.map(([k]) => k), ['tungsten', 'iron']);
  assert.deepStrictEqual(desert.deposits.map(([k]) => k), ['rare-earths', 'silicates']);
  assert.deepStrictEqual(giantMoon.deposits.map(([k]) => k), ['sulfur']);
  assert.strictEqual(gas.material, 'gas', 'a gas giant\'s deposits are siphoned');
  for (const site of [lava, desert, terran, ice, gas, moon, giantMoon]) for (const [kind] of site.deposits) assert(Goods.type(kind), kind);
  // The day: once a period, for its length, the same every time; seeded per body.
  const D = H.surface.day;
  const days = (site) => Array.from({ length: D.period }, (_, t) => Hazards.daylight(site, t).day).filter(Boolean).length;
  assert.strictEqual(days(lava), D.length);
  let t = 0;
  while (Hazards.daylight(lava, t).day) t++;
  const night = Hazards.daylight(lava, t);
  assert(night.in > 0 && night.in <= D.period - D.length && Hazards.daylight(lava, t + night.in).day, 'the countdown to sunrise');
  assert.notStrictEqual(Hazards.daylight(lava, 0).in, Hazards.daylight(Hazards.surface('planet', 'lava', 6), 0).in, 'another body, another day');
  // Heat by day builds on the lava and desert planets and the moons, not on the Terran, ice or gas worlds.
  const dayHeat = (site) => site.heat + site.day;
  for (const site of [lava, desert, moon]) assert(dayHeat(site) > cool, `${site.id} is hot by day`);
  for (const site of [terran, ice, gas]) assert(dayHeat(site) < cool, `${site.id} is mild by day`);
  assert(lava.heat > cool && desert.heat < cool, 'the lava planet is hot even by night');
  const noon = Hazards.surfaceExposure(lava, t + night.in + 1), midnight = Hazards.surfaceExposure(lava, t);
  assert.strictEqual(noon.heat - midnight.heat, lava.day);
  assert.strictEqual(Hazards.surfaceExposure(lava, t, { vent: 1 }).heat - midnight.heat, H.surface.vent, 'a vent heats the ship over it');
  assert.strictEqual(Hazards.surfaceExposure(giantMoon, t).rad, giantMoon.rad);
  // Dust storms on the desert: a front a period, crossing the landing spot in width / speed, pushing the ship.
  const S2 = H.surface.dust, pass = (S2.width * S2.length) / (2 * S2.span + S2.width);
  const storms = Array.from({ length: 10 * S2.period }, (_, k) => Hazards.dust(desert, k)).filter(Boolean);
  assert(Math.abs(storms.length - 10 * pass) <= 10, `${storms.length} s of storm at the spot in ten periods`);
  assert(Math.abs(Math.hypot(...storms[0].wind) - S2.wind) < 1e-9);
  assert(Array.from({ length: S2.period }, (_, k) => Hazards.dust(lava, k)).every((x) => x === null), 'no dust off the desert');
});

test('surfaces: the sunrise sweeps over the ground, slower than a ship; a dust storm is a front crossing the site', () => {
  const H = Hazards.config, D = H.surface.day, lava = Hazards.surface('planet', 'lava', 5), desert = Hazards.surface('planet', 'desert', 5);
  // Just after sunrise at the landing spot: day there; ahead of the light, still night, and the
  // sunrise comes there later by the distance over the sweep.
  let t = 0;
  while (Hazards.daylight(lava, t).day) t++;
  t += Hazards.daylight(lava, t).in + 1;
  const s = Hazards.sun(lava, t), ahead = [s.dir[0] * 400, s.dir[1] * 400], behind = [-s.dir[0] * 400, -s.dir[1] * 400];
  assert(Hazards.daylight(lava, t).day && !Hazards.daylight(lava, t, ahead).day && Hazards.daylight(lava, t, behind).day, 'lit behind the line, dark ahead');
  assert(Math.abs(Hazards.daylight(lava, t, ahead).in - (400 - s.rise) / D.sweep) < 1e-6, 'its sunrise comes as the line gets there');
  assert(s.rise > 0 && s.rise < 2 * D.sweep && Math.abs(s.rise - s.set - D.length * D.sweep) < 1e-6, 'the lit band, just past the spot');
  const surface = Loadout.stats(Loadout.starter('courier')).maxSpeed * 0.5;
  assert(D.sweep < surface / 4, 'a ship outruns the sunrise');
  // The front: crossing from span before the spot to span past it; a point further along it gets it later.
  let k = 0;
  while (!Hazards.dustFront(desert, k)) k += 0.5;
  const f = Hazards.dustFront(desert, k), S2 = H.surface.dust;
  assert(Math.abs(f.lead + S2.span) <= f.speed * 0.5 + 1e-6, 'it starts out past the site');
  assert.strictEqual(Hazards.dust(desert, k), null, 'not yet at the spot');
  const eta = (0 - f.lead) / f.speed;
  assert(Hazards.dust(desert, k + eta + 0.1), 'there when its edge arrives');
  const far = [f.dir[0] * 1000, f.dir[1] * 1000];
  assert.strictEqual(Hazards.dust(desert, k + eta + 0.1, far), null, 'later further along');
  assert(Hazards.dust(desert, k + eta + 1000 / f.speed + 0.1, far), 'then there');
  assert.strictEqual(Hazards.dust(desert, k + eta + (S2.width + 10) / f.speed), null, 'and gone once it has passed');
  assert(Math.abs(Math.hypot(...f.wind) - S2.wind) < 1e-9 && Math.abs(f.wind[0] / S2.wind - f.dir[0]) < 1e-9, 'blowing the way it moves');
});

test('surfaces: taking off costs fuel by gravity and how full the hold is', () => {
  const fuel = (type, fill, kind = 'planet') => Hazards.takeoffFuel(Hazards.surface(kind, type, 1, 'terran').gravity, fill);
  assert(fuel('terran', 1) > fuel('terran', 0), 'a full hold costs more');
  assert(fuel('gas', 0) > fuel('terran', 0) && fuel('terran', 0) > fuel('grey', 0, 'moon'), 'more on a heavier world');
  const courier = Loadout.stats(Loadout.starter('courier'));
  assert(fuel('gas', 1) < courier.fuel / 4, 'a full hold off a gas giant: a quarter of a tank at most');
  assert(fuel('grey', 1, 'moon') < 4, 'off a moon: little');
  assert.strictEqual(Hazards.takeoffFuel(1, 2), Hazards.takeoffFuel(1, 1), 'kept within an empty and a full hold');
});

test('deposits: small nodes on open ground, apart and clear of the landing spot; a fresh field each landing, more on a riskier site', () => {
  const site = Hazards.surface('planet', 'lava', 42), D = Mining.config.deposits;
  const area = { x0: 0, y0: 0, x1: 3000, y1: 3000, start: [1500, 1500] };
  const ok = (x, y) => !(x > 1000 && x < 1400); // a band that's blocked
  const list = Mining.deposits(42, site, { ...area, ok });
  assert.strictEqual(site.rich, 2);
  assert.strictEqual(list.length, D.n * 2, 'the lava planet: twice the nodes');
  assert.strictEqual(Mining.deposits(42, Hazards.surface('planet', 'terran', 42), { ...area, ok }).length, D.n, 'the mild Terran planet: the base count');
  assert.deepStrictEqual(Mining.deposits(42, site, { ...area, ok }), list, 'the same every time');
  assert.deepStrictEqual(Mining.deposits(42, site, { ...area, ok, field: 0 }), list, 'the same field');
  assert.notDeepStrictEqual(Mining.deposits(42, site, { ...area, ok, field: 1 }), list, 'another landing, a fresh field');
  assert.notDeepStrictEqual(Mining.deposits(43, site, { ...area, ok }), list, 'another body, other spots');
  for (const d of list) {
    assert(ok(d.x, d.y) && d.x >= 0 && d.x <= 3000 && d.y >= 0 && d.y <= 3000, 'in the area, on open ground');
    assert(Math.hypot(d.x - 1500, d.y - 1500) >= D.clear, 'clear of the landing spot');
    assert(d.r >= D.r[0] && d.r <= D.r[1] && ['tungsten', 'iron'].includes(d.kind) && d.material === 'rock' && d.rich === false);
    for (const o of list) if (o !== d) assert(Math.hypot(o.x - d.x, o.y - d.y) >= D.gap, 'apart');
  }
  assert(list.filter((d) => d.kind === 'tungsten').length > list.length / 2, 'mostly the body\'s own good');
  // Near a hazard (a vent at the middle of the top-left quarter), the nodes gather and are rich.
  const near = (x, y) => Math.max(0, 1 - Math.hypot(x - 700, y - 700) / 400);
  const by = Mining.deposits(42, site, { ...area, ok, near });
  const close = (l) => l.filter((d) => Math.hypot(d.x - 700, d.y - 700) < 400).length / l.length;
  assert(close(by) > close(list) * 1.5, `near the hazard: ${(close(by) * 100).toFixed(0)}% of the nodes, ${(close(list) * 100).toFixed(0)}% without`);
  assert(by.some((d) => d.rich) && by.every((d) => d.rich === near(d.x, d.y) >= 0.5), 'rich within half its reach');
  // Worked as an asteroid is, but small: about a second's work for the starting laser.
  const e = { kind: 'deposit', surface: true, radius: list[0].r, material: 'rock' };
  assert.strictEqual(Mining.stats(e).hull, Mining.integrity(e));
  assert.strictEqual(Mining.stats(e).name, 'Deposit');
  assert.strictEqual(Mining.material({ kind: 'deposit', material: 'gas' }), 'gas');
  for (const r of D.r) assert(Mining.integrity({ ...e, radius: r }) >= 10 && Mining.integrity({ ...e, radius: r }) <= 17, `a node of radius ${r}: ${Mining.integrity({ ...e, radius: r })}`);
  const node = mine(COURIER, { ...e, key: 'n', x: 200, y: 0, radius: D.r[1] });
  assert(node.over === 'won' && node.t < 2, `the biggest node broken in ${node.t.toFixed(1)} s`);
  // What a node leaves: a unit of its good, one more rich, one more broken on a hot day side.
  for (const d of list) {
    const got = Mining.depositYield(42, d);
    assert(got.length === 1 && got[0].kind === d.kind);
    assert.deepStrictEqual(Mining.depositYield(42, d), got);
    assert.strictEqual(Mining.depositYield(42, { ...d, rich: true }).length, 2);
    assert.strictEqual(Mining.depositYield(42, { ...d, rich: true }, { exposed: true }).length, 3);
  }
  // A rock from space never yields a surface good.
  assert(Goods.SURFACE_RAW.every((id) => Goods.type(id).surface && Goods.type(id).stage === 'raw'));
});

test('surface richness: what a site pays for its danger', () => {
  const rich = (kind, type, parent) => Hazards.surface(kind, type, 1, parent).rich;
  assert.deepStrictEqual([rich('planet', 'terran'), rich('planet', 'ice'), rich('planet', 'desert'), rich('planet', 'gas'), rich('planet', 'lava')], [1, 1.25, 1.5, 1.5, 2]);
  assert.strictEqual(rich('moon', 'grey', 'terran'), 1.5);
  assert.strictEqual(rich('moon', 'grey', 'gas'), 2, 'a giant\'s moon, twice as radioactive, pays more');
});

test('a rock locks in a quarter of the computer\'s lock time', () => {
  const me = RealtimeCombat.ship('player', 'Me', COURIER, { x: 0, y: 0, angle: 0 });
  const rock = { kind: 'asteroid', key: 'r', x: 300, y: 0, radius: 24, ast: { type: 'stony' } };
  const r = RealtimeCombat.ship('r', 'Rock', Mining.stats(rock), { x: 300, y: 0, radius: 24 }, undefined, { passive: true, material: 'rock' });
  const s = RealtimeCombat.create(mulberry32(1), me, [r], { focus: 'r' });
  assert.strictEqual(RealtimeCombat.lockTime(s), COURIER.lockTime * RealtimeCombat.config.rockLock);
  let t = 0;
  while (!s.locked && t < 5) { RealtimeCombat.step(s, 0.05); t += 0.05; }
  assert(s.locked && t <= COURIER.lockTime * RealtimeCombat.config.rockLock + 0.06, `locked in ${t.toFixed(2)} s`);
});

test('shards: a big asteroid breaks into a few, small and quick to mine, the same every time', () => {
  const S = Mining.config.shards;
  const big = { kind: 'asteroid', key: 'a7', radius: 40, ast: { type: 'metal' } };
  assert.deepStrictEqual(Mining.shards(1, { ...big, radius: S.from - 1 }), [], 'none from a small rock');
  assert.deepStrictEqual(Mining.shards(1, { ...big, ast: { type: 'nope' } }), [], 'none from a rock that yields nothing');
  const list = Mining.shards(1, big);
  assert(list.length >= S.n[0] && list.length <= S.n[1], `${list.length} shards`);
  assert.deepStrictEqual(Mining.shards(1, big), list);
  for (const sh of list) {
    assert(sh.r >= S.r[0] && sh.r <= S.r[1] && sh.d >= S.fly[0] && sh.d <= S.fly[1]);
    const e = { kind: 'asteroid', shard: true, radius: sh.r, ast: big.ast };
    assert(Mining.integrity(e) < 15, `a shard's integrity: ${Mining.integrity(e)}`);
    assert.strictEqual(Mining.stats(e).name, 'Shard');
  }
  // Drops: less often than the asteroid's own, of its kinds.
  let n = 0, got = 0;
  for (let k = 0; k < 400; k++) {
    const a = { ...big, key: `a${k}` };
    for (let i = 0; i < 4; i++) { n++; const y = Mining.shardYield(1, a, i); if (y) { got++; assert(Goods.type(y.kind).category === 'metal' || Goods.type(y.kind).category === 'mineral'); } }
  }
  const want = Mining.YIELD.metal.chance * S.chance;
  assert(Math.abs(got / n - want) < 0.06, `${(got / n * 100).toFixed(0)}% of shards drop, ${(want * 100).toFixed(0)}% wanted`);
  assert.deepStrictEqual(Mining.shardYield(1, big, 2), Mining.shardYield(1, big, 2));
});

test('collisions: a hard hit bounces the ship off and knocks it; a gentle one does nothing', () => {
  const body = { x: 30, y: 0, vx: -300, vy: 40 };
  const speed = Collide.resolve(body, 16, { x: 0, y: 0, radius: 20 });
  assert.strictEqual(speed, 300, 'the speed into it');
  assert.strictEqual(body.x, 36, 'pushed out to touching');
  assert(Math.abs(body.vx - 300 * Collide.config.restitution) < 1e-9, 'bounced back, slower');
  assert(Math.abs(body.vy - 40 * (1 - Collide.config.friction)) < 1e-9, 'some speed lost along it');
  assert.strictEqual(Collide.resolve({ x: 30, y: 0, vx: 200, vy: 0 }, 16, { x: 0, y: 0, radius: 20 }), 0, 'moving away already');
  assert.strictEqual(Collide.resolve({ x: 100, y: 0, vx: -200, vy: 0 }, 16, { x: 0, y: 0, radius: 20 }), 0, 'not touching');
  assert.strictEqual(Collide.damage(Collide.config.safe), 0, 'docking and approach speeds never hurt');
  const full = Collide.damage(COURIER.maxSpeed), half = Collide.damage(COURIER.maxSpeed / 2);
  assert(full > half && half > 0, `${half} at half speed, ${full} at full`);
  assert(full < COURIER.shield + COURIER.hull, 'one hit at full speed is not the end of the ship');
  assert(Collide.damage(COURIER.maxSpeed * 0.4, Collide.config.surfaceSafe) > 0, 'flying into a cliff at surface speed hurts');
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
      const rng = mulberry32(i * 7919 + n * 31);
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

test('the system has an android waystation alone on its outer edge, in a safe zone', () => {
  for (const [seed, g] of galaxies) {
    const where = `seed ${seed}`, s = g.systems[0];
    const ways = g.stations.filter((st) => st.waystation);
    assert.strictEqual(ways.length, 1, `${where}: one waystation`);
    const [w] = ways;
    assert.strictEqual(g.stations[g.waystation], w);
    assert.strictEqual(w.name, 'Waystation HD-1863');
    assert(w.culture === SolarSystem.ANDROID && w.owner === Factions.WAYSTATION, `${where}: ${w.name}`);
    assert.deepStrictEqual(w.market, { kind: 'outpost', type: 'waystation' });
    const out = Math.hypot(w.x - s.origin.x, w.y - s.origin.y) / s.radius;
    assert(out > 0.85 && out < 0.95, `${where}: ${out.toFixed(2)} of the radius out`);
    assert.strictEqual(g.securityAt(w.x, w.y), 2, `${where}: high security`);
    for (const o of g.stations) if (o !== w) assert(dist(o, w) > 7000, `${where}: ${o.name} too close`);
    for (const o of g.gates) assert(dist(o, w) > 7000, `${where}: ${o.name} too close`);
    for (const n of s.nebulae) assert(dist(n, w) > n.r + 6000, `${where}: ${n.name} too close`);
    for (const k of g.packs) assert(dist(k, w) > 6000, `${where}: pirates by the waystation`);
    assert.ok(Economy.market(g.seed, w).goods.some((x) => x.buy !== null), `${where}: something for sale`);
    // Every other station is built by humans, but the Drifters' kitbashed yard; gates and wrecks too.
    for (const o of g.stations.filter((x) => !x.waystation)) assert(o.culture < SolarSystem.SETTLED || o.culture === SolarSystem.DRIFTER, `${where}: ${o.key}`);
    for (const o of [...g.gates.filter((x) => !x.wormhole), ...g.wrecks]) assert(o.culture < SolarSystem.SETTLED, `${where}: ${o.key}`);
  }
  // Built in the androids' culture, the same one squad members are; pirates borrow only from humans,
  // and build the Drifters' stations.
  const g = galaxies.get(1), c = ArtCulture.forGalaxy(g);
  assert.strictEqual(c.of(SolarSystem.ANDROID).lineage, 'android');
  assert.strictEqual(c.of(SolarSystem.ANDROID).seed, ArtCulture.xeno(g.seed).android.seed);
  assert.strictEqual(c.of(SolarSystem.DRIFTER), c.pirates);
  assert(c.pirates.donors.every((d) => d.lineage !== 'android'));
  assert.strictEqual(thingsOf(1, 'station').find((e) => e.station.waystation).art.culture.lineage, 'android');
  assert.strictEqual(thingsOf(1, 'gate').find((e) => e.gate.wormhole).art.type, 'wormhole');
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
  const VALUES = { style: ['line', 'lowpoly'], move: ['cruise', 'direct'], combat: ['rounds', 'realtime'] };
  for (const st of Intro.SCRIPT.filter((x) => x.ask)) assert.deepStrictEqual(st.options.map((o) => o.value).sort(), [...VALUES[st.ask]].sort(), st.ask);
  // The combat mode is asked on the first mission's launch instead, with the same choices.
  const ask = Missions.LIST.repayment.launch.filter((l) => l.ask);
  assert.deepStrictEqual(ask.map((l) => l.ask), ['combat']);
  assert.deepStrictEqual(ask[0].options.map((o) => o.value).sort(), [...VALUES.combat].sort());
  assert(ask[0].options.every((o) => o.reply));
  // Portraits show once the art style is picked.
  const r2 = Intro.create();
  assert(!r2.portrait);
  r2.next(); r2.next(); r2.choose(0);
  assert(r2.portrait);
});

// ---------- Squad and AI logic modules ----------

// A fight as a squad member sees it (rules/logic.js ctx): ships on a line, x = distance.
function logicFight(o = {}) {
  const ship = (id, x, hull, max = 100, name = 'Fighter') => ({ id, x, hull, shield: 0, stats: { hull: max, shield: 0, name } });
  const self = ship('me', 0, 100), leader = ship('player', 50, 100), buddy = ship('sq2', 80, 30);
  const enemies = [ship('a', 900, 80), ship('b', 300, 20), ship('c', 600, 100, 100, 'Freighter')];
  return {
    self, leader, enemies, allies: [buddy], leaderTarget: 'c',
    dist: (p, q) => Math.abs(p.x - q.x), targetOf: (e) => (e.id === 'b' ? 'sq2' : 'player'), ready: () => false, ...o,
  };
}
const ALL = new Set(['core.bool', 'core.bool.or', 'combat.select', 'combat.threat', 'combat.range', 'combat.focus', 'tactics.count', 'tactics.use', 'maint.sense', 'squad.link', 'maint.guard', 'maint.retreat']);
const L = (o) => ({ ...Logic.blank(), ...o, when: (o.when || []).map((c) => Logic.clause(c)) });

test('logic: the first line that holds decides; with none, keep formation', () => {
  const ctx = logicFight();
  assert.deepStrictEqual(Logic.decide([], ctx), { line: -1, intent: { type: 'follow' } });
  const assist = Logic.copy(Logic.PRESETS['assist.leader']);
  assert.deepStrictEqual(Logic.decide([assist], ctx), { line: 0, intent: { type: 'attack', target: 'c' } });
  assert.strictEqual(Logic.text(assist), 'if enemy.isLeaderTarget → attack(enemy)');
  assert.deepStrictEqual(Logic.decide([assist], logicFight({ leaderTarget: null })).intent, { type: 'follow' });
  // Order decides between lines that both hold; lines that are off, broken or past the limit are skipped.
  const weak = L({ pick: 'weakest' });
  assert.strictEqual(Logic.decide([weak, assist], ctx).intent.target, 'b');
  assert.strictEqual(Logic.decide([assist, weak], ctx).intent.target, 'c');
  assert.strictEqual(Logic.decide([{ ...weak, on: false }, assist], ctx).line, 1);
  assert.strictEqual(Logic.decide([{ ...weak, err: 'x' }, assist], ctx).line, 1);
  assert.deepStrictEqual(Logic.decide([L({ subject: 'self', when: [{ prop: 'hull', rel: '<', value: 10 }] }), assist], ctx, 1), { line: -1, intent: { type: 'follow' } }, 'the limit');
  // Picks.
  assert.strictEqual(Logic.decide([L({ pick: 'nearest' })], ctx).intent.target, 'b');
  assert.strictEqual(Logic.decide([L({ pick: 'strongest' })], ctx).intent.target, 'c');
  assert.strictEqual(Logic.decide([L({})], ctx).intent.target, 'a', 'any: in the order given');
  // Conditions about the candidate, about self or the fight, with not, and, or.
  const lowHull = { prop: 'hull', rel: '<', value: 50 };
  assert.strictEqual(Logic.decide([L({ when: [lowHull] })], ctx).intent.target, 'b');
  assert.strictEqual(Logic.decide([L({ when: [{ ...lowHull, not: true }] })], ctx).intent.target, 'a');
  assert.strictEqual(Logic.decide([L({ when: [{ prop: 'targeting', value: 'ally' }] })], ctx).intent.target, 'b');
  assert.strictEqual(Logic.decide([L({ when: [{ prop: 'class', rel: '==', value: 'freighter' }] })], ctx).intent.target, 'c');
  assert.strictEqual(Logic.decide([L({ when: [{ prop: 'distance', rel: '<=', value: 600 }, { join: 'and', ...lowHull }] })], ctx).intent.target, 'b');
  assert.strictEqual(Logic.decide([L({ when: [{ prop: 'enemies', of: 'fight', rel: '>=', value: 4 }] })], ctx).line, -1);
  assert.deepStrictEqual(Logic.decide([L({ subject: 'self', act: 'retreat', when: [{ prop: 'hull', rel: '<=', value: 100 }] })], ctx).intent, { type: 'retreat' });
  // and binds tighter than or: false and false or true.
  const never = { prop: 'hull', rel: '>', value: 100 }, always = { prop: 'hull', rel: '<=', value: 100 };
  assert.strictEqual(Logic.decide([L({ when: [never, { join: 'and', ...never }, { join: 'or', ...always }] })], ctx).line, 0);
  assert.strictEqual(Logic.decide([L({ when: [always, { join: 'and', ...never }, { join: 'or', ...never }] })], ctx).line, -1);
  assert.strictEqual(Logic.decide([L({ when: [never, { join: 'or', ...always }, { join: 'and', ...never }] })], ctx).line, -1);
  // Guarding: the ally.
  assert.deepStrictEqual(Logic.decide([L({ subject: 'ally', act: 'guard', when: [{ prop: 'hull', rel: '<', value: 50 }] })], ctx).intent, { type: 'guard', ward: 'sq2' });
  // use() runs only when the ability is ready, else the next line does.
  const use = L({ act: 'use', skill: 'emp' });
  assert.strictEqual(Logic.decide([use, assist], ctx).line, 1);
  assert.deepStrictEqual(Logic.decide([use, assist], logicFight({ ready: (k, c) => k === 'emp' && c.id === 'b' })).intent, { type: 'use', skill: 'emp', target: 'b' });
});

test('logic: lines check against what research has unlocked, and read back from a save', () => {
  assert(Logic.check(Logic.PRESETS['assist.leader'], new Set()).ok, 'the first module needs nothing');
  assert(Logic.check(Logic.blank(), new Set()).ok);
  const errs = (line, known = ALL) => Logic.check(line, known).errors;
  assert.match(errs(L({ pick: 'nearest' }), new Set())[0], /import combat\.select/);
  assert.match(errs(L({ subject: 'ally', act: 'guard' }), new Set())[0], /import squad\.link/);
  assert.match(errs(L({ subject: 'self', pick: 'nearest' }))[0], /nothing to pick/);
  assert.match(errs(L({ subject: 'self', act: 'attack' }))[0], /can't take self/);
  assert.match(errs(L({ when: [{ prop: 'enemies', rel: '<', value: 2 }] }))[0], /enemy\.enemies isn't a thing/);
  assert.match(errs(L({ when: [{ prop: 'hull', rel: '<', value: 33 }] }))[0], /bad value/);
  assert.match(errs(L({ when: [{ prop: 'hull', rel: '~', value: 30 }] }))[0], /bad operator/);
  assert.match(errs(L({ when: [{ prop: 'isLeaderTarget' }, { join: null, prop: 'isLeaderTarget' }] }))[0], /needs and \/ or/);
  assert.match(errs(L({ when: [{ prop: 'isLeaderTarget' }, { join: 'or', prop: 'isLeaderTarget' }] }), new Set(['core.bool']))[0], /import core\.bool\.or/);
  assert.match(errs(L({ when: [{ prop: 'isLeaderTarget', not: true }] }), new Set())[0], /import core\.bool/);
  assert.match(errs(L({ act: 'use' }))[0], /bad ability/);
  assert.match(errs(L({ when: Array.from({ length: 5 }, (_, i) => ({ join: i ? 'and' : null, prop: 'isLeaderTarget' })) }))[0], /at most 4/);
  // Read: cleaned; a line that doesn't check is kept, off, with why.
  const ok = Logic.read(JSON.parse(JSON.stringify(Logic.PRESETS['assist.leader'])), new Set());
  assert.deepStrictEqual(ok, Logic.PRESETS['assist.leader']);
  const bad = Logic.read({ subject: 'enemy', pick: 'nearest', when: [null, { prop: 'hull', rel: '<', value: 30 }], act: 'attack' }, new Set());
  assert(!bad.on && /import/.test(bad.err));
  assert.strictEqual(bad.when.length, 1);
  assert(Logic.read(null, new Set()).act === 'follow' && Logic.read(null, new Set()).on, 'garbage reads as a line that follows');
  // As code.
  assert.strictEqual(Logic.text(L({ pick: 'nearest', when: [{ prop: 'hull', rel: '<', value: 30 }, { join: 'and', not: true, prop: 'targeting', value: 'leader' }] })),
    'if enemy.hull < 30% and not enemy.targeting(leader) → attack(nearest(enemy))');
  assert.strictEqual(Logic.text(L({ subject: 'self', act: 'retreat', when: [{ of: 'fight', prop: 'enemies', rel: '>=', value: 3 }] })), 'if fight.enemies >= 3 → retreat()');
  assert.strictEqual(Logic.text(Logic.blank()), 'if true → attack(enemy)');
  // As an instruction card, in plain words.
  const card = (line) => Logic.rows(line).map((r) => `${r.kw}${r.not ? ' NOT' : ''}: ${r.chips.map((c) => c.text).join(' | ')}`);
  assert.deepStrictEqual(card(L({ pick: 'weakest', when: [{ prop: 'hull', rel: '<=', value: 30 }, { join: 'or', not: true, prop: 'targeting', value: 'leader' }] })),
    ['IF: Enemy | Hull | ≤ | 30%', 'OR NOT: Enemy | is targeting | Leader', 'THEN: Attack | weakest Enemy']);
  assert.deepStrictEqual(card(Logic.blank()), ['ALWAYS: ', 'THEN: Attack | Enemy']);
  assert.deepStrictEqual(card(L({ subject: 'self', act: 'retreat', when: [{ of: 'fight', prop: 'enemies', rel: '>=', value: 3 }] })), ['IF: Fight | Enemies left | ≥ | 3', 'THEN: Retreat']);
  assert.deepStrictEqual(card(L({ when: [{ prop: 'class', rel: '!=', value: 'freighter' }] }))[0], 'IF: Enemy | is not a | Freighter');
  assert.strictEqual(Logic.say(Logic.PRESETS['assist.leader']), "If Enemy is the leader's target: Attack Enemy.");
  assert.strictEqual(Logic.say(Logic.blank()), 'Always: Attack Enemy.');
  for (const B of [Logic.SUBJECTS, Logic.PICKS, Logic.PROPS, Logic.KEYWORDS, Logic.ACTIONS]) for (const b of Object.values(B)) assert(typeof b.say === 'string' && b.say, `${b.id} has words`);
  assert.strictEqual(Logic.actionText(L({ pick: 'weakest', when: [{ prop: 'hull', rel: '<', value: 30 }] })), 'attack(weakest(enemy))');
  assert(Logic.alwaysRuns(Logic.blank()) && !Logic.alwaysRuns(Logic.PRESETS['assist.leader']) && !Logic.alwaysRuns({ ...Logic.blank(), on: false }));
  assert(!Logic.alwaysRuns(L({ act: 'use', skill: 'emp' })), 'use waits for its ability');
  for (const t of Logic.tokens(L({ act: 'use', skill: 'emp' }))) assert(['kw', 'subj', 'prop', 'op', 'num', 'fn', 'punc', 'ws', 'err'].includes(t.t));
  // Every block has a package, and every package's blocks are found.
  for (const B of [Logic.SUBJECTS, Logic.PICKS, Logic.PROPS, Logic.KEYWORDS, Logic.ACTIONS]) for (const b of Object.values(B)) assert(typeof b.pkg === 'string' && Logic.blocks(b.pkg).some((x) => x.id === b.id), b.id);
});

test('research: logic packages unlock every block, cost components and goods, and form no loops', () => {
  for (const p of Object.values(Research.PACKAGES)) {
    assert(Research.CATEGORIES.some((c) => c.id === p.cat), `${p.id}: category`);
    assert(p.time > 0 && p.cost.credits > 0, `${p.id}: time and credits`);
    for (const k of Object.keys(p.cost)) if (k !== 'credits') assert(Goods.type(k) && Goods.type(k).rarity < 5 || Goods.isSalvage(k), `${p.id}: ${k}`);
    assert(Object.keys(p.cost).some((k) => Goods.isSalvage(k)), `${p.id} needs components`);
    for (const r of p.requires) assert(Research.PACKAGES[r], `${p.id} requires unknown ${r}`);
    assert(Research.gives(p.id).length, `${p.id} gives something`);
    if (p.example) assert(Logic.check(p.example, new Set([...p.requires, p.id, ...Object.values(Research.PACKAGES).filter((q) => p.requires.includes(q.id)).flatMap((q) => q.requires)])).ok, `${p.id}: its example uses only what it and its requirements give`);
  }
  // No loops: every package can be reached in some order.
  const done = new Set();
  for (let changed = true; changed;) {
    changed = false;
    for (const p of Object.values(Research.PACKAGES)) if (!done.has(p.id) && p.requires.every((r) => done.has(r))) { done.add(p.id); changed = true; }
  }
  assert.strictEqual(done.size, Object.keys(Research.PACKAGES).length);
  // Every building block outside core comes from some package.
  for (const B of [Logic.SUBJECTS, Logic.PICKS, Logic.PROPS, Logic.KEYWORDS, Logic.ACTIONS]) {
    for (const b of Object.values(B)) assert(b.pkg === 'core' || Research.PACKAGES[b.pkg], `${b.id}: ${b.pkg}`);
  }
  // Memory: up to the most lines a program holds.
  assert.strictEqual(Squad.lineLimit(Research.lineBonus(Object.keys(Research.PACKAGES))), Squad.MAX_LINES);
  // use() runs abilities (consumables): its package is on the list now.
  assert(!Research.PACKAGES['tactics.use'].hidden && Research.LIST.includes(Research.PACKAGES['tactics.use']));
});

test('research: queued and paid up front, built on the real clock, offline too, and cancelled for a refund', () => {
  const lab = Research.empty(), rich = () => 99, T = 1e12;
  const t = (id) => Research.timeOf(id);
  // Status: what it needs, and whether it can be paid for.
  assert.strictEqual(Research.status('core.bool.or', lab, 1e9, rich).state, 'locked');
  assert.strictEqual(Research.status('core.bool', lab, 0, rich).ok, false, 'short of credits');
  assert.strictEqual(Research.status('core.bool', lab, 1e9, () => 0).ok, false, 'short of components');
  assert.strictEqual(Research.status('core.bool', lab, 1e9, rich).ok, true);
  // One builds, the rest wait; a requirement ahead in the queue is enough to queue.
  assert(Research.enqueue(lab, 'core.bool', T));
  assert.deepStrictEqual(lab.active, { id: 'core.bool', start: T, end: T + t('core.bool') });
  assert.strictEqual(Research.status('core.bool', lab, 1e9, rich).state, 'active');
  assert.strictEqual(Research.status('core.bool.or', lab, 1e9, rich).ok, true, 'its requirement is building');
  assert(Research.enqueue(lab, 'core.bool.or', T) && Research.enqueue(lab, 'tactics.count', T) && Research.enqueue(lab, 'maint.sense', T));
  assert(!Research.enqueue(lab, 'squad.link', T), 'the queue is full');
  assert(!Research.status('squad.link', lab, 1e9, rich).ok);
  assert(!Research.enqueue(lab, 'core.bool', T), 'already building');
  // Progress, and nothing done early.
  assert.strictEqual(Research.progress(lab, T + t('core.bool') / 2), 0.5);
  assert.deepStrictEqual(Research.settle(lab, T + t('core.bool') - 1), []);
  // A clock set back undoes nothing and never goes negative.
  assert.strictEqual(Research.progress(lab, T - 1e6), 0);
  assert.deepStrictEqual(Research.settle(lab, T - 1e6), []);
  // Away long enough for two: they finish in order, the next one starting when the one before ended.
  const later = T + t('core.bool') + t('core.bool.or') + 1000;
  assert.deepStrictEqual(Research.settle(lab, later), ['core.bool', 'core.bool.or']);
  assert.deepStrictEqual(lab.active, { id: 'tactics.count', start: T + t('core.bool') + t('core.bool.or'), end: T + t('core.bool') + t('core.bool.or') + t('tactics.count') });
  assert.deepStrictEqual([...Research.known(lab.done)], ['core.bool', 'core.bool.or']);
  // Cancelled while waiting: all back; while building: half back, and the next starts now.
  assert.deepStrictEqual(Research.cancel(lab, 'maint.sense', later), [{ id: 'maint.sense', refund: 1 }]);
  assert(Research.enqueue(lab, 'maint.sense', later));
  assert.deepStrictEqual(Research.cancel(lab, 'tactics.count', later), [{ id: 'tactics.count', refund: 0.5 }]);
  assert.deepStrictEqual(lab.active, { id: 'maint.sense', start: later, end: later + t('maint.sense') });
  assert.deepStrictEqual(Research.cancel(lab, 'nothing', later), []);
  // Cancelling a requirement takes what was queued on it too.
  assert(Research.enqueue(lab, 'maint.retreat', later) && Research.enqueue(lab, 'squad.link', later));
  assert.deepStrictEqual(Research.cancel(lab, 'maint.sense', later), [{ id: 'maint.sense', refund: 0.5 }, { id: 'maint.retreat', refund: 1 }]);
  assert.strictEqual(lab.active.id, 'squad.link');
  assert.deepStrictEqual(lab.queue, []);
  // Faster for testing by hand.
  Research.config.speed = 60;
  try { assert.strictEqual(Research.timeOf('core.bool'), Research.PACKAGES['core.bool'].time * 1000 / 60); } finally { Research.config.speed = 1; }
});

test('squad: an android wingman, in formation behind the leader, saved and restored', () => {
  const assist = Logic.copy(Logic.PRESETS['assist.leader']);
  const m = Squad.member(42, { program: [assist] });
  assert.match(m.name, /^[A-Z][a-z]+-\d\d$/, 'an android designation');
  assert.strictEqual(m.name, Squad.member(42).name, 'named by its seed');
  assert.deepStrictEqual(m.program, [assist]);
  assert(m.hullPoints === Squad.stats(m).hull && !m.disabled);
  assert(Squad.stats(m).weapons.length >= 1, 'armed');
  assert.strictEqual(Squad.lineLimit(0), Squad.BASE_LINES);
  assert.strictEqual(Squad.lineLimit(99), Squad.MAX_LINES);
  // Formation: behind the leader, first on one side then the other.
  const leader = { x: 100, y: 50, angle: 0 };
  const a = Squad.formation(leader, 0), b = Squad.formation(leader, 1);
  assert(a.x < leader.x && b.x < leader.x && Math.sign(a.y - leader.y) === -Math.sign(b.y - leader.y));
  const turned = Squad.formation({ x: 0, y: 0, angle: Math.PI / 2 }, 0);
  assert(turned.y < -50, 'the formation turns with the leader');
  // Adding, moving, switching off and removing lines.
  const w = Squad.member(7);
  const x = Logic.blank(), y = L({ pick: 'weakest' });
  assert(!Squad.setLine(w, 1, x), 'no gaps');
  assert(Squad.setLine(w, 0, x) && Squad.setLine(w, 1, y) && Squad.moveLine(w, 1, 0));
  assert.deepStrictEqual(w.program, [y, x]);
  assert(Squad.toggleLine(w, 0) && !w.program[0].on);
  assert.strictEqual(Squad.removeLine(w, 0), y);
  assert.deepStrictEqual(w.program, [x]);
  assert(!Squad.moveLine(w, 0, 3) && Squad.removeLine(w, 5) === null);
  for (let i = 1; i < Squad.MAX_LINES; i++) assert(Squad.setLine(w, i, Logic.blank()));
  assert(!Squad.setLine(w, Squad.MAX_LINES, Logic.blank()), 'at most MAX_LINES');
  // A save round trip; lines that don't check stay, off; bad entries are skipped.
  m.hullPoints = 12;
  m.disabled = true;
  m.program.push(L({ pick: 'nearest' }));
  const back = Squad.read(JSON.parse(JSON.stringify([m, { seed: 'x' }])), new Set());
  assert.strictEqual(back.length, 1);
  assert.deepStrictEqual([back[0].id, back[0].name, back[0].hullPoints, back[0].disabled, back[0].program[0]], [m.id, m.name, 12, true, assist]);
  assert(!back[0].program[1].on && back[0].program[1].err, 'needs combat.select');
  assert(Squad.read(JSON.parse(JSON.stringify([m])), ALL)[0].program[1].on, 'fine once researched');
  assert.strictEqual(Squad.read(undefined), null);
});

test('squad: each member flies its own loadout, joining with the player\'s starting gear, and saves it', () => {
  const m = Squad.member(5);
  assert.deepStrictEqual(m.loadout.fitted, {
    'weapon-1': 'pulse-laser-1', shield: 'deflector-1', computer: 'flight-computer-1', engine: 'courier-drive-1', scanner: 'survey-scanner-1',
  }, 'the Courier\'s starting kit, in a fighter');
  for (const [slot, id] of Object.entries(m.loadout.fitted)) assert.strictEqual(id, Loadout.starter('courier').fitted[slot], slot);
  assert.strictEqual(Squad.stats(m).hull, Loadout.HULLS.fighter.hull, 'no extra armour');
  // Its own gear: a pulse laser fitted, with a mod, is what it flies with, and survives a save.
  m.loadout = { ...m.loadout, fitted: { ...m.loadout.fitted, 'weapon-1': 'pulse-laser-3' } };
  const mod = Object.keys(Mods.MODS).find((id) => Mods.fits(id, 'weapon'));
  m.loadout.mods = { 'weapon-1': [mod] };
  assert.strictEqual(Squad.stats(m).weapons[0].name, 'Mining laser Mk III');
  const [back] = Squad.read(JSON.parse(JSON.stringify([m])), new Set());
  assert.deepStrictEqual(back.loadout, m.loadout);
  // A saved loadout is checked against its hull: wrong slots, gear and mods dropped.
  const bad = { hull: 'fighter', fitted: { 'weapon-1': 'deflector-1', shield: 'deflector-2', 'weapon-9': 'pulse-laser-1' }, mods: { shield: ['nonsense'], engine: [mod] }, armour: 9 };
  assert.deepStrictEqual(Squad.validLoadout(bad, 'fighter'), {
    hull: 'fighter', fitted: { 'weapon-1': null, shield: 'deflector-2', computer: null, engine: null, scanner: null }, mods: {}, armour: 1,
  });
  assert.strictEqual(Squad.validLoadout({ ...bad, hull: 'courier' }, 'fighter'), null, 'another hull');
  assert.deepStrictEqual(Squad.member(5, { loadout: 'junk' }).loadout, Squad.starter('fighter'), 'junk: the starting gear');
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

// The galaxy's jobs (story/jobs.js), for every test galaxy.
test('jobs: no job texts yet, so the board is empty', () => {
  for (const [seed, g] of galaxies) assert.deepStrictEqual(Jobs.board(g).list, [], `seed ${seed}`);
});

// A station job, a system job and a faction job written for the test, to check the machinery the
// board runs on while the game has none of its own.
function withTestJobs(fn) {
  const { go, fight, bring } = JobTexts;
  JobTexts.STATION.capital = [['test-delivery', (c) => ({
    name: 'Test delivery', briefing: [`${c.st.name} needs iron.`, 'Bring some in.'],
    steps: [bring('iron', 5, 'Bring 5 iron')], debrief: ['Delivered.'],
  })]];
  JobTexts.STATION['mining camp'] = [['test-patrol', (c) => {
    const at = c.space(c.st, 5000, 9000);
    return at && { name: 'Test patrol', briefing: ['Pirates nearby.', `They sit ${at.name}.`], steps: [go([at], `Fly ${at.name}`), fight(at, 2, 'Destroy the pirates')], debrief: ['Clear.'] };
  }]];
  JobTexts.FACTION.wedge = [{
    id: 'test-tour',
    where: ({ own }) => ({ system: own[0].system, from: own[0] }),
    write: (c) => {
      const far = c.stations((st) => st !== c.home && !st.waystation);
      return { name: 'Test tour', briefing: ['A tour of the system.', 'Visit every station.'], steps: [go(far, 'Visit the stations')], debrief: ['Toured.'] };
    },
  }];
  try { return fn(); } finally {
    delete JobTexts.STATION.capital;
    delete JobTexts.STATION['mining camp'];
    delete JobTexts.FACTION.wedge;
  }
}

test('jobs: the board places what job texts write, pays by tier, and the log keeps them', () => withTestJobs(() => {
  for (const [seed, g] of galaxies) {
    const where = `seed ${seed}`, B = Jobs.board(g);
    assert.deepStrictEqual(Jobs.board(g).list.map((j) => [j.id, j.reward.credits]), B.list.map((j) => [j.id, j.reward.credits]), `${where}: the same every time`);
    assert.deepStrictEqual(B.list.map((j) => j.tier).sort(), ['faction', 'station', 'station'], `${where}: jobs`);
    for (const j of B.list) {
      const name = j.tier === 'station' ? g.stations.find((st) => st.key === j.scope).name : Factions.get(j.scope).name;
      assert.strictEqual(j.title, `${name}: ${j.name}`, `${where}: ${j.id}`);
      const at = g.stations.filter((st) => Jobs.offeredAt(j, st));
      if (j.tier === 'station') assert.deepStrictEqual(at.map((st) => st.key), [j.scope]);
      if (j.tier === 'faction') assert(at.length && at.every((st) => st.owner === j.scope));
      assert(j.reward.credits >= 300 && j.reward.credits % 50 === 0, `${where}: ${j.reward.credits}`);
      const texts = [j.title, j.from, j.rewardText, ...j.briefing, ...j.report, ...j.debrief, ...j.steps.map((s) => s.label)];
      for (const t of texts) assert(typeof t === 'string' && t && !/undefined|null|NaN|\[object|[{}]/.test(t), `${where}: ${t}`);
      for (const s of j.steps) {
        if (s.type !== 'fight') continue;
        for (const st of g.stations) assert(dist(st, s.wave) >= (st.waystation ? 7500 : 2500), `${where}: a fight by ${st.name}`);
        for (const k of g.packs) assert(dist(k, s.wave) >= 2700, `${where}: a pack would join the fight`);
      }
      const listed = j.objectives.filter((o) => !o.hidden).map((o) => o.id);
      assert.deepStrictEqual(listed, j.steps.map((_, i) => `s${i}`), where);
    }
    const L = B.list.find((j) => j.tier === 'station').reward.loyalty;
    assert.strictEqual(L[0].n, 1, `${where}: loyalty`);
  }
  // The log keeps a job like the opening missions: accepted where, how many times, abandoned,
  // and progress that can go down again (goods sold before they're handed in).
  const B = Jobs.board(galaxies.get(1)), J = B.list.find((j) => j.steps.length === 1 && j.steps[0].type === 'bring');
  const log = Missions.create(null, B.byId);
  assert(log.accept(J.id, 'st1') && log.at(J.id) === 'st1' && log.attempt(J.id) === 1);
  log.set(J.id, 's0', J.steps[0].n);
  assert.strictEqual(log.status(J.id), 'ready');
  log.set(J.id, 's0', 0);
  assert.strictEqual(log.status(J.id), 'active', 'back to work');
  const back = Missions.create(JSON.parse(JSON.stringify(log.save())), B.byId);
  assert.deepStrictEqual(back.save(), log.save(), 'saved and read back');
  assert.strictEqual(Missions.create(log.save()).status(J.id), 'offered', 'a job the galaxy no longer has is dropped');
  assert(back.abandon(J.id) && back.status(J.id) === 'offered' && back.attempt(J.id) === 1 && !back.abandon(J.id));
  assert(!back.abandon('repayment'), 'the opening missions can\'t be abandoned');
  assert(back.accept(J.id, 'st2') && back.attempt(J.id) === 2 && back.count(J.id, 's0') === 0, 'taken again, from the start');
}));

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
    const s = Combat.create(mulberry32(i * 104729 + 3), Combat.combatant('p', 'Me', me), [0, 1].map((k) => Combat.combatant(`f${k}`, 'Fighter', fighter)));
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
    const rng = mulberry32(i * 7919 + 77);
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
    assert.strictEqual(Goods.type(S.module.kind).name, 'Electronics', 'drawn as electronics');
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
    const f = Combat.create(mulberry32(i * 31337 + 5), Combat.combatant('p', 'Me', me), [Combat.combatant('h', 'Android', foe)]);
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
    const rng = mulberry32(i * 7919 + 99), a = rng() * Math.PI * 2, r = 650 + rng() * 250;
    const f = RealtimeCombat.simulate(rng, RealtimeCombat.ship('player', 'Me', me, {}), [RealtimeCombat.ship('h', 'Android', foe, { x: Math.cos(a) * r, y: Math.sin(a) * r, angle: a + Math.PI / 2, radius: 18 })], face, { maxTime: 120 });
    if (f.over === 'won') wins++;
  }
  assert(wins > 95, `real time: won ${wins} of 100`);
});

test('the gate mission: the work spot by the gate, two waves of pirates, and a fight that isn\'t hard', () => {
  for (const [seed, g] of galaxies) {
    const where = `seed ${seed}`, G = Missions.gateSite(g), gate = g.gates[G.gate], W = g.stations[g.waystation];
    assert.deepStrictEqual(Missions.gateSite(g), G, `${where}: the same every time`);
    assert.strictEqual(gate.system, W.system, `${where}: the waystation's own gate`);
    assert(dist(G.work, gate) > 250 && dist(G.work, gate) < 500, `${where}: the work spot`);
    assert(dist(G.work, g.systems[gate.system].origin) < dist(gate, g.systems[gate.system].origin), `${where}: on the gate's inner side`);
    assert.deepStrictEqual(G.waves.map((w) => w.length), [1, 2]);
    const keys = G.waves.flat().map((p) => p.key);
    assert.strictEqual(new Set(keys).size, 3);
    for (const p of G.waves.flat()) {
      const c = { x: p.cx, y: p.cy };
      assert(Math.abs(dist(c, gate) - Missions.GATE.arrive) < 1, `${where}: ${p.key} arrives ${dist(c, gate).toFixed(0)} out`);
      assert(dist(c, G.work) < Missions.GATE.range, `${where}: ${p.key} too far to defend against`);
    }
    const [a, b] = G.waves[1];
    assert(dist({ x: a.cx, y: a.cy }, { x: b.cx, y: b.cy }) + a.orbit + b.orbit < CombatCore.config.groupRange, `${where}: the second wave fights together`);
  }
  // Objectives: the pirates and the return stay secret until they open.
  const ID = 'gate', log = Missions.create();
  log.accept(ID);
  assert.deepStrictEqual(log.objectives(ID).map((o) => o.id), ['reach', 'work']);
  assert(log.objectives(ID)[1].percent);
  log.set(ID, 'reach', 1);
  log.set(ID, 'ambush', 1);
  assert.deepStrictEqual(log.objectives(ID).map((o) => o.id), ['reach', 'work', 'pirates']);
  log.set(ID, 'work', 100);
  log.set(ID, 'pirates', 3);
  assert(log.open(ID, 'unlocked') && !log.open(ID, 'return'));
  log.set(ID, 'unlocked', 1);
  log.set(ID, 'return', 1);
  assert.strictEqual(log.status(ID), 'ready');
  // One Mk I pirate, then two more, without a repair between: the Courier the first mission
  // provides comes through almost always.
  const me = Loadout.stats(Missions.LIST.repayment.provides.loadout), foe = Loadout.stats(Loadout.npc('fighter', Missions.GATE.tier));
  let wins = 0;
  for (let i = 0; i < 300; i++) {
    const rng = mulberry32(i * 2654435 + 17);
    const one = Combat.create(rng, Combat.combatant('p', 'Me', me), [Combat.combatant('a', 'Pirate', foe)]);
    while (!one.over) Combat.round(one);
    if (one.over !== 'won') continue;
    const two = Combat.create(rng, Combat.combatant('p', 'Me', me, one.player.hull), [0, 1].map((k) => Combat.combatant(`b${k}`, 'Pirate', foe)));
    while (!two.over) Combat.round(two);
    if (two.over === 'won') wins++;
  }
  assert(wins / 300 > 0.95, `won both fights ${wins} of 300 times`);
});

const wingman = () => Squad.stats(Squad.member(3));

test('rounds: an ally fires on the target its orders name, and only then; a downed ally drops out', () => {
  const me = () => Combat.combatant('player', 'Me', COURIER), foe = (id) => Combat.combatant(id, 'Fighter', FIGHTER);
  const ally = () => Combat.combatant('w1', 'Cipher-07', wingman());
  // No orders: it holds fire.
  let s = Combat.create(mulberry32(1), me(), [foe('f1')], 'f1', [ally()]);
  let ev = Combat.round(s);
  assert(!ev.some((e) => e.from === 'w1'), 'no orders, no shots');
  // Ordered onto f2: every one of its volleys goes there.
  s = Combat.create(mulberry32(2), me(), [foe('f1'), foe('f2')], 'f1', [ally()]);
  Combat.setOrders(s, 'w1', { target: 'f2' });
  ev = Combat.round(s);
  const mine = ev.filter((e) => e.from === 'w1');
  assert(mine.length >= 1 && mine.every((e) => e.to === 'f2'), JSON.stringify(mine));
  // Enemies shoot at the ally now and then (about a third of them with one ally).
  let atAlly = 0;
  for (let i = 0; i < 300; i++) {
    const t = Combat.create(mulberry32(100 + i), me(), [foe('f1')], 'f1', [ally()]);
    if (t.enemies[0].aim === 'w1') atAlly++;
  }
  assert(atAlly > 60 && atAlly < 140, `${atAlly}/300 aimed at the ally`);
  // An ally shot down doesn't end the fight; the enemy turns on the player.
  s = Combat.create(mulberry32(3), me(), [foe('f1')], 'f1', [ally()]);
  s.enemies[0].aim = 'w1';
  s.allies[0].hull = 0;
  ev = Combat.round(s);
  assert(!s.over || s.over === 'won', s.over);
  assert(ev.filter((e) => e.from === 'f1').every((e) => e.to === 'player'));
  // With a wingman assisting, two fighters go down faster and the Courier keeps more hull.
  const duel = (withAlly) => {
    let rounds = 0, hull = 0;
    for (let i = 0; i < 200; i++) {
      const t = Combat.create(mulberry32(500 + i), me(), [foe('f1'), foe('f2')], 'f1', withAlly ? [ally()] : []);
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
  let s = RealtimeCombat.create(mulberry32(1), me(), [foe('f1', 4000, 0)], { allies: [ally(-600, 300)] });
  RealtimeCombat.setOrders(s, 'w1', { station: { x: -120, y: -95 } });
  for (let i = 0; i < 30 * 8; i++) RealtimeCombat.step(s, 1 / 30);
  assert(Math.hypot(s.allies[0].x + 120, s.allies[0].y + 95) < 60, `ally at ${s.allies[0].x.toFixed(0)}, ${s.allies[0].y.toFixed(0)}`);
  // Ordered onto an enemy: it closes in, locks and shoots it.
  s = RealtimeCombat.create(mulberry32(2), me(), [foe('f1', 900, 0)], { allies: [ally(-100, 100)] });
  RealtimeCombat.setOrders(s, 'w1', { target: 'f1' });
  const shots = [];
  for (let i = 0; i < 30 * 20 && !s.over; i++) shots.push(...RealtimeCombat.step(s, 1 / 30).filter((e) => e.type === 'shot' && e.from === 'w1'));
  assert(shots.length > 0 && shots.every((e) => e.to === 'f1'), `${shots.length} ally shots`);
  // Shot down: it drops out, and the fight goes on without it.
  s = RealtimeCombat.create(mulberry32(3), me(), [foe('f1', 700, 0)], { allies: [ally(-100, 100)] });
  s.enemies[0].aim = 'w1';
  s.allies[0].hull = 1;
  s.allies[0].shield = 0;
  let downed = false;
  for (let i = 0; i < 30 * 30 && !s.over && !downed; i++) downed = RealtimeCombat.step(s, 1 / 30).some((e) => e.type === 'shot' && e.to === 'w1' && e.destroyed);
  assert(downed, 'the ally was shot down');
  assert(!s.over, 'the fight goes on');
  assert.strictEqual(CombatCore.aimAt(s, s.enemies[0]), s.player, 'and the enemy turns on the player');
});

test('real time: an ally told to keep its distance stays out near gun range, and still hits', () => {
  const me = () => RealtimeCombat.ship('player', 'Me', COURIER, { x: -3000, radius: 16 });
  const foe = () => RealtimeCombat.ship('f1', 'Fighter', FIGHTER, { x: 1200, y: 0, angle: Math.PI, radius: 18 });
  const ally = () => RealtimeCombat.ship('w1', 'Cipher-07', wingman(), { x: 0, y: 0, radius: 18 });
  const run = (keep) => {
    const s = RealtimeCombat.create(mulberry32(4), me(), [foe()], { allies: [ally()] });
    s.enemies[0].aim = 'player'; // it goes for the player; the ally hunts it
    s.enemies[0].hull = s.enemies[0].shield = 1e6;
    RealtimeCombat.setOrders(s, 'w1', { target: 'f1', keep });
    let closest = Infinity, hits = 0;
    for (let i = 0; i < 30 * 20; i++) {
      hits += RealtimeCombat.step(s, 1 / 30).filter((e) => e.type === 'shot' && e.from === 'w1' && e.hits).length;
      if (i > 30 * 4) closest = Math.min(closest, Math.hypot(s.allies[0].x - s.enemies[0].x, s.allies[0].y - s.enemies[0].y));
    }
    return { closest, hits };
  };
  const close = run(false), far = run(true);
  const range = Math.max(...wingman().weapons.map((w) => w.range));
  assert(far.closest > range * 0.4, `kept ${far.closest.toFixed(0)} away (range ${range})`);
  assert(far.closest > close.closest + 100, `further than an attack run (${far.closest.toFixed(0)} vs ${close.closest.toFixed(0)})`);
  assert(far.hits > 0, 'and it still hits');
});

test('reputation: a change ripples through how the factions regard each other', () => {
  const rep = Reputation.empty();
  // Everyone starts neutral, but the aliens.
  for (const f of Factions.LIST) assert.strictEqual(Reputation.regard(rep, f.id), f.start, f.id);
  assert.strictEqual(Reputation.tier(Reputation.regard(rep, 'alien')).id, 'hostile');
  // The factions are neutral toward each other, so helping one moves no one else but the aliens,
  // who are hostile to everyone: they hold it against you.
  const moved = Reputation.change(rep, 'wedge', 20);
  assert.strictEqual(rep.wedge, 20);
  for (const id of ['block', 'shard', 'drifter', 'android']) assert.strictEqual(rep[id], undefined, id);
  assert.strictEqual(rep.alien, Factions.get('alien').start - 10);
  assert.deepStrictEqual(moved, { wedge: 20, alien: -10 });
  // And the other way: harming the aliens pleases everyone.
  const war = Reputation.empty();
  Reputation.change(war, 'alien', -20);
  for (const id of ['wedge', 'block', 'shard', 'drifter', 'android']) assert.strictEqual(war[id], 10, id);
  // Clamped, tiered, read back; a faction back at its start is forgotten.
  const big = Reputation.empty();
  for (let i = 0; i < 20; i++) Reputation.change(big, 'shard', 20);
  assert.strictEqual(big.shard, Reputation.MAX);
  assert.strictEqual(Reputation.tier(100).id, 'devoted');
  assert.strictEqual(Reputation.tier(0).id, 'neutral');
  assert.strictEqual(Reputation.tier(-100).id, 'hostile');
  assert.deepStrictEqual(Reputation.read({ wedge: 12.34, nope: 5, block: 'x', shard: 500, alien: Factions.get('alien').start, drifter: 0 }), { wedge: 12.3, shard: 100 });
  assert.strictEqual(Reputation.regard(Reputation.read({ alien: 0 }), 'alien'), 0, 'a peace with the aliens is kept');
  // A job: regard for its giver, the same taken from the faction it works against.
  const job = Reputation.empty();
  Reputation.earn(job, { tier: 'system', faction: 'block', against: 'drifter' });
  assert(job.block > 0 && job.drifter < 0, JSON.stringify(job));
  // The list, highest regard first; enemies from the matrix.
  assert.strictEqual(Reputation.ranked(rep)[0].id, 'wedge');
  const ids = (list) => list.map((f) => f.id).sort();
  assert.deepStrictEqual(ids(Reputation.hostiles('wedge')), ['alien']);
  assert.deepStrictEqual(ids(Reputation.hostiles('alien')), ['android', 'block', 'drifter', 'shard', 'wedge']);
  assert.deepStrictEqual(Reputation.allies('wedge'), []);
});

test('reputation: what regard does: prices, docking, pirates letting you pass', () => {
  const rep = Reputation.empty();
  assert.strictEqual(Reputation.priceShift(rep, 'wedge'), 0, 'neutral: the usual prices');
  rep.wedge = 70; rep.block = 20; rep.shard = -30; rep.drifter = -80; rep.android = -80;
  assert(Reputation.priceShift(rep, 'wedge') < Reputation.priceShift(rep, 'block'), 'devoted beats friendly');
  assert(Reputation.priceShift(rep, 'block') < 0 && Reputation.priceShift(rep, 'shard') > 0);
  // A friend's spread stays a spread: buying back never pays.
  assert(Economy.config.spread + Reputation.PRICE.devoted > 0);
  assert(!Reputation.refuses(rep, 'shard'), 'unfriendly still docks');
  assert(Reputation.refuses(rep, 'drifter'), 'hostile refuses');
  assert(!Reputation.refuses(rep, 'android'), 'a waystation never refuses');
  assert(!Reputation.passage(rep), 'pirates attack by default');
  rep.drifter = 20;
  assert(Reputation.passage(rep), 'friendly Drifters\' pirates let you pass');
  assert.match(Reputation.effects(rep, 'drifter').join(' '), /leave you be/);
  assert.match(Reputation.effects(rep, 'alien').join(' '), /refuse/);
  assert.match(Reputation.effects(rep, 'wedge').join(' '), /4% better prices/);
  assert.deepStrictEqual(Reputation.effects(rep, 'block', false), [], 'no stations, no word on prices');
  // The shift reaches the market: a friend's prices are better both ways.
  const st = { key: 'st-port', market: { kind: 'system', type: 'minor' } };
  const usual = Economy.market(7, st), friend = Economy.market(7, st, null, 0, Reputation.PRICE.devoted), foe = Economy.market(7, st, null, 0, Reputation.PRICE.unfriendly);
  for (let i = 0; i < usual.goods.length; i++) {
    const [u, f, x] = [usual.goods[i], friend.goods[i], foe.goods[i]];
    assert(f.sell >= u.sell && x.sell <= u.sell, `${u.kind}: sell ${x.sell} / ${u.sell} / ${f.sell}`);
    if (u.buy !== null) assert(f.buy <= u.buy && x.buy >= u.buy && f.buy > f.sell, `${u.kind}: buy ${x.buy} / ${u.buy} / ${f.buy}`);
  }
});

test('every icon code the UI uses has a line icon', () => {
  // The codes in the panels' sources (code: 'XYZ', and the codes rules give abilities, bays and
  // consumables), plus the tabs, slots, research groups and the context menu's actions.
  const src = ['station.js', 'research-view.js', 'industry-view.js', 'kit.js'].map((f) => fs.readFileSync(new URL(`../src/ui/${f}`, import.meta.url), 'utf8')).join('\n');
  const codes = new Set([...src.matchAll(/code: '([A-Z+]{1,4})'/g)].map((m) => m[1]));
  for (const a of Abilities.LIST) codes.add(a.code);
  for (const c of ['SCN', 'ENG', 'CPU', 'SYS', 'CMB', 'TAC', 'MNT', 'RCP', 'LAB', 'MOD', 'REF', 'FAB', 'ASM', 'tab-trade', 'tab-ship', 'tab-research', 'tab-industry', 'tab-squad', 'tab-missions', 'hold', 'hull', 'face', 'android', 'open',
    'dock', 'mine', 'collect', 'jump', 'attack', 'approach', 'cancel-approach']) codes.add(c);
  const missing = [...codes].filter((c) => !Glyphs.has(c));
  assert.deepStrictEqual(missing, [], 'codes with no icon');
  for (const n of Glyphs.names) assert.match(Glyphs.svg(n, 20), /^<svg viewBox="0 0 24 24" width="20" height="20"[^>]*>.+<\/svg>$/);
});

if (failed) {
  console.log(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log('\nall tests passed');
