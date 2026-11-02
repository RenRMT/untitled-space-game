// The deep-space sites (world/deep-space.js) in the flight view. A site is not one picture: the
// kinds span from an 800-unit rock to a 190,000-unit crowd of stars, and the flight view shows
// about a thousand units across. So each kind takes one of five forms (FORM, notes/galaxy.md):
//
//   body   one thing, at the size of a star or planet: a pulsar's core (its beam sweeps tens of
//          thousands of units), a Cepheid, a black hole, an interstellar object
//   place  several things laid out like a small system: an open cluster's stars, a brown dwarf
//          and its moons, a young star in its disc of rocks, a white dwarf's debris ring
//   area   flown through, drawn at its true size under everything: an H II region's glow (and the
//          O and B stars it holds), a dark cloud, a remnant's shell, a Wolf–Rayet's bubble,
//          the core's accretion disc and jets
//   sky    too big to be anything but backdrop: the core's crowd of stars, a globular's, the
//          dwarf galaxy's (game/starfield.js draws them, from crowds())
//   map    only on the galaxy map: the stellar stream round the halo
//
// Entities made here (flight/entities.js draws them):
//   { kind: 'deep', key, name, sub, color, look, x, y, radius, extent, labelled?, motion? }
//       look 'site' (art/sites.js: siteData, artR, part, reach; site for its phase), 'star', 'planet'
//       or 'moon' (body). radius: how big it is to tap and approach; extent: how far its drawing
//       reaches (a beam, a jet, a disc), for culling.
//   { kind: 'deep-area', key, site, siteData, artR, part: 'area', x, y, radius }
//   { kind: 'nebula', ... } as a system's (flight/scene.js), for the H II regions and clouds
// Rocks (in a young disc, a debris ring, a kilonova's shell) come lazily, like a system's: lazy
// lists the sites that have them, and rocks(site) makes their asteroids (keys `d<id>.a<n>`).
//
//   DeepSites.FORM                         kind -> form
//   DeepSites.build(galaxy) -> { entities, lazy: [{ site, rocks: () => [asteroid data] }] }
//   DeepSites.crowds(galaxy) -> [{ x, y, r, a, k, tint }]   the sky's crowds: a Plummer profile of
//                                          core radius a, strength k, out to r
//   DeepSites.crowdAt(crowds, x, y) -> { k: 0..1, tint }
// ES module (`DeepSites`); also runs in Node (the tests).

import { ArtSites } from '../art/sites.js';
import { hashInt, mulberry32, seedToInt, weightedPick } from '../core/rng.js';
import { DeepSpace } from '../world/deep-space.js';

const DeepSites = (() => {
  const TAU = Math.PI * 2;

  const FORM = {
    'variable-star': 'body', pulsar: 'body', 'neutron-star': 'body', magnetar: 'body', 'stellar-black-hole': 'body',
    'recurrent-nova': 'body', 'interstellar-object': 'body', 'hypervelocity-star': 'body',
    'open-cluster': 'place', 'brown-dwarf': 'place', 'rogue-planet': 'place', 'protoplanetary-disc': 'place',
    'white-dwarf': 'place', microquasar: 'place', 'wolf-rayet': 'place', 'kilonova-remnant': 'place',
    'hii-region': 'area', 'molecular-cloud': 'area', 'bok-globule': 'area', 'supernova-remnant': 'area', smbh: 'area',
    'globular-cluster': 'sky', 'nuclear-cluster': 'sky', 'satellite-galaxy': 'sky',
    'stellar-stream': 'map',
  };

  // Art radii in flight, world units, for the kinds whose drawing is not their reach: chosen so
  // their cores sit among a system's stars (400–600) and planets (140–420).
  const ART_R = {
    'variable-star': 1500, pulsar: 1400, 'neutron-star': 1400, magnetar: 2400, 'stellar-black-hole': 3000,
    'recurrent-nova': 2500, 'interstellar-object': 500, 'hypervelocity-star': 1500,
    'wolf-rayet-core': 3500, 'white-dwarf': 1800, 'white-dwarf-core': 2500,
  };
  // Star sizes by class, as a system's (world/solar-system.js), with the hot ones bigger.
  const STAR_R = { O: 700, B: 560, A: 500, F: 470, G: 450, K: 470, M: 420 };
  const SHORT_LABEL = { O: 'O-type', B: 'B-type', A: 'A-type', F: 'F-type', G: 'G-type', K: 'K-type giant', M: 'M-type giant' };

  // The sky's crowds: where the backdrop fills with stars.
  const CROWD = {
    'nuclear-cluster': { a: 0.32, k: 1, tint: '#ffe2a8' },
    'globular-cluster': { a: 0.2, k: 0.9, tint: '#ffd9a0' },
    'satellite-galaxy': { a: 0.45, k: 0.7, tint: '#d8d0ff' },
    'open-cluster': { a: 0.7, k: 0.3, tint: '#cfe0ff' },
  };

  const labelOf = (kind) => DeepSpace.KINDS[kind].label;
  const colorOf = (kind) => DeepSpace.KINDS[kind].color;

  function build(galaxy) {
    const sites = galaxy.sites || [];
    const entities = [], lazy = [];
    const rngOf = (s, salt) => mulberry32(hashInt(s.seed >>> 0, s.id, salt));
    const inside = (s) => (s.parent !== undefined ? ` in ${sites[s.parent].name}` : '');

    // A thing drawn by art/sites.js: art is the site's data at its flight art radius.
    const siteBody = (s, o) => {
      const artR = o.artR, siteData = { ...s, r: artR, ...o.art };
      return {
        kind: 'deep', key: o.key || `d${s.id}`, look: 'site', site: s, siteData, artR, part: o.part, reach: o.reach,
        name: o.name || s.name, sub: o.sub || `${labelOf(s.kind)}${inside(s)}`, color: colorOf(s.kind),
        radius: o.radius, extent: o.extent || artR, labelled: o.labelled ?? true, x: s.x, y: s.y,
        motion: s.path ? { type: 'path', site: s } : undefined,
      };
    };
    const area = (s, artR = s.r) => ({ kind: 'deep-area', key: `d${s.id}.area`, site: s, siteData: { ...s, r: artR }, artR, part: 'area', radius: artR, x: s.x, y: s.y });
    const star = (s, key, cls, x, y, name) => ({
      kind: 'deep', key, look: 'star', body: { r: STAR_R[cls], cls, seed: seedToInt(key) % 997, rays: 8 },
      name, sub: `${SHORT_LABEL[cls]} star in ${s.name}`, color: colorOf(s.kind), radius: STAR_R[cls] * 1.2, extent: STAR_R[cls] * 3.2, labelled: false, x, y,
    });
    const nebula = (s, type) => ({
      kind: 'nebula', key: `d${s.id}.neb`, site: s, radius: s.r, x: s.x, y: s.y,
      nebula: { name: s.name, type, color: colorOf(s.kind) },
      cloud: { type, seed: s.seed, x: s.x - s.r, y: s.y - s.r, w: s.r * 2, h: s.r * 2, scale: Math.round(s.r / 7), blobs: s.blobs.map((b) => ({ x: s.x + b.dx, y: s.y + b.dy, r: b.r })) },
    });

    for (const s of sites) {
      const r = rngOf(s, 0x51e5), first = entities.length;
      switch (s.kind) {
        // ---------- Bodies ----------
        case 'variable-star': entities.push(siteBody(s, { artR: ART_R[s.kind], radius: 500 })); break;
        case 'pulsar': {
          const R = ART_R.pulsar;
          entities.push(siteBody(s, { artR: R, radius: 200, reach: s.reach / (R * 0.98), extent: s.reach, sub: `${s.millisecond ? 'Millisecond pulsar' : 'Pulsar'}${inside(s)}` }));
          break;
        }
        case 'neutron-star': entities.push(siteBody(s, { artR: ART_R[s.kind], radius: 200, art: { axis: r() * TAU } })); break;
        case 'magnetar': entities.push(siteBody(s, { artR: ART_R[s.kind], radius: 340, art: { axis: r() * TAU } })); break;
        case 'stellar-black-hole': {
          const R = ART_R[s.kind];
          entities.push(siteBody(s, { artR: R, radius: R * (s.mass === 'heavy' ? 0.2 : 0.14) * 1.3, sub: `Black hole · ${s.mass === 'heavy' ? 'heavy' : 'light'}` }));
          break;
        }
        case 'recurrent-nova': entities.push(siteBody(s, { artR: ART_R[s.kind], radius: 600 })); break;
        case 'interstellar-object': entities.push(siteBody(s, { artR: ART_R[s.kind], radius: 200, extent: 700, sub: `Interstellar object · ${s.form}` })); break;
        case 'hypervelocity-star': entities.push(siteBody(s, { artR: ART_R[s.kind], radius: 580, art: { heading: Math.atan2(s.path.vy, s.path.vx) } })); break;

        // ---------- Places ----------
        case 'open-cluster':
          s.members.forEach((m, i) => entities.push(star(s, `d${s.id}.s${i}`, m.cls, s.x + m.dx, s.y + m.dy, `${s.name} ${i + 1}`)));
          break;
        case 'brown-dwarf': {
          const br = 520 + Math.round(r() * 120);
          entities.push({
            kind: 'deep', key: `d${s.id}`, look: 'planet', body: { r: br, type: `dwarf-${s.cls}`, ring: false, ringTilt: 0, seed: s.seed % 9973 },
            name: s.name, sub: `Brown dwarf · class ${s.cls}`, color: colorOf(s.kind), radius: br * 1.1, extent: br * 2, labelled: true, x: s.x, y: s.y,
          });
          for (let i = 0; i < s.moons; i++) {
            const a = r() * TAU, d = 1800 + i * 1200 + r() * 500, mr = 60 + Math.round(r() * 30);
            entities.push(moon(s, `d${s.id}.m${i}`, r() < 0.5 ? 'ice' : 'dark', mr, s.x + Math.cos(a) * d, s.y + Math.sin(a) * d, `${s.name} ${'ab'[i]}`));
          }
          break;
        }
        case 'rogue-planet': {
          const pr = 200 + Math.round(r() * 60);
          entities.push({
            kind: 'deep', key: `d${s.id}`, look: 'planet', body: { r: pr, type: `rogue-${s.type}`, ring: false, ringTilt: 0, seed: s.seed % 9973 },
            name: s.name, sub: `Rogue planet · ${s.type === 'ice' ? 'ice world' : 'dark world'}${s.ocean ? ', an ocean under the ice' : ''}`, color: colorOf(s.kind),
            radius: pr * 1.1, extent: pr * 2, labelled: true, x: s.x, y: s.y,
          });
          if (s.moon) {
            const a = r() * TAU, d = 900 + r() * 500;
            entities.push(moon(s, `d${s.id}.m0`, s.type === 'ice' ? 'ice' : 'dark', 55 + Math.round(r() * 25), s.x + Math.cos(a) * d, s.y + Math.sin(a) * d, `${s.name} a`));
          }
          break;
        }
        case 'protoplanetary-disc':
          entities.push(siteBody(s, { artR: s.r, radius: s.r * 0.13, extent: s.r }));
          lazy.push({ site: s, rocks: () => discRocks(s, s.r, 'young') });
          break;
        case 'white-dwarf':
          if (s.planetaryNebula) {
            entities.push(area(s, s.ring / 0.62));
            entities.push(siteBody(s, { artR: ART_R['white-dwarf-core'], part: 'core', radius: 330, sub: 'White dwarf · planetary nebula' }));
          } else {
            const R = ART_R['white-dwarf'];
            entities.push(siteBody(s, { artR: R, radius: R * 0.22 * 1.3, sub: s.debris ? 'White dwarf · debris ring' : 'White dwarf' }));
            if (s.debris) lazy.push({ site: s, rocks: () => discRocks(s, R, 'debris') });
          }
          break;
        case 'microquasar': {
          const R = s.r;
          entities.push(siteBody(s, { artR: R, radius: R * 0.3, reach: s.jetReach / (R * 0.82), extent: s.jetReach }));
          break;
        }
        case 'wolf-rayet':
          entities.push(area(s));
          entities.push(siteBody(s, { artR: ART_R['wolf-rayet-core'], part: 'core', radius: ART_R['wolf-rayet-core'] * 0.17 * 1.3 }));
          break;
        case 'kilonova-remnant':
          entities.push(area(s));
          lazy.push({ site: s, rocks: () => shellRocks(s) });
          break;

        // ---------- Areas ----------
        case 'hii-region': {
          entities.push(nebula(s, 'emission'));
          // The young hot stars lighting it, in its biggest blob.
          const b = s.blobs[0];
          for (let i = 0, n = 2 + Math.floor(r() * 2); i < n; i++) {
            const a = r() * TAU, d = b.r * (0.15 + r() * 0.45);
            entities.push(star(s, `d${s.id}.s${i}`, i ? 'B' : 'O', s.x + b.dx + Math.cos(a) * d, s.y + b.dy + Math.sin(a) * d, `${s.name} ${'ABC'[i]}`));
          }
          break;
        }
        case 'molecular-cloud': entities.push(nebula(s, 'dust')); break;
        case 'bok-globule': case 'supernova-remnant': entities.push(area(s)); break;
        case 'smbh': {
          // The disc and jets at their true size; the horizon is what is tapped.
          const e = siteBody(s, { artR: s.r, part: 'area', radius: s.r * 0.12 * 1.2, reach: s.jetReach / (s.r * 1.02), extent: s.jetReach });
          entities.push(e);
          break;
        }
        case 'globular-cluster': {
          // The crowd is sky; its brightest giants are stars to fly past.
          for (let i = 0, n = 6 + Math.floor(r() * 4); i < n; i++) {
            const u = 0.05 + r() * 0.6, d = Math.min(s.r * 0.8, (s.r * 0.2) / Math.sqrt(Math.pow(u, -2 / 3) - 1)), a = r() * TAU;
            entities.push(star(s, `d${s.id}.s${i}`, r() < 0.6 ? 'K' : 'M', s.x + Math.cos(a) * d, s.y + Math.sin(a) * d, `${s.name} ${i + 1}`));
          }
          break;
        }
        default: break; // sky and map only
      }
      for (let i = first; i < entities.length; i++) entities[i].form = FORM[s.kind];
    }
    return { entities, lazy };

    function moon(s, key, type, mr, x, y, name) {
      return { kind: 'deep', key, look: 'moon', body: { type, r: mr, seed: seedToInt(key) % 9973 }, name, sub: `Moon of ${s.name}`, color: colorOf(s.kind), radius: mr * 1.3, extent: mr * 1.5, labelled: false, x, y };
    }
    // Rocks lying in a disc (art/sites.js discOf, at the art radius R the site is drawn at): a
    // young disc's rocks icy outside and rocky in, a debris ring's what is left of its planets.
    function discRocks(s, R, which) {
      const d = ArtSites.discOf({ ...s, r: R }, R), r = rngOf(s, 0x40c5), out = [];
      const n = which === 'young' ? 26 + Math.floor(r() * 14) : 10 + Math.floor(r() * 7);
      for (let i = 0, tries = 0; i < n && tries < n * 20; tries++) {
        const u = r(), rho = d.rIn * 1.12 + (d.rOut * 0.97 - d.rIn * 1.12) * u;
        if (d.inGap(rho) || d.gaps.some(([g, w]) => Math.abs(rho - g) < w * 2.2)) continue;
        const [x, y] = d.at(rho, r() * TAU);
        const type = which === 'debris' ? weightedPick([['stony', 2], ['metal', 2], ['carbon', 1]], r())
          : u < 0.35 ? weightedPick([['stony', 2], ['metal', 1]], r()) : u < 0.7 ? weightedPick([['stony', 1], ['carbon', 2]], r()) : weightedPick([['ice', 3], ['carbon', 1]], r());
        const size = which === 'debris' ? 8 + r() ** 2 * 22 : 8 + r() ** 2.2 * 38;
        out.push(rock(s, i++, type, size, s.x + x, s.y + y, r));
      }
      return out;
    }
    // A kilonova's debris: heavy metal-rich rocks strewn through its shell.
    function shellRocks(s) {
      const r = rngOf(s, 0x6b11), out = [];
      for (let i = 0, n = 10 + Math.floor(r() * 7); i < n; i++) {
        const a = r() * TAU, d = s.r * 0.8 * (0.55 + r() * 0.4);
        out.push(rock(s, i, 'metal', 14 + r() ** 1.6 * 36, s.x + Math.cos(a) * d, s.y + Math.sin(a) * d, r));
      }
      return out;
    }
    function rock(s, i, type, size, x, y, r) {
      return { key: `d${s.id}.a${i}`, type, r: size, seed: Math.floor(r() * 1e9), spin0: r() * TAU, tumble: (r() - 0.5) * 0.6, x, y };
    }
  }

  function crowds(galaxy) {
    return (galaxy.sites || []).filter((s) => CROWD[s.kind]).map((s) => {
      const C = CROWD[s.kind];
      return { x: s.x, y: s.y, r: s.r, a: s.r * C.a, k: C.k, tint: C.tint };
    });
  }
  // How crowded the sky is at a point: the strongest crowd's Plummer profile, fading to nothing at
  // its edge.
  function crowdAt(list, x, y) {
    let k = 0, tint = null;
    for (const c of list) {
      const d = Math.hypot(x - c.x, y - c.y);
      if (d >= c.r) continue;
      const v = c.k * Math.pow(1 + (d / c.a) ** 2, -1.25) * Math.min(1, ((c.r - d) / (c.r * 0.15)));
      if (v > k) { k = v; tint = c.tint; }
    }
    return { k: Math.min(1, k), tint };
  }

  return { FORM, build, crowds, crowdAt };
})();

export { DeepSites };
