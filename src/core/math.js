// Small maths helpers every module shares: a full turn, clamping and linear interpolation.
// ES module (`MathUtil`); also runs in Node (the tests).

const MathUtil = (() => {
  const TAU = Math.PI * 2;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  return { TAU, clamp, lerp };
})();

export { MathUtil };
