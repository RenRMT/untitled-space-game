// What lies on a track to pick up, and picking it up. Credit chips run in short trails along the
// racing line (Line): free for flying it well. Salvage crates sit across the track from the line at
// the tightest bends, on the outside of where it runs, so a crate costs the line to take; one rare
// crate, at the tightest bend of all, holds RARE parts. Each crate's part (Career.PARTS) is drawn
// from the biome's leaning (LEAN). It's all from the seed: the same track always has the same
// pickups. Picked up once a race (one missed on lap 1 is still there on lap 2), banked at the finish
// (Career.bank).
// Knocks spill: a rival you knock (Rival.step) may spill credit chips (most often) or a crate's part
// (rarely) on the track just ahead of it; a rival that knocks you may make you spill some of your
// haul, at your feet. Spilled pickups fly out from the ship, can't be taken back by the ship that
// spilled them for DROP.arm s, and are gone DROP.life s after. They're the run's (R.drops), not
// the track's: each race starts clean.
//
//   const P = Pickups.place(tr, L, seed, biome?)   tr: Track.loop's; L: Line.build's (its off, x, y)
//   P: [{ id, kind: 'chip' | 'crate' | 'rare', x, y, r, n (its centreline point), credits, part, parts }]
//   Pickups.haul() -> { credits: 0, parts: {} }   an empty haul
//   Pickups.collect(P, got, haul, x, y, r, now?) -> [pickup]   what a craft of radius r at x, y picks up
//                now (got: a Set of the ids taken this race), into the haul: within GRAB × a pickup's r;
//                spilled ones (with `at`, `until`) only from `at` to `until` (now: the run's R.total)
//   Pickups.loot(rng, biome?) -> { credits, parts }   what a knocked rival spills (DROP.odds of a knock)
//   Pickups.shed(rng, haul) -> { credits, parts }   what you spill from a knock, taken out of haul
//   Pickups.spill(tr, from, what, rng, now, id) -> [pickup]   what spilled as pickups: chips and crates
//     flown out from the ship (from: { x, y, n, ahead: [min, max] units along the track from it to land });
//     id() -> a fresh id; each also { sx, sy, t0, t1 } (where it flew from, and when it left and landed), at, until
//   Pickups.CHIP, CRATE, RARE, TRAILS, CRATES, GRAB, DROP
// ES module (`Pickups`); also runs in Node.

import { mulberry32 } from '../core/rng.js';

const Pickups = (() => {
  const CHIP = { r: 12, credits: 5 }, CRATE = { r: 18, parts: 1 }, RARE = { r: 20, parts: 2, credits: 25 };
  const TRAILS = 6, PER_TRAIL = 5, SPACING = 6, CRATES = 4, CLEAR = 40; // CLEAR: points either side of the start kept empty
  const GRAB = 1.6; // × a pickup's r: how near counts as picked up (drawn smaller than r: Draw.pickups)
  const PARTS = ['coil', 'vane', 'cell', 'plate'];
  // A knock's spill: odds: of a rival spilling when you knock it, or you when one knocks you; part:
  // the odds a rival's spill is a part, not chips; chips: [fewest, most] a rival spills; shed: the share
  // of your credits you spill (in chips of CHIP.credits, at most chips[1] + 2 of them), shedPart: the
  // odds you spill a part too; cool: s before the same ship spills again; arm, life: s (above); fly:
  // s a spill takes to land; spread: × the half-width it lands within either side of the ship.
  const DROP = { odds: 0.45, part: 0.12, chips: [2, 4], shed: 0.2, shedPart: 0.3, cool: 1.5, arm: 0.8, life: 12, fly: 0.35, spread: 0.45 };
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

  // ---------- Spills ----------

  function loot(rng, biome) {
    if (rng() < DROP.part) return { credits: 0, parts: { [partOf(rng, biome)]: 1 } };
    const n = DROP.chips[0] + Math.floor(rng() * (DROP.chips[1] - DROP.chips[0] + 1));
    return { credits: n * CHIP.credits, parts: {} };
  }

  function shed(rng, h) {
    const out = { credits: 0, parts: {} };
    if (h.credits > 0) {
      const chips = Math.min(DROP.chips[1] + 2, Math.max(1, Math.round((h.credits * DROP.shed) / CHIP.credits)));
      out.credits = Math.min(h.credits, chips * CHIP.credits);
      h.credits -= out.credits;
    }
    const held = PARTS.filter((k) => h.parts[k] > 0);
    if (held.length && rng() < DROP.shedPart) {
      const k = held[Math.floor(rng() * held.length)];
      h.parts[k]--; out.parts[k] = 1;
    }
    return out;
  }

  function spill(tr, from, what, rng, now, id) {
    const out = [], S = tr.samples, [a0, a1] = from.ahead;
    const drop = (kind, r, credits, part) => {
      const n = wrap(from.n + Math.round((a0 + (a1 - a0) * rng()) / tr.ds), S), p = tr.pts[n];
      const off = (2 * rng() - 1) * DROP.spread * Math.max(0, p.hw - r);
      out.push({
        id: id(), kind, n, r, x: p.x - p.ty * off, y: p.y + p.tx * off, credits, part, parts: part ? 1 : 0,
        sx: from.x, sy: from.y, t0: now, t1: now + DROP.fly, at: now + DROP.arm, until: now + DROP.life,
      });
    };
    // Chips of CHIP.credits, the last one holding what's left over.
    for (let c = what.credits; c > 0; c -= CHIP.credits) drop('chip', CHIP.r, Math.min(c, CHIP.credits), null);
    for (const [k, m] of Object.entries(what.parts)) for (let i = 0; i < m; i++) drop('crate', CRATE.r, 0, k);
    return out;
  }

  const haul = () => ({ credits: 0, parts: {} });
  function collect(P, got, h, x, y, r, now = 0) {
    const out = [];
    for (const p of P) {
      if (got.has(p.id) || (p.at !== undefined && (now < p.at || now > p.until))) continue;
      const dx = p.x - x, dy = p.y - y, d = p.r * GRAB + r;
      if (dx * dx + dy * dy > d * d) continue;
      got.add(p.id);
      h.credits += p.credits;
      if (p.part) h.parts[p.part] = (h.parts[p.part] || 0) + p.parts;
      out.push(p);
    }
    return out;
  }

  return { CHIP, CRATE, RARE, TRAILS, CRATES, GRAB, LEAN, DROP, place, haul, collect, loot, shed, spill };
})();

export { Pickups };
