'use strict';

// Seeded random helpers shared by the starfield, the solar system generator, the scene and the art.

// Deterministic 32-bit hash of an integer pair plus a seed.
function hashInt(x, y, s) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(s + 1, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

// Small seeded PRNG returning floats in [0, 1).
function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A system seed (integer or string) as an unsigned 32-bit integer; strings are FNV-1a hashed.
function seedToInt(seed) {
  if (Number.isInteger(seed)) return seed >>> 0;
  let h = 2166136261;
  for (const ch of String(seed)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

// Pick from [[item, weight], ...] with a random number r in [0, 1).
function weightedPick(list, r) {
  const total = list.reduce((sum, [, w]) => sum + w, 0);
  let x = r * total;
  for (const [item, w] of list) if ((x -= w) < 0) return item;
  return list[list.length - 1][0];
}

if (typeof module !== 'undefined') module.exports = { hashInt, mulberry32, seedToInt, weightedPick };
