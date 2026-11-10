// Node checks for the main game's rules, world and flight. No dependencies: `node tests/game.js` (ONLY=text runs the tests whose
// names include it); `node tests/run.js` runs every game's.

import assert from 'node:assert';
import fs from 'node:fs';
import { mulberry32, seedToInt } from '../src/core/rng.js';
import { Save } from '../src/core/save.js';
import { Goods } from '../src/rules/goods.js';
import { Security } from '../src/world/security.js';
import { SYSTEM_CONFIG } from '../src/world/system-config.js';
import { SolarSystem } from '../src/world/solar-system.js';
import { Galaxy } from '../src/world/galaxy.js';
import { GalaxyShape } from '../src/world/galaxy-shape.js';
import { DeepSpace } from '../src/world/deep-space.js';
import { Orbits } from '../src/world/orbits.js';
import { Factions } from '../src/world/factions.js';
import { ArtUtil } from '../src/art/util.js';
import { ArtCulture } from '../src/art/culture.js';
import { ArtBlueprints } from '../src/art/blueprints.js';
import { ArtItems } from '../src/art/items.js';
import { SpriteCache } from '../src/art/sprite-cache.js';
import { Entities } from '../src/flight/entities.js';
import { Scene } from '../src/flight/scene.js';
import { DeepSites } from '../src/flight/deep-sites.js';
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
import { Restoration } from '../src/rules/restoration.js';
import { Logistics } from '../src/rules/logistics.js';
import { Mods } from '../src/rules/mods.js';
import { Loot } from '../src/rules/loot.js';
import { Survey } from '../src/rules/survey.js';
import { Vendor } from '../src/rules/vendor.js';
import { Progress } from '../src/rules/progress.js';
import { Structures } from '../src/rules/structures.js';
import { Abilities } from '../src/rules/abilities.js';
import { Classes } from '../src/rules/classes.js';
import { CombatCore } from '../src/combat/combat-core.js';
import { Combat } from '../src/combat/combat.js';
import { RealtimeCombat } from '../src/combat/combat-realtime.js';
import { JobTexts } from '../src/story/job-texts.js';
import { Jobs } from '../src/story/jobs.js';
import { Missions } from '../src/story/missions.js';
import { Glyphs } from '../src/ui/glyphs.js';
import { ScreenFx } from '../src/rules/screen-fx.js';
import { Lab } from '../src/rules/lab.js';
import * as AppSw from '../tools/app-sw.js';
import { Sound } from '../src/core/sound.js';
import { PilotLog } from '../src/rules/log.js';
import { finish, off, test } from './harness.js';

const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1).concat(['abc', 'Untitled']);

// Whole galaxies (about forty systems each) for fewer seeds than the systems on their own.
const GALAXY_SEEDS = SEEDS.slice(0, 10).concat(['abc', 'Untitled']);

const galaxies = new Map(GALAXY_SEEDS.map((s) => [s, Galaxy.generate(s, SYSTEM_CONFIG)]));

// A system as the generator makes one from each seed on its own, with its default params (the
// galaxy's start system is a showcase of one of each thing: see its own test).
const systems = new Map(SEEDS.map((seed) => [seed, SolarSystem.generate(seed, { params: SYSTEM_CONFIG.params })]));

// The flight view's scene of a galaxy, built once per seed, every system of it (it builds them
// lazily, as the flight view comes near: see its own test).
const scenes = new Map();

const sceneOf = (seed) => {
  if (!scenes.has(seed)) { const g = galaxies.get(seed), sc = Scene.create(g, ArtCulture.forGalaxy(g)); sc.ensureAll(); scenes.set(seed, sc); }
  return scenes.get(seed);
};

// A scene with every system built.
const fullScene = (g, cultures = ArtCulture.forGalaxy(g)) => { const sc = Scene.create(g, cultures); sc.ensureAll(); return sc; };

// A system's things of a kind (deep-space sites' own, flight/deep-sites.js, have keys starting 'd' or a site).
const thingsOf = (seed, kind) => sceneOf(seed).entities.filter((e) => e.kind === kind && !e.site && !String(e.key || '').startsWith('d'));

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

// The galaxy as the showcase alone (galaxy.spiral false): the game's start system, generated on its
// own (the idle game's layout 1 too).
const SHOWCASE = { ...SYSTEM_CONFIG, galaxy: { ...SYSTEM_CONFIG.galaxy, spiral: false } };

const showcases = new Map(SEEDS.slice(0, 12).concat(['abc']).map((s) => [s, Galaxy.generate(s, SHOWCASE)]));

test('the showcase alone: one of each planet, moon and station, a field, a nebula, and a gate and wormhole into each other', () => {
  const MOON_TYPES = ['grey', 'ice', 'rust', 'dark', 'sulfur'];
  for (const [seed, g] of showcases) {
    const where = `seed ${seed}`;
    assert.strictEqual(g.systems.length, 1, `${where}: systems`);
    const [s] = g.systems;
    assert.deepStrictEqual([s.index, s.origin.x, s.origin.y, s.star.x, s.star.y], [0, 0, 0, 0, 0], `${where}: the system is at the origin`);
    assert.deepStrictEqual(g.links, [], `${where}: no links to other systems`);
    assert.strictEqual(g.systemAt(0, 0), s);
    assert.strictEqual(g.systemAt(s.radius * 2, 0), null, `${where}: deep space beyond the edge`);
    assert.strictEqual(g.securityAt(s.radius * 2, 0), 0);
    assert.deepStrictEqual([g.shape, g.sites], [null, []], `${where}: no galaxy round it`);
    // One of each planet and moon type, no belts, one field and one nebula.
    assert.deepStrictEqual(s.planets.map((p) => p.type).sort(), [...PLANET_TYPES].sort(), `${where}: planets`);
    assert.deepStrictEqual(s.moons.map((m) => m.type).sort(), [...MOON_TYPES].sort(), `${where}: moons`);
    assert.deepStrictEqual([s.belts.length, s.fields.length, s.nebulae.length], [0, 1, 1], `${where}: belts, fields, nebulae`);
    // One of each station: the capital first (the start), with the waystation on the outer edge.
    const types = s.stations.map((st) => (st.waystation ? 'waystation' : st.market.type));
    assert.deepStrictEqual([...types].sort(), ['capital', 'major', 'minor', 'mining camp', 'salvage yard', 'transport hub', 'waystation'].sort(), `${where}: stations`);
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

test('the galaxy: a barred spiral from the seed, its zones where they belong', () => {
  for (const seed of [1, 7, 'abc']) {
    const a = GalaxyShape.create(seed), b = GalaxyShape.create(seed), R = a.R;
    assert.strictEqual(JSON.stringify([a.bar, a.arms]), JSON.stringify([b.bar, b.arms]), `seed ${seed}: the same shape every time`);
    assert(a.arms.filter((x) => x.major).length === 2 && a.arms.length <= 4, `seed ${seed}: two major arms and up to two spurs`);
    // The major arms rise from the bar's two ends and reach out toward the rim.
    for (const arm of a.arms.filter((x) => x.major)) {
      const root = a.armPoint(arm, 0), tip = a.armPoint(arm, 1);
      assert(Math.abs(Math.hypot(root.x, root.y) - a.bar.half) < 1, `seed ${seed}: an arm starts at the bar's end`);
      assert(Math.hypot(tip.x, tip.y) > 0.9 * R, `seed ${seed}: an arm reaches the rim`);
      for (const t of [0.3, 0.6, 0.9]) {
        const p = a.armPoint(arm, t);
        assert.strictEqual(a.zoneAt(p.x, p.y).zone, 'arm', `seed ${seed}: on an arm's spine at ${t}`);
      }
    }
    assert.strictEqual(a.zoneAt(0, 0).zone, 'core');
    assert.strictEqual(a.zoneAt(Math.cos(a.bar.angle) * a.bar.half * 0.8, Math.sin(a.bar.angle) * a.bar.half * 0.8).zone, 'bar');
    assert.strictEqual(a.zoneAt(R * 1.2, 0).zone, 'halo');
    // Densest at the centre, denser on an arm than beside it.
    const p = a.armPoint(a.arms[0], 0.5), out = { x: p.x * 1.15, y: p.y * 1.15 };
    assert(a.density(0, 0) > a.density(p.x, p.y) && a.density(p.x, p.y) > a.density(out.x, out.y), `seed ${seed}: density`);
  }
});

test('about forty systems along the shape, far apart, settled in the habitable band; the showcase starts on an outer arm', () => {
  for (const seed of [1, 2, 7, 'abc', 'Untitled']) {
    const g = galaxies.get(seed), where = `seed ${seed}`, R = g.shape.R, P = Galaxy.params.systems;
    assert(g.systems.length >= 36 && g.systems.length <= P.count, `${where}: ${g.systems.length} systems`);
    for (const s of g.systems) {
      const d = Math.hypot(s.origin.x, s.origin.y);
      assert(d >= P.core && d + s.radius <= R, `${where}: ${s.name} at ${Math.round(d)}`);
      for (const o of g.systems) if (o !== s) assert(Math.hypot(o.origin.x - s.origin.x, o.origin.y - s.origin.y) >= P.spacing, `${where}: ${s.name} and ${o.name} too close`);
      assert.strictEqual(s.zone, g.shape.zoneAt(s.origin.x, s.origin.y).zone, `${where}: ${s.name}'s zone`);
      assert.strictEqual(g.systemAt(s.origin.x, s.origin.y), s);
      // Frontier systems have no capital; settled ones (in the band) do.
      if (s.index > 0) assert.strictEqual(s.stations.some((st) => st.market.type === 'capital'), s.settled, `${where}: ${s.name}'s capital`);
    }
    // Most systems sit on the arms.
    assert(g.systems.filter((s) => s.zone === 'arm').length > g.systems.length / 2, `${where}: systems on the arms`);
    // The start: the showcase (its waystation, every planet type) on a major arm, three quarters out.
    const [home] = g.systems, d = Math.hypot(home.origin.x, home.origin.y) / R;
    assert(d > 0.7 && d < 0.8 && home.zone === 'arm' && g.arms[home.arm].major, `${where}: the start at ${d.toFixed(2)} R in ${home.zone}`);
    assert.deepStrictEqual(home.planets.map((p) => p.type).sort(), [...PLANET_TYPES].sort(), `${where}: the showcase's planets`);
    assert.strictEqual(g.stations[g.waystation].system, 0, `${where}: the waystation`);
    assert.strictEqual(g.stations[g.startStation].system, 0, `${where}: the start station`);
    assert.strictEqual(new Set(g.systems.map((s) => s.name)).size, g.systems.length, `${where}: system names`);
    // Deep space between them: no system, lawless, and the galaxy's fields.
    const gap = { x: (g.systems[0].origin.x + g.systems[1].origin.x) / 2 + 1, y: (g.systems[0].origin.y + g.systems[1].origin.y) / 2 };
    if (!g.systemAt(gap.x, gap.y)) {
      const r = g.regionAt(gap.x, gap.y);
      assert(r.system === null && r.security === 0 && r.zone && r.medium && r.dust >= 0 && r.cosmicRays >= 0, `${where}: deep space`);
      assert.deepStrictEqual(g.placeAt(gap.x, gap.y).stars, [], `${where}: no star's hazards in deep space`);
    }
    assert.strictEqual(g.placeAt(home.origin.x, home.origin.y).stars[0], home.star);
  }
});

test('territories: Wedge round the start, Block and Shard either side, each one gate network, one link between each pair', () => {
  const T = ['wedge', 'block', 'shard'];
  for (const [seed, g] of galaxies) {
    const where = `seed ${seed}`, f = (i) => g.systems[i].faction;
    assert.strictEqual(f(0), 'wedge', `${where}: the start is Wedge's`);
    for (const id of [...T, 'drifter', 'android', 'alien']) assert(g.systems.some((s) => s.faction === id), `${where}: ${id} systems`);
    for (const s of g.systems) {
      assert.strictEqual(s.holder, s.faction, `${where}: ${s.name}'s holder`);
      assert(s.level >= 1 && s.level <= 5, `${where}: ${s.name}'s level`);
      if (T.includes(s.faction)) assert(s.settled, `${where}: ${s.name} is in the band`);
      if (s.faction === 'alien') assert.strictEqual(s.level, 5, `${where}: the aliens' are the hardest`);
      if (s.faction === 'alien') assert.strictEqual(s.stations.length, 0, `${where}: no stations in alien space`);
      // Stations in their holder's culture (yards and the waystation aside).
      for (const st of s.stations) {
        if (st.waystation || st.market.type === 'salvage yard') continue;
        const want = { wedge: 'wedge', block: 'block', shard: 'shard', drifter: 'kitbash', android: 'android' }[s.faction];
        assert.strictEqual(SolarSystem.CULTURES[st.culture].lineage, want, `${where}: ${st.name} in ${s.name}`);
      }
      // Security no higher than its holder allows.
      if (s.faction === 'alien') for (const k of s.packs) assert.strictEqual(k.level, 0, `${where}: lawless alien space`);
    }
    // Wedge is the gentlest; the outside systems harder than the territories.
    assert(g.systems.filter((s) => s.faction === 'wedge').every((s) => s.level === 1), `${where}: Wedge level 1`);
    assert(g.systems.filter((s) => s.faction === 'drifter' || s.faction === 'android').every((s) => s.level >= 3), `${where}: outside levels`);
    // Gates only between territory systems: each territory one network, one link between each pair.
    for (const [a, b] of g.links) assert(a < b && T.includes(f(a)) && T.includes(f(b)), `${where}: link ${a}-${b}`);
    for (const t of T) {
      const own = g.systems.filter((s) => s.faction === t).map((s) => s.index), seen = new Set([own[0]]), todo = [own[0]];
      while (todo.length) { const i = todo.pop(); for (const [a, b] of g.links) { const j = a === i ? b : b === i ? a : -1; if (j >= 0 && f(j) === t && !seen.has(j)) { seen.add(j); todo.push(j); } } }
      assert.strictEqual(seen.size, own.length, `${where}: ${t} is one network`);
    }
    for (let x = 0; x < 3; x++) for (let y = x + 1; y < 3; y++) {
      const n = g.links.filter(([a, b]) => (f(a) === T[x] && f(b) === T[y]) || (f(a) === T[y] && f(b) === T[x])).length;
      assert.strictEqual(n, 1, `${where}: ${T[x]}-${T[y]} links`);
    }
    // Every gate leads to the gate at the other end of its link, in that system, built by its own system's holder.
    for (const x of g.gates) {
      const there = g.gates[x.link];
      assert(there.system === x.to && there.to === x.system, `${where}: ${x.name}`);
      assert.strictEqual(SolarSystem.CULTURES[x.culture].lineage, f(x.system), `${where}: ${x.name}'s culture`);
    }
    // Hostiles: none in high security, their gear by the system's level, the aliens' their own.
    for (const k of g.packs) {
      const s = g.systems[k.system];
      assert(k.level < 2, `${where}: a pack in high security`);
      assert(k.tier >= s.level && k.tier <= Math.min(5, s.level + 1), `${where}: tier ${k.tier} in a level ${s.level} system`);
      assert.strictEqual(k.faction, s.faction === 'alien' ? 'alien' : 'drifter', `${where}: whose pack`);
    }
  }
});

test('deep space: every kind of site where it belongs, clear of the systems and the black hole', () => {
  const seen = new Set();
  for (const [seed, g] of galaxies) {
    const where = `seed ${seed}`, R = g.shape.R, P = DeepSpace.params;
    assert.strictEqual(new Set(g.sites.map((s) => s.key)).size, g.sites.length, `${where}: site keys`);
    assert.strictEqual(new Set(g.sites.map((s) => s.name)).size, g.sites.length, `${where}: site names`);
    g.sites.forEach((s, i) => assert.strictEqual(s.id, i));
    const smbh = g.sites.filter((s) => s.kind === 'smbh');
    assert(smbh.length === 1 && smbh[0].x === 0 && smbh[0].y === 0, `${where}: one black hole at the centre`);
    for (const s of g.sites) {
      seen.add(s.kind);
      const K = DeepSpace.KINDS[s.kind];
      assert(K, `${where}: kind ${s.kind}`);
      assert.strictEqual(s.visible, K.visible, `${where}: ${s.name}`);
      if (s.parent !== undefined) {
        const p = g.sites[s.parent];
        assert(Math.hypot(s.x - p.x, s.y - p.y) <= p.r, `${where}: ${s.name} outside ${p.name}`);
        continue;
      }
      if (s.path) {
        // Moving: its path keeps 1.5 system radii from every star.
        const a = DeepSpace.positionAt(s, -s.path.t0), b = DeepSpace.positionAt(s, s.path.period - 1e-6 - s.path.t0);
        assert(Math.hypot(a.x - b.x, a.y - b.y) > R, `${where}: ${s.name} crosses the galaxy`);
        for (let t = 0; t < s.path.period; t += s.path.period / 200) {
          const p = DeepSpace.positionAt(s, t - s.path.t0);
          for (const sys of g.systems) assert(Math.hypot(p.x - sys.origin.x, p.y - sys.origin.y) > sys.radius * 1.5 - 1, `${where}: ${s.name} through ${sys.name}`);
        }
        continue;
      }
      if (['smbh', 'nuclear-cluster', 'stellar-stream', 'satellite-galaxy'].includes(s.kind)) continue;
      assert(Math.hypot(s.x, s.y) >= P.hole + s.r - 1, `${where}: ${s.name} in the core`);
      for (const sys of g.systems) assert(Math.hypot(s.x - sys.origin.x, s.y - sys.origin.y) >= sys.radius + P.clear + s.r - 1, `${where}: ${s.name} by ${sys.name}`);
      // The kind's own zones (a little leeway: the zone at its centre, or its kind's outer ones).
      const z = g.shape.zoneAt(s.x, s.y), key = z.zone === 'arm' ? `arm-${z.side}` : z.zone;
      assert(K.zones[key] || (K.zones.halo && z.zone === 'halo') || z.zone === 'rim' || z.zone === 'halo', `${where}: ${s.name} (${s.kind}) in ${key}`);
    }
    // The satellite galaxy lies beyond the rim.
    for (const s of g.sites.filter((x) => x.kind === 'satellite-galaxy')) assert(Math.hypot(s.x, s.y) > R * 1.25);
    // The fields: dust lanes on the arms' trailing edges, cosmic rays strongest at the core,
    // shielded inside the dark clouds.
    const F = g.space;
    assert(F.cosmicRaysAt(0, 0) > F.cosmicRaysAt(R * 0.8, 0), `${where}: cosmic rays`);
    for (const c of g.sites.filter((x) => x.kind === 'molecular-cloud')) {
      assert.strictEqual(F.mediumAt(c.x + c.blobs[0].dx, c.y + c.blobs[0].dy).phase, 'molecular', `${where}: ${c.name}'s gas`);
    }
    for (let x = -R; x <= R; x += R / 7) for (let y = -R; y <= R; y += R / 7) {
      for (const v of [F.dustAt(x, y), F.cosmicRaysAt(x, y), F.mediumAt(x, y).density]) assert(v >= 0 && v <= 1, `${where}: a field out of 0..1`);
    }
  }
  // Across the seeds, every kind turns up.
  assert.deepStrictEqual(Object.keys(DeepSpace.KINDS).filter((k) => !seen.has(k)), [], 'kinds never placed');
});

test('deep-space sites do things over time: a pulsar sweeps, a nova bursts, a Cepheid pulses', () => {
  const g = galaxies.get(1);
  const pulsar = g.sites.find((s) => s.kind === 'pulsar'), nova = g.sites.find((s) => s.kind === 'recurrent-nova'), cep = g.sites.find((s) => s.kind === 'variable-star');
  if (pulsar) assert(Math.abs(DeepSpace.phase(pulsar, pulsar.spin).beam - DeepSpace.phase(pulsar, 0).beam - Math.PI * 2) < 1e-9, 'a turn per spin');
  if (nova) {
    const states = Array.from({ length: 200 }, (_, i) => DeepSpace.phase(nova, (i / 200) * nova.period).burst);
    assert(states.some(Boolean) && !states.every(Boolean), 'bursts now and then');
  }
  if (cep) {
    const b = Array.from({ length: 50 }, (_, i) => DeepSpace.phase(cep, (i / 50) * cep.period).brightness);
    assert(Math.max(...b) - Math.min(...b) > 0.3, 'pulses');
  }
  assert.strictEqual(DeepSpace.phase(g.sites.find((s) => s.kind === 'rogue-planet'), 5), null);
});

test('dark sites are found by sensors from far off, and pinged along a cruise; luminous ones are known from the start', () => {
  const g = galaxies.get(1), k = Knowledge.create(g, { fresh: true });
  const lit = g.sites.find((s) => s.visible), dark = g.sites.find((s) => !s.visible && !s.path);
  assert.strictEqual(k.siteState(lit), 'known');
  assert.strictEqual(k.siteState(dark), null);
  k.passSites(dark.x + dark.r + Knowledge.SITE.ping - 100, dark.y);
  assert.strictEqual(k.siteState(dark), 'ping');
  const found = k.sense(dark.x + dark.r + 1000, dark.y);
  assert(found.sites.some((s) => s.id === dark.id), 'identified');
  assert.strictEqual(k.siteState(dark), 'known');
  assert.strictEqual(k.counts().sites.known, found.sites.length);
  k.save();
});

test('the scene builds each system the first time something looks near it, with the same keys whatever the order', () => {
  const g = galaxies.get(2), a = Scene.create(g, ArtCulture.forGalaxy(g)), b = Scene.create(g, ArtCulture.forGalaxy(g));
  assert(!a.built(0) && a.entities.every((e) => !['asteroid', 'item', 'wreck', 'gas'].includes(e.kind)), 'nothing small is built up front');
  assert.strictEqual(a.stations.length, g.stations.length);
  const far = g.systems[g.systems.length - 1];
  a.near(far.origin.x, far.origin.y, 5000);
  assert(a.built(far.index) && !a.built(0), 'built where looked');
  a.ensureAll();
  for (let i = g.systems.length - 1; i >= 0; i--) b.ensure(i); // the other way round
  for (const s of [...g.sites].reverse()) b.ensureSite(s.id); // and the deep-space sites' rocks
  const keys = (sc) => sc.entities.map((e) => `${e.kind}:${e.key}`).sort();
  assert.deepStrictEqual(keys(a), keys(b));
  assert.strictEqual(a.entities.filter((e) => e.kind === 'asteroid' && !e.key.startsWith('d')).length, g.asteroids.length);
});

test('deep-space sites in flight: each kind has a form, the rocks lie clear of the systems and keep their keys', () => {
  for (const seed of [1, 2]) {
    const g = galaxies.get(seed), sc = sceneOf(seed);
    for (const s of g.sites) assert(DeepSites.FORM[s.kind], `${s.kind} has no form in flight`);
    const deep = sc.entities.filter((e) => e.form);
    for (const kind of new Set(g.sites.map((s) => s.kind))) {
      const form = DeepSites.FORM[kind];
      if (form === 'sky' && kind !== 'globular-cluster') continue;
      if (form === 'map') continue;
      assert(deep.some((e) => (e.site && e.site.kind === kind) || e.form === form), `${kind}: nothing in flight`);
    }
    const rocks = sc.entities.filter((e) => e.kind === 'asteroid' && e.key.startsWith('d'));
    assert(rocks.length > 0, 'some sites hold rocks');
    for (const a of rocks) assert(!g.systemAt(a.x, a.y), `${a.key} lies in a system`);
    assert.strictEqual(new Set(rocks.map((a) => a.key)).size, rocks.length, 'rock keys are unique');
    for (const e of deep) assert(Number.isFinite(e.x) && Number.isFinite(e.y) && e.radius > 0, `${e.key}: bad place or size`);
  }
  const crowds = DeepSites.crowds(galaxies.get(1));
  assert(DeepSites.crowdAt(crowds, 0, 0).k > 0.8, 'the core\'s sky is crowded');
});

// ---------- Orbits ----------

test('orbits: a turn takes longer further out, by Kepler\'s 1.5 power, from each kind\'s reference', () => {
  for (const [kind, [secs, at]] of Object.entries(Orbits.PERIOD)) {
    assert(Math.abs(Orbits.period(kind, at) - secs) < 1e-9, `${kind}: ${secs} s at ${at}`);
    for (const d of [300, 1000, 5000, 40000]) assert(Math.abs(Orbits.period(kind, 4 * d) / Orbits.period(kind, d) - 8) < 1e-9, `${kind}: four times as far, eight times as long`);
  }
  // Slow enough at flight scale for a parked ship to keep up: a planet 5,000 out moves under 20 units a second.
  const p = Orbits.period('planet', 5000);
  assert((2 * Math.PI * 5000) / p < 20, `${((2 * Math.PI * 5000) / p).toFixed(1)} units a second`);
  assert.strictEqual(Orbits.angleAt({ angle: 1, period: 100 }, 25), 1 + Math.PI / 2, 'a quarter turn in a quarter period');
});

test('orbits: place() moves planets round their stars, moons round their planets, and stations at planets round them; the rest stay put', () => {
  const g = Galaxy.generate(2, SYSTEM_CONFIG), at0 = (o) => [o.x, o.y];
  const parked = g.stations.filter((s) => !s.period).map(at0), gates = g.gates.map(at0);
  const t = 777;
  Orbits.place(g, t);
  const round = (o, c) => {
    assert(Math.abs(Math.hypot(o.x - c.x, o.y - c.y) - o.orbit) < 1e-6, `${o.name}: off its orbit`);
    const a = Math.atan2(o.y - c.y, o.x - c.x), want = Orbits.angleAt(o, t);
    assert(Math.abs(Math.atan2(Math.sin(a - want), Math.cos(a - want))) < 1e-6, `${o.name}: not where its angle says`);
  };
  for (const p of g.planets) round(p, g.stars[p.system]);
  for (const m of g.moons) round(m, g.planets[m.parent]);
  for (const s of g.stations.filter((x) => x.period)) round(s, s.planet !== undefined ? g.planets[s.planet] : g.sites[s.site]);
  assert.deepStrictEqual(g.stations.filter((s) => !s.period).map(at0), parked, 'parked stations keep their place');
  assert.deepStrictEqual(g.gates.map(at0), gates, 'gates keep their place');
  // A whole turn later each is back where it was; the inner planets go round faster.
  const p = g.planets[0], [x, y] = [p.x, p.y];
  Orbits.place(g, t + p.period);
  assert(Math.hypot(p.x - x, p.y - y) < 1e-6, 'a turn later, back again');
  const home = g.planets.filter((q) => q.system === 0);
  for (let i = 1; i < home.length; i++) assert(home[i].period > home[i - 1].period, `${home[i].name} turns faster than the planet inside it`);
  // A station at a planet keeps a low orbit inside the planet's moons.
  for (const s of g.stations.filter((x) => x.planet !== undefined)) {
    const P = g.planets[s.planet];
    for (const id of P.moons) assert(s.orbit < g.moons[id].orbit - g.moons[id].r, `${s.name} outside ${g.moons[id].name}`);
    assert(s.orbit > P.body, `${s.name} inside ${P.name}`);
  }
});

test('orbits: what stays put keeps out of the band each planet sweeps: always in the start system, nearly always elsewhere', () => {
  let n = 0, inBand = 0;
  for (const [seed, g] of galaxies) {
    const sweeps = (sys, o) => { const S = g.stars[sys]; return g.planets.some((p) => p.system === sys && Math.abs(Math.hypot(o.x - S.x, o.y - S.y) - p.orbit) < p.extent); };
    const still = [...g.gates, ...g.stations.filter((s) => s.planet === undefined && s.site === undefined)];
    for (const o of still) {
      if (o.system === 0) assert(!sweeps(0, o), `seed ${seed}: ${o.name} in a planet's path in the start system`);
      n++;
      if (sweeps(o.system, o)) inBand++;
    }
    for (const f of g.fields.filter((x) => x.system === 0)) assert(!sweeps(0, f), `seed ${seed}: ${f.name} in a planet's path`);
  }
  assert(inBand / n < 0.06, `${inBand} of ${n} gates and parked stations in a planet's path`);
});

test('observatories: some deep-space sites have one, on a wide orbit round the site, of its culture, online from the start', () => {
  const O = Galaxy.params.observatories;
  let watched = 0, could = 0;
  for (const [seed, g] of galaxies) {
    const where = `seed ${seed}`, obs = g.stations.filter((s) => s.site !== undefined);
    could += g.sites.filter((s) => O.orbit[s.kind] && !s.path).length;
    watched += obs.length;
    for (const o of obs) {
      const s = g.sites[o.site], d0 = O.orbit[s.kind];
      assert(d0 && !s.path, `${where}: ${o.name} at a ${s.kind}`);
      assert.strictEqual(o.key, `ds${s.id}`);
      assert.deepStrictEqual(o.market, { kind: 'outpost', type: 'observatory' });
      assert.strictEqual(o.orbit, d0 < 10 ? s.r * d0 : d0, `${where}: ${o.name}'s orbit for a ${s.kind}`);
      assert(o.orbit > s.r || d0 >= 1000, `${where}: ${o.name} inside its site`);
      assert(Math.abs(Math.hypot(o.x - s.x, o.y - s.y) - o.orbit) < 1e-6, `${where}: ${o.name} off its orbit`);
      assert.strictEqual(o.period, Orbits.period('site', o.orbit));
      assert.strictEqual(o.owner, Factions.ofCulture(SolarSystem.CULTURES[o.culture].lineage).id, `${where}: ${o.name}'s owner`);
      const near = g.systems.reduce((b, x) => (Math.hypot(x.origin.x - s.x, x.origin.y - s.y) < Math.hypot(b.origin.x - s.x, b.origin.y - s.y) ? x : b));
      assert.strictEqual(o.system, near.index, `${where}: ${o.name}'s nearest system`);
      assert(!g.systemAt(o.x, o.y), `${where}: ${o.name} in a system`);
    }
  }
  assert(Math.abs(watched / could - O.share) < 0.12, `${watched} of ${could} sites watched, ${O.share} wanted`);
  assert(Restoration.online('observatory', []), 'online without restoring');
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
  for (const [seed, g] of showcases) {
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
    assert.strictEqual(thingsOf(seed, 'station').length, s.stations.filter((st) => st.site === undefined).length); // (the observatories are deep space's)
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
  const rebuilt = Scene.create(s, ArtCulture.forGalaxy(s));
  rebuilt.ensureAll();
  const a = sceneOf(1).entities.filter((e) => e.kind === 'asteroid'), b = rebuilt.entities.filter((e) => e.kind === 'asteroid'); // deep-space sites' rocks too
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
  const x = fullScene(s, cultures).entities.filter((e) => e.art), y = fullScene(s, cultures).entities.filter((e) => e.art);
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

off('?pirates', 'pirate fighter classes: mixed packs, heavier in dangerous space, the same size in a fight', () => {
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
  assert(thingsOf(1, 'ship').every((e) => e.pirate && e.pack !== undefined), 'hostile ships, in their packs');
  // With the pirates turned back on, their ships keep their keys through a rebuild.
  const s = Galaxy.generate(1, { ...SYSTEM_CONFIG, galaxy: { system: { pirates: { density: 0.5, lawlessAmbushes: [1, 2], nebulaAmbushes: true } } } });
  const a = fullScene(s).entities.filter((e) => e.kind === 'ship'), b = fullScene(s).entities.filter((e) => e.kind === 'ship');
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

test('the starter Courier: its handling, sensors and hold, a mining laser and a gas siphon', () => {
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
    assert(R && R.bay === 'shipyard' && R.unlock === `mods.${m.slot}` && Research.PACKAGES[R.unlock].mods.includes(m.id), m.id);
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
    assert(R && R.bay === (e.tier > 1 ? 'shipyard' : 'bench') && R.out[id] === 1 && Recipes.producers(id).length === 1, id);
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

test('research is queued at the station of its kind; the transport hub researches routes and haulers', () => {
  const types = new Set([...Object.keys(Industry.PROCESS), 'transport hub']);
  for (const k of Research.CATEGORIES) assert(types.has(k.station), `${k.id}: queued at ${k.station}`);
  assert.deepStrictEqual(['core.bool', 'bp.pulse-laser-2', 'bp.beam-turret-2', 'bp.deflector-2', 'hull.armour-1', 'log.routes.1'].map(Research.stationOf),
    ['waystation', 'mining camp', 'minor', 'major', 'capital', 'transport hub']);
  assert.strictEqual(Research.stationName('minor'), 'the volatiles works');
  const lab = Research.empty(), T = 1e12;
  for (const id of ['log.routes.1', 'log.haulers.1']) { lab.done.push(id); lab.doneAt[id] = T; }
  assert.deepStrictEqual([Research.bonusAt(lab, T, 'routes'), Research.bonusAt(lab, T, 'haulers')], [1, 1]);
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

const CAP = { key: 'st-cap', name: 'Cormar Station', type: 'capital' };

const CAMP2 = { key: 'st-camp2', name: 'Oso Camp', type: 'mining camp' };

const YARD = { key: 'st-yard', name: 'Kesh Yard', type: 'salvage yard' };

// An ore works order (a mining camp) making steel pipe from the iron in its stock, and a fabricator
// order (the major hub) making electronics from the pipe and carbon fibre in its own.
function pipeWorks(T, { iron = 40, fibre = 20, pipe = 0 } = {}) {
  const state = Industry.empty(), env = Industry.env(Research.empty());
  Industry.deposit(state, CAMP.key, 'iron', iron, env, T);
  Industry.deposit(state, HUB.key, 'carbon-fibre', fibre, env, T);
  if (pipe) Industry.deposit(state, HUB.key, 'steel-pipe', pipe, env, T);
  const a = Industry.place(state, CAMP, 'make.steel-pipe', null, env, T);
  const b = Industry.place(state, HUB, 'make.electronics', null, env, T);
  return { state, env, a, b };
}

const statusOf = (state, o) => Industry.status(state, o).id;

test('production: each station keeps its own stock; what the ore works makes is carried to the fabricator, while away too', () => {
  const T = 1e12, { state, env, a, b } = pipeWorks(T);
  assert.strictEqual(statusOf(state, a), 'running');
  assert.deepStrictEqual(Industry.status(state, b), { id: 'starved', missing: 'steel-pipe' }, 'no pipe yet: the input is named');
  let { log } = Industry.settle(state, T + 3600e3, env);
  // 40 iron make 20 pipes, which stay at the camp: the hub has none.
  assert.deepStrictEqual(state.stock, { [CAMP.key]: { 'steel-pipe': 20 }, [HUB.key]: { 'carbon-fibre': 20 } });
  assert.deepStrictEqual([statusOf(state, a), statusOf(state, b)], ['starved', 'starved']);
  assert.deepStrictEqual(Industry.summary(state, log), ['Almar Camp: 20 × Steel pipe']);
  // Carried over (out of one stock, into the other), and the hub takes it up at once.
  const t = T + 3600e3;
  assert.strictEqual(Industry.withdraw(state, CAMP.key, 'steel-pipe', 50), 20, 'as many as there are');
  assert.strictEqual(Industry.deposit(state, HUB.key, 'steel-pipe', 20, env, t), 20);
  assert.strictEqual(statusOf(state, b), 'running');
  ({ log } = Industry.settle(state, t + 3600e3, env));
  assert.deepStrictEqual(state.stock, { [HUB.key]: { electronics: 20 } }, 'an empty stock goes');
  assert.strictEqual(log.length, 20);
  assert(log.every((x, i) => !i || x.at >= log[i - 1].at), 'in time order');
  // More iron, and the ore works takes it up at once.
  Industry.deposit(state, CAMP.key, 'iron', 2, env, t + 3600e3);
  assert.strictEqual(statusOf(state, a), 'running');
  // One order per station; the shipyard takes the next step.
  assert.strictEqual(Industry.place(state, CAMP, 'make.carbon-fibre', null, env, T), null, 'one order per station');
  assert(Industry.place(state, CAP, 'make.flight-computer-1', 2, env, T), 'Mk I flight computers from the electronics');
});

test('production: settling in many steps comes out the same as in one, and a clock set back undoes nothing', () => {
  const T = 1e12, end = T + 30 * 60e3;
  const once = pipeWorks(T, { pipe: 12 });
  Industry.settle(once.state, end, once.env);
  const r = mulberry32(5);
  for (let trial = 0; trial < 20; trial++) {
    const many = pipeWorks(T, { pipe: 12 });
    const times = Array.from({ length: 10 }, () => T + r() * (end - T)).sort((a, b) => a - b);
    for (const t of times) Industry.settle(many.state, t, many.env);
    Industry.settle(many.state, T, many.env); // the clock set back
    Industry.settle(many.state, end, many.env);
    assert.deepStrictEqual(many.state, once.state);
  }
  // A cap on runs per call stops part way, and the next call goes on to the same end.
  const capped = pipeWorks(T, { pipe: 12 });
  assert(Industry.settle(capped.state, end, capped.env, 5).truncated);
  while (Industry.settle(capped.state, end, capped.env, 5).truncated);
  assert.deepStrictEqual(capped.state, once.state);
});

test('production: processes by station type, room in each stock, counts, pausing, cancelling and priority', () => {
  const T = 1e12, env = Industry.env(Research.empty()), state = Industry.empty();
  // Each station type works one process; the shipyard has a bench too.
  assert(Industry.canMake('mining camp', 'make.steel-pipe') && Industry.canMake('salvage yard', 'recycle.hull-components'));
  assert(Industry.canMake('minor', 'make.hydrazine') && Industry.canMake('major', 'make.electronics'));
  assert(Industry.canMake('waystation', 'make.pulse-laser-1') && Industry.canMake('waystation', 'make.shield-cell') && !Industry.canMake('waystation', 'make.pulse-laser-2'));
  assert(Industry.canMake('capital', 'make.pulse-laser-1') && Industry.canMake('capital', 'make.pulse-laser-2') && Industry.canMake('capital', 'make.mod.overcharger'));
  assert(!Industry.canMake('mining camp', 'make.pulse-laser-1') && !Industry.canMake('capital', 'make.steel-pipe') && !Industry.canMake('mining camp', 'make.hydrazine'));
  assert(!Industry.canMake('salvage yard', 'make.steel-pipe') && !Industry.canMake('minor', 'make.electronics'));
  // Every recipe is made somewhere.
  for (const R of Recipes.LIST) assert(Object.keys(Industry.PROCESS).some((type) => Industry.canMake(type, R.id)), `${R.id}: no station makes it`);
  assert.strictEqual(Industry.place(state, HUB, 'make.steel-pipe', null, env, T), null, 'the fabricator does not refine ore');
  // Room: only as much as fits.
  const cap = Industry.capacity(state, env, T);
  assert.strictEqual(cap, Industry.STORAGE.base);
  assert.strictEqual(Industry.deposit(state, CAMP.key, 'iron', 1000, env, T), cap, 'only as much as there is room for');
  assert.strictEqual(Industry.free(state, CAMP.key, env, T), 0);
  assert.strictEqual(Industry.free(state, HUB.key, env, T), cap, 'each station has room of its own');
  // Full, a run that makes no more than it takes still starts (2 iron make 1 pipe).
  const o = Industry.place(state, CAMP, 'make.steel-pipe', 3, env, T);
  assert.strictEqual(statusOf(state, o), 'running');
  const run = Industry.runTime(o, env, T);
  assert.strictEqual(run, Recipes.RECIPES['make.steel-pipe'].time * 1000);
  Industry.settle(state, T + 10 * run, env);
  assert.deepStrictEqual([Industry.stockAt(state, CAMP.key)['steel-pipe'], o.made, statusOf(state, o)], [3, 3, 'done'], 'a count of runs, then it stops');
  // Blocked: a run that makes more than it takes, with storage full (a recycled hull makes 2 pipes).
  Industry.deposit(state, YARD.key, 'hull-components', 1, env, T);
  Industry.deposit(state, YARD.key, 'iron', 1000, env, T);
  const rec = Industry.place(state, YARD, 'recycle.hull-components', null, env, T);
  assert.strictEqual(statusOf(state, rec), 'blocked', 'storage is full');
  Industry.withdraw(state, YARD.key, 'iron', 10);
  Industry.kick(state, env, T);
  assert.strictEqual(statusOf(state, rec), 'running');
  // Changing an order part way gives the run's inputs back; cancelling one too.
  const t = T + 10 * run;
  assert(Industry.change(state, o.id, 'make.steel-pipe', null, env, t));
  assert.strictEqual(statusOf(state, o), 'running');
  const iron = Industry.stockAt(state, CAMP.key).iron;
  assert(Industry.cancel(state, o.id));
  assert.strictEqual(Industry.stockAt(state, CAMP.key).iron, iron + 2, 'back in its station\'s stock');
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
  Industry.deposit(two, CAMP.key, 'iron', 2, env, T);
  const lab2 = Research.empty();
  lab2.done.push('ind.bays.1');
  lab2.doneAt['ind.bays.1'] = T;
  const env2 = Industry.env(lab2);
  const x = Industry.place(two, CAMP, 'make.steel-pipe', null, env2, T);
  const y = Industry.place(two, CAMP, 'make.steel-pipe', null, env2, T);
  assert.deepStrictEqual([statusOf(two, x), statusOf(two, y)], ['running', 'starved']);
  Industry.cancel(two, x.id);
  const z = Industry.place(two, CAMP, 'make.steel-pipe', null, env2, T);
  assert.deepStrictEqual([statusOf(two, y), statusOf(two, z)], ['running', 'starved'], 'the inputs back: the first in line takes them');
  // Moved up, an order gets the next inputs first.
  Industry.settle(two, T + run, env2);
  assert(Industry.move(two, 1, 0) && two.orders[0] === z);
  Industry.deposit(two, CAMP.key, 'iron', 2, env2, T + run);
  assert.deepStrictEqual([statusOf(two, z), statusOf(two, y)], ['running', 'starved']);
  assert.strictEqual(Industry.withdraw(two, CAMP.key, 'iron', 5), 0);
  // Orders at different stations never compete: each has its own stock.
  Industry.deposit(two, CAMP2.key, 'iron', 2, env2, T + run);
  const w = Industry.place(two, CAMP2, 'make.steel-pipe', null, env2, T + run);
  assert.strictEqual(statusOf(two, w), 'running');
});

// The ore works and the fabricator of pipeWorks, with the ore works' shuttle sending its pipe to
// the fabricator (a minute each way).
function shuttled(T, opts) {
  const w = pipeWorks(T, opts);
  w.route = Industry.setShuttle(w.state, CAMP, HUB, 60e3, w.env, T);
  return w;
}

test('logistics: a shuttle carries what a station makes to another, which makes from it, while away too', () => {
  const T = 1e12, { state, env, a, b, route } = shuttled(T);
  assert.strictEqual(Industry.shuttle(state, CAMP.key), route);
  assert.deepStrictEqual(route.stops.map((s) => [s.station, s.load, s.unload]), [[CAMP.key, 'made', {}], [HUB.key, {}, 'all']]);
  assert.strictEqual(route.haulers[0].next, null, 'nothing made yet: it waits');
  // The first pipe made (20 s): loaded at once, and flown over.
  let { log } = Industry.settle(state, T + 20e3, env);
  const h = route.haulers[0];
  assert.deepStrictEqual([h.stop, h.next, h.load], [1, T + 80e3, { 'steel-pipe': 1 }], 'loaded, on its way');
  // Delivered a minute later: the hub's order starts on it; the shuttle goes back for more.
  ({ log } = Industry.settle(state, T + 80e3, env));
  assert.deepStrictEqual(log.filter((x) => x.delivered).map((x) => [x.key, x.delivered]), [[HUB.key, { 'steel-pipe': 1 }]]);
  assert.deepStrictEqual(Industry.delivered(log), ['Corlital Hub: 1 × Steel pipe']);
  assert.strictEqual(statusOf(state, b), 'running');
  assert.deepStrictEqual([h.stop, h.next], [0, T + 140e3], 'back for more, as there is some');
  // An hour away: all 40 iron become 20 pipes, and all of those electronics at the hub.
  Industry.settle(state, T + 3600e3, env);
  assert.deepStrictEqual(state.stock, { [HUB.key]: { electronics: 20 } });
  assert.deepStrictEqual([statusOf(state, a), statusOf(state, b), h.next, h.load], ['starved', 'starved', null, {}], 'all done: the shuttle waits');
  // Lineage and the pipeline know the route.
  assert.deepStrictEqual(Industry.lineage(state, 'make.electronics', Recipes.known(), HUB.key).map((x) => [x.kind, x.source]), [['steel-pipe', 'route'], ['carbon-fibre', 'stage']]);
  assert(Industry.pipelines(state)[0].links.every((l) => l.away && l.routed));
  // More iron at the camp, and the shuttle (waiting there) takes the pipe as soon as it's made.
  assert.strictEqual(h.stop, 0, 'it waits where it last had something to do');
  Industry.deposit(state, CAMP.key, 'iron', 2, env, T + 3600e3);
  Industry.settle(state, T + 3600e3 + 20e3, env);
  assert.deepStrictEqual([h.stop, h.load, h.next], [1, { 'steel-pipe': 1 }, T + 3600e3 + 80e3]);
});

test('logistics: settling with haulers in many steps comes out the same as in one', () => {
  const T = 1e12, end = T + 40 * 60e3;
  const once = shuttled(T);
  Industry.settle(once.state, end, once.env);
  const r = mulberry32(9);
  for (let trial = 0; trial < 20; trial++) {
    const many = shuttled(T);
    const times = Array.from({ length: 12 }, () => T + r() * (end - T)).sort((x, y) => x - y);
    for (const t of times) Industry.settle(many.state, t, many.env);
    Industry.settle(many.state, end, many.env);
    assert.deepStrictEqual(many.state, once.state);
  }
  const capped = shuttled(T);
  while (Industry.settle(capped.state, end, capped.env, 3).truncated);
  assert.deepStrictEqual(capped.state, once.state);
});

test('logistics: a route keeps what a stop keeps, waits when the next stock is full, and gives back its load when removed', () => {
  const T = 1e12, env = Industry.env(Research.empty()), state = Industry.empty();
  Industry.deposit(state, CAMP.key, 'iron', 30, env, T);
  const r = Industry.addRoute(state, [
    { station: CAMP.key, name: CAMP.name, load: { iron: 'all' }, keep: { iron: 10 }, travel: 30e3 },
    { station: HUB.key, name: HUB.name, unload: 'all', travel: 30e3 },
  ], { cap: 12 }, env, T);
  const h = r.haulers[0];
  assert.deepStrictEqual([h.load, Industry.stockAt(state, CAMP.key).iron], [{ iron: 12 }, 18], 'as much as it carries');
  Industry.settle(state, T + 60e3, env);
  assert.deepStrictEqual([Industry.stockAt(state, HUB.key).iron, Industry.stockAt(state, CAMP.key).iron, h.load], [12, 10, { iron: 8 }], 'never below the 10 kept');
  // The hub full: the hauler waits there with its load, losing none of it.
  Industry.deposit(state, HUB.key, 'carbon-fibre', 1000, env, T + 60e3);
  Industry.settle(state, T + 200e3, env);
  assert.deepStrictEqual([h.stop, h.next, h.load], [1, null, { iron: 8 }], 'waiting at the full hub');
  // Room again: it unloads at once.
  Industry.withdraw(state, HUB.key, 'carbon-fibre', 5);
  Industry.kick(state, env, T + 200e3);
  assert.deepStrictEqual([h.load, Industry.stockAt(state, HUB.key).iron], [{ iron: 3 }, 17]);
  // Removed: what's aboard goes into the stock it's flying to (it moved something, so it flew on).
  assert.strictEqual(h.stop, 0);
  assert(Industry.removeRoute(state, r.id) && !state.routes.length);
  assert.deepStrictEqual([Industry.stockAt(state, HUB.key).iron, Industry.stockAt(state, CAMP.key).iron], [17, 13]);
  // A saved route reads back; a broken one is dropped.
  const r2 = Industry.addRoute(state, [{ station: 'a', load: 'all', travel: 5 }, { station: 'b', unload: { iron: 'all', nope: 2 } }], {}, env, T);
  assert.deepStrictEqual(Logistics.read(JSON.parse(JSON.stringify(r2)), (k) => !!Goods.type(k)), { ...r2, stops: r2.stops.map((s) => (s.station === 'b' ? { ...s, unload: { iron: 'all' } } : s)) });
  assert.strictEqual(Logistics.read({ id: 1, stops: [{ station: 'a' }], haulers: [{}] }), null, 'one stop is no route');
  assert.strictEqual(Logistics.legTime(0), Logistics.HAULER.minLeg);
});

test('restoration: stations come online in order, each paid with goods and credits', () => {
  // Online from the start: the waystation and the ore works; everything else waits.
  assert(Restoration.online('waystation', []) && Restoration.online('mining camp', []));
  for (const type of ['minor', 'transport hub', 'salvage yard', 'major', 'capital']) assert(!Restoration.online(type, []), type);
  assert(!Restoration.shuttle('mining camp', []) && Restoration.shuttle('mining camp', ['shuttle.ore']));
  // Every station type with a process, and the transport hub, is restored by one project; each
  // project needs the one before it; every good it asks for has a source.
  for (const type of [...Object.keys(Industry.PROCESS), 'transport hub']) {
    if (!Restoration.ONLINE.includes(type)) assert.strictEqual(Restoration.LIST.filter((p) => p.type === type).length, 1, type);
  }
  Restoration.LIST.forEach((p, i) => {
    assert.deepStrictEqual(p.requires, i ? [Restoration.LIST[i - 1].id] : [], p.id);
    for (const kind of Object.keys(p.goods)) assert(Goods.type(kind), `${p.id}: ${kind}`);
  });
  // Status: locked until the one before is done; short of goods or credits; then ready.
  const first = Restoration.LIST[0], second = Restoration.LIST[1];
  assert.strictEqual(Restoration.status(second.id, [], { ...second.goods }, 1e6).id, 'locked');
  const short = Restoration.status(first.id, [], { 'steel-pipe': 1 }, 0);
  assert.strictEqual(short.id, 'short');
  assert(short.credits && short.short.some((x) => x.kind === 'steel-pipe' && x.have === 1));
  assert.strictEqual(Restoration.restore(first.id, [], { 'steel-pipe': 1 }, 0), null, 'not paid for: nothing');
  assert.deepStrictEqual(Restoration.restore(first.id, [], { ...first.goods, iron: 5 }, first.credits), { take: first.goods, credits: first.credits });
  assert.strictEqual(Restoration.status(first.id, [first.id], {}, 0).id, 'done');
  assert.strictEqual(Restoration.status(second.id, [first.id], { ...second.goods }, second.credits).id, 'ready');
  assert(Restoration.online(second.type, [first.id, second.id]));
});

test('production: slots grow with research, and a station takes orders only when it trusts the player', () => {
  const T = 1e12, lab = Research.empty(), state = Industry.empty();
  const env = Industry.env(lab);
  assert(Industry.place(state, CAMP, 'make.steel-pipe', null, env, T));
  assert.strictEqual(Industry.place(state, CAMP, 'make.carbon-fibre', null, env, T), null);
  lab.done.push('ind.bays.1');
  lab.doneAt['ind.bays.1'] = T;
  assert(Industry.place(state, CAMP, 'make.carbon-fibre', null, env, T), 'a second slot');
  assert.strictEqual(Industry.place(state, CAMP, 'make.steel-pipe', null, env, T), null);
  // Loyalty: a station takes orders once the player has its trust (every station online has it:
  // game/restoration.js trustOnline; jobs add to it).
  assert(!Industry.trusted({}, HUB.key) && !Industry.trusted({ [HUB.key]: 0 }, HUB.key));
  assert.strictEqual(Industry.place(state, HUB, 'make.electronics', null, env, T, {}), null, 'untrusted: refused');
  assert(Industry.place(state, HUB, 'make.electronics', null, env, T, { [HUB.key]: 1 }), 'trusted: taken');
});

test('production: the pipeline links orders by what they make, and shows the gaps', () => {
  const T = 1e12, env = Industry.env(Research.empty()), state = Industry.empty();
  // Iron → steel pipe (camp) → electronics (hub, with carbon fibre no order makes) → Mk I flight
  // computers (capital), and the pipe into Mk I pulse lasers (the waystation's bench); hydrazine at
  // a port, linked to nothing.
  const pipe = Industry.place(state, CAMP, 'make.steel-pipe', null, env, T);
  const elec = Industry.place(state, HUB, 'make.electronics', null, env, T);
  const laser = Industry.place(state, { key: 'st-way', name: 'Waystation', type: 'waystation' }, 'make.pulse-laser-1', null, env, T);
  const fc = Industry.place(state, CAP, 'make.flight-computer-1', null, env, T);
  const lone = Industry.place(state, PORT, 'make.hydrazine', null, env, T);
  const groups = Industry.pipelines(state);
  const chain = groups.find((g) => !g.standalone);
  assert.deepStrictEqual(chain.orders.map((o) => o.id).sort(), [pipe.id, elec.id, laser.id, fc.id].sort());
  const link = (a, b, kind) => chain.links.some((l) => l.from === a.id && l.to === b.id && l.kind === kind);
  assert(link(pipe, elec, 'steel-pipe') && link(pipe, laser, 'steel-pipe') && link(elec, fc, 'electronics'));
  assert.deepStrictEqual(chain.end.sort(), ['flight-computer-1', 'pulse-laser-1'], 'what no order uses is an end product, not a gap');
  // Carbon fibre isn't raw and no order makes it: a gap, for the ore works. Iron is raw: not flagged.
  assert.deepStrictEqual(chain.gaps, [{ order: elec.id, kind: 'carbon-fibre', stage: 'ore' }]);
  const solo = groups.find((g) => g.standalone);
  assert.deepStrictEqual([solo.orders.map((o) => o.id), solo.links, solo.gaps], [[lone.id], [], []], 'linked to nothing: standalone');
  // Links between stations are marked: the good has to be carried.
  assert(chain.links.every((l) => l.away), 'every order of this chain is at a station of its own');
  // Lineage: where an order's inputs come from, seen from its station.
  Industry.deposit(state, HUB.key, 'carbon-fibre', 3, env, T);
  assert.deepStrictEqual(Industry.lineage(state, 'make.electronics', Recipes.known(), HUB.key).map((x) => [x.kind, x.source]), [['steel-pipe', 'away'], ['carbon-fibre', 'storage']]);
  assert.deepStrictEqual(Industry.lineage(state, 'make.electronics', Recipes.known(), PORT.key).map((x) => [x.kind, x.source]), [['steel-pipe', 'away'], ['carbon-fibre', 'stage']]);
  assert.deepStrictEqual(Industry.lineage(state, 'make.steel-pipe', Recipes.known(), CAMP.key).map((x) => [x.kind, x.source]), [['iron', 'raw']]);
});

test('industry research counts from when it finished, even part way through a long absence', () => {
  const T = 1e12, lab = Research.empty();
  Research.PACKAGES['core.bool'].industry = { speed: 1 }; // twice as fast, as an industry package would make it
  try {
    lab.done.push('core.bool');
    lab.doneAt['core.bool'] = T + 60e3;
    const env = Industry.env(lab), state = Industry.empty();
    Industry.deposit(state, CAMP.key, 'iron', 20, env, T);
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
  const ship = (id, o = {}) => CombatCore.combatant(id, id, testShip({ shield: 50, ...o }));
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

test('classes: Tank, DPS and Healer shape the stats and give four skills each, opening at levels 1, 2, 4 and 10', () => {
  const base = Loadout.stats(Loadout.starter('courier'));
  const tank = Classes.apply(base, 'tank'), dps = Classes.apply(base, 'dps'), healer = Classes.apply(base, 'healer');
  assert(tank.hull > dps.hull && tank.shield > dps.shield && tank.firepower < dps.firepower, 'a Tank soaks, a DPS hits');
  assert(healer.firepower < dps.firepower && healer.shield > dps.shield);
  assert.strictEqual(Classes.valid('nonsense'), Classes.DEFAULT);
  for (const c of Classes.LIST) {
    const ids = Classes.skills(c.id);
    assert.strictEqual(ids.length, 4, c.id);
    assert.deepStrictEqual(ids.map((id) => Abilities.ABILITIES[id].level), [1, 2, 4, 10], c.id);
    for (const id of ids) {
      const a = Abilities.ABILITIES[id];
      assert(a.skill && a.cls === c.id && a.cast >= 0 && a.cooldown > a.cast, id);
    }
    // Its starting program checks with what every game knows (use() and hull %).
    const known = Research.known(['tactics.use', 'maint.sense']);
    for (const line of Classes.program(c.id)) assert(Logic.check(line, known).ok, `${c.id}: ${Logic.text(line)}: ${Logic.check(line, known).errors}`);
  }
});

test('skills: an activation first, the effect after it, then a cooldown; taunt draws fire, fortify and a mark change damage', () => {
  const st = Classes.apply(Loadout.stats(Loadout.starter('courier')), 'tank');
  const foe = RealtimeCombat.ship('e', 'Foe', Loadout.stats(Loadout.npc('fighter', 1)), { x: 400, y: 0 });
  const me = RealtimeCombat.ship('player', 'Me', st, { x: 0, y: 0 }, st.hull, { cls: 'tank' });
  const ally = RealtimeCombat.ship('a1', 'Ally', st, { x: 0, y: 100 });
  const s = RealtimeCombat.create(mulberry32(3), me, [foe], { allies: [ally] });
  foe.aim = 'a1';
  assert.strictEqual(CombatCore.aimAt(s, foe), ally, 'it picked the ally');
  assert(Abilities.ready(me, 'taunt', me, s.t));
  const ev = Abilities.use(me, 'taunt', me, s.t);
  assert.strictEqual(ev.type, 'cast');
  assert(!Abilities.ready(me, 'fortify', me, s.t), 'one activation at a time');
  assert.strictEqual(CombatCore.aimAt(s, foe), ally, 'not yet: still activating');
  RealtimeCombat.step(s, 0.4);
  assert(Abilities.has(me, 'taunt', s.t), 'taunting once activated');
  assert.strictEqual(CombatCore.aimAt(s, foe), me, 'it turns on the taunting tank');
  assert(!Abilities.ready(me, 'taunt', me, s.t), 'cooling down');
  // Fortify halves what gets through; a mark adds to it.
  Abilities.use(me, 'fortify', me, s.t);
  RealtimeCombat.step(s, 0.6);
  assert.strictEqual(me.stats.taken, 0.5);
  const shieldBefore = me.shield;
  CombatCore.applyDamage(me, 10);
  assert.strictEqual(shieldBefore - me.shield, 5);
  Abilities.use(ally, 'mark', foe, s.t);
  RealtimeCombat.step(s, 0.4);
  assert.strictEqual(foe.stats.taken, 1.3);
  // A salvo lands as a shot after its activation.
  const dps = RealtimeCombat.ship('d', 'Dps', Classes.apply(Loadout.stats(Loadout.starter('courier')), 'dps'), { x: 0, y: -100 });
  dps.order = {};
  s.allies.push(dps);
  Abilities.use(dps, 'salvo', foe, s.t);
  const before = foe.hull + foe.shield;
  let shot = null;
  for (let i = 0; i < 40 && !shot; i++) shot = RealtimeCombat.step(s, 1 / 30).find((e) => e.type === 'shot' && e.skill === 'salvo');
  assert(shot && shot.damage > 0 && foe.hull + foe.shield < before, 'the salvo hit');
  // A heal on a friend, and the nanite field on the whole side.
  s.over = null; foe.hull = foe.stats.hull; // (still flying, so the fight goes on)
  me.hull = me.stats.hull / 2; ally.hull = ally.stats.hull / 2; me.invulnerable = ally.invulnerable = true;
  const healer = RealtimeCombat.ship('h', 'Healer', Classes.apply(Loadout.stats(Loadout.starter('courier')), 'healer'), { x: 0, y: 50 });
  healer.order = {};
  s.allies.push(healer);
  healer.hull = healer.stats.hull / 2; // (worth using: it's hurt too)
  assert.strictEqual(Abilities.use(healer, 'nanite-field', healer, s.t).type, 'cast');
  for (let i = 0; i < 60; i++) RealtimeCombat.step(s, 1 / 30);
  assert(me.hull > me.stats.hull / 2 && ally.hull > ally.stats.hull / 2, 'the field repaired both');
});

test('skills: the fourth of each class: an aegis over the whole side, a barrage on every enemy, a disrupt that silences and cancels', () => {
  const stats = (cls, level, talents = []) => Progress.apply(Classes.apply(Loadout.stats(Loadout.starter('courier')), cls), level, talents);
  const mk = (id, cls, level, talents) => ({ id, name: id, stats: stats(cls, level, talents), hull: 1, shield: 0, cooldowns: {}, status: [] });
  const full = (c) => { c.hull = c.stats.hull; c.shield = c.stats.shield; return c; };
  const fightOf = (player, allies, enemies) => ({ t: 0, player, allies, enemies });
  const land = (s, at) => Abilities.resolve(s, at);
  // Level 9 hasn't got it; level 10 has.
  const tank = full(mk('player', 'tank', 10)), mate = full(mk('a1', 'dps', 10)), e1 = full(mk('e1', 'dps', 10)), e2 = full(mk('e2', 'dps', 10));
  assert(!Abilities.ready(full(mk('x', 'tank', 9)), 'aegis', tank, 0) && Abilities.ready(tank, 'aegis', tank, 0));
  const s = fightOf(tank, [mate], [e1, e2]);
  // Aegis: everyone on the tank's side, nobody on the other.
  Abilities.use(tank, 'aegis', tank, 0);
  assert.deepStrictEqual(land(s, 1).map((e) => e.to), ['player', 'a1']);
  assert.strictEqual(tank.stats.taken, 0.6);
  assert.strictEqual(mate.stats.taken, 0.6);
  assert.strictEqual(e1.stats.taken ?? 1, 1);
  Abilities.tick(mate, 20);
  assert.strictEqual(mate.stats.taken ?? 1, 1, 'it runs out');
  // Barrage: a shot on each enemy still flying.
  e2.hull = 0;
  const e3 = full(mk('e3', 'dps', 10));
  s.enemies.push(e3);
  Abilities.use(mate, 'barrage', e1, 20);
  const shots = land(s, 22);
  assert.deepStrictEqual(shots.map((e) => [e.type, e.to, e.skill]), [['shot', 'e1', 'barrage'], ['shot', 'e3', 'barrage']]);
  assert(shots.every((e) => e.damage > 0) && e1.shield < e1.stats.shield);
  // Disrupt: guns quiet, a heavy shot cancelled, and no second one straight after.
  const medic = full(mk('a2', 'healer', 10));
  s.allies.push(medic);
  e1.intent = { kind: 'heavy' };
  Abilities.use(medic, 'disrupt', e1, 30);
  land(s, 31);
  assert(Abilities.disabled(e1, 31) && e1.intent.kind === 'volley');
  assert(!Abilities.disabled(e1, 36) && Abilities.has(e1, 'emp-immune', 36));
  medic.cooldowns = {};
  assert(!Abilities.ready(medic, 'disrupt', e1, 36), 'it shrugs off another for a while');
});

test('surveys: every deep-space site but the stream has a find; worth more further on; gear from the rarer kinds', () => {
  for (const kind of Object.keys(DeepSpace.KINDS)) assert.strictEqual(!!Survey.FINDS[kind], kind !== 'stellar-stream', kind);
  for (const [seed, g] of galaxies) {
    for (const s of g.sites) {
      if (!Survey.has(s)) continue;
      const R = Survey.reward(s, 1), far = Survey.reward(s, 30);
      assert(Survey.range(s) >= 2500 && Survey.range(s) <= 20000, `seed ${seed}: ${s.name}`);
      assert(R.credits >= 300 && R.xp > 0 && far.credits > R.credits && far.xp > R.xp && /^[A-Z].*[^.]$/.test(R.what), `seed ${seed}: ${s.name}`);
      if (R.gear) {
        assert(Loot.RANK[R.gear.floor] >= Loot.RANK.uncommon && far.gear.level === 5);
        const offer = Loot.offer('mission', `site:${s.id}`, { ...R.gear, seed: g.seed });
        assert(offer.length === 3 && offer.every((x) => Loot.RANK[x.rarity] >= Loot.RANK[R.gear.floor]), `seed ${seed}: ${s.name}: an offer`);
      }
    }
  }
  assert.strictEqual(Survey.reward({ kind: 'stellar-stream' }, 5), null);
  assert.deepStrictEqual([1, 6, 7, 30].map(Survey.level), [1, 1, 2, 5]);
});

test('talents: perks change what a skill does', () => {
  const stats = (cls, talents = []) => Progress.apply(Classes.apply(Loadout.stats(Loadout.starter('courier')), cls), 12, talents);
  const mk = (id, cls, talents) => { const st = stats(cls, talents); return { id, name: id, stats: st, hull: st.hull, shield: st.shield, cooldowns: {}, status: [] }; };
  const cast = (s, user, id, target, at) => { user.casting = null; user.cooldowns = {}; assert(Abilities.use(user, id, target, at), id); return Abilities.resolve(s, at + 2); };
  const foes = () => [mk('e1', 'dps'), mk('e2', 'dps')];
  // Barbed taunt: every enemy takes more while it lasts; without the perk, none does.
  for (const [talents, taken] of [[[], 1], [['barbed-taunt'], 1.15]]) {
    const me = mk('player', 'tank', talents), enemies = foes();
    cast({ t: 0, player: me, allies: [], enemies }, me, 'taunt', me, 0);
    assert.deepStrictEqual(enemies.map((e) => e.stats.taken ?? 1), [taken, taken]);
    Abilities.tick(enemies[0], 60);
    assert.strictEqual(enemies[0].stats.taken ?? 1, 1);
  }
  // Counter-battery: fortified, the guns hit harder.
  for (const [talents, k] of [[[], 1], [['counter-battery'], 1.4]]) {
    const me = mk('player', 'tank', talents), before = me.stats.firepower;
    cast({ t: 0, player: me, allies: [], enemies: foes() }, me, 'fortify', me, 0);
    assert(Math.abs(me.stats.firepower / before - k) < 1e-9 && me.stats.taken === 0.5);
    assert.deepStrictEqual(me.stats.perks, talents, 'the perks stay on the stats while a status runs');
  }
  // Executioner: a salvo on a ship low on hull hits half as hard again. Chain fire: a kill readies it.
  const hit = (talents, hullShare) => {
    const me = mk('player', 'dps', talents), enemies = foes();
    enemies[0].stats = { ...enemies[0].stats, hull: 100000 };
    enemies[0].shield = 0; enemies[0].hull = 100000 * hullShare;
    return cast({ t: 0, player: me, allies: [], enemies }, me, 'salvo', enemies[0], 0)[0].damage;
  };
  assert.strictEqual(hit(['executioner'], 0.9), hit([], 0.9));
  assert(Math.abs(hit(['executioner'], 0.3) / hit([], 0.3) - 1.5) < 0.02);
  for (const [talents, ready] of [[[], false], [['chain-fire'], true]]) {
    const me = mk('player', 'dps', talents), enemies = foes();
    enemies[0].shield = 0; enemies[0].hull = 1;
    assert.strictEqual(Abilities.use(me, 'salvo', enemies[0], 0).type, 'cast');
    assert(Abilities.resolve({ t: 0, player: me, allies: [], enemies }, 2)[0].destroyed);
    assert.strictEqual(Abilities.ready(me, 'salvo', enemies[1], 2), ready);
  }
  // Overflow: what the hull has no room for goes to the shields. Battle medic: the mended ship hits harder.
  for (const [talents, spill] of [[[], false], [['overflow'], true]]) {
    const me = mk('player', 'healer', talents), mate = mk('a1', 'dps');
    mate.hull = mate.stats.hull * 0.84; mate.shield = 0;
    cast({ t: 0, player: me, allies: [mate], enemies: foes() }, me, 'repair-beam', mate, 0);
    assert.strictEqual(mate.hull, mate.stats.hull);
    assert.strictEqual(mate.shield > 0, spill);
  }
  for (const [talents, k] of [[[], 1], [['battle-medic'], 1.2]]) {
    const me = mk('player', 'healer', talents), mate = mk('a1', 'dps'), before = mate.stats.firepower;
    mate.hull = mate.stats.hull / 2;
    cast({ t: 0, player: me, allies: [mate], enemies: foes() }, me, 'repair-beam', mate, 0);
    assert(Math.abs(mate.stats.firepower / before - k) < 1e-9);
    Abilities.tick(mate, 30);
    assert.strictEqual(mate.stats.firepower, before);
  }
});

// Turn-based combat (combat/combat.js): ships as the timeline takes them. Real gear, so they can fly;
// `fixed` ones hold their place (only turning), for the rule checks.
const FOE1 = Loadout.stats(Loadout.npc('fighter', 1));

const COURIER_STATS = () => Loadout.stats(Loadout.starter('courier'));

const tl = (id, stats, x, o = {}, hull = stats.hull) => RealtimeCombat.ship(id, id, stats, { x, y: 0, angle: x > 0 ? Math.PI : 0, radius: 16 }, hull, o);

// n ships of these stats in a ring round the origin, 700 out, nosing in.
const ringOf = (r, stats, n, prefix) => Array.from({ length: n }, (_, k) => {
  const a = (k / n) * Math.PI * 2 + r();
  return RealtimeCombat.ship(`${prefix}${k}`, 'Fighter', stats, { x: Math.cos(a) * 700, y: Math.sin(a) * 700, angle: a + Math.PI, radius: 16 });
});

off('?pirates', 'abilities in a fight: a silenced ship holds fire, on the timeline and in real time', () => {
  const p = tl('player', COURIER_STATS(), 0), e = tl('e', { ...FOE1, hull: 1000 }, 300, { fixed: true });
  const s = Combat.create(always, p, [e], { focus: 'e' });
  Abilities.use(p, 'emp-charge', e, s.t);
  const g = e.gauge;
  for (let i = 0; i < 60; i++) Combat.step(s, 1 / 30);
  assert.strictEqual(e.gauge, g, 'its gauge froze');
  assert.strictEqual(p.hull, p.stats.hull, 'no shots from it');
  for (let i = 0; i < 6 * 30; i++) Combat.step(s, 1 / 30);
  assert(p.hull < p.stats.hull || p.shield < p.stats.shield, 'and it fires again once it wears off');
  // Real time: an enemy with its guns on you, silenced, does no damage while it lasts.
  const body = (x) => ({ x, y: 0, vx: 0, vy: 0, angle: x > 0 ? Math.PI : 0, radius: 16 });
  const rp = RealtimeCombat.ship('player', 'Me', COURIER_STATS(), body(0));
  const re = RealtimeCombat.ship('e', 'Them', FOE1, body(300));
  const rt = RealtimeCombat.create(mulberry32(3), rp, [re], { focus: 'e' });
  Abilities.use(rp, 'emp-charge', re, rt.t);
  for (let i = 0; i < 60; i++) RealtimeCombat.step(rt, 1 / 30, rp); // two seconds
  assert.strictEqual(rp.hull, rp.stats.hull, 'no shots landed while silenced');
});

off('?pirates', 'the timeline: gauges by initiative, first strike, a volley when full, shields before hull, holding fire out of reach', () => {
  // A better scanner charges quicker; turns at an even initiative take `turn`.
  assert.strictEqual(Combat.period({ stats: { initiative: Combat.config.baseInitiative } }), Combat.config.turn);
  assert(Combat.period({ stats: { initiative: 10000 } }) < Combat.config.turn && Combat.period({ stats: { initiative: 0 } }) > Combat.config.turn);
  // Shots per turn average out to fireRate × turn time.
  const c = { stats: { initiative: Combat.config.baseInitiative } }, w = { fireRate: 3 }, r = mulberry32(5);
  let n = 0;
  for (let i = 0; i < 2000; i++) n += Combat.shotsPerTurn(c, w, r);
  assert(Math.abs(n / 2000 - 4.5) < 0.05, `average shots ${n / 2000}`);
  // The fight you start: your gauge half full; an ambush: empty.
  const me = () => tl('player', COURIER_STATS(), 0);
  assert.strictEqual(Combat.create(always, me(), [tl('e', FOE1, 400, { fixed: true })], { focus: 'e' }).player.gauge, Combat.config.firstStrike);
  assert.strictEqual(Combat.create(always, me(), [tl('e', FOE1, 400, { fixed: true })], {}).player.gauge, 0);
  // Full, the player's volley lands on the focus: shields first, then the hull.
  const p = me(), e = tl('e', { ...FOE1, hull: 500 }, 400, { fixed: true });
  const s = Combat.create(always, p, [e], { focus: 'e' });
  p.gauge = 0.999;
  e.gauge = 0;
  const ev = Combat.step(s, 1 / 30).filter((x) => x.type === 'shot');
  assert.strictEqual(ev.length, 1, 'the laser fires (the gas siphon sits it out)');
  assert.strictEqual(ev[0].from, 'player');
  assert.strictEqual(ev[0].shieldDamage, FOE1.shield, 'shields first');
  assert(ev[0].hullDamage > 0 && p.gauge === 0, 'then the hull; the gauge starts over');
  // Out of reach: the gauge holds full, and the volley goes the moment it reaches.
  const far = tl('f', { ...FOE1, weapons: [] }, 3000, { fixed: true });
  const s2 = Combat.create(always, me(), [far], { focus: 'f' });
  for (let i = 0; i < 90; i++) Combat.step(s2, 1 / 30);
  assert.strictEqual(s2.player.gauge, 1, 'holding fire, ready');
  assert(Combat.mode.gauge(s2, s2.player).holding, 'shown as holding');
  far.home = { x: 500, y: 0 };
  assert(Combat.step(s2, 1 / 30).some((x) => x.type === 'shot' && x.from === 'player'), 'fires as soon as it reaches');
});

off('?pirates', 'a breach: shields down knock the gauge back and cancel a heavy shot', () => {
  const p = tl('player', COURIER_STATS(), 0), e = tl('e', { ...FOE1, hull: 500 }, 400, { fixed: true });
  const s = Combat.create(always, p, [e], { focus: 'e' });
  e.intent = { kind: 'heavy' };
  e.gauge = 0.8;
  e.shield = 1;
  p.gauge = 0.999;
  const ev = Combat.step(s, 1 / 30);
  assert.deepStrictEqual(ev.find((x) => x.type === 'breach'), { type: 'breach', id: 'e', cancelled: true });
  assert(e.gauge < 0.8 - Combat.config.breach + 0.05, `knocked back: ${e.gauge}`);
  assert.strictEqual(e.intent.kind, 'volley', 'the heavy shot cancelled');
  // A heavy shot that lands hits harder.
  const q = tl('player', { ...COURIER_STATS(), shield: 0 }, 0), f = tl('f', FOE1, 400, { fixed: true });
  const s2 = Combat.create(always, q, [f], { focus: 'f' });
  f.intent = { kind: 'heavy' };
  f.gauge = 0.9999;
  const hit = Combat.step(s2, 1 / 30).find((x) => x.type === 'shot' && x.from === 'f');
  assert(hit.heavy && hit.damage === hit.hits * FOE1.weapons[0].damage * Combat.config.heavyDamage, 'heavy damage');
});

off('?pirates', 'Legendary powers bend the timeline\'s rules for whoever flies one', () => {
  const pw = (...powers) => ({ ...COURIER_STATS(), powers });
  // Every Legendary has a power, and fitted it's in the ship's stats.
  for (const base of Loot.BASE_IDS) {
    const item = Loot.make({ id: 'Lp', base, ilvl: 30, rarity: 'legendary', seed: 4 });
    assert(Loot.powerOf(item.loot.power), `${base} has a power`);
  }
  const leg = Loot.register({ id: 'Lpow', base: 'laser', ilvl: 30, rarity: 'legendary', seed: 4 }, Loadout.EQUIPMENT), l = Loadout.starter('courier');
  l.fitted['weapon-1'] = 'Lpow';
  assert.deepStrictEqual(Loadout.stats(l).powers, [leg.loot.power]);
  delete Loadout.EQUIPMENT.Lpow;
  // Breaker: a breach knocks the gauge back twice as far. Afterburn: not at all.
  const knock = (me, foe) => {
    const p = tl('player', me, 0), e = tl('e', { ...foe, hull: 500 }, 400, { fixed: true });
    const s = Combat.create(always, p, [e], { focus: 'e' });
    Object.assign(e, { gauge: 0.9, shield: 1, intent: { kind: 'volley' } });
    p.gauge = 0.999;
    Combat.step(s, 1 / 30);
    return 0.9 - e.gauge;
  };
  const plain = knock(COURIER_STATS(), FOE1);
  assert(Math.abs(knock(pw('breaker'), FOE1) - 2 * plain) < 0.05, 'breaker');
  assert(knock(COURIER_STATS(), { ...FOE1, powers: ['afterburn'] }) < 0.05, 'afterburn');
  // Overkill and meltdown: more damage on a ship charging a heavy shot, or with its shields down.
  const dealt = (me, o) => {
    const p = tl('player', me, 0), e = tl('e', { ...FOE1, hull: 5000 }, 400, { fixed: true });
    const s = Combat.create(always, p, [e], { focus: 'e' });
    Object.assign(e, { gauge: 0, shield: 0, intent: { kind: o.heavy ? 'heavy' : 'volley' } });
    p.gauge = 0.999;
    return Combat.step(s, 1 / 30).filter((x) => x.type === 'shot' && x.from === 'player').reduce((t, x) => t + x.damage, 0);
  };
  const base = dealt(COURIER_STATS(), {});
  assert(dealt(pw('overkill'), { heavy: true }) > base * 1.4 && dealt(pw('overkill'), {}) === base, 'overkill only on a heavy shot');
  assert(dealt(pw('meltdown'), {}) > base * 1.2, 'meltdown with its shields down');
  // Insight: more hit chance on a ship charging a heavy shot.
  const p = tl('player', pw('insight'), 0), e = tl('e', { ...FOE1, evasion: 0.5 }, 400, { fixed: true }), w = p.stats.weapons[0];
  e.intent = { kind: 'volley' };
  const h0 = Combat.hitChance(p, w, e);
  e.intent = { kind: 'heavy' };
  assert(Combat.hitChance(p, w, e) > h0, 'insight');
  // Foresight: a fight starts with the gauge full, even an ambush.
  assert.strictEqual(Combat.create(always, tl('player', pw('foresight'), 0), [tl('e', FOE1, 400, { fixed: true })], {}).player.gauge, 1, 'foresight');
  // Second wind: the first time the shields go down, half come back; the second time, a breach.
  const q = tl('player', { ...pw('second-wind'), shield: 100 }, 0), f = tl('f', { ...FOE1, weapons: [{ name: 'Gun', damage: 500, fireRate: 1, range: 1000, arc: 360 }] }, 400, { fixed: true });
  const s2 = Combat.create(always, q, [f], { focus: 'f' });
  q.hull = q.stats.hull = 1e6;
  Object.assign(f, { gauge: 0.9999, intent: { kind: 'volley' } });
  const ev = Combat.step(s2, 1 / 30);
  assert(ev.some((x) => x.type === 'power' && x.power === 'second-wind') && !ev.some((x) => x.type === 'breach'), 'second wind, no breach');
  assert.strictEqual(q.shield, 50);
  Object.assign(f, { gauge: 0.9999, intent: { kind: 'volley' } });
  assert(Combat.step(s2, 1 / 30).some((x) => x.type === 'breach' && x.id === 'player'), 'once a fight');
  // A power counts a little in a ship's rating.
  assert(Combat.rating(pw('breaker')) > Combat.rating(COURIER_STATS()));
});

off('?pirates', 'the player switches to the next enemy when the focused one is destroyed', () => {
  const p = tl('player', COURIER_STATS(), 0);
  const a = tl('a', { ...FOE1, hull: 1, shield: 0, weapons: [] }, 300, { fixed: true }), b = tl('b', { ...FOE1, hull: 500, weapons: [] }, 350, { fixed: true });
  const s = Combat.create(always, p, [a, b], { focus: 'a' });
  p.gauge = 0.999;
  Combat.step(s, 1 / 30);
  assert.strictEqual(a.hull, 0);
  Combat.step(s, 1 / 30);
  assert.strictEqual(s.focus, 'b');
});

off('?pirates', 'the starter Courier against pirate fighters: easy alone, costly in pairs, flee by flying clear', () => {
  const N = 200;
  const fight = (n, pilot) => {
    let wins = 0, escapes = 0, hull = 0;
    for (let i = 0; i < N; i++) {
      const r = mulberry32(i * 7919 + n);
      const es = Array.from({ length: n }, (_, k) => { const a = (k / n) * Math.PI * 2 + r(); return RealtimeCombat.ship(`f${k}`, 'Fighter', FOE1, { x: Math.cos(a) * 700, y: Math.sin(a) * 700, angle: a + Math.PI, radius: 16 }); });
      const s = Combat.simulate(r, tl('player', COURIER_STATS(), 0), es, pilot);
      if (s.over === 'won') { wins++; hull += s.player.hull; }
      if (s.over === 'fled') escapes++;
    }
    return { win: wins / N, escape: escapes / N, hull: hull / Math.max(1, wins) };
  };
  const me = COURIER_STATS();
  const [one, two, three, four] = [1, 2, 3, 4].map((n) => fight(n, null));
  assert(one.win > 0.99 && one.hull > 100, `vs 1: ${JSON.stringify(one)}`);
  assert(two.win > 0.85 && two.hull < me.hull - 10, `vs 2: ${JSON.stringify(two)}`);
  assert(three.win < 0.3, `vs 3: ${JSON.stringify(three)}`);
  assert(four.win < 0.1, `vs 4: ${JSON.stringify(four)}`);
  // Straight out at full speed, past the pirates' leash.
  const run = fight(4, (s, dt) => { const a = Math.atan2(s.player.y - s.anchor.y, s.player.x - s.anchor.x); Flight.step(s.player, s.player.stats, { targetAngle: a, targetSpeed: s.player.stats.maxSpeed, mode: 'cruise' }, dt); });
  assert(run.escape > 0.6, `fleeing 4: ${JSON.stringify(run)}`);
});

off('?pirates', 'pirates pay their cargo as credits and leave nothing floating; freighters spill trade goods', () => {
  const g = systems.get(1);
  let paid = 0, paidAt4 = 0, none = 0;
  for (let i = 0; i < 300; i++) {
    for (const tier of [1, 4]) {
      assert.deepStrictEqual(CombatCore.loot(g.seed, `x,y,s${i}`, 'fighter', tier), [], 'a pirate leaves nothing floating');
      const c = CombatCore.credits(g.seed, `x,y,s${i}`, 'fighter', tier);
      assert.strictEqual(CombatCore.credits(g.seed, `x,y,s${i}`, 'fighter', tier), c, 'credits are not deterministic');
      if (tier === 1) { paid += c; if (!c) none++; } else paidAt4 += c;
    }
    const fr = CombatCore.loot(g.seed, `x,y,s${i}`, 'freighter');
    assert(fr.length >= 1);
    for (const d of fr) assert(Goods.type(d.kind) && !Goods.isSalvage(d.kind), `freighter dropped ${d.kind}`);
    assert.strictEqual(CombatCore.credits(g.seed, `x,y,s${i}`, 'freighter'), 0, 'a freighter\'s cargo floats');
  }
  assert(none > 120 && none < 210, `${none} of 300 pirates carried nothing`);
  assert(paid / 300 > 25 && paid / 300 < 110, `${paid / 300} credits a pirate`);
  assert(paidAt4 > paid, 'better-armed pirates keep better cargo');
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

off('?pirates', 'pirates come in packs that follow the security level and can be fought one at a time', () => {
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
        // (A galaxy's systems have a level, which sets the tier instead: their own test.)
        if (!scened) assert(P.tier.some(([t]) => t === k.tier), `seed ${seed}: tier ${k.tier} at security ${k.level}`);
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

off('?pirates', 'schematics: only from armed pirates, for gear of their tier or one better', () => {
  for (let i = 0; i < 6000; i++) {
    assert.strictEqual(CombatCore.schematic(1, `p${i}`, 'fighter', 1), null, 'tier 1 pirates carry none');
    assert.strictEqual(CombatCore.schematic(1, `p${i}`, 'freighter', 4), null, 'freighters carry none');
    for (const tier of [2, 3, 4]) {
      const id = CombatCore.schematic(1, `p${i}`, 'fighter', tier);
      if (id) assert(!Loadout.EQUIPMENT[id].npc && Loadout.EQUIPMENT[id].tier >= tier && Loadout.EQUIPMENT[id].tier <= tier + 1);
    }
  }
});

off('?pirates', 'each step up the gear ladder takes on the next pirate band', () => {
  const fit = (hull, mk, weapons) => {
    const fitted = {};
    let w = 0;
    for (const s of Loadout.slotsOf(hull)) {
      fitted[s.id] = s.type === 'weapon' ? (w++ < weapons ? `pulse-laser-${mk}` : null)
        : { shield: 'deflector', computer: 'flight-computer', engine: 'courier-drive', scanner: 'survey-scanner' }[s.type] + `-${mk}`;
    }
    return Loadout.stats({ hull, fitted });
  };
  // Sitting still, guns on the target (Combat.simulate's own pilot): flying well does better.
  const winRate = (stats, tier, n) => {
    let wins = 0;
    for (let i = 0; i < 100; i++) {
      const r = mulberry32(i * 7919 + tier * 31 + n);
      const enemies = Array.from({ length: n }, (_, k) => { const a = (k / n) * Math.PI * 2 + r(); return RealtimeCombat.ship(`e${k}`, 'Fighter', Loadout.stats(Loadout.npc('fighter', tier)), { x: Math.cos(a) * 700, y: Math.sin(a) * 700, angle: a + Math.PI, radius: 16 }); });
      if (Combat.simulate(r, tl('player', stats, 0), enemies).over === 'won') wins++;
    }
    return wins / 100;
  };
  assert(winRate(fit('courier', 1, 1), 1, 2) > 0.85, 'the starter ship beats two Mk I pirates');
  assert(winRate(fit('courier', 1, 1), 2, 2) < 0.2, '... but not two Mk II');
  assert(winRate(fit('courier', 2, 2), 2, 3) > 0.7, 'Mk II gear with two lasers beats three Mk II pirates, mostly');
  assert(winRate(fit('courier', 2, 2), 3, 3) < 0.2, '... but not three Mk III');
  assert(winRate(fit('corvette', 3, 3), 3, 4) > 0.45, 'a Corvette with Mk III gear holds its own against four Mk III pirates');
  assert(winRate(fit('gunship', 5, 4), 4, 6) > 0.75, 'a Gunship with Mk V gear beats the largest band');
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

off('?pirates', 'real-time combat: hit chance falls with crossing speed and range; evasion needs speed', () => {
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

off('?pirates', 'real-time combat: shields soak damage first and recharge only after a pause', () => {
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

off('?pirates', 'real-time combat: targets and locks', () => {
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

off('?pirates', 'real-time combat: fighters make attack runs, turrets keep their distance', () => {
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
  // Each system's hazards are its own (galaxy.placeAt); deep space has no star and no flares.
  const place = g.placeAt(terran.x, terran.y), S = place.stars[0];
  const behind = [S.x + (terran.x - S.x) * 1.1, S.y + (terran.y - S.y) * 1.1], open = [behind[0] + 3000, behind[1] - 3000];
  const sun = (pt) => Hazards.exposure(place, g.seed, pt[0], pt[1], wave);
  const far = g.systems[0].origin, deep = [far.x + g.systems[0].radius * 1.5, far.y];
  if (!g.systemAt(...deep)) assert.deepStrictEqual([Hazards.exposure(g.placeAt(...deep), g.seed, ...deep, wave).flare.phase, Hazards.exposure(g.placeAt(...deep), g.seed, ...deep, wave).heat], ['calm', 0], 'no flare in deep space');
  assert.ok(sun(behind).shadow, 'behind the terran planet');
  assert(sun(open).rad > 0 && !sun(open).shadow, 'out in the open, the wave comes through');
  assert(sun(open).heat > Hazards.exposure(place, g.seed, open[0], open[1], calm).heat, 'and heats');
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
  // Between the systems: a hop to a neighbour (a quarter million units) is a good share of a tank,
  // the rim to the core more than a tank holds.
  const hop = Hazards.travelFuel(250000), deep = Hazards.travelFuel(0.75 * GalaxyShape.params.radius);
  assert(hop > courier.fuel / 6 && hop < courier.fuel / 2, `a hop between systems costs ${hop}`);
  assert(deep > courier.fuel, 'the core is beyond one tank from the start');
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

off('?pirates', 'real-time combat: the starter Courier against pirate fighters, and getting away', () => {
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
    for (const o of g.stations.filter((x) => !x.waystation && x.system === 0)) assert(o.culture < SolarSystem.SETTLED || o.culture === SolarSystem.DRIFTER, `${where}: ${o.key}`);
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
  assert.strictEqual(thingsOf(1, 'gate').find((e) => !e.gate.wormhole).art.type, 'gate');
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
  assert.strictEqual(Squad.stats(m).hull, Math.round(Loadout.HULLS.fighter.hull * Classes.CLASSES[m.cls].mods.hull), 'no extra armour (its class aside)');
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

test('jobs: every station posts contracts: raiders, a battery, an outpost (here or nearby), a siege, a strike, and some that are not fights', () => {
  for (const [seed, g] of galaxies) {
    const B = Jobs.board(g), where = `seed ${seed}`;
    assert(B.list.length > 0, `${where}: contracts`);
    const kinds = new Set(B.list.map((j) => j.id.split('/').pop()));
    for (const k of ['patrol', 'battery', 'outpost', 'siege', 'strike', 'dispatch', 'survey', 'recovery', 'stores']) assert(kinds.has(k), `${where}: a ${k}`);
    for (const j of B.list) {
      assert(Jobs.DIFFICULTY[j.difficulty], `${where}: ${j.id} has a difficulty`);
      const calm = j.difficulty === 'calm';
      assert(calm ? !j.reward.gear && j.reward.level >= 1 : j.reward.gear && j.reward.gear.level >= 1, `${where}: ${j.id} rewards gear (unless it's no fight)`);
      // A contract that is no fight has none in it, and pays; one for stores names a good another station sells.
      if (calm) {
        assert(j.steps.every((s) => ['go', 'take', 'bring'].includes(s.type)) && j.reward.credits >= 100, `${where}: ${j.id} is no fight`);
        for (const s of j.steps.filter((x) => x.type === 'bring')) {
          const sold = (st) => Economy.market(g.seed, st).goods.some((x) => x.kind === s.kind && x.buy !== null);
          assert(!sold(g.stations.find((st) => st.key === j.scope)) && g.stations.some(sold), `${where}: ${j.id}: ${s.kind} is sold elsewhere`);
          assert(j.reward.credits > Goods.type(s.kind).price * s.n, `${where}: ${j.id} pays more than its goods cost`);
        }
        for (const s of j.steps.filter((x) => x.type === 'take')) for (const it of s.items) assert(Goods.type(it.kind), `${where}: ${j.id}: ${it.kind}`);
      }
      const texts = [j.title, j.rewardText, ...j.briefing, ...j.debrief, ...j.steps.map((s) => s.label)];
      for (const t of texts) assert(typeof t === 'string' && t && !/undefined|null|NaN|\[object/.test(t), `${where}: ${t}`);
      for (const s of j.steps) {
        if (s.type === 'assault') {
          assert.strictEqual(j.objectives.find((o) => o.id === `s${j.steps.indexOf(s)}`).need ?? 1, Jobs.assaultNeed(s));
          assert(s.base.turrets.length >= 2 && s.base.tier >= 1 && s.base.tier <= 5);
        }
        if (s.type === 'defend') assert(s.waves.length >= 3 && g.stations.some((st) => st.key === s.station.key));
      }
    }
    // Harder pays more, on the whole; some fights are in another system.
    const med = (d) => { const v = B.list.filter((j) => j.difficulty === d).map((j) => j.reward.credits).sort((a, b) => a - b); return v[v.length >> 1]; };
    assert(med('easy') < med('hard') && med('hard') < med('elite'), `${where}: pay by difficulty`);
    assert(B.list.some((j) => j.systems.some((i) => i !== j.system)), `${where}: a contract in a nearby system`);
  }
});

// A station job, a system job and a faction job written for the test, to check the machinery the
// board runs on while the game has none of its own.
function withTestJobs(fn) {
  const { go, fight, bring } = JobTexts;
  const saved = { ...JobTexts.STATION }; // the combat contracts, out of the way meanwhile
  const story = JobTexts.STORY.splice(0); // and the main story
  for (const k of Object.keys(JobTexts.STATION)) JobTexts.STATION[k] = [];
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
    Object.assign(JobTexts.STATION, saved);
    delete JobTexts.FACTION.wedge;
    JobTexts.STORY.push(...story);
  }
}

off('no job texts', 'jobs: the board places what job texts write, pays by tier, and the log keeps them', () => withTestJobs(() => {
  for (const [seed, g] of showcases) { // one system: the test texts post a job at each capital and camp
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
  const B = Jobs.board(showcases.get(1)), J = B.list.find((j) => j.steps.length === 1 && j.steps[0].type === 'bring');
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

// A squad member's ship, as it flies in a fight.
const wingman = () => Squad.stats(Squad.member(3));

test('turns: an ally fires on the target its orders name, and only then; a downed ally drops out', () => {
  const me = () => tl('player', COURIER, 0), foe = (id, x = 400) => tl(id, FIGHTER, x, { fixed: true });
  const ally = () => tl('w1', wingman(), 0);
  ally.at = (a) => Object.assign(a, { y: 120 });
  const run = (s, secs) => { const ev = []; for (let i = 0; i < secs * 30 && !s.over; i++) ev.push(...Combat.step(s, 1 / 30)); return ev; };
  // No orders: it holds fire.
  let s = Combat.create(mulberry32(1), me(), [foe('f1')], { focus: 'f1', allies: [ally.at(ally())] });
  let ev = run(s, 3);
  assert(!ev.some((e) => e.from === 'w1'), 'no orders, no shots');
  // Ordered onto f2: every one of its volleys goes there.
  s = Combat.create(mulberry32(2), me(), [foe('f1'), foe('f2', 450)], { focus: 'f1', allies: [ally.at(ally())] });
  Combat.mode.setOrders(s, 'w1', { target: 'f2' });
  ev = run(s, 4);
  const mine = ev.filter((e) => e.type === 'shot' && e.from === 'w1');
  assert(mine.length >= 1 && mine.every((e) => e.to === 'f2'), JSON.stringify(mine));
  // Enemies shoot at the ally now and then (about a third of them with one ally).
  let atAlly = 0;
  for (let i = 0; i < 300; i++) {
    const t = Combat.create(mulberry32(100 + i), me(), [foe('f1')], { focus: 'f1', allies: [ally()] });
    if (t.enemies[0].aim === 'w1') atAlly++;
  }
  assert(atAlly > 60 && atAlly < 140, `${atAlly}/300 aimed at the ally`);
  // An ally shot down doesn't end the fight; the enemy turns on the player.
  s = Combat.create(mulberry32(3), me(), [foe('f1')], { focus: 'f1', allies: [ally.at(ally())] });
  s.enemies[0].aim = 'w1';
  s.allies[0].hull = 0;
  ev = run(s, 3);
  assert(!s.over || s.over === 'won', s.over);
  assert(ev.filter((e) => e.type === 'shot' && e.from === 'f1').every((e) => e.to === 'player'));
  // With a wingman assisting, two fighters go down faster and the Courier keeps more hull.
  const duel = (withAlly) => {
    let time = 0, hull = 0;
    for (let i = 0; i < 100; i++) {
      const r = mulberry32(500 + i);
      const t = Combat.create(r, me(), ringOf(r, FIGHTER, 2, 'f'), { focus: 'f0', allies: withAlly ? [ally.at(ally())] : [] });
      while (!t.over && t.t < 120) { if (withAlly) Combat.mode.setOrders(t, 'w1', { target: t.focus }); Combat.step(t, 1 / 30); }
      time += t.t;
      hull += Math.max(0, t.player.hull);
    }
    return { time: time / 100, hull: hull / 100 };
  };
  const alone = duel(false), helped = duel(true);
  assert(helped.time < alone.time * 0.8 && helped.hull > alone.hull + 10, `alone ${JSON.stringify(alone)}, helped ${JSON.stringify(helped)}`);
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
  // consumables), plus the tabs, slots, the old research groups and the context menu's actions.
  const src = ['station.js', 'kit.js'].map((f) => fs.readFileSync(new URL(`../src/ui/${f}`, import.meta.url), 'utf8')).join('\n');
  const codes = new Set([...src.matchAll(/code: '([A-Z+]{1,4})'/g)].map((m) => m[1]));
  for (const a of Abilities.LIST) codes.add(a.code);
  for (const c of ['SCN', 'ENG', 'CPU', 'SYS', 'CMB', 'TAC', 'MNT', 'RCP', 'LAB', 'MOD', 'ORE', 'VOL', 'RCY', 'FAB', 'BEN', 'SHY', 'tab-trade', 'tab-ship', 'tab-outfitter', 'tab-squad', 'tab-missions', 'LOG', 'OUT', 'hold', 'hull', 'face', 'android', 'open',
    'dock', 'mine', 'collect', 'gather', 'jump', 'attack', 'approach', 'cancel-approach',
    'HLD', 'HUL', 'SHD']) codes.add(c); // the last row: the HUD's status icons (game/hud.js)
  const missing = [...codes].filter((c) => !Glyphs.has(c));
  assert.deepStrictEqual(missing, [], 'codes with no icon');
  for (const n of Glyphs.names) assert.match(Glyphs.svg(n, 20), /^<svg viewBox="0 0 24 24" width="20" height="20"[^>]*>.+<\/svg>$/);
});

test('screen effects: cracks by stage of the hull, seeded and stable', () => {
  assert.deepStrictEqual([1, 0.5, 0.49, 0.25, 0.2, 0.1, 0.05].map(ScreenFx.crackStage), [0, 0, 1, 1, 2, 2, 3]);
  // Seeded and stable: the same cracks for a seed, and each stage keeps the ones before.
  assert.deepStrictEqual(ScreenFx.cracks(7, 2), ScreenFx.cracks(7, 2));
  assert.notDeepStrictEqual(ScreenFx.cracks(7, 2), ScreenFx.cracks(8, 2));
  assert.deepStrictEqual(ScreenFx.cracks(7, 0), []);
  const one = ScreenFx.cracks(7, 1), three = ScreenFx.cracks(7, 3);
  assert.deepStrictEqual(three.slice(0, one.length), one);
  assert(three.length > one.length);
  for (const c of three) {
    assert(c.corner >= 0 && c.corner <= 3 && c.pts.length >= 2);
    for (const [x, y] of c.pts) assert(x >= 0 && y >= 0 && x < 0.6 && y < 0.6, `in from the corner: ${x}, ${y}`);
  }
});

// ---------- The race's career: the hangar's trade-off trees, pickups, banking ----------

test('lab: forks rule each other out, a requirement list is met by any one of it', () => {
  const pk = {
    a: { id: 'a', cat: 'x', requires: [], time: 10, cost: { credits: 1 }, fork: 'f' },
    b: { id: 'b', cat: 'x', requires: [], time: 10, cost: { credits: 1 }, fork: 'f' },
    c: { id: 'c', cat: 'x', requires: [['a', 'b']], time: 10, cost: { credits: 1 } },
  };
  const L = Lab.create({ packages: pk, categories: [{ id: 'x' }], queueMax: () => 3 }), lab = L.empty(), have = () => 0;
  assert.strictEqual(L.status('c', lab, 9, have).state, 'locked');
  assert(L.enqueue(lab, 'b', 0));
  assert.strictEqual(L.status('a', lab, 9, have).state, 'closed', 'its fork sibling queued closes it');
  assert.strictEqual(L.status('a', lab, 9, have).by, 'b');
  assert(!L.enqueue(lab, 'a', 0), 'and it can\'t be queued');
  assert.strictEqual(L.status('c', lab, 9, have).state, 'available', 'b (pending) meets [a, b]');
  assert(L.enqueue(lab, 'c', 0));
  assert.deepStrictEqual(L.cancel(lab, 'b', 1).map((x) => x.id), ['b', 'c'], 'cancelling b takes c with it');
  assert.strictEqual(L.status('a', lab, 9, have).state, 'available', 'b gone, a opens again');
  const lay = L.layout(Object.values(pk));
  assert.deepStrictEqual(lay.nodes.map((n) => [n.id, n.col]), [['a', 0], ['b', 0], ['c', 1]]);
});

test('Sound: silent until the player has touched the page, never made while off, a voice for every event that buzzes', () => {
  // A stand-in audio context that counts what is made on it.
  const made = { contexts: 0, tones: 0, noises: 0 };
  const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const node = (extra = {}) => ({ connect() {}, start() {}, stop() {}, ...extra });
  class FakeAudio {
    constructor() { made.contexts++; this.state = 'suspended'; this.currentTime = 0; this.sampleRate = 8000; this.destination = {}; }
    resume() { this.state = 'running'; return Promise.resolve(); }
    suspend() { this.state = 'suspended'; return Promise.resolve(); }
    createGain() { return node({ gain: param() }); }
    createOscillator() { made.tones++; return node({ frequency: param(), type: 'sine' }); }
    createBiquadFilter() { return node({ frequency: param(), Q: param(), type: 'lowpass' }); }
    createBuffer(ch, n) { const d = new Float32Array(n); return { getChannelData: () => d }; }
    createBufferSource() { made.noises++; return node({ buffer: null }); }
  }
  assert.strictEqual(Sound.available, false, 'none in Node');
  assert.strictEqual(Sound.play('hit'), false);
  Sound.use(FakeAudio);
  try {
    Sound.setVolume(0.5);
    assert.strictEqual(Sound.play('hit'), false, 'nothing before a touch');
    assert.strictEqual(made.contexts, 0, 'and no audio context made');
    Sound.unlock();
    assert.strictEqual(made.contexts, 1);
    assert.strictEqual(Sound.play('hit'), true);
    assert(made.tones === 1 && made.noises === 1, 'a hit: a thump and a burst of noise');
    assert.strictEqual(Sound.play('hit'), false, 'a second hit in the same instant is the same sound');
    assert.strictEqual(Sound.play('no-such-event'), false);
    const before = made.tones;
    assert.strictEqual(Sound.play('loot', { rarity: 'legendary' }), true);
    assert.strictEqual(made.tones - before, 5, 'a legendary rings five notes');
    Sound.setVolume(0);
    assert.strictEqual(Sound.play('won'), false, 'off: nothing');
    Sound.use(FakeAudio);
    Sound.setVolume(0);
    Sound.unlock();
    assert.strictEqual(made.contexts, 1, 'off from the start: no context even after a touch');
    Sound.setVolume(0.8);
    assert.strictEqual(made.contexts, 2, 'turned on after a touch: made then');
    // Every event the game sends has a voice (the same list the vibration answers: game/options.js).
    for (const ev of ['hit', 'bump', 'hazard', 'skill', 'shields-down', 'low-hull', 'locked', 'targeted', 'destroyed', 'won', 'mined', 'docked', 'launched']) assert(Sound.VOICES[ev], ev);
    for (const r of ['common', 'uncommon', 'rare', 'epic', 'legendary']) assert(Sound.VOICES[`loot-${r}`], r);
  } finally {
    Sound.use(null);
    Sound.setVolume(0);
  }
});

test('squad members learn their class\'s perks at their levels, and their skills change with them', () => {
  const xpFor = (level) => { let xp = 0; for (let k = 1; k < level; k++) xp += Progress.toNext(k); return xp; };
  assert.deepStrictEqual(Progress.squadPerks('tank', 5), []);
  assert.deepStrictEqual(Progress.squadPerks('tank', 6), ['barbed-taunt']);
  assert.deepStrictEqual(Progress.squadPerks('tank', 30), ['barbed-taunt', 'counter-battery']);
  assert.deepStrictEqual(Progress.squadPerks('dps', 12), ['executioner', 'chain-fire']);
  for (const c of Classes.LIST) assert.strictEqual(Progress.perksOf(c.id).length, 2, `${c.id}: two perks`);
  const member = Squad.member(7, { cls: 'healer' });
  assert.deepStrictEqual(Squad.stats(member).perks, [], 'none at level 1');
  member.xp = xpFor(6);
  assert.deepStrictEqual(Squad.stats(member).perks, ['overflow'], 'the first at level 6');
  member.xp = xpFor(12);
  assert.deepStrictEqual(Squad.stats(member).perks, ['overflow', 'battle-medic']);
  member.cls = 'dps';
  assert.deepStrictEqual(Squad.stats(member).perks, ['executioner', 'chain-fire'], 'its class changed: that class\'s');
  assert.strictEqual(Squad.stats(member).hull, Squad.stats({ ...member, cls: 'dps' }).hull, 'perks change skills, not the numbers');
});

test('Loot workshop: a reroll keeps the piece and changes its affixes; a refine is one rarity better, never Legendary', () => {
  const spec = { id: 'Labc1e', base: 'laser', ilvl: 14, rarity: 'rare', seed: 123456 };
  const item = Loot.make(spec), again = Loot.reroll(spec), made = Loot.make(again);
  assert(again.id !== spec.id && /^L[0-9a-z]+$/.test(again.id), 'a new id, of the saved form');
  assert.deepStrictEqual([again.base, again.ilvl, again.rarity], ['laser', 14, 'rare'], 'the same piece');
  assert.strictEqual(made.loot.affixes.length, 2, 'as many affixes');
  assert.notDeepStrictEqual(made.loot.affixes, item.loot.affixes, 'rolled anew');
  assert.deepStrictEqual(Loot.reroll(spec), again, 'the same every time: reloading can\'t fish for a roll');
  assert.notDeepStrictEqual(Loot.reroll(again), again, 'and again from there');
  assert.deepStrictEqual(Loot.read({ [again.id]: again })[again.id], again, 'it saves and reads back');
  assert.strictEqual(Loot.reroll({ ...spec, rarity: 'common' }), null, 'nothing to reroll on a Common');
  const up = Loot.promote(spec);
  assert.strictEqual(up.rarity, 'epic');
  assert.strictEqual(Loot.make(up).loot.affixes.length, 3, 'one more affix');
  assert(Loot.make(up).stats.damage > item.stats.damage, 'and stronger');
  assert.strictEqual(Loot.promote(up), null, 'never into Legendary');
  assert.strictEqual(Loot.promote({ ...spec, rarity: 'legendary' }), null);
  // Costs: components of the slot's kind by the Mk, and credits; refining costs more of both.
  const rr = Loot.workCost(spec, 'reroll'), pr = Loot.workCost(spec, 'promote');
  assert.deepStrictEqual([rr.salvage, rr.n], ['weapon', 2], 'a Mk II gun: two weapon components');
  assert(pr.n > rr.n && pr.credits > rr.credits);
  assert.strictEqual(Loot.workCost({ ...spec, base: 'engine' }, 'reroll').salvage, 'drive');
  assert.strictEqual(Loot.workCost({ ...spec, base: 'shield-generator' }, 'reroll').salvage, 'hull');
  assert.strictEqual(Loot.workCost(up, 'promote'), null);
  for (const slot of new Set(Object.values(Loot.BASES).map((B) => B.slot))) assert(Goods.CATEGORIES[Loot.SALVAGE[slot]]?.group === 'salvage', slot);
});

test('PilotLog: counts read back checked, milestones due once each, the grandest one reached the title', () => {
  const c = { level: 1, systems: 1, allSystems: 40, surveyed: 0, allSites: 12, elites: 0, chapters: 0, allChapters: 7 };
  const s = PilotLog.empty();
  assert.deepStrictEqual(PilotLog.due(s, c), [], 'a new game has reached none');
  assert.strictEqual(PilotLog.title(s), null);
  s.kills = 1;
  assert.deepStrictEqual(PilotLog.due(s, c).map((M) => M.id), ['first-blood']);
  s.done.push('first-blood');
  assert.deepStrictEqual(PilotLog.due(s, c), [], 'paid once');
  assert.strictEqual(PilotLog.title(s), 'Blooded');
  // Those read from the rest of the game: level, systems, sites, elites, the story.
  assert.deepStrictEqual(PilotLog.due(s, { ...c, level: 15, elites: 1, surveyed: 5, systems: 10 }).map((M) => M.id), ['bounty', 'traveller', 'surveyor', 'veteran']);
  assert.deepStrictEqual(PilotLog.due(s, { ...c, chapters: 7 }).map((M) => M.id), ['core-breaker']);
  assert.deepStrictEqual(PilotLog.due(s, { ...c, allSystems: 1 }), [], 'the showcase alone has nowhere to travel');
  s.done.push('veteran', 'bounty');
  assert.strictEqual(PilotLog.title(s), 'Veteran', 'the grandest reached, whatever the order');
  // A save: only what makes sense is kept.
  assert.deepStrictEqual(PilotLog.read({ kills: 12.7, wardens: -3, raids: 'x', seconds: 90.5, done: ['first-blood', 'nope', 'first-blood'], extra: 1 }),
    { kills: 12, wardens: 0, raids: 0, contracts: 0, losses: 0, seconds: 90.5, done: ['first-blood'] });
  assert.deepStrictEqual(PilotLog.read(null), PilotLog.empty());
  assert.strictEqual(PilotLog.time(59), '0 min');
  assert.strictEqual(PilotLog.time(3 * 3600 + 12 * 60 + 5), '3 h 12 min');
  const ids = PilotLog.MILESTONES.map((M) => M.id);
  assert.strictEqual(new Set(ids).size, ids.length, 'ids are unique');
});

test('the game offline: sw.js keeps every file the main game loads (npm run sw), and nothing of the other games', () => {
  const files = AppSw.appFiles('game');
  for (const f of ['./', 'manifest.webmanifest', 'src/main.js', 'src/game/loop.js', 'src/ui/kit-line.css', 'src/ui/kit-lowpoly.css', 'assets/icon-512.png', 'assets/fonts/b612-latin-400-normal.woff2']) assert(files.includes(f), f);
  assert(!files.some((f) => /^src\/(race|idle|sim|4x)\//.test(f) || /^(race|idle|sim|4x)\//.test(f) || f.endsWith('sw.js')), 'nothing of the other games, and not the worker itself');
  const { current, wanted } = AppSw.check('game');
  assert.strictEqual(current, wanted, 'sw.js: the file list is out of date: npm run sw');
});

test('Industry.create: a recipe with no inputs (a drill) fills its site to the room it has, then waits for a shuttle', () => {
  const recipes = { ...Recipes.RECIPES, 'extract.iron': { id: 'extract.iron', bay: 'extract', in: {}, out: { iron: 1 }, time: 10, unlock: null } };
  const I = Industry.create({ recipes, process: { ...Industry.PROCESS, site: ['extract'] } });
  const SITE = { key: 'site:a', name: 'A Field', type: 'site' }, T = 1e12;
  const env = { ...I.env(Research.empty()), slotsAt: (k) => (k === SITE.key ? 1 : 1), roomAt: (k) => (k === SITE.key ? -80 : 0) };
  const run = (steps) => {
    const state = I.empty();
    assert(I.place(state, SITE, 'extract.iron', null, env, T));
    assert(!I.place(state, SITE, 'extract.iron', null, env, T), 'one drill: one order');
    assert(!Industry.canMake('site', 'make.steel-pipe') && !I.canMake('site', 'make.steel-pipe') && I.canMake('site', 'extract.iron'));
    for (let i = 1; i <= steps; i++) I.settle(state, T + (3600e3 * i) / steps, env);
    return state;
  };
  const one = run(1);
  assert.strictEqual(I.stockAt(one, SITE.key).iron, 20, 'the site holds 100 − 80');
  assert.strictEqual(I.status(one, one.orders[0]).id, 'blocked', 'full: the drill waits');
  assert.deepStrictEqual(run(37), one, 'settled in steps: the same');
  // A shuttle takes it away, and drilling goes on.
  const t = T + 3600e3;
  I.setShuttle(one, SITE, CAMP, 20e3, env, t);
  I.settle(one, t + 600e3, env);
  assert((I.stockAt(one, CAMP.key).iron || 0) > 0, 'iron delivered');
  assert(one.orders[0].made > 20, 'drilling went on');
});

test('Restoration.create: another project list, the game\'s untouched', () => {
  const R = Restoration.create({ list: [{ id: 'a', name: 'A', type: 'minor', shuttle: null, goods: { iron: 2 }, credits: 10, requires: [] }], online: ['waystation'] });
  assert(!R.online('mining camp', []) && Restoration.online('mining camp', []));
  assert.strictEqual(R.status('a', [], { iron: 1 }, 50).id, 'short');
  assert.deepStrictEqual(R.restore('a', [], { iron: 2 }, 50), { take: { iron: 2 }, credits: 10 });
  assert(R.online('minor', ['a']));
});

// ---------- Loot (rules/loot.js) ----------

test('loot: item levels by source level, rarities by weight, affixes by rarity, one stat each', () => {
  const r = mulberry32(42), seen = {};
  for (let i = 0; i < 4000; i++) {
    const level = 1 + (i % 5), spec = Loot.roll(r, { level });
    assert(spec.ilvl >= (level - 1) * 10 + 1 && spec.ilvl <= level * 10, `ilvl ${spec.ilvl} at level ${level}`);
    const item = Loot.make(spec), R = Loot.rarityOf(spec.rarity);
    seen[spec.rarity] = (seen[spec.rarity] || 0) + 1;
    assert.strictEqual(item.slot, Loot.BASES[spec.base].slot);
    assert.strictEqual(item.tier, Loot.tierOf(spec.ilvl));
    assert(item.loot.affixes.length <= R.affixes, 'no more affixes than its rarity has');
    assert.strictEqual(new Set(item.loot.affixes.map((a) => a.stat)).size, item.loot.affixes.length, 'never one stat twice');
    for (const [k, v] of Object.entries(item.stats)) if (k !== 'vs') assert(Number.isFinite(v) && v >= 0, `${k}: ${v}`);
    assert(item.stats.accuracy === undefined || item.stats.accuracy <= 0.99);
    assert(item.price > 0 && item.name && !/undefined/.test(item.name));
  }
  assert(seen.common > seen.uncommon && seen.uncommon > seen.rare && seen.rare > seen.epic && seen.epic > (seen.legendary || 0), JSON.stringify(seen));
  // Remade from its spec, the same item.
  const spec = Loot.roll(mulberry32(7), { level: 4, floor: 'epic' });
  assert.deepStrictEqual(Loot.make(JSON.parse(JSON.stringify(spec))), Loot.make(spec));
  assert.deepStrictEqual(Loot.read({ [spec.id]: spec, bad: { id: 'x' } }), { [spec.id]: spec }, 'a save read back, the bad dropped');
});

test('loot: drop tables, floors, the same drops from the same kill, bad-luck protection and class bias', () => {
  for (const [source, S] of Object.entries(Loot.SOURCES)) {
    let n = 0;
    for (let k = 0; k < 400; k++) {
      const d = Loot.drops(source, `k${k}`, { level: 3, seed: 1 });
      if (d.length) n++;
      for (const spec of d) assert(Loot.RANK[spec.rarity] >= Loot.RANK[S.floor], `${source}: floor ${S.floor}`);
    }
    assert(Math.abs(n / 400 - S.chance) < 0.08, `${source}: drops ${n / 400} of the time, not ${S.chance}`);
  }
  assert.deepStrictEqual(Loot.drops('station', 'st1', { level: 2, seed: 9 }), Loot.drops('station', 'st1', { level: 2, seed: 9 }), 'the same every time');
  assert(Loot.drops('warden', 'w', { level: 2, seed: 1 }).every((s) => Loot.RANK[s.rarity] >= Loot.RANK.rare));
  // Pity: never more than PITY.rare rolls in a row below Rare.
  const pity = {}, r = mulberry32(3);
  let run = 0, worst = 0;
  for (let i = 0; i < 3000; i++) {
    const spec = Loot.roll(r, { level: 1, pity });
    run = Loot.RANK[spec.rarity] >= Loot.RANK.rare ? 0 : run + 1;
    worst = Math.max(worst, run);
  }
  assert(worst <= Loot.PITY.rare, `${worst} in a row`);
  // A DPS finds more weapons than a Tank does.
  const weapons = (cls) => { const q = mulberry32(5); let n = 0; for (let i = 0; i < 2000; i++) if (Loot.BASES[Loot.roll(q, { level: 2, cls }).base].slot === 'weapon') n++; return n; };
  assert(weapons('dps') > weapons('tank') * 1.3, 'class bias');
  // A party's classes: a DPS pilot with two Healers finds more shields than a DPS alone, and still
  // more weapons than the Healers alone would.
  const shields = (cls) => { const q = mulberry32(6); let n = 0; for (let i = 0; i < 3000; i++) if (Loot.roll(q, { level: 2, cls }).base === 'shield-generator') n++; return n; };
  assert(shields(['dps', 'dps', 'healer', 'healer']) > shields('dps') * 1.15, 'the squad\'s classes count');
  assert(weapons(['dps', 'dps', 'healer', 'healer']) > weapons('healer'), 'the pilot\'s still counts most');
  assert.deepStrictEqual(Loot.roll(mulberry32(1), { level: 2, cls: [] }).base.length > 0, true, 'an empty party is no bias');
});

test('loot: an offer is three kinds of gear to choose from, the first for the party, the same every time', () => {
  for (let k = 0; k < 200; k++) {
    const o = Loot.offer('warden', `w${k}`, { level: 3, seed: 2, cls: ['tank', 'tank', 'healer'] });
    assert.strictEqual(o.length, Loot.OFFER);
    assert.strictEqual(new Set(o.map((s) => s.base)).size, Loot.OFFER, 'each a different kind');
    assert(o.every((s) => Loot.RANK[s.rarity] >= Loot.RANK.rare), 'the source\'s floor');
    assert(Loot.CLASS_BIAS.tank.includes(o[0].base) || Loot.CLASS_BIAS.healer.includes(o[0].base), 'the first for a class in the party');
    assert.strictEqual(new Set(o.map((s) => s.id)).size, Loot.OFFER);
  }
  assert.deepStrictEqual(Loot.offer('mission', 'j1', { level: 2, seed: 5 }), Loot.offer('mission', 'j1', { level: 2, seed: 5 }));
  // Only the first roll counts toward bad-luck protection.
  const pity = { rare: 0, epic: 0 };
  Loot.offer('mission', 'j2', { level: 2, seed: 5, pity, floor: 'uncommon' });
  assert(pity.rare <= 1 && pity.epic <= 1, JSON.stringify(pity));
});

test('loot: fitted like any gear: its stats and hull affixes count in the loadout', () => {
  const EQ = Loadout.EQUIPMENT;
  let spec, r = mulberry32(11);
  do spec = Loot.roll(r, { level: 3, floor: 'rare', base: 'laser' }); while (!Loot.make(spec).stats.hullPlus);
  const item = Loot.register(spec, EQ);
  assert.strictEqual(EQ[spec.id], item);
  const l = Loadout.starter('courier');
  const before = Loadout.stats(l);
  l.fitted['weapon-1'] = spec.id;
  const after = Loadout.stats(l);
  assert.strictEqual(after.hull, before.hull + Math.round(item.stats.hullPlus));
  assert.strictEqual(after.weapons[0].damage, item.stats.damage);
  assert(Loadout.summary(item).includes('hull'));
  delete EQ[spec.id];
});

test('loot: fewer, better drops: nothing destroyed drops Common, and rarity is worth item levels', () => {
  for (const [source, S] of Object.entries(Loot.SOURCES)) assert(Loot.RANK[S.floor] >= Loot.RANK.uncommon, `${source} drops Common`);
  for (const D of Object.values(Jobs.DIFFICULTY)) assert(D.floor === null || Loot.RANK[D.floor] >= Loot.RANK.uncommon, `${D.label} contracts pay Common gear`);
  // A Legendary's rarity alone is worth some eight item levels of a weapon's damage.
  const power = (rarity) => Loot.RARITIES[Loot.RANK[rarity]].power;
  const grow = Loot.BASES.laser.grow.damage;
  assert(power('legendary') >= (1 + grow * 17) / (1 + grow * 9), `Legendary power ${power('legendary')}`);
  const dmg = (rarity, ilvl) => Loot.make({ id: 'Lx', base: 'laser', ilvl, rarity, seed: 1 }).stats.damage;
  assert(dmg('rare', 10) > dmg('uncommon', 10) && dmg('uncommon', 10) > dmg('common', 10));
});

test('loot: every affix and every rarity boost is on a stat that counts in a fight', () => {
  // The timeline (combat/combat.js) reads damage, fire rate, range, shields, speed, evasion, accuracy,
  // initiative (the scanner's reach) and hull; lock range, lock time and mining don't count, and a
  // weapon's field of fire hardly does.
  const COUNTS = new Set(['damage', 'fireRate', 'range', 'strength', 'recharge', 'maxSpeed', 'accel', 'turnRate', 'evasion', 'sensorRange', 'pingRange', 'accuracy', 'hullPlus', 'initiativePlus', 'evasionPlus']);
  for (const a of Loot.AFFIXES) assert(COUNTS.has(a.stat), `${a.name}: ${a.stat}`);
  // A Legendary of every base finds its four affixes.
  for (const base of Loot.BASE_IDS) {
    for (let seed = 1; seed < 40; seed++) assert.strictEqual(Loot.make({ id: 'Lt', base, ilvl: 30, rarity: 'legendary', seed }).loot.affixes.length, 4, `${base} #${seed}`);
  }
  // A rarer scanner reaches further, so it charges quicker than the starting one.
  const scan = (rarity) => Loadout.stats({ hull: 'courier', fitted: { scanner: Loot.register({ id: `Ls${rarity}`, base: 'scanner', ilvl: 40, rarity, seed: 3 }, Loadout.EQUIPMENT) && `Ls${rarity}` } });
  const start = Loadout.stats(Loadout.starter('courier'));
  assert(Combat.period({ stats: scan('common') }) < Combat.period({ stats: start }), 'a better scanner gains initiative past the starting one');
  assert(Combat.period({ stats: scan('legendary') }) < Combat.period({ stats: scan('common') }), 'rarity raises initiative');
  assert.strictEqual(Combat.period({ stats: start }), Combat.config.turn * (1 - Combat.config.tempo), 'the starting scanner charges as before');
  // Flat initiative and evasion affixes count in the loadout.
  let spec, r = mulberry32(17);
  do spec = Loot.roll(r, { level: 4, floor: 'epic', base: 'ship-computer' }); while (!Loot.make(spec).stats.initiativePlus || !Loot.make(spec).stats.evasionPlus);
  const item = Loot.register(spec, Loadout.EQUIPMENT), l = Loadout.starter('courier');
  const before = Loadout.stats(l);
  l.fitted.computer = spec.id;
  const after = Loadout.stats(l);
  assert.strictEqual(after.initiative, before.initiative + item.stats.initiativePlus);
  assert(Math.abs(after.evasion - (before.evasion + item.stats.evasionPlus)) < 1e-9);
  for (const id of ['Lscommon', 'Lslegendary', spec.id]) delete Loadout.EQUIPMENT[id];
});

test('Combat.rating: more damage, more hull, more evasion or quicker turns each rate a ship higher', () => {
  const base = Loadout.stats(Loadout.starter('courier')), r0 = Combat.rating(base);
  assert(r0 > 0);
  const up = (patch) => Combat.rating({ ...base, ...patch });
  assert(up({ weapons: base.weapons.map((w) => ({ ...w, damage: w.damage * 1.2 })) }) > r0, 'damage');
  assert(up({ hull: base.hull + 50 }) > r0, 'hull');
  assert(up({ evasion: base.evasion + 0.05 }) > r0, 'evasion');
  assert(up({ initiative: base.initiative + 8000 }) > r0, 'initiative');
  assert(up({ accuracy: base.accuracy + 0.05 }) > r0, 'accuracy');
  assert(up({ weapons: [] }) < r0, 'unarmed');
});

// ---------- Structures (rules/structures.js) ----------

test('structures: 0-3 turrets a station, more in safe space; turrets tougher than ships, stations tougher still', () => {
  const r = mulberry32(1), avg = (o) => { let n = 0; for (let i = 0; i < 2000; i++) { const k = Structures.turretCount(r, o); assert(k >= 0 && k <= 3); n += k; } return n / 2000; };
  assert(avg({ security: 2, level: 1 }) > avg({ security: 1, level: 1 }) && avg({ security: 1, level: 1 }) > avg({ security: 0, level: 1 }));
  assert(avg({ security: 1, level: 4 }) > avg({ security: 1, level: 1 }), 'harder systems a few more');
  for (let t = 1; t <= 5; t++) {
    const ship = Loadout.stats(Loadout.npc('fighter', t)), gun = Structures.turretStats('gun', t), missile = Structures.turretStats('missile', t);
    const st = Structures.stationStats(t), cap = Structures.stationStats(t, 'capital');
    assert(gun.hull > ship.hull * 3 && missile.hull === gun.hull, `tier ${t}: turrets`);
    assert(st.hull > gun.hull * 3 && cap.hull > st.hull, `tier ${t}: stations`);
    for (const s of [gun, missile, st]) assert(s.structure && s.weapons.length && s.weapons.every((w) => w.arc === 360) && s.evasion === 0);
  }
});

test('structures: every station in the scene has its turrets, round it, keyed by it', () => {
  const g = galaxies.get(1), scene = Scene.create(g, ArtCulture.forGalaxy(g));
  assert(scene.turrets.length > 0);
  for (const st of scene.stations) {
    assert(st.turrets.length <= 3);
    for (const t of st.turrets) {
      assert(t.key.startsWith(`${st.key}.t`) && t.host === st && t.owner === st.station.owner && scene.get(t.key) === t);
      assert(Math.hypot(t.x - st.x, t.y - st.y) > st.radius, 'outside the station');
    }
  }
  scene.move(1000);
  for (const t of scene.turrets) assert(Math.hypot(t.x - t.host.x, t.y - t.host.y) < t.host.radius + 400, 'still round it as things move');
  const again = Scene.create(g, ArtCulture.forGalaxy(g));
  assert.deepStrictEqual(again.turrets.map((t) => t.key), scene.turrets.map((t) => t.key), 'the same turrets each time');
});

test('real time: fixed combatants hold their place on either side, and walls stop ships', () => {
  const fighter = Loadout.stats(Loadout.npc('fighter', 1));
  const player = RealtimeCombat.ship('player', 'you', Loadout.stats(Loadout.starter('courier')), { x: 0, y: 0, radius: 16 });
  const turret = RealtimeCombat.ship('t', 'turret', Structures.turretStats('gun', 1), { x: 0, y: 200, radius: 20 }, undefined, { fixed: true });
  const ally = RealtimeCombat.ship('a', 'ally turret', Structures.turretStats('gun', 1), { x: 0, y: -150, radius: 20 }, undefined, { fixed: true, defender: true });
  const raider = RealtimeCombat.ship('r', 'raider', fighter, { x: 900, y: 0, radius: 14 });
  const wall = (x) => x > 500 && x < 520; // a wall between the raider and the rest
  const s = RealtimeCombat.create(mulberry32(1), player, [turret, raider], { allies: [ally], blocked: (x) => wall(x) });
  ally.order = { target: 't' };
  for (let i = 0; i < 300; i++) RealtimeCombat.step(s, 1 / 30);
  assert.deepStrictEqual([turret.x, turret.y, ally.x, ally.y], [0, 200, 0, -150], 'held in place');
  assert(raider.x >= 520 || raider.hull <= 0, 'the raider never got through the wall');
});

test('vendor: gambits by level, needing what they build on; gear rolled per station and day, capped; a gambit drop', () => {
  for (const id of Object.keys(Research.PACKAGES).filter((x) => Research.PACKAGES[x].kind === 'logic' && !Vendor.FREE.includes(x))) {
    assert.ok(Vendor.GAMBIT_TIER[id], `${id} has a tier`);
    assert.ok(Vendor.gambitPrice(id) > 0, `${id} has a price`);
  }
  assert.ok(Vendor.gambits(1).length < Vendor.gambits(3).length && Vendor.gambits(3).length < Vendor.gambits(5).length, 'more further out');
  assert.ok(!Vendor.gambits(5).some((id) => Vendor.FREE.includes(id)), 'the free ones are never sold');
  const owned = new Set(Vendor.FREE);
  assert.deepStrictEqual(Vendor.canBuyGambit('core.bool.or', owned), { ok: false, why: 'Needs And · Not' });
  owned.add('core.bool');
  assert.ok(Vendor.canBuyGambit('core.bool.or', owned).ok);
  assert.strictEqual(Vendor.canBuyGambit('core.bool', owned).why, 'Owned');
  // Gear: the same for a station and day, another the next day; never above the cap.
  const a = Vendor.gear('s1', 3, 100), b = Vendor.gear('s1', 3, 100), c = Vendor.gear('s1', 3, 101), d = Vendor.gear('s2', 3, 100);
  assert.deepStrictEqual(a, b);
  assert.notDeepStrictEqual(a, c);
  assert.notDeepStrictEqual(a, d);
  for (let day = 0; day < 40; day++) {
    for (const spec of Vendor.gear('s1', 2, day)) assert.ok(Loot.RANK[spec.rarity] <= Loot.RANK.uncommon, spec.rarity);
    for (const spec of Vendor.gear('cap', 2, day, { capital: true })) assert.ok(Loot.RANK[spec.rarity] <= Loot.RANK.rare, spec.rarity);
  }
  assert.ok(Vendor.gear('s1', 4, 7).every((spec) => spec.ilvl >= 31 && spec.ilvl <= 40), 'at the level');
  assert.ok(Vendor.gearPrice(a[0]) === 2 * Loot.make(a[0]).price);
  // A drop: not owned, up to a tier above; none once all are owned.
  const drop = Vendor.gambitDrop(1, 'warden', 1, owned);
  assert.ok(drop && !owned.has(drop) && Vendor.GAMBIT_TIER[drop] <= 2, drop);
  assert.strictEqual(Vendor.gambitDrop(1, 'warden', 5, new Set([...owned, ...Vendor.gambits(5)])), null);
  assert.ok(Vendor.sellsMods('capital') && !Vendor.sellsMods('minor'));
});

test('progress: levels from experience, less for easy kills, talents by level and class, gear and hulls by level', () => {
  assert.deepStrictEqual(Progress.of(0), { level: 1, into: 0, need: Progress.toNext(1), max: false });
  assert.strictEqual(Progress.of(Progress.toNext(1)).level, 2);
  let all = 0;
  for (let l = 1; l < Progress.MAX_LEVEL; l++) { assert.ok(Progress.toNext(l + 1) > Progress.toNext(l), 'each level takes longer'); all += Progress.toNext(l); }
  assert.ok(Progress.of(all * 2).max && Progress.of(all * 2).level === Progress.MAX_LEVEL, 'a top level');
  assert.ok(Progress.killXP(2, 1) > Progress.killXP(1, 1), 'tougher pays more');
  assert.ok(Progress.killXP(1, 20) < Progress.killXP(1, 1) * 0.2, 'far below you pays little');
  assert.strictEqual(Progress.killXP(1, 30), 0);
  assert.ok(Progress.contractXP('elite', 5, 2) > Progress.contractXP('easy', 5, 2));
  // Levels make a ship stronger; talents add on top, some only for a class.
  const base = { hull: 100, shield: 50, firepower: 10, classDamage: 1, accuracy: 0.6, evasion: 0.1, shieldRecharge: 5 };
  const l10 = Progress.apply(base, 10);
  assert.ok(l10.hull > 100 && l10.firepower > 10 && l10.classDamage > 1);
  assert.strictEqual(Progress.apply(base, 1).hull, 100);
  assert.strictEqual(Progress.apply(base, 1, ['bulkheads']).hull, 112);
  assert.strictEqual(Progress.apply(base, 1, ['quick-hands']).cooldown, 0.9);
  assert.deepStrictEqual(Progress.upgrades(['cargo-racks', 'hardpoint-retrofit']), { cargo: 0.25, hull: 0, weapons: 1 });
  const o = (level, cls, talents = []) => ({ level, cls, talents });
  assert.deepStrictEqual(Progress.canTake('bulkheads', o(3, 'tank')), { ok: true, why: '' });
  assert.strictEqual(Progress.canTake('bulkheads', o(3, 'dps')).why, 'Not for this class');
  assert.strictEqual(Progress.canTake('armour-plating', o(9, 'dps')).why, 'Opens at level 12');
  assert.strictEqual(Progress.canTake('reinforced-frame', o(3, 'dps', ['hot-loads'])).why, 'No talent points left');
  assert.ok(Progress.talentsFor('healer').every((t) => !t.cls || t.cls === 'healer'));
  assert.deepStrictEqual(Progress.read(['bulkheads', 'hot-loads', 'nope', 'hot-loads'], 'dps'), ['hot-loads']);
  assert.ok(Progress.points(30) >= Progress.talentsFor('dps').length - 2, 'most talents by the top level, never all: a choice');
  // Two perks a class: no stats of their own, known to the skills (rules/abilities.js), carried in the stats.
  for (const c of Classes.LIST) {
    const perks = Progress.talentsFor(c.id).filter((t) => t.perk);
    assert.strictEqual(perks.length, 2, c.id);
    for (const t of perks) assert(t.cls === c.id && !t.stats && !t.upgrade && Abilities.PERKS[t.id], t.id);
    assert.deepStrictEqual(Progress.apply(Classes.apply(Loadout.stats(Loadout.starter('courier')), c.id), 12, [perks[0].id, 'reinforced-frame']).perks, [perks[0].id]);
  }
  // Gear and hulls.
  assert.strictEqual(Progress.gearLevel({ tier: 1 }), 1);
  assert.strictEqual(Progress.gearLevel({ loot: { ilvl: 9 } }), 1);
  assert.ok(Progress.gearLevel({ loot: { ilvl: 41 } }) > Progress.gearLevel({ loot: { ilvl: 21 } }));
  assert.ok(Progress.HULL_LEVEL.gunship > Progress.HULL_LEVEL.corvette);
  assert.deepStrictEqual([1, 9, 10, 19, 20].map(Progress.lineBonus), [0, 0, 1, 1, 2]);
});

test('the main story: seven chapters, each after the last and at a higher level, further out, ending at the core; contracts repeat', () => {
  for (const seed of [1, 7, 42]) {
    const g = Galaxy.generate(seed), B = Jobs.board(g), story = B.list.filter((j) => j.chapter); // (the job after the story has no chapter: its own test)
    assert.strictEqual(story.length, JobTexts.STORY.length, `seed ${seed}: every chapter placed`);
    story.forEach((j, i) => {
      assert.strictEqual(j.chapter, i + 1);
      assert.strictEqual(j.requires, i ? story[i - 1].id : null, 'each after the one before');
      if (i) assert.ok(j.level > story[i - 1].level, 'at a higher level');
      assert.ok(Number.isFinite(j.reward.credits) && j.reward.credits > 0, `${j.id} pays (${j.reward.credits})`);
      assert.ok(Jobs.offeredAt(j, g.stations[0]), 'offered at any station');
    });
    const last = story.at(-1);
    assert.ok(last.systems.every((k) => g.systems[k].level === 5), 'the last at the core');
    assert.ok(story.at(-1).reward.credits > story[0].reward.credits * 5, 'pays far more by the end');
    assert.ok(B.list.some((j) => j.id.endsWith('/convoy') && j.escort && j.handIn), `seed ${seed}: convoys, handed in where they deliver`);
    // After the story: one job more, where it ended, that repeats.
    const after = B.list.filter((j) => j.tier === 'story' && !j.chapter);
    assert.strictEqual(after.length, 1, `seed ${seed}: one job after the story`);
    assert.ok(after[0].repeat && after[0].requires === last.id && after[0].level === last.level, 'once the last chapter is done, and asked again');
    assert.ok(after[0].systems.every((k) => g.systems[k].level === 5) && after[0].difficulty === 'elite', 'an Elite fight at the core');
    assert.ok(after[0].reward.credits > 0 && Jobs.offeredAt(after[0], g.stations[0]));
  }
  // A done contract can be reopened (the next day: game/jobs.js); its next attempt starts afresh.
  const g = Galaxy.generate(1), B = Jobs.board(g), J = B.list.find((j) => j.tier === 'station'), log = Missions.create(null, B.byId);
  assert.ok(log.accept(J.id, J.scope) && log.finish(J.id));
  assert.ok(log.reopen(J.id) && log.status(J.id) === 'offered');
  assert.ok(!log.reopen(J.id), 'only a done one');
  assert.ok(log.accept(J.id, J.scope) && log.attempt(J.id) === 2, 'a second attempt');
});

finish('game');
