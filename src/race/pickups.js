// What lies on a track to pick up, and picking it up. Credit chips run in short trails along the
// racing line (Line): free for flying it well. Salvage crates sit across the track from the line at
// the tightest bends, on the outside of where it runs, so a crate costs the line to take; one rare
// crate, at the tightest bend of all, holds RARE parts. Each crate's part (Career.PARTS) is drawn
// from the biome's leaning (LEAN). It's all from the seed: the same track always has the same
// pickups. Picked up once a race (one missed on lap 1 is still there on lap 2), banked at the finish
// (Career.bank).
//
//   const P = Pickups.place(tr, L, seed, biome?)   tr: Track.loop's; L: Line.build's (its off, x, y)
//   P: [{ id, kind: 'chip' | 'crate' | 'rare', x, y, r, n (its centreline point), credits, part, parts }]
//   Pickups.haul() -> { credits: 0, parts: {} }   an empty haul
//   Pickups.collect(P, got, haul, x, y, r) -> [pickup]   what a craft of radius r at x, y picks up
//                now (got: a Set of the ids taken this race), into the haul: within GRAB × a pickup's r
//   Pickups.CHIP, CRATE, RARE, TRAILS, CRATES, GRAB
// ES module (`Pickups`); also runs in Node.

import { mulberry32 } from '../core/rng.js';

const Pickups = (() => {
  const CHIP = { r: 12, credits: 5 }, CRATE = { r: 18, parts: 1 }, RARE = { r: 20, parts: 2, credits: 25 };
  const TRAILS = 6, PER_TRAIL = 5, SPACING = 6, CRATES = 4, CLEAR = 40; // CLEAR: points either side of the start kept empty
  const GRAB = 1.6; // × a pickup's r: how near counts as picked up (drawn smaller than r: Draw.pickups)
  const PARTS = ['coil', 'vane', 'cell', 'plate'];
  const LEAN = { desert: 'coil', ice: 'vane', lava: 'plate', moon: 'cell', gas: 'vane', terran: null };
  const wrap = (n, m) => ((n % m) + m) % m;
  const nearStart = (n, S) => n < CLEAR || n > S - CLEAR;

  function partOf(rng, biome) {
    const lean = LEAN[biome], w = PARTS.map((p) => (p === lean ? 3 : 1)), all = w.reduce((a, b) => a + b, 0);
    let x = rng() * all;
    for (let i = 0; i < PARTS.length; i++) if ((x -= w[i]) < 0) return PARTS[i];
    return PARTS[PARTS.length - 1];
  }

  function place(tr, L, seed, biome) {
    const S = tr.samples, rng = mulberry32(seed * 2654435761 + 977), out = [];
    // Crates at the tightest bends, a spread apart; the tightest of them the rare one.
    const bends = tr.pts.map((p, n) => ({ n, k: Math.abs(p.k) })).filter((b) => !nearStart(b.n, S)).sort((a, b) => b.k - a.k);
    const picked = [];
    for (const b of bends) {
      if (picked.length > CRATES) break;
      if (picked.every((q) => Math.min(wrap(q - b.n, S), wrap(b.n - q, S)) > S / 10)) picked.push(b.n);
    }
    picked.forEach((n, i) => {
      const p = tr.pts[n], rare = i === 0, r = rare ? RARE.r : CRATE.r;
      const side = L.off[n] > 0 ? -1 : 1, off = side * Math.max(0, p.hw - 2 * r); // across from the line
      const part = partOf(rng, biome);
      out.push({
        id: `${rare ? 'rare' : 'crate'}${n}`, kind: rare ? 'rare' : 'crate', n, r,
        x: p.x - p.ty * off, y: p.y + p.tx * off,
        credits: rare ? RARE.credits : 0, part, parts: rare ? RARE.parts : CRATE.parts,
      });
    });
    // Chip trails along the line, spread round the lap, clear of the start and the crates.
    const len = PER_TRAIL * SPACING;
    for (let t = 0; t < TRAILS; t++) {
      const from = wrap(Math.floor(((t + 0.15 + 0.7 * rng()) * S) / TRAILS), S);
      for (let j = 0; j < PER_TRAIL; j++) {
        const n = wrap(from + j * SPACING, S);
        if (nearStart(n, S) || picked.some((q) => Math.min(wrap(q - n, S), wrap(n - q, S)) < len / 2)) continue;
        out.push({ id: `chip${n}`, kind: 'chip', n, r: CHIP.r, x: L.x[n], y: L.y[n], credits: CHIP.credits, part: null, parts: 0 });
      }
    }
    return out;
  }

  const haul = () => ({ credits: 0, parts: {} });
  function collect(P, got, h, x, y, r) {
    const out = [];
    for (const p of P) {
      if (got.has(p.id)) continue;
      const dx = p.x - x, dy = p.y - y, d = p.r * GRAB + r;
      if (dx * dx + dy * dy > d * d) continue;
      got.add(p.id);
      h.credits += p.credits;
      if (p.part) h.parts[p.part] = (h.parts[p.part] || 0) + p.parts;
      out.push(p);
    }
    return out;
  }

  return { CHIP, CRATE, RARE, TRAILS, CRATES, GRAB, LEAN, place, haul, collect };
})();

export { Pickups };
