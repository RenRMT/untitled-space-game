// The screen's pixel density, for every canvas the game draws. Phones report 2–3 device pixels per
// CSS pixel; drawing every one of them costs fill rate (the full-screen layers: background,
// nebulae, star glow) and sprite memory, both growing with the square of the ratio. So the
// full-screen canvases draw at most 2 device pixels per CSS pixel, and on touch screens at most 1.5,
// which still looks sharp at phone sizes and draws about half the pixels of 2.
//
//   Display.dpr()      the ratio for full-screen canvases (flight view, map) and the art drawn on them
//   Display.uiDpr()    for small canvases in the panels (portraits): at most 2
//   Display.touch()    a touch screen (phone or tablet): the sprite caches keep less (art/render.js)
// ES module (`Display`); in Node (no window) the ratio is 1.

const Display = (() => {
  const CAP = 2, TOUCH_CAP = 1.5;
  const raw = () => (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  const touch = () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  return {
    dpr: () => Math.min(raw(), touch() ? TOUCH_CAP : CAP),
    uiDpr: () => Math.min(raw(), CAP),
    touch,
  };
})();

export { Display };
