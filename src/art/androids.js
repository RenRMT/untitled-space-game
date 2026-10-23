// Android portraits: seeded robot head-and-shoulders busts built from the parts and marks of
// art/portraits.js, so ArtPortraits.draw renders them in all four styles. A culture
// (art/culture.js) tints the suit and, half the time, the lamps.
//
//   ArtAndroids.create(seed, culture?) -> portrait { seed, culture, pal, items, traits }
//                                         (pass it to ArtPortraits.draw)
//   ArtAndroids.FACES, HEADS              the face and head shapes there are
// ES module (`ArtAndroids`); needs a browser.

import { ArtPortraits } from './portraits.js';
import { ArtUtil } from './util.js';

const ArtAndroids = (() => {
  const U = ArtUtil;
  const { lerp } = U;
  const { part, ell, stroke, mulberry } = ArtPortraits.kit;

  // [name, colour, shiny]
  const PLATES = [['chrome', '#c4ccd6', 1], ['ceramic', '#e9e6df', 1], ['gunmetal', '#5f6872', 0], ['brass', '#c09658', 1], ['matte black', '#3a3d45', 0], ['copper', '#b5714a', 1], ['olive drab', '#7b8763', 0], ['signal red', '#a8403a', 0]];
  const GLOWS = ['#ff4d4d', '#ffb84a', '#7df9ff', '#6aff8a', '#c77dff', '#ff6ad5'];
  const HEADS = { dome: { n: 2.2, taper: 0.82 }, box: { n: 4.6, taper: 1 }, capsule: { n: 2.7, taper: 0.95, w: 0.86, h: 1.08 }, wedge: { n: 3.4, taper: 0.5 }, facet: { n: 1.7, taper: 0.85, w: 1.08 } };
  const FACES = ['visor', 'twin', 'twin', 'mono', 'slits', 'quad'];
  const MOUTHS = ['grille', 'speaker', 'seam', 'none'];
  const SIDES = ['ears', 'antenna', 'fins', 'bolts', 'none'];
  const TOPS = ['none', 'none', 'antenna', 'fin', 'dome', 'ridge'];
  const MARKS = ['none', 'seams', 'rivets', 'crack', 'stripe'];
  const DEFAULT_PAL = { hull: '#c3cbd5', hull2: '#7a8696', trim: '#e6ecf2', glass: '#7df9ff', accent: '#7df9ff', line: '#7df9ff' };

  function create(seed, culture) {
    seed = seed >>> 0 || 1;
    const r = mulberry(seed * 13 + 5), pick = (a) => a[Math.floor(r() * a.length)];
    const cp = (culture && culture.pal) || DEFAULT_PAL;
    // The Android culture's own crew keep its machine palette: neutral plates, the culture's light.
    const own = culture && culture.lineage === 'android';
    const [plateName, plate, shiny] = pick(own ? PLATES.filter((p) => /chrome|ceramic|gunmetal|black/.test(p[0])) : PLATES);
    const glow = r() < 0.5 ? cp.accent : pick(GLOWS), lampBase = own ? cp.light || cp.accent : glow;
    const shell = shiny ? 'shell' : 'plate';
    const pal = {
      plate, shell: plate, plate2: U.shade(plate, 0.74), frame: U.mix(U.shade(plate, 0.55), '#20242b', 0.4),
      dark: U.mix(U.shade(plate, 0.3), '#0c0e12', 0.55), metal: '#8e959e', visor: U.mix('#0b141b', lampBase, 0.22),
      lamp: lampBase, glow: U.mix(lampBase, '#ffffff', 0.3),
      suit: U.mix(U.shade(cp.hull2, 0.8), cp.accent, 0.12), suit2: U.shade(cp.hull2, 0.55), trim: cp.trim, accent: cp.accent, line: cp.line,
    };
    const headType = pick(Object.keys(HEADS)), H = HEADS[headType];
    const hw = (17.5 + r() * 4) * (H.w || 1), hh = (21 + r() * 3.5) * (H.h || 1), hy = -11, n = H.n, taper = H.taper;
    const eyeY = hy + hh * r() * 0.12, eyeX = hw * (0.38 + r() * 0.08), er = 2.6 + r() * 1.2;
    const face = pick(FACES), mouth = face === 'mono' && r() < 0.4 ? 'none' : pick(MOUTHS);
    const sides = pick(SIDES), top = sides === 'antenna' ? pick(['none', 'fin', 'dome', 'ridge']) : pick(TOPS), mark = pick(MARKS);
    const mouthY = hy + hh * (0.55 + r() * 0.1), mouthW = hw * (0.28 + r() * 0.16), smile = (r() - 0.4) * 1.2;
    const lidT = pick([-1.4, 0, 0, 0.9, 1.6]), fpMat = r() < 0.6 && face !== 'visor' ? pick(['frame', 'plate2']) : null;
    const pads = r() < 0.6, chest = pick(['core', 'vents', 'stripe', 'none']);
    const tw = 37 + r() * 8, side = r() < 0.5 ? -1 : 1, faceMat = fpMat || shell;
    const items = [], marks = [];
    const P = (mat, o) => items.push(part(mat, o));
    const M = (m) => marks.push(m);
    const lens = (x, y, rr) => { P('dark', { cx: x, cy: y, rx: rr + 1.4, ry: rr + 1.4, depth: 2 }); M(ell('lamp', x, y, rr, rr, { line: 'fill', glow: true })); };

    // Body
    P('suit', { cx: 0, cy: 50, rx: tw, ry: 26, n: 3, prof: 4, depth: 14, oy: 42 });
    if (pads) for (const s of [-1, 1]) P(shell, { cx: s * (tw - 9), cy: 34, rx: 11, ry: 7, n: 2.6, depth: 5 });
    if (chest === 'core') { P('frame', { cx: 0, cy: 43, rx: 5, ry: 5, depth: 2 }); M(ell('lamp', 0, 43, 3, 3, { line: 'fill', glow: true })); }
    if (chest === 'vents') for (let k = 0; k < 3; k++) M(stroke('suit2', [[side * tw * 0.55, 39 + k * 3.4], [side * tw * 0.28, 39 + k * 3.4]], 1.4));
    if (chest === 'stripe') M(stroke('accent', [[side * tw * 0.38, 31], [side * tw * 0.38, 52]], 4));
    const nw = hw * (0.3 + r() * 0.12);
    P('frame', { cx: 0, cy: hy + hh + 5, rx: nw, ry: 14, n: 4, prof: 4, depth: 5, keep: (x, y) => y < 31 });
    for (let k = 0; k < 4; k++) { const y = hy + hh + 2.5 + k * 3.2; if (y < 25) M(stroke('dark', [[-nw * 0.85, y], [nw * 0.85, y]], 1.1)); }
    P('suit2', { cx: 0, cy: 28, rx: Math.max(nw * 1.6, hw * 0.55), ry: 7, n: 3, depth: 4, oy: 30, keep: (x, y) => y > 23 });

    // Behind the head
    if (sides === 'ears') for (const s of [-1, 1]) { P('plate2', { cx: s * (hw + 1), cy: eyeY + 2, rx: 4, ry: 6.5, n: 2.5, depth: 3 }); P('frame', { cx: s * (hw + 2.6), cy: eyeY + 2, rx: 1.8, ry: 3.6, depth: 1.5 }); }
    if (sides === 'fins') for (const s of [-1, 1]) P('plate2', { cx: s * (hw + 0.5), cy: hy - hh * 0.15, rx: 3.2, ry: hh * 0.55, n: 2.2, taper: 0.5, depth: 2.5 });
    if (sides === 'bolts') for (const s of [-1, 1]) P('metal', { cx: s * (hw + 0.3), cy: eyeY + 3, rx: 3, ry: 3, n: 4, depth: 2 });
    if (sides === 'antenna') {
      const ax = side * (hw + 1.5);
      P('metal', { cx: ax, cy: hy - hh * 0.4, rx: 0.9, ry: hh * 0.75, n: 4, depth: 1 });
      P('lamp', { cx: ax, cy: hy - hh * 1.15, rx: 2, ry: 2, depth: 1.5 });
      M(ell('lamp', ax, hy - hh * 1.15, 1.1, 1.1, { line: 'fill', glow: true }));
      P('plate2', { cx: side * (hw + 0.5), cy: eyeY + 1, rx: 3.5, ry: 5, depth: 2.5 });
    }
    if (top === 'antenna') {
      P('metal', { cx: 0, cy: hy - hh, rx: 0.9, ry: 7, n: 4, depth: 1 });
      P('lamp', { cx: 0, cy: hy - hh - 7, rx: 2.2, ry: 2.2, depth: 1.5 });
      M(ell('lamp', 0, hy - hh - 7, 1.2, 1.2, { line: 'fill', glow: true }));
    }

    // Head
    P(shell, { cx: 0, cy: hy, rx: hw, ry: hh, n, taper, depth: hw * 0.9, oy: hy - hh * 0.15 });
    if (top === 'antenna') P('plate2', { cx: 0, cy: hy - hh + 0.5, rx: 3.5, ry: 2.5, depth: 1.5 });
    if (top === 'fin') P('plate2', { cx: 0, cy: hy - hh * 0.55, rx: hw * 0.16, ry: hh * 0.62, n: 2, depth: 4, oy: hy - hh * 0.9, keep: (x, y) => y < hy - hh * 0.15 });
    if (top === 'dome') P('visor', { cx: 0, cy: hy - hh * 0.82, rx: hw * 0.5, ry: hh * 0.32, n: 2, depth: 5, keep: (x, y) => y < hy - hh * 0.72 });
    if (top === 'ridge') P('plate2', { cx: 0, cy: hy, rx: hw * 1.02, ry: hh * 1.03, n, taper, depth: hw * 0.92, oy: hy - hh * 0.7, keep: (x, y) => Math.abs(x) < hw * 0.13 && y < eyeY - er - 3 });
    if (fpMat) P(fpMat, { cx: 0, cy: hy + hh * 0.18, rx: hw * 0.8, ry: hh * 0.74, n, taper, depth: hw * 0.55, oy: eyeY + 2, keep: (x, y) => y > eyeY - er - 4 });

    // Face
    if (face === 'visor') {
      P('visor', { cx: 0, cy: eyeY, rx: hw * 0.9, ry: er + 1.6, n: 3.6, depth: 3 });
      M(stroke('lamp', [[-hw * 0.62, eyeY], [hw * 0.62, eyeY]], 1.4, { glow: true }));
      M(ell('lamp', side * hw * 0.3, eyeY, 2.4, 1.5, { line: 'fill', glow: true }));
    }
    if (face === 'twin') for (const s of [-1, 1]) {
      lens(s * eyeX, eyeY, er);
      M(ell('dark', s * eyeX, eyeY, er * 0.38, er * 0.38, { line: 'skip' }));
      if (lidT) M(stroke(faceMat, [[s * (eyeX - er * 1.4), eyeY - er * 0.75 + lidT], [s * (eyeX + er * 1.4), eyeY - er * 0.75 - lidT * 0.6]], 2.4));
    }
    if (face === 'mono') {
      P('dark', { cx: 0, cy: eyeY + 1, rx: er + 3.5, ry: er + 3.5, depth: 3 });
      M(ell('metal', 0, eyeY + 1, er + 1.8, er + 1.8));
      M(ell('lamp', 0, eyeY + 1, er + 0.6, er + 0.6, { line: 'fill', glow: true }));
      M(ell('dark', side * 0.6, eyeY + 1, er * 0.4, er * 0.4, { line: 'skip' }));
    }
    if (face === 'slits') for (const s of [-1, 1]) {
      P('dark', { cx: s * eyeX, cy: eyeY, rx: er * 1.5, ry: er * 0.75, n: 3.5, depth: 1.5 });
      M(stroke('lamp', [[s * (eyeX - er), eyeY + lidT * 0.35], [s * (eyeX + er), eyeY - lidT * 0.35]], 1.3, { glow: true }));
    }
    if (face === 'quad') for (const s of [-1, 1]) { lens(s * eyeX, eyeY, er * 0.85); lens(s * eyeX * 0.5, eyeY - er * 1.9, er * 0.5); }

    // Mouth
    if (mouth === 'grille') {
      P('metal', { cx: 0, cy: mouthY, rx: mouthW, ry: 3.2, n: 4, depth: 1.5 });
      const cnt = mouthW > 7 ? 5 : 4;
      for (let k = 0; k < cnt; k++) { const x = lerp(-mouthW * 0.65, mouthW * 0.65, k / (cnt - 1)); M(stroke('dark', [[x, mouthY - 1.8], [x, mouthY + 1.8]], 0.9)); }
    }
    if (mouth === 'speaker') {
      P('frame', { cx: 0, cy: mouthY, rx: 4, ry: 4, depth: 1.5 });
      for (const [dy, w] of [[-1.7, 2], [0, 2.8], [1.7, 2]]) M(stroke('dark', [[-w, mouthY + dy], [w, mouthY + dy]], 0.8));
    }
    if (mouth === 'seam') M(stroke('dark', [[-mouthW, mouthY - smile * 0.5], [0, mouthY + smile * 0.5], [mouthW, mouthY - smile * 0.5]], 1.1));

    // Surface marks
    if (mark === 'seams') {
      M(stroke('frame', [[-hw * 0.7, hy - hh * 0.42], [0, hy - hh * 0.5], [hw * 0.7, hy - hh * 0.42]], 0.7));
      M(stroke('frame', [[0, hy - hh * 0.95], [0, hy - hh * 0.5]], 0.7));
    }
    if (mark === 'rivets') for (const s of [-1, 1]) for (const y of [hy - hh * 0.55, hy + hh * 0.3]) M(ell('metal', s * hw * 0.66, y, 0.9, 0.9, { line: 'fill' }));
    if (mark === 'crack') { const s = -side; M(stroke('dark', [[s * hw * 0.3, hy - hh * 0.8], [s * hw * 0.45, hy - hh * 0.55], [s * hw * 0.35, hy - hh * 0.4], [s * hw * 0.55, hy - hh * 0.15]], 0.8)); }
    if (mark === 'stripe') M(stroke('accent', [[-hw * 0.75, hy - hh * 0.42], [hw * 0.75, hy - hh * 0.42]], 2.6));

    return {
      seed, culture: culture || null, pal, items: items.concat(marks),
      traits: { plate: plateName, head: headType, face, mouth, sides, top, mark, chest, pads },
    };
  }

  return { create, FACES, HEADS: Object.keys(HEADS) };
})();

export { ArtAndroids };
