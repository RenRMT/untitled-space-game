// Small maths helpers every module shares: a full turn, clamping, interpolation, easing, distance
// and angles.
//   TAU                      a full turn in radians
//   clamp(v, lo, hi)         v kept within [lo, hi]
//   lerp(a, b, t)            from a (t = 0) to b (t = 1)
//   smoothstep(e0, e1, x)    0 below e0, 1 above e1, eased in and out between
//   dist(a, b)               between two points ({ x, y })
//   angleDiff(a, b)          a - b the short way round, in [-PI, PI)
// ES module (`MathUtil`, and each helper by name); also runs in Node (the tests).

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const angleDiff = (a, b) => ((a - b + Math.PI) % TAU + TAU) % TAU - Math.PI;
const MathUtil = { TAU, clamp, lerp, smoothstep, dist, angleDiff };

export { MathUtil, TAU, clamp, lerp, smoothstep, dist, angleDiff };
