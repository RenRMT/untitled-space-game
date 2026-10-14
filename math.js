'use strict';

// Small maths helpers every module shares: a full turn, clamping and linear interpolation.
// Works as a classic browser script (global `MathUtil`) and as a Node module.

const MathUtil = (() => {
  const TAU = Math.PI * 2;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  return { TAU, clamp, lerp };
})();

if (typeof module !== 'undefined') module.exports = MathUtil;
