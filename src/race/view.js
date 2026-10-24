// Where the race puts the craft on screen: the camera's lead (its focus ahead of the craft, world
// units) held so the craft stays in sight, and the focus's height.
// - Without a band: the lead held to `reach` of the screen's shorter side, the focus 0.55 down.
// - With a band (the stick's, along the bottom of a portrait screen; Input.home): the focus sits
//   higher (BOX.anchor) and the lead is held so the craft is drawn in a box above the band. Flying
//   up, the craft rests just above the thumb with most of the screen ahead; flying down, it rises
//   toward the top, so the track ahead is never under the thumb.
//
//   View.frame({ W, H, lx, ly, zoom, ct, band, reach }) -> { lx, ly, oy }
//     W, H: the screen (CSS px); lx, ly: the lead (world units); zoom: px a world unit; ct: the
//     cosine of the view's tilt (a world unit's height on screen); band: its share of H (0: none)
// ES module (`View`); also runs in Node (the tests).

const View = (() => {
  const BOX = { anchor: 0.42, x: [0.18, 0.82], top: 0.16, gap: 40 }; // gap: px between the craft and the band
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  function frame({ W, H, lx, ly, zoom, ct, band = 0, reach }) {
    if (!band) {
      const l = Math.hypot(lx, ly) * zoom, f = Math.min(1, (reach * Math.min(W, H)) / (l || 1));
      return { lx: lx * f, ly: ly * f, oy: H * 0.55 };
    }
    const oy = H * BOX.anchor;
    const sx = clamp(W / 2 - lx * zoom, W * BOX.x[0], W * BOX.x[1]), sy = clamp(oy - ly * zoom * ct, H * BOX.top, H * (1 - band) - BOX.gap);
    return { lx: (W / 2 - sx) / zoom, ly: (oy - sy) / (zoom * ct), oy };
  }

  return { frame, BOX };
})();

export { View };
