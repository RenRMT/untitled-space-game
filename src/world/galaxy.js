// The play area: a barred spiral galaxy of star systems grown from the seed (notes/galaxy.md).
// The galaxy's shape (world/galaxy-shape.js) is a density field: a bulge round the centre, a bar
// through it, two major arms from the bar's ends and maybe a spur or two. About forty solar
// systems (world/solar-system.js) are placed by it, kept far apart (most of a minute's cruise
// between neighbours), each made for the zone it sits in: old red stars in the core and the bar,
// young bright ones on the arms, settled systems with stations in the habitable band, sparse
// frontier systems outside it. The first is the start: the showcase (one of each planet, moon and
// station type, a field, a nebula) on an outer arm, its waystation where the game begins. Between
// the systems lie the deep-space sites and fields (world/deep-space.js): the black hole at the
// centre, clusters, remnants, rogue planets and the rest. The settled band is split into three
// territories (Wedge round the start, Block and Shard either side), each joined inside by jump gates,
// one gate link between each pair; the rest of the frontier is the Drifters' and the Androids', the
// systems furthest in the aliens', reached by cruising. Each system has a level (1..5) setting how
// tough its hostiles and dungeons are (notes/galaxy.md).
// With galaxy.spiral false it is the single showcase system as before (the idle game's stage).
// Galaxy.generate gathers everything into one object that reads like a single system with a list
// of systems around it, as the flight view (flight/scene.js, game/), map travel (flight/travel.js),
// fog of war (rules/knowledge.js) and the map (ui/map.js) expect:
// - systems[i]: each system as SolarSystem.generate made it, already in place, plus `index`, its
//   `zone` and `arm` (world/galaxy-shape.js), whether it is `settled` (in the habitable band), its
//   `faction` (wedge, block, shard, drifter, android, alien) and `level` (1..5), and its
//   politics: region { key, label }, holder (its faction; null in the showcase alone), branch (null), factions [{ id, hidden,
//   stations }], situations ([]), places (names jobs could use),
// - links: [[i, j]] gate links between systems by index (i < j); wormholes: the same, for the
//   links that are wormholes,
// - stars, planets, moons, ...: every system's together. Ids are indices into these lists (a
//   station's planet, a moon's parent, a contact's pack) and keys are unique across systems (the
//   first system's keep their own; later ones get an `i.` prefix), so saves and lookups need no
//   system. Each thing also says which system it belongs to (`system`); stations their `owner`,
// - gates: { ..., system, link, to, wormhole? } with link the id of the gate (or wormhole) at the
//   other end,
// - shape (world/galaxy-shape.js), arms [{ index, name, major }], sites and `space` (the
//   galaxy-wide fields: world/deep-space.js), siteAt(x, y, t?),
// - systemAt(x, y): the system a point is in (within its radius), or null in deep space;
//   nearestSystem(x, y): the one whose edge is closest; placeAt(x, y): the { stars, planets,
//   moons, stations } whose hazards reach a point (its system's; nothing in deep space),
// - securityAt, nebulaAt, regionAt, stationDist as for one system; deep space is lawless and
//   empty. regionAt also says where in the galaxy a point is: zone, arm, site, and the fields there
//   (medium, dust, cosmicRays).
// ES module (`Galaxy`); also runs in Node (the tests).

import { hashInt, mulberry32, seedToInt } from '../core/rng.js';
import { DeepSpace } from './deep-space.js';
import { Factions } from './factions.js';
import { GalaxyShape } from './galaxy-shape.js';
import { Orbits } from './orbits.js';
import { SolarSystem } from './solar-system.js';

const Galaxy = (() => {
  const SS = SolarSystem;

  // Bump whenever a change here moves systems or gates for the same seed.
  const VERSION = 7;

  const DEFAULTS = {
    // The system's params, over SolarSystem.params: one of each planet type (inner to outer) and
    // each moon type, no belts, one asteroid field and one nebula, and one of each station: the
    // capital, the major hub, a minor station, a mining camp (in the field), a salvage yard and a
    // transport hub, with the waystation on the outer edge across from the gate; no pirates.
    system: {
      radius: 40000,
      kinds: { planets: ['lava', 'desert', 'terran', 'ice', 'gas', 'blue'], moons: ['grey', 'ice', 'rust', 'dark', 'sulfur'] },
      planets: { first: [4800, 5400], gap: [3400, 4000], growth: 1.08, edge: 0.9 },
      moons: { gas: [2, 2], blue: [1, 1], terran: [1, 1], ice: [1, 1], desert: [0, 0], lava: [0, 0] },
      belts: { main: false, outer: 0 },
      fields: { count: [1, 1], rocks: [70, 90], spread: [2000, 2400] },
      nebulae: { count: [1, 1], r: [4500, 6000] },
      stations: { capital: true, major: true, minor: [1, 1], miningCamps: [1, 1], yard: true, transport: true },
      // No pirates: the game is about gathering under hazards now (notes/hazards.md), not fighting.
      pirates: { density: 0, lawlessAmbushes: [0, 0], nebulaAmbushes: false },
    },
    // The station cultures (SolarSystem.CULTURES ids) by station type; the waystation is android.
    cultures: { capital: 0, major: 1, minor: 2, 'mining camp': 1, 'salvage yard': SS.DRIFTER, 'transport hub': 2 },
    // The jump gate, in this culture; the wormhole a quarter turn round from it.
    gate: { culture: 0 },
    // The android-run waystation the game starts at, on the outer edge across from the gate.
    waystation: { name: 'Waystation HD-1863' },
    // false: the showcase system alone, its gate and wormhole leading to each other (the idle game).
    spiral: true,
    shape: {}, // over GalaxyShape.params (world/galaxy-shape.js)
    deep: {}, // over DeepSpace.params (world/deep-space.js)
    // The star systems: how many, how far apart their centres keep (world units), how far from the
    // centre the nearest may be, and where the start sits (on which major arm, how far out in R).
    systems: { count: 40, spacing: 170000, core: 240000, start: { arm: 0, at: 0.75 } },
    // Every system but the start: SolarSystem.params with these over them, then its zone's, then
    // `settled` or `frontier` by whether it lies in the habitable band (in R).
    generated: { radius: 40000 },
    habitable: [0.45, 0.86],
    settled: { stations: { capital: true, major: true, minor: [1, 2], miningCamps: [1, 1], transport: false }, yard: 0.5 },
    frontier: { stations: { capital: false, major: false, minor: [0, 1], miningCamps: [0, 1], transport: false }, yard: 0.3, derelicts: { count: [8, 11] } },
    // By zone (world/galaxy-shape.js): the stars, nebulae and planets that grow there. Only the
    // classes art/render.js draws (M, K, G, A, B).
    zones: {
      core: { star: { classes: [['M', 4], ['K', 4], ['G', 1]] }, nebulae: { count: [0, 1] } },
      bar: { star: { classes: [['M', 4], ['K', 3], ['G', 2]] }, nebulae: { count: [0, 1] } },
      'arm-outer': { star: { classes: [['B', 2], ['A', 3], ['G', 2], ['K', 1]] }, nebulae: { count: [2, 3] } },
      'arm-inner': { star: { classes: [['G', 2], ['K', 2], ['M', 2], ['A', 1]] }, nebulae: { count: [1, 2] } },
      interarm: { star: { classes: [['M', 3], ['K', 3], ['G', 2]] }, nebulae: { count: [0, 1] } },
      rim: { star: { classes: [['M', 5], ['K', 2], ['G', 1]] }, nebulae: { count: [0, 1] }, planets: { count: [3, 5] } },
      halo: { star: { classes: [['M', 1]] }, nebulae: { count: [0, 0] }, planets: { count: [2, 4] } },
    },
    // Observatories: some of the deep-space sites (a `share` of those of the kinds below) have a
    // station in a wide orbit round them, studying them. orbit: its distance from the site, by
    // kind (world units; a disc's by its own reach, beyond the disc), clear of what the site's
    // flight art draws there (flight/deep-sites.js); cultures: the cultures they're built in, by weight.
    observatories: {
      share: 0.45,
      orbit: {
        'variable-star': 4500, pulsar: 5000, 'neutron-star': 4500, magnetar: 7000, 'stellar-black-hole': 8000, 'recurrent-nova': 7000,
        'brown-dwarf': 5500, 'rogue-planet': 3200, 'white-dwarf': 5500, 'wolf-rayet': 8000, 'protoplanetary-disc': 1.3,
      },
      cultures: [[0, 2], [1, 2], [2, 2], [SS.DRIFTER, 3]],
    },
    // Hostile ships in every system of the spiral: packs in its low and lawless space (none where
    // security is high), their gear by the system's level (world/security.js levelTier).
    hostiles: { density: 0.5, lawlessAmbushes: [1, 2], nebulaAmbushes: true },
    // Territories (notes/galaxy.md): how many of the systems furthest in are the aliens' (at least
    // the first, up to the second while they're in the core or the bar), and the most security a
    // system of each holder can have (outside systems are rough, the aliens' lawless).
    territory: { aliens: [3, 6], cap: { drifter: 1, android: 1, alien: 0 } },
    // The outside systems' stations: the Drifters' a few kitbashed stations and a yard, the
    // Androids' one station; the aliens' none (and more wrecks).
    drifter: { stations: { capital: false, major: false, minor: [1, 2], miningCamps: [0, 1], transport: false }, yard: 0.6, derelicts: { count: [6, 9] } },
    android: { stations: { capital: false, major: false, minor: [1, 1], miningCamps: [0, 0], transport: false }, yard: 0, derelicts: { count: [4, 6] } },
    alien: { stations: { capital: false, major: false, minor: [0, 0], miningCamps: [0, 0], transport: false }, yard: 0, derelicts: { count: [10, 14] } },
    // Each major arm's name, picked from these.
    armNames: ['Lantern', 'Cinder', 'Orison', 'Harrow', 'Tamsin', 'Verge', 'Halcyon', 'Ember', 'Solace', 'Wake'],
  };
  // The three territories, and the station culture (SolarSystem.CULTURES id) each builds in.
  const TERRITORIES = ['wedge', 'block', 'shard'];
  const CULTURE_OF = { wedge: 0, block: 1, shard: 2 };
  const ZONE_LABEL = { core: 'Galactic core', bar: 'The bar', interarm: 'Between the arms', rim: 'Outer rim', halo: 'The halo' };

  // A copy of `base` with `over` merged in: plain objects merge, everything else replaces.
  function merge(base, over) {
    if (!over) return base;
    const out = { ...base };
    for (const [k, v] of Object.entries(over)) {
      const b = base[k];
      out[k] = v && typeof v === 'object' && !Array.isArray(v) && b && typeof b === 'object' && !Array.isArray(b) ? merge(b, v) : v;
    }
    return out;
  }

  // Who owns what: each station the faction of the culture it's built in. In the showcase (the
  // start) each type of station is built in the culture G.cultures gives it.
  function settle(system, G, showcase, region = { key: 'home', label: 'Home system' }) {
    const owned = new Map();
    for (const st of system.stations) {
      if (showcase && !st.waystation && G.cultures[st.market.type] !== undefined) st.culture = G.cultures[st.market.type];
      st.owner = Factions.ofCulture(SS.CULTURES[st.culture].lineage).id;
      owned.set(st.owner, (owned.get(st.owner) || 0) + 1);
    }
    const first = (type) => system.stations.find((st) => st.market.type === type);
    const places = {
      system: system.name, station: (first('capital') || system.stations[0] || {}).name, hub: (first('major') || {}).name,
      camp: (first('mining camp') || {}).name, yard: (first('salvage yard') || {}).name,
      waystation: (system.stations.find((st) => st.waystation) || {}).name, nebula: system.nebulae[0] && system.nebulae[0].name,
    };
    const factions = Factions.LIST.filter((f) => owned.has(f.id) || f.id === Factions.PIRATES)
      .map((f) => ({ id: f.id, hidden: f.hidden, stations: owned.get(f.id) || 0 }));
    Object.assign(system, { region, holder: null, branch: null, factions, situations: [], places });
    return system;
  }

  // config: { params (over every system's), galaxy: overriding DEFAULTS }
  function generate(seed, config = {}) {
    const G = merge(DEFAULTS, config.galaxy);
    const base = seedToInt(seed);
    const r = mulberry32(hashInt(base, 0, 0x6a1a));
    const params = merge(merge(SS.params, G.system), config.params);
    if (!G.spiral) {
      // The showcase alone: the gate in a direction from the seed, the wormhole a quarter turn on;
      // each leads to the other.
      const a0 = r() * Math.PI * 2;
      const gates = [{ angle: a0, to: 0, culture: G.gate.culture }, { angle: a0 + Math.PI / 2, to: 0, wormhole: true }];
      const systems = [SS.generate(seed, { params, gates, waystation: { name: G.waystation.name, opposite: true } })];
      systems.forEach((s, i) => { s.index = i; settle(s, G, true); });
      return assemble(seed, G, systems, [], [], null, null, null);
    }

    // ---------- The shape, and where the systems go ----------
    const shape = GalaxyShape.create(seed, G.shape);
    const R = shape.R, S = G.systems;
    const rp = mulberry32(hashInt(base, 1, 0x6a1a));
    const majors = shape.arms.filter((a) => a.major);
    const startArm = majors[S.start.arm % majors.length];
    const startT = Math.log((S.start.at * R) / startArm.r0) / Math.log(startArm.r1 / startArm.r0);
    const spots = [shape.armPoint(startArm, startT)];
    const genR = G.generated.radius ?? SS.params.radius;
    const fits = (at, rad) => Math.hypot(at.x, at.y) >= S.core && Math.hypot(at.x, at.y) <= R * 0.98 - rad
      && spots.every((o) => Math.hypot(o.x - at.x, o.y - at.y) >= S.spacing);
    for (let tries = 0; spots.length < S.count && tries < 30000; tries++) {
      const at = shape.sample(rp, 1);
      if (fits(at, genR)) spots.push({ x: Math.round(at.x), y: Math.round(at.y) });
    }

    // ---------- Territories ----------
    // Who holds each system (notes/galaxy.md): the habitable band is split into three contiguous
    // territories by their angle round the centre, Wedge round the start and Block and Shard either
    // side; the systems nearest the core (the core and the bar) are the aliens', the end game; the
    // rest of the frontier is the outside civilisations', the Drifters' and the Androids'.
    const where = spots.map((p) => ({ arm: shape.armAt(p.x, p.y), zone: shape.zoneAt(p.x, p.y) }));
    const fromC = (i) => Math.hypot(spots[i].x, spots[i].y) / R;
    const isSettled = (i) => i === 0 || (fromC(i) >= G.habitable[0] && fromC(i) <= G.habitable[1] && where[i].zone.zone !== 'core' && where[i].zone.zone !== 'bar');
    const T = G.territory, faction = spots.map(() => null);
    const idx = spots.map((p, i) => i);
    const remote = idx.filter((i) => !isSettled(i)).sort((a, b) => fromC(a) - fromC(b));
    remote.forEach((i, k) => { if (k < T.aliens[0] || (k < T.aliens[1] && ['core', 'bar'].includes(where[i].zone.zone))) faction[i] = 'alien'; });
    const ra = mulberry32(hashInt(base, 3, 0x7e77));
    const outside = remote.filter((i) => !faction[i]);
    outside.forEach((i, k) => { faction[i] = k % 5 === 1 || k % 5 === 3 ? 'android' : 'drifter'; });
    if (ra() < 0.5 && outside.length > 2) [faction[outside[0]], faction[outside[1]]] = [faction[outside[1]], faction[outside[0]]];
    const a0 = Math.atan2(spots[0].y, spots[0].x);
    const signed = (i) => { let d = Math.atan2(spots[i].y, spots[i].x) - a0; while (d > Math.PI) d -= 2 * Math.PI; while (d <= -Math.PI) d += 2 * Math.PI; return d; };
    const band = idx.filter(isSettled).sort((a, b) => Math.abs(signed(a)) - Math.abs(signed(b)));
    const nW = Math.max(1, Math.round(band.length / 3));
    band.slice(0, nW).forEach((i) => { faction[i] = 'wedge'; });
    const rest = band.slice(nW).sort((a, b) => ((signed(a) + 2 * Math.PI) % (2 * Math.PI)) - ((signed(b) + 2 * Math.PI) % (2 * Math.PI)));
    rest.forEach((i, k) => { faction[i] = k < rest.length / 2 ? 'block' : 'shard'; });
    // How hard each system is (1..5): Wedge's the gentlest, the other two a step up, the outside
    // systems harder (the further from the start the harder), the aliens' the hardest.
    const dStart = (i) => Math.hypot(spots[i].x - spots[0].x, spots[i].y - spots[0].y);
    const outD = outside.map(dStart).sort((a, b) => a - b), median = outD[Math.floor(outD.length / 2)] ?? 0;
    const level = spots.map((p, i) => ({ wedge: 1, block: 2, shard: 2, alien: 5 })[faction[i]] ?? (dStart(i) > median ? 4 : 3));

    // ---------- Gate links ----------
    // Inside each territory its systems are joined into one network (the shortest links that join
    // them all); between territories, one link joins each pair at their nearest systems. The
    // outside and alien systems have no gates: they're reached by cruising.
    const links = [], wormholes = [];
    const link = (a, b) => {
      if (a === b || a < 0 || b < 0) return;
      const pair = a < b ? [a, b] : [b, a];
      if (!links.some(([x, y]) => x === pair[0] && y === pair[1])) links.push(pair);
    };
    const dOf = (i, j) => Math.hypot(spots[i].x - spots[j].x, spots[i].y - spots[j].y);
    const members = (f) => idx.filter((i) => faction[i] === f);
    for (const f of TERRITORIES) {
      const list = members(f);
      if (!list.length) continue;
      const inTree = new Set([list[0]]);
      while (inTree.size < list.length) {
        let best = null;
        for (const a of inTree) for (const b of list) if (!inTree.has(b) && (!best || dOf(a, b) < best[2])) best = [a, b, dOf(a, b)];
        link(best[0], best[1]);
        inTree.add(best[1]);
      }
    }
    for (let x = 0; x < TERRITORIES.length; x++) {
      for (let y = x + 1; y < TERRITORIES.length; y++) {
        const A = members(TERRITORIES[x]), B = members(TERRITORIES[y]);
        let best = null;
        for (const a of A) for (const b of B) if (!best || dOf(a, b) < best[2]) best = [a, b, dOf(a, b)];
        if (best) link(best[0], best[1]);
      }
    }

    // ---------- The systems ----------
    // The start is the showcase; each other system is made for its zone, settled or frontier.
    const zoneKey = (z) => (z.zone === 'arm' ? `arm-${z.side}` : z.zone);
    const armNames = [...G.armNames];
    for (let i = armNames.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [armNames[i], armNames[j]] = [armNames[j], armNames[i]]; }
    const arms = shape.arms.map((a, i) => ({ index: a.index, major: a.major, name: a.major ? `${armNames[i]} Arm` : `${armNames[i]} Spur` }));
    const usedNames = new Set();
    const systems = spots.map((at, i) => {
      const gates = links.flatMap(([a, b]) => (a === i ? [b] : b === i ? [a] : [])).map((j) => {
        const hole = wormholes.some(([a, b]) => (a === i && b === j) || (a === j && b === i));
        const angle = Math.atan2(spots[j].y - at.y, spots[j].x - at.x);
        return { angle, to: j, ...(hole ? { wormhole: true } : { culture: CULTURE_OF[faction[i]] ?? G.gate.culture }) };
      });
      const z = where[i].zone, settled = isSettled(i), f = faction[i];
      // Each system's own: its hostiles' level and side, and the most security it can have.
      const own = { security: { cap: T.cap[f] ?? 2 }, pirates: { ...G.hostiles, level: level[i], faction: f === 'alien' ? 'alien' : 'drifter' } };
      let sys = null;
      for (let attempt = 0; attempt < 8 && (!sys || usedNames.has(sys.name)); attempt++) {
        if (i === 0) {
          sys = SS.generate(seed, { params: merge(params, own), gates, origin: at, waystation: { name: G.waystation.name, opposite: true } });
          break;
        }
        const rs = mulberry32(hashInt(base, i, 0x5755 + attempt));
        const kind = settled ? G.settled : G[f] || G.frontier;
        const zp = G.zones[zoneKey(z)] || {};
        const p = merge(merge(merge(merge(SS.params, { pirates: params.pirates }), G.generated), zp), {
          stations: { ...kind.stations, yard: rs() < kind.yard }, ...(kind.derelicts ? { derelicts: kind.derelicts } : {}),
        });
        sys = SS.generate(hashInt(base, i, 0x5e5e + attempt), { params: merge(merge(p, own), config.params), gates, origin: at });
      }
      usedNames.add(sys.name);
      const zl = z.zone === 'arm' ? arms[z.arm].name : ZONE_LABEL[z.zone];
      const region = i === 0 ? { key: 'home', label: `Home system · ${zl}` } : { key: settled ? 'settled' : 'frontier', label: `${zl} · ${settled ? 'settled' : 'frontier'}` };
      Object.assign(sys, { index: i, zone: z.zone, arm: z.arm, side: z.side, settled, faction: f, level: level[i] });
      // Its stations in its holder's culture: a territory's all its own (salvage yards the
      // Drifters', the waystation the Androids'), an outside system's all the Drifters' or Androids'.
      for (const st of sys.stations) {
        if (st.waystation) continue;
        st.culture = f === 'drifter' ? SS.DRIFTER : f === 'android' ? SS.ANDROID : st.market.type === 'salvage yard' ? SS.DRIFTER : CULTURE_OF[f] ?? st.culture;
      }
      settle(sys, G, false, region);
      sys.holder = f;
      return sys;
    });

    const deep = DeepSpace.generate(seed, shape, systems, G.deep);
    return assemble(seed, G, systems, links, wormholes, shape, arms, deep, observatories(base, G, deep.sites, systems));
  }

  // The observatories round some deep-space sites, each a minor station on a wide orbit round its
  // site (world/orbits.js), owned by the faction of its culture. Keys `ds<site id>`; `system` is the
  // nearest system's index (for what asks which system a station is in), `site` its site's id.
  function observatories(base, G, sites, systems) {
    const O = G.observatories, r = mulberry32(hashInt(base, 2, 0x0b5e));
    const pick = (list) => { let u = r() * list.reduce((a, [, w]) => a + w, 0); for (const [v, w] of list) if ((u -= w) < 0) return v; return list[0][0]; };
    const out = [];
    for (const s of sites) {
      const d0 = O.orbit[s.kind];
      if (!d0 || s.path || r() >= O.share) continue;
      const orbit = d0 < 10 ? s.r * d0 : d0, angle = r() * Math.PI * 2, culture = pick(O.cultures);
      const near = systems.reduce((b, x) => (Math.hypot(x.origin.x - s.x, x.origin.y - s.y) < Math.hypot(b.origin.x - s.x, b.origin.y - s.y) ? x : b));
      const word = s.kind === 'brown-dwarf' || s.kind === 'rogue-planet' || s.kind === 'protoplanetary-disc' ? 'Outpost' : 'Observatory';
      out.push({
        key: `ds${s.id}`, name: `${s.name} ${word}`, size: 'minor', site: s.id, system: near.index, culture,
        owner: Factions.ofCulture(SS.CULTURES[culture].lineage).id, seed: Math.floor(r() * 2 ** 31), reach: 140,
        orbit, angle, period: Orbits.period('site', orbit), x: s.x + Math.cos(angle) * orbit, y: s.y + Math.sin(angle) * orbit,
        market: { kind: 'outpost', type: 'observatory' },
      });
    }
    return out;
  }

  // Everything together, renumbered and rekeyed, with the lookups.
  function assemble(seed, G, systems, links, wormholes, shape, arms, deep, observed = []) {
    // Everything together, renumbered and rekeyed.
    const all = { stars: [], planets: [], moons: [], belts: [], fields: [], nebulae: [], stations: [], wrecks: [], contacts: [], packs: [], asteroids: [], gates: [], pockets: [] };
    for (const s of systems) {
      const pre = s.index === 0 ? '' : `${s.index}.`;
      const off = Object.fromEntries(Object.entries(all).map(([k, list]) => [k, list.length]));
      const tag = (o) => { o.system = s.index; return o; };
      tag(s.star);
      for (const p of s.planets) { p.id += off.planets; p.moons = p.moons.map((m) => m + off.moons); }
      for (const m of s.moons) { m.id += off.moons; m.parent += off.planets; }
      for (const st of s.stations) { st.id += off.stations; st.key = pre + st.key; if (st.planet !== undefined) st.planet += off.planets; }
      for (const c of s.contacts) { c.id = pre + c.id; if (c.pack !== undefined) c.pack += off.packs; }
      for (const k of s.packs) { k.id += off.packs; for (const sh of k.ships) sh.key = pre + sh.key; }
      for (const w of s.wrecks) { w.key = pre + w.key; if (w.contact) w.contact = pre + w.contact; }
      for (const a of s.asteroids) a.key = pre + a.key;
      for (const q of s.pockets) { q.key = pre + q.key; q.nebula += off.nebulae; }
      for (const g of s.gates) { g.id += off.gates; g.key = pre + g.key; }
      for (const f of s.fields) if (f.camp !== undefined) f.camp += off.stations;
      for (const [k, list] of Object.entries({ ...s, stars: [s.star] })) {
        if (!all[k]) continue;
        for (const o of list) all[k].push(tag(o));
      }
    }
    // The observatories out in deep space, after every system's stations.
    for (const st of observed) { st.id = all.stations.length; all.stations.push(st); }
    // Gate pairs: each gate knows the one at the other end.
    for (const g of all.gates) g.link = all.gates.find((o) => o !== g && o.system === g.to && o.to === g.system).id;

    const inSystem = (s, x, y) => Math.hypot(x - s.origin.x, y - s.origin.y) <= s.radius;
    const systemAt = (x, y) => systems.find((s) => inSystem(s, x, y)) || null;
    const edgeDist = (s, x, y) => Math.hypot(x - s.origin.x, y - s.origin.y) - s.radius;
    const nearestSystem = (x, y) => systems.reduce((b, s) => (edgeDist(s, x, y) < edgeDist(b, x, y) ? s : b));
    // What each system's hazards are made of (rules/hazards.js), and deep space's: nothing.
    for (const s of systems) s.place = { stars: [s.star], planets: s.planets, moons: s.moons, stations: s.stations };
    const DEEP = { stars: [], planets: [], moons: [], stations: observed }; // an observatory shelters its approaches
    const F = deep ? deep.fields : null;
    // Where in the galaxy a point is, and the fields there (deep space's; none for the showcase alone).
    const galactic = (x, y) => {
      if (!shape) return { zone: null, arm: null, site: null, medium: null, dust: 0, cosmicRays: 0 };
      const z = shape.zoneAt(x, y);
      return { zone: z.zone, arm: z.arm, site: deep.siteAt(x, y), medium: F.mediumAt(x, y), dust: F.dustAt(x, y), cosmicRays: F.cosmicRaysAt(x, y) };
    };

    return {
      seed, name: systems[0].name, cultures: SS.CULTURES, systems, links, wormholes, ...all,
      shape, arms: arms || [], sites: deep ? deep.sites : [], space: F,
      siteAt: (x, y, t = 0) => (deep ? deep.siteAt(x, y, t) : null),
      startStation: 0, // the first station: the capital
      waystation: all.stations.findIndex((st) => st.waystation), // its id, or -1 without one
      systemAt, nearestSystem,
      placeAt: (x, y) => { const s = systemAt(x, y); return s ? s.place : DEEP; },
      securityAt: (x, y) => { const s = systemAt(x, y); return s ? s.securityAt(x, y) : 0; },
      nebulaAt: (x, y) => { const s = systemAt(x, y); return s ? s.nebulaAt(x, y) : null; },
      stationDist: (x, y) => Math.min(...systems.map((s) => s.stationDist(x, y))),
      // As for one system, plus the system it's in (null in deep space) and where in the galaxy.
      regionAt(x, y) {
        const s = systemAt(x, y);
        if (s) return { ...s.regionAt(x, y), system: s, ...galactic(x, y) };
        const n = nearestSystem(x, y);
        return { security: 0, nebula: null, near: null, fromStar: Math.hypot(x - n.origin.x, y - n.origin.y), system: null, ...galactic(x, y) };
      },
      cultureColor: (id) => (SS.CULTURES[id] || SS.CULTURES[0]).color,
    };
  }

  // localStorage key part identifying one generated galaxy: every system's own key, and this
  // module's version.
  // A galaxy of many systems hashes theirs after the first's.
  const saveKey = (g) => (g.systems.length === 1 ? `${SS.saveKey(g.systems[0])}:g${VERSION}`
    : `${SS.saveKey(g.systems[0])}+${g.systems.length}x${seedToInt(g.systems.slice(1).map(SS.saveKey).join('+')).toString(36)}:g${VERSION}`);

  return { generate, params: DEFAULTS, VERSION, saveKey, ZONE_LABEL };
})();

export { Galaxy };
