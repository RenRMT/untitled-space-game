// The racing line and its speed profile: where a fast lap runs across the track, and how fast it can
// go at each point, for rivals (rival.js) and medal times.
//
// The line is the centreline moved sideways, an offset per point along the way out (−ty, tx), held
// `margin` inside the track's edge. It's found by relaxing: each point is pulled toward where its
// neighbours would have it for the least bending (−1, 4, 4, −1 of the two either side, over 6), with a
// little of their midpoint (`length`: the shorter way); coarse first (neighbours far apart round the
// loop), then finer, so the whole loop settles in a few hundred passes. Out wide, in to the apex and
// out wide again follows.
// The speed profile: at each point the fastest the grip holds the line's bend at (v² = grip × r,
// grip: Handling's GRIP × the acceleration), then held to what the craft can reach from the point
// before (the engine pushes at the full acceleration up to top speed) and can brake down from in
// time for the point after (BRAKE × the acceleration, × BRAKE here to leave room). Its lap time is a lap flown perfectly.
//
//   const L = Line.build(tr, { stats, handling, r, margin?, length? })
//     stats: { maxSpeed, accel } (the race's); handling: Handling's config (a run's R.tune.handling); r: the craft's radius
//   L: { off: [], x: [], y: [], k: [], v: [], time }   per centreline point: the offset (+: the way
//     out, −ty, tx), where the line is, its curvature, the speed; time: a lap at those speeds (s)
//   Line.ride(tr, off, stats, handling) -> { x, y, k, v, time }   the same for any offsets (a rival's own line)
//   Line.lim(tr, margin) -> []   the furthest a line may be off the centreline at each point
//   Line.MARGIN   × the craft's radius a line keeps inside the edge
// ES module (`Line`); also runs in Node.

const Line = (() => {
  const PASSES = [[48, 120], [24, 120], [12, 120], [6, 120], [3, 160], [1, 200]]; // [neighbour spacing, passes]
  const LENGTH = 0.02, MARGIN = 1.5, BRAKE = 0.8, SPAN = 3; // SPAN: points either side the line's curvature is measured over
  const wrap = (n, m) => ((n % m) + m) % m;
  const lim = (tr, margin) => tr.pts.map((p) => Math.max(0, p.hw - margin));

  function build(tr, { stats, handling, r, margin = MARGIN * r, length = LENGTH }) {
    const { pts, samples: S } = tr, off = new Float64Array(S), x = new Float64Array(S), y = new Float64Array(S);
    const most = lim(tr, margin);
    const place = (i) => { const p = pts[i]; x[i] = p.x - p.ty * off[i]; y[i] = p.y + p.tx * off[i]; };
    for (let i = 0; i < S; i++) place(i);
    for (const [h, passes] of PASSES) {
      for (let pass = 0; pass < passes; pass++) {
        for (let i = 0; i < S; i++) {
          const a = wrap(i - 2 * h, S), b = wrap(i - h, S), c = (i + h) % S, d = (i + 2 * h) % S;
          const bx = (4 * (x[b] + x[c]) - x[a] - x[d]) / 6, by = (4 * (y[b] + y[c]) - y[a] - y[d]) / 6;
          const tx = bx + ((x[b] + x[c]) / 2 - bx) * length, ty = by + ((y[b] + y[c]) / 2 - by) * length;
          const p = pts[i];
          off[i] = Math.max(-most[i], Math.min(most[i], off[i] + ((tx - x[i]) * -p.ty + (ty - y[i]) * p.tx) * 0.5));
          place(i);
        }
      }
    }
    return { off, ...ride(tr, off, stats, handling) };
  }

  // A line's points, curvature (by the circle through a point and those SPAN either side), speeds
  // and lap time, for any offsets (a rival's own line).
  function ride(tr, off, stats, handling) {
    const { pts, samples: S } = tr, x = new Float64Array(S), y = new Float64Array(S), k = new Float64Array(S);
    for (let i = 0; i < S; i++) { const p = pts[i]; x[i] = p.x - p.ty * off[i]; y[i] = p.y + p.tx * off[i]; }
    for (let i = 0; i < S; i++) {
      const a = wrap(i - SPAN, S), c = (i + SPAN) % S;
      const ax = x[a] - x[i], ay = y[a] - y[i], cx = x[c] - x[i], cy = y[c] - y[i];
      const cross = ax * cy - ay * cx, la = Math.hypot(ax, ay), lc = Math.hypot(cx, cy), lac = Math.hypot(x[c] - x[a], y[c] - y[a]);
      k[i] = la && lc && lac ? Math.abs(2 * cross) / (la * lc * lac) : 0;
    }
    const v = profile(x, y, k, stats, handling);
    let time = 0;
    for (let i = 0; i < S; i++) { const j = (i + 1) % S; time += Math.hypot(x[j] - x[i], y[j] - y[i]) / ((v[i] + v[j]) / 2); }
    return { x, y, k, v, time };
  }

  // The speeds: the grip's limit, then passes forward (accelerating) and back (braking) round the
  // loop until nothing changes; twice round each way is enough, as the slowest bend sets the rest.
  function profile(x, y, k, stats, H) {
    const S = k.length, top = stats.maxSpeed, a = stats.accel, grip = H.GRIP * a, dec = H.BRAKE * a * BRAKE;
    const v = new Float64Array(S), ds = (i, j) => Math.hypot(x[j] - x[i], y[j] - y[i]);
    for (let i = 0; i < S; i++) v[i] = Math.min(top, Math.sqrt(grip / Math.max(k[i], 1e-6)));
    for (let round = 0; round < 2; round++) {
      for (let s = 1; s <= S; s++) {
        const i = s % S, h = s - 1;
        v[i] = Math.min(v[i], Math.sqrt(v[h] * v[h] + 2 * a * ds(h, i)));
      }
      for (let s = S - 1; s >= 0; s--) { const j = (s + 1) % S; v[s] = Math.min(v[s], Math.sqrt(v[j] * v[j] + 2 * dec * ds(s, j))); }
    }
    return v;
  }

  return { build, ride, lim, MARGIN };
})();

export { Line };
