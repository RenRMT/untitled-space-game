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
import { Regions } from '../src/world/regions.js';
import { ArtUtil } from '../src/art/util.js';
import { ArtCulture } from '../src/art/culture.js';
import { ArtBlueprints } from '../src/art/blueprints.js';
import { ArtItems } from '../src/art/items.js';
import { SpriteCache } from '../src/art/sprite-cache.js';
import { Entities } from '../src/flight/entities.js';
import { Scene } from '../src/flight/scene.js';
import { Interactions } from '../src/flight/interactions.js';
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

test('systems far apart joined by gates, grown from the capital by region; the tutorial on the rim with one gate', () => {
  const gap = Galaxy.params.gap;
  // About five minutes' flight between the edges at the starter Courier's top speed.
  assert(Math.abs(gap / Loadout.stats(Loadout.starter('courier')).maxSpeed - 300) < 1, `gap ${gap}`);
  const sizes = new Set();
  for (const [seed, g] of galaxies) {
    const where = `seed ${seed}`;
    const [a, b] = g.systems;
    sizes.add(g.systems.length);
    g.systems.forEach((s, i) => assert.strictEqual(s.index, i, `${where}: system ${i}`));
    assert.deepStrictEqual([a.origin.x, a.origin.y, a.star.x, a.star.y], [0, 0, 0, 0], `${where}: the first system is at the origin`);
    assert.deepStrictEqual(g.systems.map((s) => s.region.key).slice(0, 2), ['tutorial', 'gateway'], where);
    assert.strictEqual(b.radius, SolarSystem.params.radius / 2, `${where}: the second is half the usual size`);
    assert(Math.abs(dist(a.origin, b.origin) - a.radius - b.radius - gap) < 1e-6, `${where}: systems ${dist(a.origin, b.origin)} apart`);
    // Every region as planned, one capital, and every system at least `gap` from every other.
    for (const [key, [lo, hi]] of Galaxy.params.plan) {
      const n = g.systems.filter((s) => s.region.key === key).length;
      assert(n >= lo && n <= hi, `${where}: ${n} ${key} systems`);
    }
    assert.strictEqual(g.systems.filter((s) => s.region.key === 'capital').length, 1, `${where}: one capital system`);
    for (const s of g.systems) {
      assert.strictEqual(g.systemAt(s.star.x, s.star.y), s);
      for (const o of g.systems) if (o.index > s.index) assert(dist(s.origin, o.origin) - s.radius - o.radius >= gap - 1e-6, `${where}: ${s.name} and ${o.name} too close`);
    }
    const mid = { x: (a.origin.x + b.origin.x) / 2, y: (a.origin.y + b.origin.y) / 2 };
    assert.strictEqual(g.systemAt(mid.x, mid.y), null, `${where}: deep space between them`);
    assert.strictEqual(g.securityAt(mid.x, mid.y), 0);
    // Links: each pair once, between regions that route to each other; the tutorial's only one
    // to the gateway; every system reachable through the gates.
    const keyOf = (i) => g.systems[i].region.key;
    assert.strictEqual(new Set(g.links.map(([i, j]) => `${i}-${j}`)).size, g.links.length, `${where}: a link twice`);
    for (const [i, j] of g.links) {
      assert(i < j && j < g.systems.length, `${where}: link ${i}-${j}`);
      const [p, q] = [keyOf(i), keyOf(j)];
      const grew = Regions.REGIONS[p].parents.includes(q) || Regions.REGIONS[q].parents.includes(p) || Regions.linkChance(p, q) > 0 || (i === 0 && j === 1);
      assert(grew, `${where}: a ${p} system linked to a ${q} one`);
    }
    assert.deepStrictEqual(g.links.filter((l) => l.includes(0)), [[0, 1]], `${where}: the tutorial's links`);
    const reached = new Set([0]);
    for (let grew = true; grew;) {
      grew = false;
      for (const [i, j] of g.links) if (reached.has(i) !== reached.has(j)) { reached.add(i); reached.add(j); grew = true; }
    }
    assert.strictEqual(reached.size, g.systems.length, `${where}: systems no gate reaches`);
    // One gate each end of every link, in the outer system toward the other system.
    assert.strictEqual(g.gates.length, g.links.length * 2, `${where}: gates`);
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
      for (const o of home.gates) if (o !== gate) assert(dist(o, gate) > 4000, `${where}: ${gate.name} by ${o.name}`);
    }
    // The second system: everything inside its edge, a capital and some stations to dock at.
    for (const o of [...b.planets, ...b.stations, ...b.asteroids, ...b.wrecks]) assert(dist(o, b.origin) < b.radius, `${where}: ${o.name || o.key} outside the second system`);
    for (const p of b.planets) assert(Math.abs(dist(p, b.origin) - p.orbit) < 1e-6, `${where}: ${p.name} is off its orbit`);
    assert(b.planets.length >= 2 && b.stations.length >= 3, `${where}: ${b.planets.length} planets, ${b.stations.length} stations`);
    assert.strictEqual(b.stations.filter((x) => x.market.type === 'capital').length, 1, `${where}: one capital`);
    for (const st of b.stations) assert.strictEqual(g.securityAt(st.x, st.y), 2, `${where}: ${st.name} is not high security`);
    // Lists together, every id an index into them, every reference to the right system.
    for (const k of ['planets', 'moons', 'stations', 'packs', 'gates']) g[k].forEach((o, i) => assert.strictEqual(o.id, i, `${where}: ${k} ${i}`));
    for (const m of g.moons) assert(g.planets[m.parent].moons.includes(m.id) && g.planets[m.parent].system === m.system, `${where}: moon ${m.name}'s planet`);
    for (const st of g.stations) if (st.planet !== undefined) assert.strictEqual(g.planets[st.planet].system, st.system, `${where}: ${st.name}'s planet`);
    for (const c of g.contacts) if (c.pack !== undefined) assert.strictEqual(g.packs[c.pack].system, c.system, `${where}: ${c.id}'s pack`);
    assert.strictEqual(g.stations.length, g.systems.reduce((n, s) => n + s.stations.length, 0));
    for (const k of ['stations', 'asteroids', 'wrecks', 'gates', 'pockets']) assert.strictEqual(new Set(g[k].map((o) => o.key)).size, g[k].length, `${where}: ${k} keys`);
  }
  assert(sizes.size > 2, 'galaxies of different sizes');
});

test('the tutorial system is the one the seed always gave, whatever the rest of the galaxy', () => {
  // Generated on its own from the seed, as before the galaxy grew: the same star, planet, belt,
  // nebula, waystation and gate, and the gateway in the same direction.
  const G = Galaxy.params;
  const strip = (s) => JSON.parse(layout({ ...s, region: undefined, holder: undefined, branch: undefined, factions: undefined, situations: undefined, places: undefined, index: undefined }), (k, v) => (['system', 'link', 'owner'].includes(k) ? undefined : v));
  for (const seed of [1, 2, 7, 'abc', 'Untitled']) {
    const a0 = mulberry32(hashInt(seedToInt(seed), 0, 0x6a1a))() * Math.PI * 2, d = G.tutorial.radius + G.gap + G.gateway.radius;
    const alone = SolarSystem.generate(seed, {
      params: { ...SolarSystem.params, ...G.tutorial }, origin: { x: 0, y: 0 }, gates: [{ to: 1, angle: Math.atan2(Math.sin(a0) * d, Math.cos(a0) * d) }],
      waystation: { name: G.waystation.name, opposite: true },
    });
    const t = galaxies.get(seed).systems[0];
    const gate = { ...strip(t).gates[0], name: alone.gates[0].name };
    assert.deepStrictEqual({ ...strip(t), gates: [gate] }, strip(alone), `seed ${seed}`);
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
    // Safe throughout: high security, low in the nebula only if anywhere.
    for (let i = 0; i < 200; i++) {
      const a = i * 2.39996, d = Math.sqrt(i / 200) * s.radius, x = O.x + Math.cos(a) * d, y = O.y + Math.sin(a) * d;
      assert(s.securityAt(x, y) >= 1, `${where}: security ${s.securityAt(x, y)} at ${x.toFixed(0)},${y.toFixed(0)}`);
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
      assert.strictEqual(s.securityAt(st.x, st.y), 2, `${where}: ${st.name} is not high security`);
    }
  }
});

// ---------- Factions and the politics of each system ----------

test('sixteen factions, each with its six points, and the standing matrix of notes/factions.md', () => {
  assert.strictEqual(Factions.LIST.length, 16);
  assert.strictEqual(new Set(Factions.LIST.map((f) => f.id)).size, 16);
  for (const f of Factions.LIST) {
    for (const k of ['name', 'abbr', 'law', 'territory', 'ideals', 'drive', 'concern', 'color']) assert(typeof f[k] === 'string' && f[k].length, `${f.id}: ${k}`);
    assert(['power', 'breakaway', 'raiders', 'guild', 'neutral', 'hidden'].includes(f.kind), `${f.id}: ${f.kind}`);
    if (f.kind === 'breakaway') assert(Factions.hostile(f.id, f.of), `${f.id} is not hostile to ${f.of}`);
  }
  assert.strictEqual(Factions.MATRIX.length, 16);
  Factions.MATRIX.forEach((row, i) => {
    assert.strictEqual(row.length, 16, `row ${i}`);
    assert.strictEqual(row[i], 0, `row ${i}: itself`);
    for (const v of row) assert(v === null || (Number.isInteger(v) && v >= -5 && v <= 5), `row ${i}: ${v}`);
  });
  // Enforced neutrality: the Registry holds everyone at 0 and everyone holds it at 0, but the Remainder.
  for (const f of Factions.LIST) {
    assert.strictEqual(Factions.standing('registry', f.id), 0, f.id);
    assert.strictEqual(Factions.standing(f.id, 'registry'), f.id === 'remainder' ? -5 : 0, f.id);
  }
  // The hidden androids and the Thren are unknown to every human faction.
  for (const f of Factions.LIST.filter((x) => !['registry', 'remainder', 'thren', 'facet', 'pirates', 'unfaceted'].includes(x.id))) {
    assert.strictEqual(Factions.standing(f.id, 'remainder'), null, f.id);
    assert.strictEqual(Factions.standing(f.id, 'thren'), null, f.id);
  }
  // The hostile pairs at the start, and no others.
  const pairs = [['compact', 'brokenWheel'], ['compact', 'pirates'], ['combines', 'scorched'], ['combines', 'pirates'], ['union', 'blackline'], ['scorched', 'blackline'],
    ['freeClaim', 'blackline'], ['freeClaim', 'pirates'], ['facet', 'unfaceted'], ['remainder', 'registry'], ['remainder', 'combines'], ['remainder', 'breakers']];
  const key = (a, b) => [a, b].sort().join('/');
  const found = [];
  for (const a of Factions.LIST) for (const b of Factions.LIST) if (a.id < b.id && Factions.hostile(a.id, b.id)) found.push(key(a.id, b.id));
  assert.deepStrictEqual(found.sort(), pairs.map(([a, b]) => key(a, b)).sort());
  // Hostile pairs are hostile both ways where both know of the other, but for the Registry, whose
  // neutrality holds even towards the Remainder.
  for (const [a, b] of pairs) if (Factions.standing(b, a) !== null && b !== 'registry') assert(Factions.standing(a, b) <= -4 && Factions.standing(b, a) <= -4, `${a} and ${b}`);
});

test('each system has its region, holder, factions, stations owned to match and a situation with mission hooks', () => {
  const seen = new Set();
  for (const [seed, g] of galaxies) {
    for (const s of g.systems) {
      const where = `seed ${seed}: ${s.name}`, R = Regions.REGIONS[s.region.key];
      assert(R && s.region.label === R.label, where);
      assert.strictEqual(s.holder, R.holder, where);
      const here = new Set(s.factions.map((f) => f.id));
      assert.strictEqual(here.size, s.factions.length, `${where}: a faction twice`);
      for (const f of s.factions) assert(Factions.get(f.id) && f.hidden === Factions.get(f.id).hidden, `${where}: ${f.id}`);
      if (s.holder) assert.strictEqual(s.factions[0].id, s.holder, `${where}: the holder first`);
      assert.strictEqual(s.branch !== null, s.region.key === 'combine', `${where}: branch`);
      // Stations: the capital the holder's, the yard the Breakers', a waystation the Registry's;
      // a station of a faction with a culture is built in it, gates in the holder's.
      for (const st of s.stations) {
        assert(Factions.get(st.owner), `${where}: ${st.name} owned by ${st.owner}`);
        assert(here.has(st.owner), `${where}: ${st.name}'s owner isn't here`);
        if (st.market.type === 'capital') assert.strictEqual(st.owner, s.holder, `${where}: ${st.name}`);
        if (st.market.type === 'salvage yard') assert.strictEqual(st.owner, 'breakers', `${where}: ${st.name}`);
        if (st.waystation) assert.strictEqual(st.owner, 'registry', `${where}: ${st.name}`);
        if (s.index && Regions.CULTURE[st.owner] !== undefined) assert.strictEqual(st.culture, Regions.CULTURE[st.owner], `${where}: ${st.name}'s culture`);
      }
      if (s.index) for (const gate of s.gates) assert.strictEqual(gate.culture, Regions.CULTURE[s.holder] ?? R.build, `${where}: ${gate.name}'s culture`);
      // One or two situations from its region, every name filled in, every hook from and
      // against a faction that is here.
      assert(s.situations.length >= 1 && s.situations.length <= 2, `${where}: ${s.situations.length} situations`);
      for (const sit of s.situations) {
        const def = s.index ? Regions.SITUATIONS.find((x) => x.id === sit.id) : Regions.TUTORIAL;
        assert(def && (!s.index || def.regions.includes(s.region.key)), `${where}: ${sit.id}`);
        seen.add(sit.id);
        assert(sit.title && sit.text && !/[{}]/.test(sit.text), `${where}: ${sit.id}: ${sit.text}`);
        assert(sit.hooks.length >= 2, `${where}: ${sit.id} hooks`);
        for (const h of sit.hooks) {
          assert(!/[{}]/.test(h.text), `${where}: ${h.text}`);
          for (const id of [h.from, h.against].filter(Boolean)) assert(here.has(id) && sit.factions.includes(id), `${where}: ${sit.id}: ${id} isn't here`);
        }
      }
      if (s.index) assert.notStrictEqual(s.situations[0].id, s.situations[1]?.id, `${where}: the same situation twice`);
    }
    // The tutorial is the Registry's, its one station the waystation; the capital is the Compact's.
    assert.deepStrictEqual([g.systems[0].holder, g.systems[0].situations[0].id], ['registry', 'balance'], `seed ${seed}`);
  }
  // Across the galaxies, every situation turns up somewhere.
  for (const sit of Regions.SITUATIONS) assert(seen.has(sit.id), `${sit.id} never happens`);
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
  // As the flight view sets it up (game/docking.js): a ship at the origin, gaps measured to the edge.
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
    assert.ok(e.gas.type === g.nebulae[e.pocket.nebula].type && e.gas.seed === e.pocket.seed && e.radius > 30);
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

test('rarer items turn up less often: picks, floating cargo and market stock', () => {
  // Picks by rarity, for the category with the most levels (conduits: common to very rare).
  const counts = [0, 0, 0, 0, 0, 0];
  const r = mulberry32(99);
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

// ---------- Industry ----------

const STAGE_RANK = { raw: 0, salvage: 0, refined: 1, advanced: 2, part: 3, item: 4 };
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

test('gear is assembled: one recipe per piece, Mk I known, the rest by blueprint, the best from exotic salvage', () => {
  for (const [id, e] of Object.entries(Loadout.EQUIPMENT)) {
    const R = Recipes.gearRecipe(id);
    if (e.npc) { assert.strictEqual(R, null, `${id} is NPC gear`); continue; }
    assert(R && R.bay === 'assembler' && R.out[id] === 1 && Recipes.producers(id).length === 1, id);
    assert.strictEqual(R.unlock, e.tier === 1 ? null : `bp.${id}`);
    assert.strictEqual(Research.blueprintFor(id), e.tier === 1 ? null : `bp.${id}`);
    const salvage = Object.keys(R.in).filter(Goods.isSalvage).map((k) => Goods.type(k).tier);
    assert.deepStrictEqual(salvage.sort(), e.tier === 5 ? [4, 5] : e.tier === 4 ? [4] : [], `${id}: complex and exotic components`);
  }
  // Blueprints: each needs the Mk before it in its line; the best take exotic components.
  for (const p of Object.values(Research.PACKAGES).filter((x) => x.kind === 'blueprint')) {
    assert(Loadout.EQUIPMENT[p.gear] && p.id === `bp.${p.gear}` && Recipes.known([p.id]).has(`make.${p.gear}`));
    const before = `bp.${p.line}-${p.tier - 1}`;
    assert.deepStrictEqual(p.requires, Research.PACKAGES[before] ? [before] : []);
    if (p.tier === 5) assert(Object.keys(p.cost).some((k) => Goods.type(k)?.tier === 5), `${p.id} needs an exotic component`);
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
  assert(!Recipes.known([]).has('alt.graphene') && Recipes.known(['ind.alt.graphene']).has('alt.graphene'));
  assert.deepStrictEqual(Recipes.producers('graphene').map((r) => r.id).sort(), ['alt.graphene', 'make.graphene', 'recycle.computer-advanced']);
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
  // Sources: mined, collected or made.
  const mined = new Set();
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const s = systems.get(seed);
    for (const e of thingsOf(seed, 'asteroid')) { const y = Mining.yieldOf(s.seed, e); if (y) mined.add(y.kind); }
    for (const e of thingsOf(seed, 'gas')) for (const y of Mining.gasOf(s.seed, e)) mined.add(y.kind);
  }
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
  const read = Economy.read({ a: { [ore.kind]: { stock: 5, at: T }, nope: { stock: 1, at: T }, 'hull-simple': { stock: 1, at: T } }, b: { iron: { stock: NaN, at: T } }, c: 3 });
  assert.deepStrictEqual(read, { a: { [ore.kind]: { stock: 5, at: T } } });
});

// Stations of each type, as the scene names them.
const CAMP = { key: 'st-camp', name: 'Almar Camp', type: 'mining camp' };
const PORT = { key: 'st-port', name: 'Rito Port', type: 'minor' };
const HUB = { key: 'st-hub', name: 'Corlital Hub', type: 'major' };
const YARD = { key: 'st-yard', name: 'Kesh Yard', type: 'salvage yard' };
// A refinery order at a mining camp making copper cable, and a fabricator order at a minor station
// making electronics from it, through the one storage.
function cableWorks(T, { ore = 40, silicates = 20 } = {}) {
  const state = Industry.empty(), env = Industry.env(Research.empty());
  Industry.deposit(state, 'copper-ore', ore, env, T);
  Industry.deposit(state, 'silicates', silicates, env, T);
  const a = Industry.place(state, CAMP, 'make.copper-cable', null, env, T);
  const b = Industry.place(state, PORT, 'make.electronics', null, env, T);
  return { state, env, a, b };
}
const statusOf = (state, o) => Industry.status(state, o).id;

test('production: a refinery order feeds a fabricator order at another station through storage, while away too', () => {
  const T = 1e12, { state, env, a, b } = cableWorks(T);
  assert.strictEqual(statusOf(state, a), 'running');
  assert.deepStrictEqual(Industry.status(state, b), { id: 'starved', missing: 'copper-cable' }, 'no cable yet: the input is named');
  const { log } = Industry.settle(state, T + 3600e3, env);
  // 40 ore make 20 cables, 20 silicates make 20 electronics from them.
  assert.strictEqual(state.storage.electronics, 20);
  assert.strictEqual(state.storage['copper-cable'], undefined);
  assert.strictEqual(state.storage['copper-ore'], undefined);
  assert.strictEqual(log.length, 40);
  assert(log.every((x, i) => !i || x.at >= log[i - 1].at), 'in time order');
  assert.deepStrictEqual([statusOf(state, a), statusOf(state, b)], ['starved', 'starved'], 'out of inputs');
  assert.deepStrictEqual(Industry.summary(state, log), ['Almar Camp: 20 × Copper cable', 'Rito Port: 20 × Electronics']);
  // More ore, and the refinery takes it up at once.
  Industry.deposit(state, 'copper-ore', 2, env, T + 3600e3);
  assert.strictEqual(statusOf(state, a), 'running');
  // One order per station; a shipyard takes the next step.
  assert.strictEqual(Industry.place(state, CAMP, 'make.steel-pipe', null, env, T), null, 'one order per station');
  assert(Industry.place(state, HUB, 'make.flight-computer-1', 2, env, T), 'Mk I flight computers from the electronics');
});

test('production: settling in many steps comes out the same as in one, and a clock set back undoes nothing', () => {
  const T = 1e12, end = T + 30 * 60e3;
  const once = cableWorks(T);
  Industry.settle(once.state, end, once.env);
  const r = mulberry32(5);
  for (let trial = 0; trial < 20; trial++) {
    const many = cableWorks(T);
    const times = Array.from({ length: 10 }, () => T + r() * (end - T)).sort((a, b) => a - b);
    for (const t of times) Industry.settle(many.state, t, many.env);
    Industry.settle(many.state, T, many.env); // the clock set back
    Industry.settle(many.state, end, many.env);
    assert.deepStrictEqual(many.state, once.state);
  }
  // A cap on runs per call stops part way, and the next call goes on to the same end.
  const capped = cableWorks(T);
  assert(Industry.settle(capped.state, end, capped.env, 5).truncated);
  while (Industry.settle(capped.state, end, capped.env, 5).truncated);
  assert.deepStrictEqual(capped.state, once.state);
});

test('production: stages by station type, room in storage, counts, pausing, cancelling and priority', () => {
  const T = 1e12, env = Industry.env(Research.empty()), state = Industry.empty();
  // Each station type does one stage.
  assert(Industry.canMake('mining camp', 'make.steel-pipe') && Industry.canMake('salvage yard', 'recycle.hull-simple'));
  assert(Industry.canMake('minor', 'make.electronics') && Industry.canMake('waystation', 'make.actuator'));
  assert(Industry.canMake('capital', 'make.pulse-laser-1') && Industry.canMake('major', 'make.shield-cell'));
  assert(!Industry.canMake('mining camp', 'make.pulse-laser-1') && !Industry.canMake('capital', 'make.steel-pipe') && !Industry.canMake('minor', 'make.copper-cable'));
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
  Industry.deposit(state, 'hull-simple', 1, env, T);
  Industry.deposit(state, 'iron', 1000, env, T);
  const rec = Industry.place(state, YARD, 'recycle.hull-simple', null, env, T);
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
  assert.strictEqual(Industry.place(state, CAMP, 'make.copper-cable', null, env, T), null);
  lab.done.push('ind.bays.1');
  lab.doneAt['ind.bays.1'] = T;
  assert(Industry.place(state, CAMP, 'make.copper-cable', null, env, T), 'a second slot');
  assert.strictEqual(Industry.place(state, CAMP, 'make.carbon-fibre', null, env, T), null);
  // Loyalty: a station takes orders once missions done for it have raised its loyalty.
  assert(!Industry.trusted({}, HUB.key) && !Industry.trusted({ [HUB.key]: 0 }, HUB.key));
  assert.strictEqual(Industry.place(state, HUB, 'make.pulse-laser-1', null, env, T, {}), null, 'untrusted: refused');
  assert(Industry.place(state, HUB, 'make.pulse-laser-1', null, env, T, { [HUB.key]: 1 }), 'trusted: taken');
});

test('production: the pipeline links orders by what they make, and shows the gaps', () => {
  const T = 1e12, env = Industry.env(Research.empty()), state = Industry.empty();
  // Copper ore → cable (camp) → electronics (port) → actuators (waystation, with steel pipe no
  // order makes) and Mk I flight computers (hub); carbon fibre at a yard, linked to nothing.
  const cable = Industry.place(state, CAMP, 'make.copper-cable', null, env, T);
  const elec = Industry.place(state, PORT, 'make.electronics', null, env, T);
  const act = Industry.place(state, { key: 'st-way', name: 'Waystation', type: 'waystation' }, 'make.actuator', null, env, T);
  const fc = Industry.place(state, HUB, 'make.flight-computer-1', null, env, T);
  const lone = Industry.place(state, YARD, 'make.carbon-fibre', null, env, T);
  const groups = Industry.pipelines(state);
  const chain = groups.find((g) => !g.standalone);
  assert.deepStrictEqual(chain.orders.map((o) => o.id), [cable.id, elec.id, act.id, fc.id]);
  const link = (a, b, kind) => chain.links.some((l) => l.from === a.id && l.to === b.id && l.kind === kind);
  assert(link(cable, elec, 'copper-cable') && link(elec, act, 'electronics') && link(elec, fc, 'electronics'));
  assert.deepStrictEqual(chain.end.sort(), ['actuator', 'flight-computer-1'], 'what no order uses is an end product, not a gap');
  // Steel pipe isn't raw and no order makes it: a gap, for a refinery. Ore and silicates are raw: not flagged.
  assert.deepStrictEqual(chain.gaps, [{ order: act.id, kind: 'steel-pipe', stage: 'refinery' }]);
  const solo = groups.find((g) => g.standalone);
  assert.deepStrictEqual([solo.orders.map((o) => o.id), solo.links, solo.gaps], [[lone.id], [], []], 'linked to nothing: standalone');
  // Lineage: where an order's inputs come from.
  Industry.deposit(state, 'electronics', 3, env, T);
  assert.deepStrictEqual(Industry.lineage(state, 'make.actuator', Recipes.known()).map((x) => [x.kind, x.source, x.stage]),
    [['steel-pipe', 'stage', 'refinery'], ['electronics', 'storage', 'fabricator']]);
  assert.deepStrictEqual(Industry.lineage(state, 'make.electronics', Recipes.known()).map((x) => [x.kind, x.source]), [['copper-cable', 'order'], ['silicates', 'raw']]);
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
  assert.strictEqual(Goods.resolve('gas'), 'water-ice');
  assert.strictEqual(Goods.resolve('hull'), 'hull-simple');
  assert.strictEqual(Goods.resolve(undefined, 'Railgun barrel'), 'weapon-simple');
  assert.strictEqual(Goods.resolve(undefined, 'Ore crystals'), 'silicates');
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
  assert(packs[1].length > packs[2].length, `packs per level: ${packs.map((b) => b.length)}`);
  assert(mean(packs[0]) > mean(packs[1]) && mean(packs[1]) > mean(packs[2]), `pack sizes: ${packs.map((b) => (b.length ? mean(b).toFixed(1) : '-'))}`);
  assert(share(packs[1], 1) > 0.35 && packs[2].every((n) => n === 1), 'safer space has mostly lone pirates');
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

test('the first system has an android waystation alone on its outer edge, in a safe zone', () => {
  for (const [seed, g] of galaxies) {
    const where = `seed ${seed}`, s = g.systems[0];
    const ways = g.stations.filter((st) => st.waystation);
    // Others are spread thin: at most one a system, the gateway's always, each with its own number.
    assert.deepStrictEqual(s.stations.filter((st) => st.waystation).length, 1, `${where}: one waystation in the first system`);
    for (const o of g.systems) assert(o.stations.filter((st) => st.waystation).length <= 1, `${where}: waystations in ${o.name}`);
    assert.strictEqual(g.systems[1].stations.find((st) => st.waystation).name, 'Waystation HD-1908', where);
    assert.strictEqual(new Set(ways.map((st) => st.name)).size, ways.length, `${where}: waystation numbers`);
    assert(ways.length < (g.systems.length * 2) / 3, `${where}: ${ways.length} waystations`);
    for (const o of ways) assert(o.culture === SolarSystem.ANDROID && o.owner === 'registry', `${where}: ${o.name}`);
    const w = ways[0];
    assert.strictEqual(g.stations[g.waystation], w);
    assert.strictEqual(w.system, 0, `${where}: in the first system`);
    assert.strictEqual(w.name, 'Waystation HD-1863');
    assert.strictEqual(w.culture, SolarSystem.ANDROID);
    assert.deepStrictEqual(w.market, { kind: 'outpost', type: 'waystation' });
    const out = Math.hypot(w.x - s.origin.x, w.y - s.origin.y) / s.radius;
    assert(out > 0.85 && out < 0.95, `${where}: ${out.toFixed(2)} of the radius out`);
    assert.strictEqual(g.securityAt(w.x, w.y), 2, `${where}: high security`);
    for (const o of g.stations) if (o !== w) assert(dist(o, w) > 7000, `${where}: ${o.name} too close`);
    for (const o of g.gates) assert(dist(o, w) > 7000, `${where}: ${o.name} too close`);
    for (const n of s.nebulae) assert(dist(n, w) > n.r + 6000, `${where}: ${n.name} too close`);
    for (const k of g.packs) assert(dist(k, w) > 6000, `${where}: pirates by the waystation`);
    assert.ok(Economy.market(g.seed, w).goods.some((x) => x.buy !== null), `${where}: something for sale`);
    // Every other station is built by humans; gates and wrecks too.
    for (const o of [...g.stations.filter((x) => !x.waystation), ...g.gates, ...g.wrecks]) assert(o.culture < SolarSystem.SETTLED, `${where}: ${o.key}`);
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
  assert.strictEqual(Squad.stats(m).weapons[0].name, 'Pulse laser Mk III');
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
const boards = new Map([...galaxies].map(([seed, g]) => [seed, Jobs.board(g)]));

test('jobs: every station posts its own, every situation hook is a job, and the factions post theirs', () => {
  for (const [seed, g] of galaxies) {
    const where = `seed ${seed}`, B = boards.get(seed);
    assert.deepStrictEqual(Jobs.board(g).list.map((j) => [j.id, j.reward.credits]), B.list.map((j) => [j.id, j.reward.credits]), `${where}: the same every time`);
    assert.strictEqual(new Set(B.list.map((j) => j.id)).size, B.list.length, `${where}: ids unique`);
    for (const st of g.stations) {
      const own = B.list.filter((j) => j.tier === 'station' && j.scope === st.key);
      if (st.system === 0) assert.strictEqual(own.length, 0, `${where}: the tutorial's waystation has its own missions`);
      else assert(own.length >= 1 && own.length <= 2, `${where}: ${st.name} posts ${own.length}`);
    }
    for (const s of g.systems.slice(1)) {
      for (const sit of s.situations) for (const h of sit.hooks) assert(B.byId[`sy/${s.index}/${sit.id}/${h.i}`], `${where}: ${s.name}: ${sit.id} hook ${h.i} has no job`);
    }
    for (const f of ['compact', 'combines', 'facet', 'freeClaim', 'breakers']) assert(B.list.some((j) => j.tier === 'faction' && j.scope === f), `${where}: ${f} posts nothing`);
    // Named for who offers it, and offered where it should be.
    for (const j of B.list) {
      const name = j.tier === 'station' ? g.stations.find((st) => st.key === j.scope).name : j.tier === 'system' ? g.systems[j.scope].name : Factions.get(j.scope).name;
      assert.strictEqual(j.title, `${name}: ${j.name}`, `${where}: ${j.id}`);
      const at = g.stations.filter((st) => Jobs.offeredAt(j, st));
      assert(at.length >= 1, `${where}: ${j.id} offered nowhere`);
      if (j.tier === 'station') assert.deepStrictEqual(at.map((st) => st.key), [j.scope]);
      if (j.tier === 'system') assert(at.every((st) => st.system === j.scope) && at.length === g.systems[j.scope].stations.length);
      if (j.tier === 'faction') assert(at.every((st) => st.owner === j.scope));
    }
  }
});

test('jobs: steps in their systems, fights clear of stations and packs, texts complete', () => {
  for (const [seed, g] of galaxies) {
    for (const j of boards.get(seed).list) {
      const where = `seed ${seed}: ${j.id}`;
      const texts = [j.title, j.from, j.rewardText, ...j.briefing, ...j.report, ...j.debrief, ...j.steps.flatMap((s) => [s.label, ...(s.say || [])])];
      for (const t of texts) assert(typeof t === 'string' && t && !/undefined|null|NaN|\[object|[{}]/.test(t), `${where}: ${t}`);
      assert(j.briefing.length >= 2 && j.debrief.length >= 1, `${where}: exposition and resolution`);
      j.steps.forEach((s, i) => {
        if (s.say) assert(i > 0, `${where}: the first step's news is the briefing's`);
        for (const p of [...(s.points || []), ...(s.items || []), s.wave, s.at, ...(s.pockets || [])].filter(Boolean)) {
          const sys = g.systemAt(p.x, p.y);
          assert(sys && sys.index === p.system, `${where}: step ${i} outside its system`);
        }
        if (s.type === 'fight' && !s.wave.rush) {
          const w = s.wave, sys = g.systems[w.system];
          for (const st of sys.stations) assert(dist(st, w) >= (st.waystation ? 7500 : 2500), `${where}: a fight by ${st.name}`);
          for (const k of sys.packs) assert(dist(k, w) >= 2700, `${where}: a pack would join the fight`);
        }
        if (s.type === 'fight') assert(s.wave.tier >= 1 && s.wave.tier <= Jobs.TIERS[j.tier].cap + 1 && s.wave.ships.length >= 1, `${where}: tier ${s.wave.tier}`);
        if (s.type === 'gas') for (const q of s.pockets) assert.strictEqual(g.nebulaAt(q.x, q.y), g.nebulae[s.nebula], `${where}: a pocket outside its nebula`);
        if (s.type === 'bring') assert(Goods.type(s.kind) && !Goods.isSalvage(s.kind) && s.n >= 1, `${where}: ${s.kind}`);
      });
      if (j.handIn) assert.strictEqual(j.steps[j.steps.length - 1].points[0].station, j.handIn, `${where}: delivered where it's handed in`);
      if (j.escort) assert(j.steps.some((s) => s.type === 'go'), `${where}: an escort goes somewhere`);
    }
  }
});

test('jobs: pay by tier and difficulty, loyalty to whom they help, and objectives the log can keep', () => {
  const pay = { station: [], system: [], faction: [] };
  for (const [seed, g] of galaxies) {
    for (const j of boards.get(seed).list) {
      const where = `seed ${seed}: ${j.id}`;
      pay[j.tier].push(j.reward.credits);
      assert(j.reward.credits >= 300 && j.reward.credits % 50 === 0, `${where}: ${j.reward.credits}`);
      // A fight pays well over what its pirates would leave (their loot is the player's besides).
      const ships = j.steps.filter((s) => s.type === 'fight').reduce((n, s) => n + s.wave.ships.length * s.wave.tier, 0);
      assert(j.reward.credits >= 150 * ships, `${where}: ${j.reward.credits} for ${ships} ship-tiers`);
      const L = j.reward.loyalty;
      if (j.tier === 'station') assert.deepStrictEqual(L.map((l) => [l.keys, l.n]), [[[j.scope], 1]], where);
      if (j.tier === 'faction') assert(L[0] && L[0].n === 1 && L[0].keys.every((k) => g.stations.find((st) => st.key === k).owner === j.scope), where);
      if (j.tier === 'system') {
        for (const l of L) for (const k of l.keys) {
          const st = g.stations.find((x) => x.key === k);
          assert(st.system === j.scope && st.owner === (l.n > 0 ? j.faction : j.against), `${where}: ${st.name}`);
        }
      }
      // Each step a listed objective, in order; a step's lines come before it.
      const listed = j.objectives.filter((o) => !o.hidden).map((o) => o.id);
      assert.deepStrictEqual(listed, j.steps.map((_, i) => `s${i}`), where);
      j.steps.forEach((s, i) => { if (s.say) assert.deepStrictEqual(j.byId[`s${i}`].after, [`m${i}`], where); });
    }
  }
  const median = (l) => [...l].sort((a, b) => a - b)[l.length >> 1];
  assert(median(pay.station) < median(pay.system) && median(pay.system) < median(pay.faction), `medians ${median(pay.station)} / ${median(pay.system)} / ${median(pay.faction)}`);
  assert(median(pay.station) >= 600 && median(pay.faction) >= 6000, 'worth doing');
  // The log keeps a job like the opening missions: accepted where, how many times, abandoned,
  // and progress that can go down again (goods sold before they're handed in).
  const B = boards.get(1), J = B.list.find((j) => j.steps.length === 1 && j.steps[0].type === 'bring');
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
  const moved = Reputation.change(rep, 'union', 20);
  assert.strictEqual(rep.union, 20);
  // Read down the Union's column: Free Claim (+3) and the Scorched (+2) are pleased, the Combines
  // (-3) and Blackline (-4) are not.
  assert.strictEqual(rep.freeClaim, 6);
  assert.strictEqual(rep.scorched, 4);
  assert.strictEqual(rep.combines, -6);
  assert.strictEqual(rep.blackline, -8);
  assert.strictEqual(rep.registry, undefined, 'the Registry holds everyone at 0');
  assert.strictEqual(moved.blackline, -8);
  // Helping the Registry moves no one the player knows of; factions that don't know a faction exists don't react.
  const reg = Reputation.empty();
  Reputation.change(reg, 'registry', 30);
  assert.deepStrictEqual(Reputation.visible().filter((f) => reg[f.id]).map((f) => f.id), ['registry']);
  assert(reg.remainder < 0, 'only the Remainder, which no one knows of yet, holds a grudge');
  const rem = Reputation.empty();
  Reputation.change(rem, 'remainder', -10);
  assert.strictEqual(rem.compact, undefined, 'the Compact doesn\'t know the Remainder');
  // Clamped, tiered, read back.
  const big = Reputation.empty();
  for (let i = 0; i < 20; i++) Reputation.change(big, 'facet', 20);
  assert.strictEqual(big.facet, Reputation.MAX);
  assert.strictEqual(Reputation.tier(100).id, 'devoted');
  assert.strictEqual(Reputation.tier(0).id, 'neutral');
  assert.strictEqual(Reputation.tier(-100).id, 'hostile');
  assert.deepStrictEqual(Reputation.read({ union: 12.34, nope: 5, compact: 'x', facet: 500 }), { union: 12.3, facet: 100 });
  // A job: regard for its giver, the same taken from the faction it works against.
  const job = Reputation.empty();
  Reputation.earn(job, { tier: 'system', faction: 'freeClaim', against: 'pirates' });
  assert(job.freeClaim > 0 && job.pirates < 0, JSON.stringify(job));
  // The list: known factions only, highest regard first; allies and enemies from the matrix.
  const names = Reputation.ranked(rep).map((f) => f.id);
  assert.strictEqual(names[0], 'union');
  assert(!names.includes('remainder') && !names.includes('thren'));
  const ids = (list) => list.map((f) => f.id).sort();
  assert.deepStrictEqual(ids(Reputation.hostiles('compact')), ['brokenWheel', 'pirates']);
  assert(ids(Reputation.allies('combines')).includes('breakers'), 'the Combines count on the Breakers');
  for (const f of Reputation.visible()) {
    for (const a of Reputation.allies(f.id)) assert(!Reputation.hostiles(f.id).includes(a), `${f.id} both allied with and hostile to ${a.id}`);
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
