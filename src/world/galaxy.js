// The play area: solar systems (world/solar-system.js) far apart in one open space, joined by
// jump gates. Galaxy.generate grows the map from the seed, generates each system in place with a
// gate toward each system it links to, settles its politics (world/regions.js: who holds it, who
// else is there, its local situation and mission hooks) and gathers everything into one object
// that reads like a single system: the flight view (flight/scene.js, game/), map travel
// (flight/travel.js) and fog of war (rules/knowledge.js) work on all of it at once in world units,
// and the map (ui/map.js) shows one system at a time or the galaxy.
// The map grows on a hex lattice from the Meridian Compact's capital: its core around it, then
// Combine company systems, Facet sees, Spoke colonies, claim belts, pilgrim nebulae and lawless
// reaches, each beside a system of a region it may grow from and toward its region's side of the
// galaxy; neighbours are then linked by the routes their regions share (Regions.LINKS). Last
// comes the gateway, a Spoke frontier colony on the rim, and beyond it the tutorial, whose one
// gate leads there and nowhere else.
// - systems[i]: each system as SolarSystem.generate made it, already in place, plus `index` and
//   its politics (Regions.settle: region, holder, branch, factions, situations). The first is
//   the tutorial, the second the gateway, the rest in gate order outward from there,
// - links: [[i, j]] gate links by system index (i < j),
// - stars, planets, moons, ...: every system's together. Ids are indices into these lists (a
//   station's planet, a moon's parent, a contact's pack) and keys are unique across systems (the
//   first system's keep their own; later ones get an `i.` prefix), so saves and lookups need no
//   system. Each thing also says which system it belongs to (`system`); stations their `owner`,
// - gates: { ..., system, link, to } with link the id of the gate at the other end,
// - systemAt(x, y): the system a point is in (within its radius), or null in deep space;
//   nearestSystem(x, y): the one whose edge is closest,
// - securityAt, nebulaAt, regionAt, stationDist as for one system; deep space is lawless and
//   empty.
// The first system is generated from the seed itself, at the origin, with its gate toward where
// the seed has always put the second: it is the system the seed always gave, whatever the rest of
// the galaxy. ES module (`Galaxy`); also runs in Node (the tests).

import { hashInt, mulberry32, seedToInt } from '../core/rng.js';
import { Regions } from './regions.js';
import { SolarSystem } from './solar-system.js';

const Galaxy = (() => {
  const SS = SolarSystem;

  // Bump whenever a change here moves systems or gates for the same seed.
  const VERSION = 3;

  const DEFAULTS = {
    // Space between neighbouring systems' edges, at least: about five minutes' flight at the
    // Courier's top speed (650 units/s, rules/loadout.js).
    gap: 195000,
    // The lattice the galaxy grows on: neighbouring systems' stars this far apart (before each is
    // nudged by up to `jitter` of it, keeping `gap` between edges).
    spacing: 300000,
    jitter: 0.2,
    // How many systems of each region (world/regions.js), in the order they grow out from the
    // capital: each attaches to a system of a region it may grow from.
    plan: [['core', [2, 3]], ['combine', [2, 3]], ['see', [1, 2]], ['spoke', [2, 3]], ['claims', [1, 2]], ['veil', [1, 2]], ['reach', [1, 2]], ['gateway', [1, 1]]],
    // The first system is the tutorial: a small system with one planet, the main belt, one nebula,
    // the android waystation on one edge and the jump gate on the other, and nothing else: no
    // other stations, no derelicts, no pirates (the opening missions bring their own), high
    // security throughout (medium in the nebula). It is the system the seed always gave, at the
    // origin, with its one gate to the second system: the gateway, a Spoke frontier colony half
    // the usual size (fewer, closer planets, smaller nebulae, fewer stations and derelicts, and
    // security falling off over shorter distances), on the galaxy's rim.
    tutorial: {
      radius: 22000,
      planets: { count: [1, 1], first: [5200, 6000], gap: [3800, 4800] },
      belts: { outer: 0, width: [1400, 1900] },
      fields: { count: [0, 0] },
      nebulae: { count: [1, 1], r: [3500, 4500] },
      stations: { capital: false, major: false, minor: [0, 0], miningCamps: [0, 0], yard: false },
      security: { high: 1e9, medium: 2e9, low: 3e9 },
      pirates: { density: 0, lawlessAmbushes: [0, 0], nebulaAmbushes: false },
      derelicts: { count: [0, 0] },
    },
    gateway: {
      radius: 24000,
      planets: { count: [3, 5], first: [2600, 3300], gap: [1900, 2800] },
      belts: { width: [1100, 1600], clump: 2000 },
      fields: { count: [1, 2], spread: [800, 1200] },
      nebulae: { count: [0, 1], r: [2800, 4000] },
      stations: { minor: [1, 2], miningCamps: [1, 1] },
      security: { high: 5000, medium: 10000, low: 16000 },
      pirates: { cell: 9000, lawlessAmbushes: [0, 1] },
      derelicts: { count: [3, 5], spacing: 4000 },
    },
    // The android-run waystation the game starts at, on the tutorial's outer edge, across the
    // system from its gate; the nearest other one, in the gateway (the opening missions name it);
    // other systems have one by their region's chance, named from the seed.
    waystation: { name: 'Waystation HD-1863', next: 'Waystation HD-1908' },
  };

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

  // ---------- The map: regions grown on a hex lattice, then the gate links ----------

  const HEX = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
  const hexKey = (q, r) => `${q},${r}`;
  const hexAt = (q, r, s) => ({ x: s * (q + r / 2), y: s * r * (Math.sqrt(3) / 2) });
  const radiusOf = (G, key, base) => (key === 'tutorial' ? G.tutorial.radius : key === 'gateway' ? G.gateway.radius : merge(base, Regions.REGIONS[key].params).radius);

  // The capital at the lattice's centre, then each planned system on a free spot next to a system
  // of a region it may grow from: scored by how far out its region lies (`out`), the direction
  // of its region's sector, keeping close to its own kind (`cluster`) and away from the rest,
  // plus chance. The gateway also needs open space beyond it for the tutorial.
  //   -> { nodes: [{ key, q, r, x, y, radius }], links: [[i, j]] } (indices into nodes; 0 is the capital)
  function grow(r, G, base) {
    const nodes = [{ key: 'capital', q: 0, r: 0 }];
    const taken = new Map([[hexKey(0, 0), 0]]);
    const links = [];
    const theta = r() * Math.PI * 2;
    const SECTOR = { compact: theta, combines: theta + (Math.PI * 2) / 3, facet: theta - (Math.PI * 2) / 3, claims: theta + Math.PI / 3 };
    const around = (q, rr) => HEX.map(([dq, dr]) => [q + dq, rr + dr]);
    const free = (q, rr) => !taken.has(hexKey(q, rr));
    // Room for the tutorial beyond (q, r): a free neighbour whose own neighbours are free too.
    const roomBeyond = (q, rr) => around(q, rr).some(([a, b]) => free(a, b) && around(a, b).every(([c, d]) => (c === q && d === rr) || free(c, d)));
    const plan = G.plan.flatMap(([key, [lo, hi]]) => Array(lo + Math.floor(r() * (hi - lo + 1))).fill(key));
    // The best free spot for a system of region `key` beside one of `parents`, or null.
    function spot(key, parents) {
      const R = Regions.REGIONS[key];
      let best = null;
      for (const [i, n] of nodes.entries()) {
        if (!parents.includes(n.key)) continue;
        for (const [q, rr] of around(n.q, n.r)) {
          if (!free(q, rr)) continue;
          if (key === 'gateway' && !roomBeyond(q, rr)) continue;
          const p = hexAt(q, rr, 1), d = Math.hypot(p.x, p.y);
          const next = around(q, rr).map(([a, b]) => taken.get(hexKey(a, b))).filter((j) => j !== undefined);
          const kin = next.filter((j) => nodes[j].key === key).length;
          let score = R.out * d + (R.cluster ? R.cluster * kin : -0.6 * (next.length - 1)) + r() * 0.9;
          if (R.sector) score += 1.6 * Math.cos(Math.atan2(p.y, p.x) - SECTOR[R.sector]);
          if (!best || score > best.score) best = { score, q, r: rr, parent: i };
        }
      }
      return best;
    }
    for (const key of plan) {
      // The gateway beside a Spoke colony, or failing that beside anything with room beyond it.
      const best = spot(key, Regions.REGIONS[key].parents) || (key === 'gateway' ? spot(key, nodes.map((n) => n.key)) : null);
      if (!best) continue;
      taken.set(hexKey(best.q, best.r), nodes.length);
      links.push([best.parent, nodes.length]);
      nodes.push({ key, q: best.q, r: best.r });
    }
    // Extra links between neighbours, by their regions' routes, up to each region's gate count.
    const gates = (i) => links.filter(([a, b]) => a === i || b === i).length;
    const linked = (i, j) => links.some(([a, b]) => (a === i && b === j) || (a === j && b === i));
    nodes.forEach((n, i) => {
      for (const [q, rr] of around(n.q, n.r)) {
        const j = taken.get(hexKey(q, rr));
        if (j === undefined || j <= i || linked(i, j)) continue;
        const m = nodes[j];
        if (gates(i) >= Regions.REGIONS[n.key].gates || gates(j) >= Regions.REGIONS[m.key].gates) continue;
        if (r() < Regions.linkChance(n.key, m.key)) links.push([i, j]);
      }
    });
    // Into place: each star nudged off its lattice point, keeping `gap` between edges.
    for (const n of nodes) Object.assign(n, hexAt(n.q, n.r, G.spacing), { radius: radiusOf(G, n.key, base) });
    for (const n of nodes) {
      for (let tries = 0; tries < 12; tries++) {
        const a = r() * Math.PI * 2, d = Math.sqrt(r()) * G.jitter * G.spacing;
        const c = { x: n.x + Math.cos(a) * d, y: n.y + Math.sin(a) * d };
        if (nodes.every((o) => o === n || Math.hypot(o.x - c.x, o.y - c.y) >= o.radius + n.radius + G.gap)) { Object.assign(n, c); break; }
      }
    }
    return { nodes, links };
  }

  // config: { params (for every system), galaxy: { gap, spacing, plan, ... } overriding DEFAULTS }
  function generate(seed, config = {}) {
    const G = { ...DEFAULTS, ...config.galaxy };
    const base = seedToInt(seed);
    const r = mulberry32(hashInt(base, 0, 0x6a1a));
    const common = merge(SS.params, config.params);

    // The tutorial at the origin, and the gateway in the direction the seed always gave it.
    const a0 = r() * Math.PI * 2;
    const d01 = G.tutorial.radius + G.gap + G.gateway.radius;
    const map = grow(r, G, common);
    // The tutorial beyond the gateway, on the side with the most room and furthest from the
    // capital; then the whole map turned and moved so that it sits at the origin and the gateway
    // where the seed puts it.
    const gw = map.nodes.findIndex((n) => n.key === 'gateway');
    const way = map.nodes[gw];
    let tut = null;
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2, c = { x: way.x + Math.cos(a) * d01, y: way.y + Math.sin(a) * d01 };
      const room = Math.min(...map.nodes.filter((n) => n !== way).map((n) => Math.hypot(n.x - c.x, n.y - c.y) - n.radius - G.tutorial.radius));
      const score = (room >= G.gap ? 1e9 : room) + Math.hypot(c.x, c.y) + r();
      if (!tut || score > tut.score) tut = { score, ...c };
    }
    const turn = a0 - Math.atan2(way.y - tut.y, way.x - tut.x), cos = Math.cos(turn), sin = Math.sin(turn);
    const place = (p) => ({ x: (p.x - tut.x) * cos - (p.y - tut.y) * sin, y: (p.x - tut.x) * sin + (p.y - tut.y) * cos });
    // Systems in order: the tutorial, the gateway, then the rest by gate links outward from it.
    const order = [gw];
    for (let i = 0; i < order.length; i++) {
      for (const [a, b] of map.links) {
        const j = a === order[i] ? b : b === order[i] ? a : -1;
        if (j >= 0 && !order.includes(j)) order.push(j);
      }
    }
    for (const [j] of map.nodes.entries()) if (!order.includes(j)) order.push(j);
    const regions = ['tutorial', ...order.map((j) => map.nodes[j].key)];
    const origins = [{ x: 0, y: 0 }, { x: Math.cos(a0) * d01, y: Math.sin(a0) * d01 }, ...order.slice(1).map((j) => place(map.nodes[j]))];
    const links = [[0, 1], ...map.links.map(([a, b]) => [order.indexOf(a) + 1, order.indexOf(b) + 1]).map(([a, b]) => (a < b ? [a, b] : [b, a]))]
      .sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    const params = regions.map((key) => merge(common, key === 'tutorial' ? G.tutorial : key === 'gateway' ? G.gateway : Regions.REGIONS[key].params));

    const gatesOf = (i) => links.flatMap(([a, b]) => (a === i ? [b] : b === i ? [a] : []))
      .map((to) => ({ to, angle: Math.atan2(origins[to].y - origins[i].y, origins[to].x - origins[i].x) }));
    // Waystations: the tutorial's, the gateway's, and others by chance, each with its own number.
    const rw = mulberry32(hashInt(base, 3, 0x3a75));
    const numbers = new Set([G.waystation.name, G.waystation.next]);
    const waystations = regions.map((key, i) => {
      if (i === 0) return { name: G.waystation.name, opposite: true };
      if (i === 1) return { name: G.waystation.next };
      if (rw() >= Regions.REGIONS[key].waystation) return null;
      let name;
      do name = `Waystation HD-${1000 + Math.floor(rw() * 9000)}`; while (numbers.has(name));
      numbers.add(name);
      return { name };
    });
    const systems = params.map((p, i) => {
      const s = SS.generate(i === 0 ? seed : hashInt(base, i, 0x5e57), { params: p, origin: origins[i], gates: gatesOf(i), waystation: waystations[i] });
      s.index = i;
      return s;
    });
    // Politics: who holds each system, who else is there, and what is going on.
    const used = new Map();
    systems.forEach((s, i) => {
      const neighbours = gatesOf(i).map((g) => systems[g.to].name);
      Regions.settle(s, regions[i], mulberry32(hashInt(base, i, 0x9017)), { neighbours, used });
    });

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
    // Gate pairs: each gate knows the one at the other end, and is named for where it leads.
    for (const g of all.gates) {
      const there = all.gates.find((o) => o.system === g.to && o.to === g.system);
      g.link = there.id;
      g.name = `${systems[g.to].name} Gate`;
    }

    const inSystem = (s, x, y) => Math.hypot(x - s.origin.x, y - s.origin.y) <= s.radius;
    const systemAt = (x, y) => systems.find((s) => inSystem(s, x, y)) || null;
    const edgeDist = (s, x, y) => Math.hypot(x - s.origin.x, y - s.origin.y) - s.radius;
    const nearestSystem = (x, y) => systems.reduce((b, s) => (edgeDist(s, x, y) < edgeDist(b, x, y) ? s : b));

    return {
      seed, name: systems[0].name, cultures: SS.CULTURES, systems, links, ...all,
      startStation: 0, // the first system's first station: the waystation in the tutorial system
      waystation: all.stations.findIndex((st) => st.waystation), // its id, or -1 without one
      systemAt, nearestSystem,
      securityAt: (x, y) => { const s = systemAt(x, y); return s ? s.securityAt(x, y) : 0; },
      nebulaAt: (x, y) => { const s = systemAt(x, y); return s ? s.nebulaAt(x, y) : null; },
      stationDist: (x, y) => Math.min(...systems.map((s) => s.stationDist(x, y))),
      // As for one system, plus the system it's in (null in deep space).
      regionAt(x, y) {
        const s = systemAt(x, y);
        if (s) return { ...s.regionAt(x, y), system: s };
        const n = nearestSystem(x, y);
        return { security: 0, nebula: null, near: null, fromStar: Math.hypot(x - n.origin.x, y - n.origin.y), system: null };
      },
      cultureColor: (id) => (SS.CULTURES[id] || SS.CULTURES[0]).color,
    };
  }

  // localStorage key part identifying one generated galaxy: every system's own key, and this
  // module's version.
  const saveKey = (g) => `${g.systems.map(SS.saveKey).join('+')}:g${VERSION}`;

  return { generate, params: DEFAULTS, VERSION, saveKey };
})();

export { Galaxy };
