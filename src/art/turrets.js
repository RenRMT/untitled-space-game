// Stationary turrets: a missile turret and a gun turret (lasers, plasma, kinetic) for each culture,
// built from the same culture parts kit as the ship equipment (art/equipment.js) and drawn like
// stations (banded ink in Low-poly, hatched hairlines in Line).
//
// One design serves two places:
// - in orbit round a planet, beside the stations, against the sky;
// - on a planet's surface (art/surface.js), whose cameras are the assets' own (Line straight down,
//   Low-poly tilted Art.config.tilt), so drawing the blueprint at a tile's projected ground point
//   stands it on the ground.
// So the base is a radially symmetric footing with anchor pods (station-keeping pods with nav
// lights in orbit, footings with beacons on the ground), nothing that only makes sense in one
// place (no engines, solar wings or legs), and the head sits at the centre facing +x. The game aims
// a turret by turning the whole blueprint (drawAsset's `angle`): the base looks the same at any angle.
// The whole turret fits inside one surface tile at about 2.5 tile units per blueprint unit
// (SURFACE_SCALE) and then stands about 20 units tall, under the flight altitude (ArtSurface.FLY).
//
//   ArtTurrets.KINDS                       -> [{ id: 'missile' | 'gun', name, sub }]
//   ArtTurrets.create(kind, culture, seed) -> blueprint (type 'station-turret'; kind, label)
//   ArtTurrets.SURFACE_SCALE               -> surface units per blueprint unit on a planet's surface
//
// ES module (`ArtTurrets`); also runs in Node (the tests).

import { ArtBlueprints } from './blueprints.js';
import { ArtEquipment } from './equipment.js';
import { ArtUtil } from './util.js';
import { hashInt, mulberry32 } from '../core/rng.js';

const ArtTurrets = (() => {
  const U = ArtUtil, B = ArtBlueprints, { TAU } = U;
  const polar = (r, a) => [Math.cos(a) * r, Math.sin(a) * r];

  const KINDS = [
    { id: 'missile', name: 'Missile turret', sub: 'twin launcher pods' },
    { id: 'gun', name: 'Gun turret', sub: 'barrels for laser, plasma or kinetic' },
  ];
  const SURFACE_SCALE = 2.5;

  // The footing: anchor pods on struts round a round base with a turning collar. Machine and
  // built cultures stand on four; Shard and Alien on three.
  function base(b, K, c) {
    const f = c.lineage === 'kitbash' ? 'kitbash' : c.hull;
    const n = f === 'shard' || f === 'bio' ? 3 : 4, a0 = n === 4 ? TAU / 8 : TAU / 4;
    for (let i = 0; i < n; i++) {
      const a = a0 + (i / n) * TAU, [x0, y0] = polar(4.6, a), [x1, y1] = polar(7.6, a), [px, py] = polar(8.4, a);
      K.strut(x0, y0, x1, y1, 1.3, 'hull2', { lvl: 0.5, h: 1.4 });
      K.tank(px, py, 1.6, 'hull2', { lvl: 0.6, h: 1.8 });
      b.light(...polar(9.6, a), 0.5, K.light, { blink: i * 1.1 });
    }
    K.round(0, 0, 6.4, 'hull', { lvl: 1, h: 2.2, bevel: 1 });
    K.round(0, 0, 5.2, 'trim', { lvl: 1.5, h: 0.4 });
  }

  const HEAD = {
    // Two launcher pods either side of a sensor housing, tube mouths facing forward and up.
    missile: (b, K) => {
      K.box(-1, 0, 6.8, 5.6, 'hull', { lvl: 2, h: 2.4, bevel: 0.8 });
      for (const s of [1, -1]) {
        const d = K.box(0.8, s * 4.4, 9, 3.6, 'hull2', { lvl: 2.2, h: 2.4, bevel: 0.5, sensor: false });
        const f = K.fam(d), sq = f === 'block' || f === 'synth';
        for (const x of [-2.2, 0.8, 3.8]) {
          if (sq) {
            b.poly(U.rect(x, s * 4.4, 2, 2), 'dark', { lvl: 2.6, h: 0.2, line: true });
            b.poly(U.rect(x + 0.2, s * 4.4, 1, 1), 'accent', { lvl: 2.7, h: 0.4, line: false });
          } else {
            b.circle(x, s * 4.4, 1.05, 'dark', { lvl: 2.6, h: 0.2 });
            b.circle(x + 0.15, s * 4.4, 0.55, 'accent', { lvl: 2.7, h: 0.4, dome: true, line: false });
          }
        }
      }
      K.core(-2, 0, 1.3, { lvl: 2.8, h: 0.5 });
      b.poly(U.rect(2.2, 0, 1, 4.6), 'accent', { lvl: 2.8, h: 0.3, line: false });
    },
    // A turret head with a mantlet and barrels: twin barrels, or one long lance for Shard.
    gun: (b, K, c) => {
      const lance = c.hull === 'shard' && c.lineage !== 'kitbash';
      K.box(4, 0, 6, 5.2, 'hull2', { lvl: 2.2, h: 1.6, bevel: 0.5, sensor: false });
      if (lance) K.barrel(-1, 14, 0, 2.4, 'hull2', { lvl: 2.4, h: 1.4 });
      else for (const s of [1, -1]) {
        const d = K.barrel(-1, 12.4, s * 1.6, 1.3, 'hull2', { lvl: 2.4, h: 1.2 });
        const f = K.fam(d);
        if (f !== 'synth' && f !== 'bio') K.box(11.8, s * 1.6, 1.2, 2, 'trim', { lvl: 2.5, h: 1.4, sensor: false }, 0, d);
      }
      K.round(-0.8, 0, 4.4, 'hull', { lvl: 2.6, h: 2.4, bevel: 0.9 });
      K.core(-1.4, 0, 1.5, { lvl: 3, h: 0.6 });
      b.poly(U.rect(1.6, 0, 0.8, 4.2), 'accent', { lvl: 3, h: 0.3, line: false });
      b.light(-4.2, 0, 0.45, K.light, { blink: 0.5 });
    },
  };

  // Drifters: plates in donor colours and scorch on the footing, a strap across it.
  function kitbashFinish(b, c, r) {
    const big = b.bp.parts.find((p) => p.shape === 'poly' && p.mat !== 'glass' && Math.abs(U.area(p.pts)) > 80);
    if (!big) return;
    B.addPatches(b, c, r, big.pts, 1.8, 3);
    b.strut(-3.4, -6.6, -2.6, 6.6, 0.7, '#3a3530', { lvl: big.lvl + 0.3, h: 2.5, thin: true });
  }

  function create(kind, culture, seed = 1) {
    const head = HEAD[kind];
    if (!head) throw new Error(`Unknown turret: ${kind}`);
    const s = seed >>> 0;
    const r = mulberry32(hashInt(s, 17, kind.length * 131 + kind.charCodeAt(0)));
    const b = B.builder('station-turret', culture, s);
    const K = ArtEquipment.kit(b, culture, r);
    base(b, K, culture);
    head(b, K, culture);
    if (culture.lineage === 'kitbash') kitbashFinish(b, culture, r);
    b.bp.line = culture.pal.line;
    const t = KINDS.find((k) => k.id === kind);
    Object.assign(b.bp, {
      id: `turret:${kind}:${culture.lineage}:${culture.seed ?? 0}:${s}`,
      kind, label: `Turret · ${t.name}`,
    });
    return B.finish(b.bp);
  }

  return { KINDS, SURFACE_SCALE, create };
})();

export { ArtTurrets };
