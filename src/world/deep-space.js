// What lies between the star systems (notes/galaxy.md): deep-space sites and the galaxy-wide
// fields, grown from the seed over the galaxy's shape (world/galaxy-shape.js), clear of the
// systems world/galaxy.js placed. Grounded in what galaxies hold, not a model of one: each kind
// lives where its real counterpart tends to (young things on the arms' leading edges, dust on
// their trailing edges, old remnants between the arms, wanderers out at the rim), at game sizes.
// Plain data, no art: the galaxy map draws it now; flight art and mechanics come later.
//
// Sites, each { id, key, kind, name, x, y, r, zone, arm, visible, parent?, ...kind's own data }:
// - visible: luminous, so charted from the start; the rest are dark, found by sensors
//   (rules/knowledge.js),
// - parent: the id of the site it sits inside (a pulsar in its supernova remnant, a Bok globule
//   in its H II region),
// - moving ones (an interstellar object, a hypervelocity star) have `path` { x0, y0, vx, vy,
//   period }: DeepSpace.positionAt(site, t) says where one is at t (seconds of the real clock),
// - pulsing, flaring, sweeping ones say how at t through DeepSpace.phase(site, t).
// Fields, cheap enough for a frame: mediumAt(x, y) -> { density 0..1, phase }, dustAt(x, y) ->
// 0..1, cosmicRaysAt(x, y) -> 0..1, plus the features behind them (fields.bubbles: superbubbles;
// fields.fermi: the lobes round the core; fields.cmz: the dense gas ring round it).
//
//   DeepSpace.KINDS                            every kind: label, colour, visible, counts...
//   DeepSpace.generate(seed, shape, systems, params?) -> { sites, fields, siteAt(x, y) }
//   DeepSpace.positionAt(site, t), DeepSpace.phase(site, t)
// ES module (`DeepSpace`); also runs in Node (the tests).

import { hashInt, mulberry32, nextSeed, seedToInt, weightedPick } from '../core/rng.js';

const DeepSpace = (() => {
  const TAU = Math.PI * 2;

  // Every kind of site. zones: where it grows, by weight ('arm-outer' and 'arm-inner' are an arm's
  // leading and trailing edges); count: [min, max]; r: its reach, world units; visible: on the
  // chart from the start. Fractions of R where a kind is placed by a rule of its own instead.
  const KINDS = {
    smbh: { label: 'Supermassive black hole', color: '#ffb35c', visible: true, count: [1, 1], r: [60000, 60000] },
    'nuclear-cluster': { label: 'Nuclear star cluster', color: '#ffe2a8', visible: true, count: [1, 1], r: [190000, 190000] },
    'open-cluster': { label: 'Open cluster', color: '#9cc8ff', visible: true, count: [2, 4], r: [9000, 18000], zones: { 'arm-outer': 1 } },
    'globular-cluster': { label: 'Globular cluster', color: '#ffd9a0', visible: true, count: [2, 3], r: [14000, 24000], zones: { halo: 3, rim: 1 } },
    'hii-region': { label: 'H II region', color: '#ff6ab0', visible: true, count: [3, 5], r: [26000, 44000], zones: { 'arm-outer': 1 } },
    'molecular-cloud': { label: 'Giant molecular cloud', color: '#6a5a78', visible: false, count: [3, 5], r: [30000, 58000], zones: { 'arm-inner': 3, interarm: 1 } },
    'bok-globule': { label: 'Bok globule', color: '#4a4058', visible: false, count: [0, 0], r: [3000, 6000] }, // inside H II regions
    'protoplanetary-disc': { label: 'Protoplanetary disc', color: '#e8b98a', visible: false, count: [1, 2], r: [6000, 10000] }, // in H II regions
    'supernova-remnant': { label: 'Supernova remnant', color: '#7ad8ff', visible: true, count: [2, 3], r: [16000, 30000], zones: { 'arm-outer': 2, 'arm-inner': 1, bar: 1 } },
    pulsar: { label: 'Pulsar', color: '#b8f0ff', visible: true, count: [0, 0], r: [2500, 2500] }, // in remnants and globulars
    'neutron-star': { label: 'Neutron star', color: '#a8c4e0', visible: false, count: [1, 2], r: [2000, 2000], zones: { bar: 2, interarm: 2, 'arm-inner': 1 } },
    magnetar: { label: 'Magnetar', color: '#d07aff', visible: true, count: [1, 1], r: [6000, 6000], zones: { 'arm-outer': 1, bar: 1 } },
    'stellar-black-hole': { label: 'Black hole', color: '#c08aff', visible: false, count: [2, 3], r: [4000, 6000], zones: { bar: 2, interarm: 2, 'arm-inner': 1 } },
    microquasar: { label: 'Microquasar', color: '#ff8ae0', visible: true, count: [1, 1], r: [9000, 9000], zones: { bar: 1, 'arm-inner': 1, interarm: 1 } },
    'white-dwarf': { label: 'White dwarf', color: '#e8f0ff', visible: false, count: [3, 5], r: [2500, 2500], zones: { interarm: 3, rim: 1 } },
    'recurrent-nova': { label: 'Recurrent nova', color: '#ffeb8a', visible: true, count: [1, 2], r: [5000, 5000], zones: { interarm: 2, bar: 1 } },
    'kilonova-remnant': { label: 'Kilonova remnant', color: '#ffc94a', visible: false, count: [1, 2], r: [10000, 16000], zones: { interarm: 2, bar: 1, rim: 1 } },
    'wolf-rayet': { label: 'Wolf–Rayet star', color: '#8affff', visible: true, count: [1, 3], r: [12000, 22000], zones: { 'arm-outer': 1 } },
    'variable-star': { label: 'Cepheid variable', color: '#fff2b0', visible: true, count: [2, 3], r: [3000, 3000], zones: { 'arm-outer': 1, interarm: 1 } },
    'brown-dwarf': { label: 'Brown dwarf', color: '#b0664a', visible: false, count: [4, 6], r: [2500, 4500], zones: { interarm: 2, rim: 2, 'arm-inner': 1 } },
    'rogue-planet': { label: 'Rogue planet', color: '#7e94a8', visible: false, count: [4, 6], r: [1500, 3000], zones: { rim: 3, interarm: 2, halo: 1 } },
    'interstellar-object': { label: 'Interstellar object', color: '#cfd8e8', visible: false, count: [2, 4], r: [800, 800] }, // moving
    'hypervelocity-star': { label: 'Hypervelocity star', color: '#fff6d8', visible: true, count: [1, 1], r: [3000, 3000] }, // moving
    'stellar-stream': { label: 'Stellar stream', color: '#c9b8ff', visible: true, count: [1, 1], r: [0, 0] }, // an arc in the halo
    'satellite-galaxy': { label: 'Dwarf galaxy', color: '#d8d0ff', visible: true, count: [1, 1], r: [120000, 160000] }, // beyond the rim
  };

  const DEFAULTS = {
    clear: 25000, // a site keeps this far from a system's edge
    hole: 120000, // nothing but the core's own sites this close to the centre
    gap: 8000, // between two sites' edges
    counts: {}, // { kind: [min, max] } over KINDS' counts (0 turns a kind off)
    // Moving sites: speeds in world units per (real) second.
    movers: { object: [220, 340], star: [120, 180] },
  };

  // Catalogue names: a survey's letters and a number, or a discoverer's name for the bright ones.
  const SURVEYS = ['VX', 'KR', 'HD', 'TQ', 'NX', 'LM', 'OR', 'SB', 'ZT', 'GC'];
  const PEOPLE = ['Kessler', 'Amari', 'Okonkwo', 'Varga', 'Lindqvist', 'Tamura', 'Reyes', 'Haddad', 'Novak', 'Ferreira', 'Ishida', 'Mbeki', 'Castell', 'Orlov', 'Achebe', 'Halvorsen'];
  const GREEK = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta', 'Kappa', 'Lambda', 'Sigma', 'Tau', 'Omega'];
  const SHORT = {
    smbh: 'Core', 'nuclear-cluster': 'Cluster', 'open-cluster': 'Cluster', 'globular-cluster': 'Globular', 'hii-region': 'Nebula', 'molecular-cloud': 'Cloud', 'bok-globule': 'Globule',
    'protoplanetary-disc': 'Disc', 'supernova-remnant': 'Remnant', pulsar: 'Pulsar', 'neutron-star': 'Neutron Star', magnetar: 'Magnetar',
    'stellar-black-hole': 'Black Hole', microquasar: 'Microquasar', 'white-dwarf': 'Dwarf', 'recurrent-nova': 'Nova', 'kilonova-remnant': 'Kilonova',
    'wolf-rayet': 'Star', 'variable-star': 'Variable', 'brown-dwarf': 'Dwarf', 'rogue-planet': 'Wanderer', 'interstellar-object': 'Interloper',
    'hypervelocity-star': 'Runaway', 'stellar-stream': 'Stream', 'satellite-galaxy': 'Cloud',
  };

  function generate(seed, shape, systems, params = {}) {
    const P = { ...DEFAULTS, ...params, movers: { ...DEFAULTS.movers, ...params.movers } };
    const R = shape.R, base = seedToInt(seed);
    const stream = (salt, i = 0) => mulberry32(hashInt(base, i, salt));
    const between = (r, [lo, hi]) => lo + r() * (hi - lo);
    const countOf = (r, kind) => { const [lo, hi] = P.counts[kind] || KINDS[kind].count; return lo + Math.floor(r() * (hi - lo + 1)); };
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

    const rn = stream(0x9a3e);
    const usedNames = new Set();
    function nameFor(kind) {
      for (let i = 0; i < 50; i++) {
        let n;
        if (kind === 'stellar-stream') n = `${PEOPLE[Math.floor(rn() * PEOPLE.length)]} Stream`;
        else if (kind === 'satellite-galaxy') n = `${PEOPLE[Math.floor(rn() * PEOPLE.length)]}'s Cloud`;
        else if (KINDS[kind].visible && rn() < 0.45) n = `${PEOPLE[Math.floor(rn() * PEOPLE.length)]}'s ${SHORT[kind]}`;
        else if (kind === 'hii-region' || kind === 'molecular-cloud' || kind === 'open-cluster') n = `${GREEK[Math.floor(rn() * GREEK.length)]} ${SHORT[kind]} ${100 + Math.floor(rn() * 900)}`;
        else n = `${SURVEYS[Math.floor(rn() * SURVEYS.length)]}-${100 + Math.floor(rn() * 9900)}`;
        if (!usedNames.has(n)) { usedNames.add(n); return n; }
      }
      return `${SURVEYS[0]}-${usedNames.size}`;
    }

    const sites = [];
    const add = (kind, at, r, extra = {}) => {
      const z = shape.zoneAt(at.x, at.y);
      const s = {
        id: sites.length, key: `s${sites.length}`, kind, name: nameFor(kind), x: at.x, y: at.y, r: Math.round(r),
        zone: z.zone, arm: z.arm, visible: KINDS[kind].visible, seed: nextSeed(rn), ...extra,
      };
      sites.push(s);
      return s;
    };
    // Where a site of reach r may sit: clear of every system (by a margin), of the core's own
    // sites, and of the other sites (but its parent).
    const WIDE = new Set(['nuclear-cluster', 'satellite-galaxy', 'stellar-stream']); // others may sit in their reach
    const clearOfSystems = (at, r) => systems.every((s) => dist(s.origin, at) >= s.radius + P.clear + r);
    const fits = (at, r, parent = null) => clearOfSystems(at, r)
      && (parent !== null || Math.hypot(at.x, at.y) >= P.hole + r)
      && sites.every((o) => o.id === parent || o.parent !== undefined || WIDE.has(o.kind) || dist(o, at) >= o.r + r + P.gap);
    // The zone key a kind's weights use.
    const zoneKey = (at) => { const z = shape.zoneAt(at.x, at.y); return z.zone === 'arm' ? `arm-${z.side}` : z.zone; };
    // A spot for a kind, by its zones' weights: a point drawn by density (or uniformly out in the
    // rim and halo, where the density is thin), kept if its zone is one the kind grows in, by weight.
    function spot(r, kind, reach) {
      const Z = KINDS[kind].zones, top = Math.max(...Object.values(Z));
      const outer = (Z.halo || 0) + (Z.rim || 0) > 0;
      for (let tries = 0; tries < 1500; tries++) {
        const at = outer && r() < ((Z.halo || 0) + (Z.rim || 0)) / Object.values(Z).reduce((a, b) => a + b, 0)
          ? (() => { const a = r() * TAU, d = R * between(r, Z.halo ? [0.9, 1.22] : [0.86, 1.02]); return { x: Math.cos(a) * d, y: Math.sin(a) * d }; })()
          : shape.sample(r, 1.02);
        const w = Z[zoneKey(at)] || 0;
        if (!w || r() * top > w) continue;
        if (fits(at, reach)) return at;
      }
      return null;
    }

    // ---------- The core: the black hole and the crowd of old stars round it ----------
    const rc = stream(0xc0e1);
    if (countOf(rc, 'smbh')) {
      add('smbh', { x: 0, y: 0 }, KINDS.smbh.r[0], {
        name: 'Core A*', horizon: 2400, disc: KINDS.smbh.r[0], jet: rc() * TAU, jetWidth: 0.16, jetReach: 0.38 * R,
      });
    }
    if (countOf(rc, 'nuclear-cluster')) add('nuclear-cluster', { x: 0, y: 0 }, Math.min(KINDS['nuclear-cluster'].r[0], P.hole + 70000), { name: 'The Core Cluster', stars: 2400 });

    // ---------- Star birth: H II regions with their globules and young discs ----------
    const rh = stream(0x4111);
    // A cloud of overlapping blobs, like a system's nebula but at galactic scale.
    const blobsOf = (r, reach) => {
      const blobs = [{ dx: 0, dy: 0, r: reach * between(r, [0.5, 0.65]) }];
      for (let k = 3 + Math.floor(r() * 4); k > 0; k--) {
        const br = reach * between(r, [0.28, 0.48]), a = r() * TAU, d = between(r, [0.2, 1]) * (reach - br);
        blobs.push({ dx: Math.cos(a) * d, dy: Math.sin(a) * d, r: br });
      }
      return blobs;
    };
    const inBlobs = (s, x, y) => dist(s, { x, y }) <= s.r && s.blobs.some((b) => Math.hypot(x - s.x - b.dx, y - s.y - b.dy) < b.r);
    const inside = (r, s, frac = 0.7) => { const b = s.blobs[Math.floor(r() * s.blobs.length)], a = r() * TAU, d = Math.sqrt(r()) * b.r * frac; return { x: s.x + b.dx + Math.cos(a) * d, y: s.y + b.dy + Math.sin(a) * d }; };
    const hii = [];
    for (let n = countOf(rh, 'hii-region'); n > 0; n--) {
      const reach = between(rh, KINDS['hii-region'].r), at = spot(rh, 'hii-region', reach);
      if (at) hii.push(add('hii-region', at, reach, { blobs: blobsOf(rh, reach) }));
    }
    for (const h of hii) {
      for (let n = 1 + Math.floor(rh() * 3), tries = 0; n > 0 && tries < 40; tries++) {
        const reach = between(rh, KINDS['bok-globule'].r), at = inside(rh, h, 0.6);
        if (sites.some((o) => o.parent === h.id && dist(o, at) < o.r + reach + 1500)) continue;
        add('bok-globule', at, reach, { parent: h.id });
        n--;
      }
    }
    for (let n = countOf(rh, 'protoplanetary-disc'), i = 0; n > 0 && hii.length && i < 40; i++) {
      const h = hii[i % hii.length], reach = between(rh, KINDS['protoplanetary-disc'].r), at = inside(rh, h, 0.5);
      if (sites.some((o) => o.parent === h.id && dist(o, at) < o.r + reach + 2000)) continue;
      add('protoplanetary-disc', at, reach, { parent: h.id, star: weightedPick([['K', 1], ['G', 2], ['A', 1]], rh()), proplyds: 2 + Math.floor(rh() * 4) });
      n--;
    }

    // ---------- Dark clouds on the arms' trailing edges ----------
    const rm = stream(0x3c10);
    for (let n = countOf(rm, 'molecular-cloud'); n > 0; n--) {
      const reach = between(rm, KINDS['molecular-cloud'].r), at = spot(rm, 'molecular-cloud', reach);
      if (at) add('molecular-cloud', at, reach, { blobs: blobsOf(rm, reach) });
    }

    // ---------- Clusters ----------
    const rk = stream(0xc1a5);
    const members = (r, reach, n) => Array.from({ length: n }, () => {
      const a = r() * TAU, d = reach * Math.sqrt(r()) * 0.9;
      return { dx: Math.round(Math.cos(a) * d), dy: Math.round(Math.sin(a) * d), cls: weightedPick([['B', 2], ['A', 3], ['F', 2], ['G', 1]], r()) };
    });
    for (let n = countOf(rk, 'open-cluster'); n > 0; n--) {
      const reach = between(rk, KINDS['open-cluster'].r), at = spot(rk, 'open-cluster', reach);
      if (at) add('open-cluster', at, reach, { members: members(rk, reach, 5 + Math.floor(rk() * 8)), age: 'young' });
    }
    const globulars = [];
    for (let n = countOf(rk, 'globular-cluster'); n > 0; n--) {
      const reach = between(rk, KINDS['globular-cluster'].r), at = spot(rk, 'globular-cluster', reach);
      if (at) globulars.push(add('globular-cluster', at, reach, { stars: 200 + Math.floor(rk() * 600), age: 'old', pulsar: rk() < 0.5 }));
    }

    // ---------- Remnants: the dead stars and what they left ----------
    const rr = stream(0x5e3d);
    const pulsarData = (r, fast = false) => ({ spin: fast ? 0.6 + r() * 0.6 : 2 + r() * 5, beam: r() * TAU, beamWidth: 0.12 + r() * 0.08, reach: 30000 + r() * 30000 });
    for (let n = countOf(rr, 'supernova-remnant'); n > 0; n--) {
      const reach = between(rr, KINDS['supernova-remnant'].r), at = spot(rr, 'supernova-remnant', reach);
      if (!at) continue;
      const snr = add('supernova-remnant', at, reach, { shell: Math.round(reach * 0.85), age: Math.round(2000 + rr() * 18000) });
      const heart = { x: at.x + (rr() - 0.5) * reach * 0.3, y: at.y + (rr() - 0.5) * reach * 0.3 };
      if (rr() < 0.65) add('pulsar', heart, KINDS.pulsar.r[0], { parent: snr.id, ...pulsarData(rr) });
      else add('neutron-star', heart, KINDS['neutron-star'].r[0], { parent: snr.id, field: 0.3 + rr() * 0.3 });
    }
    for (const g of globulars) if (g.pulsar) add('pulsar', { x: g.x + (rr() - 0.5) * g.r * 0.4, y: g.y + (rr() - 0.5) * g.r * 0.4 }, KINDS.pulsar.r[0], { parent: g.id, millisecond: true, ...pulsarData(rr, true) });
    const simple = (kind, r, extra) => {
      for (let n = countOf(r, kind); n > 0; n--) {
        const reach = between(r, KINDS[kind].r), at = spot(r, kind, reach);
        if (at) add(kind, at, reach, extra(r, reach));
      }
    };
    simple('neutron-star', rr, (r) => ({ field: 0.3 + r() * 0.3 }));
    simple('magnetar', rr, (r) => ({ field: 1, reach: 40000 + r() * 20000 }));
    simple('stellar-black-hole', rr, (r) => ({ mass: weightedPick([['light', 3], ['heavy', 2]], r()), horizon: 40 + Math.round(r() * 60) }));
    simple('microquasar', rr, (r) => ({ mass: 'light', companion: weightedPick([['B', 2], ['O', 1]], r()), jet: r() * TAU, jetWidth: 0.08, jetReach: 60000 + r() * 40000, precession: 300 + r() * 600, wobble: 0.35 + r() * 0.3 }));
    simple('white-dwarf', rr, (r, reach) => {
      const pn = r() < 0.4;
      return { planetaryNebula: pn, ring: pn ? Math.round(reach * 3 + r() * 6000) : 0, debris: r() < 0.3 };
    });
    // A planetary nebula's ring is part of its reach.
    for (const s of sites) if (s.kind === 'white-dwarf' && s.planetaryNebula) s.r = Math.max(s.r, s.ring);
    simple('recurrent-nova', rr, (r) => ({ companion: 'M', period: 1800 + Math.round(r() * 3600), burst: 60 + Math.round(r() * 60), offset: r() }));
    simple('kilonova-remnant', rr, (r) => ({ heavy: ['gold', 'platinum', 'iridium'].filter(() => r() < 0.7), age: Math.round(5000 + r() * 40000) }));

    // ---------- Living stars of note ----------
    const rl = stream(0x1a7e);
    simple('wolf-rayet', rl, (r, reach) => ({ bubble: Math.round(reach * 0.9), wind: 40 + Math.round(r() * 40) }));
    simple('variable-star', rl, (r) => ({ period: 20 + Math.round(r() * 40), amplitude: 0.4 + r() * 0.4, offset: r() }));

    // ---------- Failed stars and lost planets ----------
    const rd = stream(0xb0d1);
    simple('brown-dwarf', rd, (r) => ({ cls: weightedPick([['L', 2], ['T', 3], ['Y', 1]], r()), moons: Math.floor(r() * 3) }));
    simple('rogue-planet', rd, (r) => ({ type: weightedPick([['ice', 3], ['dark', 2]], r()), moon: r() < 0.3, ocean: r() < 0.25 }));

    // ---------- Wanderers: moving on straight paths across the galaxy, round again ----------
    // A path: from (x0, y0) along (vx, vy) for `period` seconds, then from the start again. It
    // never comes within 1.5 system radii of a star.
    const rw = stream(0x1d0b);
    const segClear = (a, b) => systems.every((s) => segDist(s.origin, a, b) > s.radius * 1.5) && segDist({ x: 0, y: 0 }, a, b) > P.hole;
    function pathOf(r, from, to, speed) {
      const len = dist(from, to);
      return { x0: Math.round(from.x), y0: Math.round(from.y), vx: ((to.x - from.x) / len) * speed, vy: ((to.y - from.y) / len) * speed, period: Math.round(len / speed), t0: Math.floor(r() * 1e6) };
    }
    for (let n = countOf(rw, 'interstellar-object'), tries = 0; n > 0 && tries < 400; tries++) {
      // In from outside the disc, across it, and out again.
      const a = rw() * TAU, b = a + Math.PI + (rw() - 0.5) * 1.6;
      const from = { x: Math.cos(a) * R * 1.15, y: Math.sin(a) * R * 1.15 }, to = { x: Math.cos(b) * R * 1.15, y: Math.sin(b) * R * 1.15 };
      if (!segClear(from, to)) continue;
      const path = pathOf(rw, from, to, between(rw, P.movers.object));
      add('interstellar-object', positionAt({ path }, 0), KINDS['interstellar-object'].r[0], { path, form: weightedPick([['cigar', 1], ['comet', 2], ['shard', 1]], rw()) });
      n--;
    }
    for (let n = countOf(rw, 'hypervelocity-star'), tries = 0; n > 0 && tries < 400; tries++) {
      // Flung out of the core: from just outside the hole, straight out past the rim.
      const a = rw() * TAU;
      const from = { x: Math.cos(a) * (P.hole + 30000), y: Math.sin(a) * (P.hole + 30000) }, to = { x: Math.cos(a) * R * 1.3, y: Math.sin(a) * R * 1.3 };
      if (!systems.every((s) => segDist(s.origin, from, to) > s.radius * 1.5)) continue;
      const path = pathOf(rw, from, to, between(rw, P.movers.star));
      add('hypervelocity-star', positionAt({ path }, 0), KINDS['hypervelocity-star'].r[0], { path, cls: 'B' });
      n--;
    }

    // ---------- Out past the rim: a stellar stream and a dwarf galaxy ----------
    const rx = stream(0x5a7e);
    if (countOf(rx, 'stellar-stream')) {
      // An arc of old stars round the halo, a third of a turn long.
      const a0 = rx() * TAU, span = 1.6 + rx() * 0.8, d0 = R * (1.05 + rx() * 0.1), d1 = R * (1.15 + rx() * 0.12);
      const points = Array.from({ length: 34 }, (_, i) => {
        const u = i / 33, a = a0 + span * u, d = d0 + (d1 - d0) * u + (rx() - 0.5) * 0.025 * R;
        return { x: Math.round(Math.cos(a) * d), y: Math.round(Math.sin(a) * d) };
      });
      const mid = points[17];
      add('stellar-stream', mid, 0.04 * R, { points });
    }
    if (countOf(rx, 'satellite-galaxy')) {
      const a = rx() * TAU, d = R * (1.32 + rx() * 0.12);
      add('satellite-galaxy', { x: Math.cos(a) * d, y: Math.sin(a) * d }, between(rx, KINDS['satellite-galaxy'].r), { stars: 30 + Math.floor(rx() * 30) });
    }

    // ---------- Fields ----------
    const rf = stream(0xf1e7);
    // Superbubbles: hot, near-empty cavities between the arms, blown by old supernovae.
    const bubbles = [];
    for (let i = 0, tries = 0; i < 3 && tries < 400; tries++) {
      const at = shape.sample(rf, 0.9), z = shape.zoneAt(at.x, at.y).zone, r = R * (0.04 + rf() * 0.035);
      if (z !== 'interarm' && z !== 'arm') continue;
      if (Math.hypot(at.x, at.y) < P.hole * 2 || bubbles.some((b) => dist(b, at) < b.r + r)) continue;
      bubbles.push({ x: Math.round(at.x), y: Math.round(at.y), r: Math.round(r) });
      i++;
    }
    // The Fermi lobes: two great lobes either side of the core, across the bar.
    const fermiAxis = shape.bar.angle + Math.PI / 2;
    const fermi = [1, -1].map((s) => ({ x: Math.cos(fermiAxis) * s * 0.17 * R, y: Math.sin(fermiAxis) * s * 0.17 * R, r: 0.15 * R }));
    // The central molecular zone: a dense ring of cold gas round the core.
    const cmz = { r: 0.16 * R, width: 0.035 * R };
    const clouds = sites.filter((s) => s.kind === 'molecular-cloud' || s.kind === 'bok-globule');
    const lit = sites.filter((s) => s.kind === 'hii-region');
    const hot = sites.filter((s) => s.kind === 'supernova-remnant' || s.kind === 'kilonova-remnant');
    const sources = sites.filter((s) => s.kind === 'pulsar' || s.kind === 'magnetar' || s.kind === 'microquasar');
    const smbh = sites.find((s) => s.kind === 'smbh');

    // A cheap value noise, for texture in the fields (0..1).
    const noise = (x, y, cell) => {
      const gx = Math.floor(x / cell), gy = Math.floor(y / cell), fx = x / cell - gx, fy = y / cell - gy;
      const h = (i, j) => hashInt(gx + i, gy + j, base ^ 0xd057) / 4294967296;
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      return (h(0, 0) * (1 - sx) + h(1, 0) * sx) * (1 - sy) + (h(0, 1) * (1 - sx) + h(1, 1) * sx) * sy;
    };
    const inCloud = (x, y) => { for (const c of clouds) if (c.blobs ? inBlobs(c, x, y) : Math.hypot(x - c.x, y - c.y) < c.r) return c; return null; };
    const inBubble = (x, y) => bubbles.find((b) => Math.hypot(x - b.x, y - b.y) < b.r) || null;
    const ringK = (x, y) => Math.exp(-(((Math.hypot(x, y) - cmz.r) / cmz.width) ** 2));

    function dustAt(x, y) {
      let v = 0;
      const a = shape.armAt(x, y);
      // The lane: along the arm's inner (trailing) edge.
      if (a) { const off = a.side === 'inner' ? a.d - a.w * 0.55 : -(a.d + a.w * 0.55); v += a.k * Math.exp(-((off / (a.w * 0.4)) ** 2)); }
      v += 0.6 * ringK(x, y);
      const c = inCloud(x, y);
      if (c) v += c.kind === 'bok-globule' ? 1 : 0.7;
      if (inBubble(x, y)) v *= 0.2;
      v *= 0.7 + 0.6 * noise(x, y, 0.03 * R);
      return Math.max(0, Math.min(1, v));
    }
    function mediumAt(x, y) {
      const d = Math.min(1, shape.density(x, y) / 1.3);
      if (inCloud(x, y) || ringK(x, y) > 0.5) return { density: Math.max(d, 0.85), phase: 'molecular' };
      if (inBubble(x, y)) return { density: d * 0.1, phase: 'void' };
      if (lit.some((h) => inBlobs(h, x, y))) return { density: Math.max(d, 0.5), phase: 'warm' };
      if (Math.hypot(x, y) < 0.13 * R || hot.some((s) => Math.hypot(x - s.x, y - s.y) < s.r)) return { density: d * 0.5, phase: 'hot' };
      return { density: d, phase: d > 0.45 ? 'cold' : 'warm' };
    }
    function cosmicRaysAt(x, y) {
      const fromC = Math.hypot(x, y);
      let v = 0.12 + 0.75 * Math.exp(-((fromC / (0.22 * R)) ** 2));
      for (const f of fermi) { const k = 1 - Math.hypot(x - f.x, y - f.y) / f.r; if (k > 0) v += 0.35 * Math.min(1, k * 2); }
      for (const s of hot) { const k = 1 - Math.hypot(x - s.x, y - s.y) / (s.r * 1.4); if (k > 0) v += 0.45 * k; }
      for (const s of sources) { const reach = s.reach || s.jetReach || 40000, k = 1 - Math.hypot(x - s.x, y - s.y) / reach; if (k > 0) v += 0.5 * k * k; }
      if (smbh) {
        // The black hole's jet: a narrow cone either way along its axis.
        const a = Math.atan2(y, x), off = Math.abs(Math.sin(a - smbh.jet));
        if (fromC < smbh.jetReach && Math.abs(Math.cos(a - smbh.jet)) > Math.cos(smbh.jetWidth) && off < Math.sin(smbh.jetWidth)) v += 0.6 * (1 - fromC / smbh.jetReach);
      }
      if (inBubble(x, y)) v += 0.2;
      if (inCloud(x, y)) v *= 0.4; // dense gas shields
      return Math.max(0, Math.min(1, v));
    }

    // The site a point is in: the smallest whose reach it is inside (moving ones where they are now).
    function siteAt(x, y, t = 0) {
      let best = null;
      for (const s of sites) {
        if (s.kind === 'stellar-stream') continue;
        const p = s.path ? positionAt(s, t) : s;
        if (Math.hypot(x - p.x, y - p.y) <= s.r && (!best || s.r < best.r)) best = s;
      }
      return best;
    }

    return { sites, fields: { bubbles, fermi, cmz, dustAt, mediumAt, cosmicRaysAt }, siteAt };
  }

  // The distance from p to the segment a-b.
  function segDist(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
    const u = L2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2)) : 0;
    return Math.hypot(a.x + dx * u - p.x, a.y + dy * u - p.y);
  }

  // Where a moving site is at t (seconds); a fixed one where it is.
  function positionAt(site, t) {
    const P = site.path;
    if (!P) return { x: site.x, y: site.y };
    const u = ((((t + (P.t0 || 0)) % P.period) + P.period) % P.period);
    return { x: P.x0 + P.vx * u, y: P.y0 + P.vy * u };
  }

  // What a site is doing at t (seconds): a pulsar's beam angle, a Cepheid's brightness (0..1), a
  // recurrent nova's outburst, a microquasar's jet angle. null for a site that does nothing.
  function phase(site, t) {
    switch (site.kind) {
      case 'pulsar': return { beam: site.beam + (TAU * t) / site.spin };
      case 'variable-star': return { brightness: 0.5 + 0.5 * site.amplitude * Math.sin(TAU * (t / site.period + site.offset)) };
      case 'recurrent-nova': {
        const u = ((t / site.period + site.offset) % 1 + 1) % 1, into = u * site.period;
        return { burst: into < site.burst, in: into < site.burst ? 0 : site.period - into, left: into < site.burst ? site.burst - into : 0 };
      }
      case 'microquasar': return { jet: site.jet + site.wobble * Math.sin((TAU * t) / site.precession) };
      default: return null;
    }
  }

  return { KINDS, generate, positionAt, phase, params: DEFAULTS };
})();

export { DeepSpace };
