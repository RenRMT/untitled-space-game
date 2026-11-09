// A Redshift star system from a seed and a destination's terms (notes/sim.md): a star, planets on
// orbits that widen outward (hot rocky worlds inside, giants outside), their moons, an asteroid belt,
// sometimes a nebula, and the gate site on the outermost orbit. Every body but the gate site is a
// slot for one station and has its minerals and volatiles (0–3 pips) and sometimes a trait. Plain
// data, no art: the map (map.js) places and draws it, the rules (rules.js) read it.
//
//   SimWorld.generate(seed, terms) -> system
//     terms: { depth (systems reached, 0 first), distance: 'near' | 'mid' | 'far', rich: 'm' | 'v' | 'poor' | null,
//              hazard: SimConfig.HAZARDS id | null, cultures: [culture id present], traits: [trait id] (forced, story),
//              lifeMul (Archive dampers, overcharge), ease (how much depth shortens it: 1, or less in the story), name? }
//     system: { seed, name, depth, distance, rich, hazard, cultures, star: { name, cls, r, seed }, sky (a deep-space kind in its sky),
//               life (cycles from 0 to 100%), pull0, rings (orbits, the gate's included), gate (its body key),
//               bodies: [body] }
//     body: { key, id, kind: 'planet' | 'moon' | 'belt' | 'nebula' | 'gate', name, ring (orbit, 0 innermost;
//             a moon its planet's), parent (a moon's planet key) | null, slot (its place round the planet), angle (rad at t=0),
//             m, v (pips), trait | null, art (what art/ draws: a planet's { type, r, ring, ringTilt, seed }, a moon's
//             { type, r, seed }, a nebula's { type, seed }, a belt's { seed }) }
//   SimWorld.choices(seed, depth, o) -> [terms]   the systems a jump offers (o: { count, cultures, story, charge })
//   SimWorld.group(system, key) -> [key]   a body's group: a planet and its moons
//   SimWorld.NAMES                          the syllables names are made of
// ES module (`SimWorld`); also runs in Node (the tests).

import { hashInt, mulberry32, seedToInt } from '../core/rng.js';
import { SimConfig } from './config.js';

const SimWorld = (() => {
  const C = SimConfig;
  const TAU = Math.PI * 2;
  const SYLL = ['ka', 'ri', 'to', 'ven', 'sol', 'mar', 'dra', 'li', 'on', 'tha', 'ce', 'rus', 'vel', 'no', 'ae', 'quin', 'sa', 'tor', 'mi', 'el', 'zan', 'pho', 'ly', 'xe'];
  const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
  // Planet types by how far out: [type, weight].
  const ZONES = [
    [['lava', 3], ['desert', 2]],
    [['desert', 2], ['terran', 2], ['lava', 1], ['ice', 1]],
    [['terran', 2], ['ice', 2], ['desert', 1]],
    [['gas', 3], ['blue', 1], ['ice', 1]],
    [['gas', 2], ['blue', 2]],
  ];
  const SIZE = { gas: [300, 400], blue: [240, 320], terran: [170, 220], desert: [160, 210], ice: [150, 200], lava: [140, 190] };
  const MOONS = { gas: [1, 3], blue: [1, 2], terran: [0, 1], ice: [0, 1], desert: [0, 1], lava: [0, 0] };
  const MOON_TYPES = [['grey', 3], ['ice', 3], ['rust', 2], ['dark', 2], ['sulfur', 2]];
  const NEBULA_TYPES = ['emission', 'reflection', 'ion', 'ember', 'dust'];
  const STARS = [['M', 3], ['K', 3], ['G', 3], ['F', 2], ['A', 1], ['B', 1]];
  const STAR_R = { M: [180, 230], K: [210, 260], G: [230, 280], F: [250, 300], A: [270, 320], B: [290, 340] };
  // What a system's sky may hold, far off (art/sites.js kinds the hazards don't use).
  const SKY = ['open-cluster', 'globular-cluster', 'protoplanetary-disc', 'brown-dwarf', 'rogue-planet', 'interstellar-object', 'hii-region',
    'bok-globule', 'molecular-cloud', 'wolf-rayet', 'neutron-star', 'recurrent-nova', 'kilonova-remnant', 'hypervelocity-star'];
  const pickW = (list, x) => { const tot = list.reduce((s, [, w]) => s + w, 0); let a = x * tot; for (const [v, w] of list) { a -= w; if (a < 0) return v; } return list[list.length - 1][0]; };
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

  function namer(rnd) {
    const used = new Set();
    return () => {
      for (;;) {
        let s = '';
        for (let i = 2 + Math.floor(rnd() * 2); i > 0; i--) s += SYLL[Math.floor(rnd() * SYLL.length)];
        s = s[0].toUpperCase() + s.slice(1);
        if (!used.has(s) && s.length <= 9) { used.add(s); return s; }
      }
    };
  }

  function generate(seed, terms = {}) {
    const s = seedToInt(seed);
    const rnd = mulberry32(hashInt(s, 1, 0x5e1));
    const name = terms.name || namer(rnd)();
    const cls = pickW(STARS, rnd());
    const star = { name, cls, r: Math.round(STAR_R[cls][0] + rnd() * (STAR_R[cls][1] - STAR_R[cls][0])), seed: s % 997 };
    const cultures = terms.cultures || ['android'];
    const has = (c) => cultures.includes(c);
    const rich = terms.rich || null, hz = terms.hazard ? C.HAZARDS[terms.hazard] : null;
    const bodies = [];
    const pip = (base, which) => {
      let n = base + (rnd() < 0.25 ? 1 : 0) - (rnd() < 0.2 ? 1 : 0);
      if (rich === which) n += rnd() < 0.6 ? 1 : 0;
      if (rich === 'poor') n -= rnd() < 0.5 ? 1 : 0;
      if (which === 'm' && hz?.minerals) n += hz.minerals;
      return base === 0 && n > 0 && rnd() < 0.7 ? 0 : clamp(n, 0, 3);
    };
    // Orbits: 4–6 planets, a belt among them, sometimes a nebula outside them, the gate site last.
    const nPlanets = 4 + Math.floor(rnd() * 3);
    const beltAt = 1 + Math.floor(rnd() * (nPlanets - 1));
    const nebula = rnd() < 0.55 || terms.hazard === 'ion';
    let ring = 0, planets = 0;
    const add = (b) => { b.id = bodies.length; b.key = `b${b.id}`; bodies.push(b); return b; };
    for (let i = 0; i < nPlanets + 1; i++) {
      const angle = rnd() * TAU;
      if (i === beltAt) {
        const [m, v] = C.YIELD.belt;
        add({ kind: 'belt', name: `${name} Belt`, ring: ring++, parent: null, slot: 0, angle, m: pip(m, 'm'), v: pip(v, 'v'), trait: null, art: { seed: Math.floor(rnd() * 9973) } });
        continue;
      }
      const zone = ZONES[Math.min(ZONES.length - 1, Math.floor((planets / nPlanets) * ZONES.length))];
      const type = pickW(zone, rnd());
      const r = Math.round(SIZE[type][0] + rnd() * (SIZE[type][1] - SIZE[type][0]));
      const [m, v] = C.YIELD.planet[type];
      const p = add({
        kind: 'planet', name: `${name} ${ROMAN[planets]}`, ring: ring++, parent: null, slot: 0, angle, m: pip(m, 'm'), v: pip(v, 'v'), trait: null,
        art: { type, r, ring: rnd() < (type === 'gas' || type === 'blue' ? 0.45 : 0.1), ringTilt: -0.35 + (rnd() - 0.5) * 0.5, seed: Math.floor(rnd() * 9973) },
      });
      planets++;
      const [lo, hi] = MOONS[type];
      const nm = lo + Math.floor(rnd() * (hi - lo + 1));
      for (let k = 0; k < nm; k++) {
        const mt = pickW(MOON_TYPES, rnd());
        const [mm, mv] = C.YIELD.moon[mt];
        add({ kind: 'moon', name: `${p.name}${'abc'[k]}`, ring: p.ring, parent: p.key, slot: k, angle: rnd() * TAU, m: pip(mm, 'm'), v: pip(mv, 'v'), trait: null, art: { type: mt, r: Math.round(55 + rnd() * 35), seed: Math.floor(rnd() * 9973) } });
      }
    }
    if (nebula) {
      const type = terms.hazard === 'ion' ? 'ion' : NEBULA_TYPES[Math.floor(rnd() * NEBULA_TYPES.length)];
      const [m, v] = C.YIELD.nebula;
      add({ kind: 'nebula', name: `${namer(rnd)()} Nebula`, ring: ring++, parent: null, slot: 0, angle: rnd() * TAU, m: pip(m, 'm'), v: pip(v, 'v'), trait: null, art: { type, seed: Math.floor(rnd() * 9973) } });
    }
    const gate = add({ kind: 'gate', name: 'Gate site', ring: ring++, parent: null, slot: 0, angle: -Math.PI / 2 + (rnd() - 0.5) * 0.6, m: 0, v: 0, trait: null, art: { seed: Math.floor(rnd() * 9973) } });

    // Traits: the forced ones first, then a third of the rest of the bodies, among those whose culture is here.
    const slots = bodies.filter((b) => b.kind !== 'gate');
    const open = (list) => list.filter((b) => !b.trait);
    const allowed = Object.entries(C.TRAITS).filter(([, t]) => !t.culture || has(t.culture)).map(([id]) => id);
    for (const id of terms.traits || []) {
      const free = open(slots);
      if (free.length) free[Math.floor(rnd() * free.length)].trait = id;
    }
    const nTraits = Math.round(slots.length * (0.25 + rnd() * 0.15)) - (terms.traits || []).length;
    for (let i = 0; i < nTraits && allowed.length; i++) {
      const free = open(slots);
      if (!free.length) break;
      // Traits favour the bodies poor in what they're for, so the choice costs something.
      free[Math.floor(rnd() * free.length)].trait = allowed[Math.floor(rnd() * allowed.length)];
    }
    // Every system has something to mine and something to siphon.
    if (!slots.some((b) => b.m >= 2)) slots.find((b) => b.kind === 'belt' || b.kind === 'planet').m = 2;
    if (!slots.some((b) => b.v >= 2)) slots.filter((b) => b.kind === 'planet').pop().v = 2;

    // Something in this system's sky (deep-space art, drawn far off): a cluster, a disc, a remnant.
    const sky = SKY[Math.floor(rnd() * SKY.length)];
    const distance = terms.distance || 'mid', depth = terms.depth || 0, H = C.HORIZON;
    const life = Math.round(Math.max(H.min, H.life[distance] - H.perDepth * depth * (terms.ease ?? 1)) * (terms.lifeMul || 1));
    return {
      seed: s, name, depth, distance, rich, hazard: terms.hazard || null, cultures, star, sky, life, pull0: H.pull0[distance],
      rings: ring, gate: gate.key, bodies,
    };
  }

  // The systems a jump offers: one near, one mid, one far by default (the far ones poorer or more
  // hazardous), each with its own seed, richness and hazard. o: { count (3, 4 with the scanner),
  // cultures (present in all), hazards (allowed ids), names }.
  function choices(seed, depth, o = {}) {
    const rnd = mulberry32(hashInt(seedToInt(seed), depth + 1, 0xc401));
    const count = o.count || 3, hazards = o.hazards ?? Object.keys(C.HAZARDS).filter((h) => !C.HAZARDS[h].culture || (o.cultures || []).includes(C.HAZARDS[h].culture));
    const dists = ['near', 'mid', 'far', ['near', 'mid', 'far'][Math.floor(rnd() * 3)]].slice(0, count);
    const riches = ['m', 'v', null, 'poor'];
    return dists.map((distance, i) => {
      const hazardChance = distance === 'far' ? 0.75 : distance === 'mid' ? 0.45 : 0.25;
      const hazard = hazards.length && rnd() < hazardChance ? hazards[Math.floor(rnd() * hazards.length)] : null;
      const rich = distance === 'far' ? (rnd() < 0.5 ? 'poor' : riches[Math.floor(rnd() * 3)]) : riches[Math.floor(rnd() * 3)];
      return { seed: hashInt(seedToInt(seed), depth * 7 + i, 0x5157) % 1e9, depth: depth + 1, distance, rich, hazard, cultures: o.cultures || ['android'] };
    });
  }

  function group(system, key) {
    const b = system.bodies.find((x) => x.key === key);
    if (!b) return [];
    const root = b.parent || b.key;
    return system.bodies.filter((x) => x.key === root || x.parent === root).map((x) => x.key);
  }

  return { generate, choices, group, NAMES: SYLL, SKY };
})();

export { SimWorld };
