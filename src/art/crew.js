// Crew portraits for every culture, built from art/portraits.js parts and marks so they render in
// all four styles. Humans for the three settled cultures and the Drifters, each dressed in its
// culture's design language (Drifters wear gear borrowed from all three); aliens for the alien culture; androids (art/androids.js) for theirs.
// Parts and marks are listed in draw order (a mark before a part is hidden by it).
//
//   ArtCrew.create(seed, culture) -> portrait { seed, culture, pal, items, traits }  (ArtPortraits.draw)
// ES module (`ArtCrew`); needs a browser. Project addition, not in the repo.

import { ArtPortraits } from './portraits.js';
import { ArtAndroids } from './androids.js';
import { ArtUtil } from './util.js';

const ArtCrew = (() => {
  const U = ArtUtil;
  const { part, ell, stroke, mulberry } = ArtPortraits.kit;

  const SKINS = ['#f3d2b6', '#e8b994', '#d29a72', '#b97c55', '#9a603f', '#7a4a30', '#5e3826'];
  const HAIRS = ['#1f1612', '#3a261a', '#5e3a22', '#8a5a30', '#c49a5a', '#e0c890', '#1a1a20', '#7c7c82'];
  const IRIS = ['#3a5a8a', '#4a7a5a', '#5a3a22', '#2a1a12', '#6a8aa0', '#7a6a3a'];

  function base(seed, salt) {
    let h = Math.imul((seed >>> 0) ^ 0x9e3779b9, 0x85ebca6b) ^ salt;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    const r = mulberry((h ^ (h >>> 16)) >>> 0);
    for (let i = 0; i < 3; i++) r();
    const items = [];
    return { r, pick: (a) => a[Math.floor(r() * a.length)], items, P: (mat, o) => items.push(part(mat, o)), M: (m) => items.push(m) };
  }

  // ---------- Humans ----------

  function human(seed, c) {
    const { r, pick, items, P, M } = base(seed, 3);
    const kind = c.lineage === 'kitbash' ? 'drifter' : ['wedge', 'block', 'shard'].includes(c.lineage) ? c.lineage : 'wedge';
    const cp = c.pal, side = r() < 0.5 ? -1 : 1;
    const skin = pick(SKINS);
    const hair = kind === 'shard' && r() < 0.45 ? pick(['#d8dbe6', '#e8e4f0', U.mix(cp.accent, '#ffffff', 0.35), '#2a2238']) : pick(HAIRS);
    const suits = {
      wedge: [U.mix(U.shade(cp.hull2, 0.8), cp.accent, 0.18), U.shade(cp.hull2, 0.5), cp.trim],
      block: [U.mix(cp.hull2, '#5a4a2e', 0.35), U.shade(cp.hull2, 0.55), cp.hull],
      shard: [U.shade(cp.hull2, 0.85), U.mix(cp.panel, cp.accent, 0.35), cp.trim],
      drifter: [pick(['#6a5a44', '#4f5a52', '#5e4a3e', '#55585e', '#6e6250', '#4a5466']), '#2e2a24', pick((c.donors || []).map((d) => d.pal.trim).concat(['#b8ad98']))],
    }[kind];
    // Drifters: who they are, and the borrowed gear that shows it.
    const role = kind === 'drifter' ? pick(['freelancer', 'salvager', 'explorer', 'outlaw']) : null;
    const donorPal = (c.donors && c.donors.length ? pick(c.donors) : c).pal;
    const lampC = kind === 'drifter' ? pick([cp.light, cp.glass, donorPal.accent]) : cp.accent;
    const pal = {
      skin, skin2: U.shade(skin, 0.84), skin3: U.mix(U.shade(skin, 0.68), '#6a2a2a', 0.25), hair, hair2: U.shade(hair, 0.7),
      white: '#eceef0', iris: pick(IRIS), lip: U.mix(U.shade(skin, 0.8), '#9a4a4a', 0.35),
      suit: suits[0], suit2: suits[1], trim: suits[2], accent: cp.accent, metal: '#9aa2ac', dark: '#16191f',
      glass: cp.glass, lamp: lampC, glow: U.mix(lampC, '#ffffff', 0.3), beanie: U.mix(cp.accent, suits[1], 0.45), line: cp.line,
      scarf: pick(['#8a6a4a', '#5a6a5a', '#7a4a3a', '#6a6a7a', U.mix(cp.accent, '#5a5048', 0.4)]), pad: U.mix(donorPal.hull, '#7a7266', 0.3), patch: U.mix(donorPal.accent, '#6a6258', 0.35),
    };

    let hw = 15.5 + r() * 2.5, hh = 20 + r() * 2.5, n = 2.2 + r() * 0.4, taper = 0.72 + r() * 0.12, tw = 36 + r() * 4;
    if (kind === 'shard') { hw -= 1.6; hh += 1.4; taper -= 0.08; n = 2; tw = 32 + r() * 3; }
    if (kind === 'block') { hw += 1.4; n += 0.4; taper = Math.min(0.95, taper + 0.1); tw = 42 + r() * 4; }
    if (kind === 'drifter') tw = 36 + r() * 6;
    const hy = -12, eyeY = hy + hh * 0.06, eyeX = hw * 0.42, noseY = hy + hh * 0.34, mouthY = hy + hh * 0.6, mw = hw * (0.26 + r() * 0.08);
    const nw = hw * 0.46, hairY = hy - hh * (0.48 + r() * 0.14);

    const hairStyles = {
      wedge: ['crop', 'crop', 'part', 'buzz', 'bun', 'long'],
      block: ['buzz', 'crop', 'shaved', 'crop', 'long'],
      shard: ['long', 'undercut', 'undercut', 'bun', 'shaved'],
      drifter: ['crop', 'long', 'part', 'buzz', 'shaved', 'bun', 'mohawk'],
    }[kind];
    const hs = pick(hairStyles);
    const beard = kind === 'block' ? r() < 0.55 : kind === 'drifter' ? r() < 0.4 : kind === 'wedge' ? r() < 0.15 : false;
    const stache = !beard && (kind === 'drifter' || kind === 'block') && r() < 0.35;
    let hat = 'none';
    if (kind === 'wedge') hat = pick(['none', 'none', 'headset', 'headset', 'cap']);
    if (kind === 'block') hat = pick(['none', 'hardhat', 'hardhat', 'beanie', 'goggles']);
    if (kind === 'shard') hat = pick(['none', 'circlet', 'circlet']);
    if (kind === 'drifter') hat = pick({ freelancer: ['none', 'headset', 'cap'], salvager: ['goggles', 'goggles', 'beanie'], explorer: ['hood', 'hood', 'scanner', 'headset'], outlaw: ['none', 'bandana', 'hood'] }[role]);
    const eyeMod = role === 'outlaw' ? pick(['none', 'patch', 'cyber']) : role === 'salvager' && r() < 0.2 ? 'cyber' : 'none';

    // Long hair behind everything
    if (hs === 'long') P('hair2', { cx: 0, cy: hy + hh * 0.35, rx: hw * 1.18, ry: hh * 1.25, n: 2, taper: 0.92, depth: 6, oy: hy });
    if (hat === 'hood') P('scarf', { cx: 0, cy: hy + 3, rx: hw * 1.38, ry: hh * 1.28, n: 2.2, taper: 0.9, depth: 8, oy: hy - 2 });
    if (hat === 'bandana') P('scarf', { cx: side * (hw + 2.5), cy: hy - hh * 0.25, rx: 2.8, ry: 7, n: 2, taper: 0.5, depth: 2 });

    // Body
    P('suit', { cx: 0, cy: 50, rx: tw, ry: 26, n: 3, prof: 4, depth: 14, oy: 42 });
    if (kind === 'wedge') {
      for (const s of [-1, 1]) M(stroke('suit2', [[s * nw * 1.5, 30], [s * tw * 0.55, 58]], 3));
      const ix = side * tw * 0.45;
      M(stroke('accent', [[ix - 3.5, 42], [ix, 38.5], [ix + 3.5, 42]], 1.6));
      M(stroke('accent', [[ix - 3.5, 45.5], [ix, 42], [ix + 3.5, 45.5]], 1.6));
    }
    if (kind === 'block') {
      for (const s of [-1, 1]) P('trim', { cx: s * (tw - 8), cy: 35, rx: 12, ry: 8, n: 3, depth: 6 });
      M(stroke('accent', [[-tw * 0.62, 47], [tw * 0.62, 47]], 3));
      for (const s of [-1, 1]) M(stroke('suit2', [[s * (tw - 14), 31], [s * (tw - 3), 31]], 1.2));
    }
    if (kind === 'shard') {
      M(stroke('trim', [[0, 31], [0, 60]], 0.8));
      M(stroke('accent', [[-side * tw * 0.7, 34], [side * tw * 0.45, 60]], 2.4));
    }
    if (kind === 'drifter') {
      // One borrowed shoulder piece: a Block pad, a Wedge harness or a Shard sash.
      const piece = role === 'salvager' ? 'pad' : pick(['pad', 'harness', 'sash']);
      if (piece === 'pad') { P('pad', { cx: side * (tw - 8), cy: 35, rx: 11, ry: 7.5, n: 2.8, depth: 5 }); for (const k of [0, 1, 2]) M(ell('dark', side * (tw - 14 + k * 5), 34, 0.7, 0.7, { line: 'fill' })); }
      if (piece === 'harness') M(stroke('suit2', [[side * nw * 1.5, 30], [side * tw * 0.55, 58]], 3));
      if (piece === 'sash') M(stroke('patch', [[-side * tw * 0.7, 34], [side * tw * 0.45, 60]], 2.4));
      // A patch sewn on, and the role's kit.
      const px = -side * tw * (0.35 + r() * 0.15), py = 42 + r() * 6;
      P('patch', { cx: px, cy: py, rx: 3.6, ry: 3, n: 4, depth: 1 });
      M(stroke('dark', [[px - 3, py - 2.4], [px + 3, py + 2.4]], 0.5));
      if (role === 'salvager') { M(stroke('dark', [[-side * tw * 0.6, 32], [side * tw * 0.35, 60]], 2.4)); M(ell('metal', side * tw * 0.05, 47, 2, 1.6)); }
      if (role === 'explorer') M(ell('lamp', side * tw * 0.4, 40, 1.4, 1.4, { line: 'fill', glow: true }));
      if (role === 'outlaw') for (const s2 of [-1, 1]) P('suit2', { cx: s2 * nw * 1.4, cy: 33, rx: 4.5, ry: 9, n: 1.6, taper: 0.6, depth: 3 });
    }

    // Collar
    if (kind === 'shard') for (const s of [-1, 1]) P('suit2', { cx: s * (nw + 5), cy: 21, rx: 5, ry: 13, n: 1.3, depth: 4 });
    P('skin2', { cx: 0, cy: hy + hh + 4, rx: nw, ry: 12, n: 2.4, prof: 3, depth: 5, keep: (x, y) => y < 33 });
    if (kind === 'wedge') P('trim', { cx: 0, cy: 29, rx: nw * 1.55, ry: 6, n: 3, depth: 4, keep: (x, y) => y > 25 });
    if (kind === 'block') P('suit2', { cx: 0, cy: 29, rx: nw * 1.9, ry: 7, n: 2.6, depth: 5, keep: (x, y) => y > 24 });
    if (kind === 'shard') P('trim', { cx: 0, cy: 28, rx: nw * 1.3, ry: 5, n: 2.4, depth: 3, keep: (x, y) => y > 25 });
    if (kind === 'drifter') P(hat === 'hood' || role === 'explorer' || r() < 0.4 ? 'scarf' : 'suit2', { cx: 0, cy: 29, rx: nw * 1.8, ry: 7, n: 2, depth: 5, keep: (x, y) => y > 23.5 });

    // Ears, head
    for (const s of [-1, 1]) P('skin2', { cx: s * (hw - 0.5), cy: eyeY + 2.5, rx: 3, ry: 5, n: 2, depth: 2.5 });
    if (hat === 'headset') for (const s of [-1, 1]) if (s === side) P('metal', { cx: s * hw, cy: eyeY + 2.5, rx: 3.6, ry: 5, n: 3, depth: 3 });
    P('skin', { cx: 0, cy: hy, rx: hw, ry: hh, n, taper, depth: hw * 0.85, oy: hy - hh * 0.05 });
    if (role === 'outlaw' && r() < 0.6) M(stroke('skin3', [[-side * hw * 0.55, eyeY - 6], [-side * hw * 0.3, eyeY + 1], [-side * hw * 0.42, noseY + 4]], 0.9));
    if (beard) P('hair', { cx: 0, cy: hy, rx: hw * 1.03, ry: hh * 1.04, n, taper, depth: hw * 0.87, oy: hy + hh * 0.75, keep: (x, y) => y > noseY + 1 + Math.max(0, hw * 0.55 - Math.abs(x)) * 0.25 });
    P('skin', { cx: 0, cy: noseY, rx: 2.3, ry: 4, n: 2, taper: 1.3, depth: 3, lineArc: [0.05, 0.45] });
    if (stache) P('hair', { cx: 0, cy: mouthY - 2.4, rx: mw + 1.6, ry: 1.8, n: 2, depth: 1.5 });

    // Hair on top
    const top = { cx: 0, cy: hy, rx: hw * 1.05, ry: hh * 1.05, n, taper, depth: hw * 0.92, oy: hy - hh * 0.75 };
    if (hs === 'crop' || hs === 'long' || hs === 'bun') P('hair', { ...top, keep: (x, y) => y < hairY + Math.max(0, Math.abs(x) - hw * (hs === 'long' ? 0.4 : 0.55)) * (hs === 'long' ? 3 : 1.4) });
    if (hs === 'part') P('hair', { ...top, keep: (x, y) => y < hairY + side * x * 0.18 + Math.max(0, Math.abs(x) - hw * 0.55) * 1.4 });
    if (hs === 'buzz') P('hair', { ...top, rx: hw * 1.01, ry: hh * 1.01, depth: hw * 0.87, keep: (x, y) => y < hairY + 2 + Math.max(0, Math.abs(x) - hw * 0.6) * 1.2 });
    if (hs === 'mohawk') P('hair', { ...top, rx: hw * 1.08, ry: hh * 1.12, keep: (x, y) => Math.abs(x) < hw * 0.2 && y < hy - hh * 0.25 });
    if (hs === 'undercut') P('hair', { ...top, rx: hw * 1.08, ry: hh * 1.08, keep: (x, y) => y < hairY + (x * side > 0 ? hh * 0.45 : 0) && x * side > -hw * 0.55 });
    if (hs === 'bun') P('hair', { cx: 0, cy: hy - hh - 2.5, rx: 5.5, ry: 4.5, depth: 4 });

    // Headgear
    if (hat === 'cap') {
      P('suit', { cx: 0, cy: hy - hh * 0.62, rx: hw * 1.08, ry: hh * 0.5, n: 2.6, depth: 6, keep: (x, y) => y < hy - hh * 0.5 });
      P('suit2', { cx: 0, cy: hy - hh * 0.5, rx: hw * 1.02, ry: 2.4, n: 3, depth: 2 });
      M(ell('accent', 0, hy - hh * 0.82, 1.9, 1.9, { line: 'fill', glow: true }));
    }
    if (hat === 'headset') {
      M(stroke('dark', [[side * hw * 0.98, eyeY - 1], [side * hw * 0.85, hy - hh * 0.6], [0, hy - hh * 1.02], [-side * hw * 0.85, hy - hh * 0.6]], 1.4));
      M(stroke('metal', [[side * hw, eyeY + 6], [side * hw * 0.62, mouthY + 1.5], [side * mw * 1.1, mouthY + 1.5]], 1.1));
      M(ell('lamp', side * mw * 1.1, mouthY + 1.5, 1, 1, { line: 'fill', glow: true }));
    }
    if (hat === 'hardhat') {
      P('trim', { cx: 0, cy: hy - hh * 0.5, rx: hw * 1.14, ry: hh * 0.62, n: 2, depth: 8, keep: (x, y) => y < hy - hh * 0.42 });
      P('trim', { cx: 0, cy: hy - hh * 0.44, rx: hw * 1.32, ry: 2.2, n: 4, depth: 2 });
      M(stroke('accent', [[0, hy - hh * 1.08], [0, hy - hh * 0.5]], 2.2));
    }
    if (hat === 'beanie') {
      P('beanie', { cx: 0, cy: hy - hh * 0.4, rx: hw * 1.1, ry: hh * 0.75, n: 2.1, depth: hw * 0.95, oy: hy - hh * 0.8, keep: (x, y) => y < hy - hh * 0.4 });
      M(stroke('suit2', [[-hw * 1.02, hy - hh * 0.5], [hw * 1.02, hy - hh * 0.5]], 1.2));
    }
    if (hat === 'goggles' || (hat === 'hardhat' && r() < 0.4)) {
      const gy = hy - hh * 0.38;
      M(stroke('dark', [[-hw * 1.0, gy], [hw * 1.0, gy]], 2.2));
      for (const s of [-1, 1]) { P('metal', { cx: s * eyeX, cy: gy, rx: 3.8, ry: 3.1, n: 2.4, depth: 2.5 }); M(ell('glass', s * eyeX, gy, 2.5, 2, { glow: true })); }
    }
    if (hat === 'circlet') {
      const cy = hy - hh * 0.42;
      M(stroke('metal', [[-hw * 0.98, cy + 2], [0, cy - 1], [hw * 0.98, cy + 2]], 1));
      M(ell('lamp', 0, cy - 1, 1.5, 2.2, { line: 'fill', glow: true }));
    }
    if (hat === 'hood') M(stroke('suit2', [[-hw * 1.2, eyeY + 6], [-hw * 1.05, hy - hh * 0.75], [0, hy - hh * 1.15], [hw * 1.05, hy - hh * 0.75], [hw * 1.2, eyeY + 6]], 1.2));
    if (hat === 'scanner') {
      M(stroke('dark', [[side * hw * 0.98, eyeY - 2], [side * hw * 0.85, hy - hh * 0.6], [0, hy - hh * 1.02], [-side * hw * 0.85, hy - hh * 0.6]], 1.4));
      M(stroke('metal', [[side * hw, eyeY - 1], [side * eyeX, eyeY - 1]], 1));
    }
    if (hat === 'bandana') {
      P('scarf', { cx: 0, cy: hy, rx: hw * 1.06, ry: hh * 1.06, n, taper, depth: hw * 0.95, oy: hy - hh * 0.8, keep: (x, y) => y < hy - hh * 0.36 + Math.max(0, Math.abs(x) - hw * 0.6) * 0.6 });
      for (const k of [-1, 1]) M(ell('white', k * hw * 0.35, hy - hh * 0.65, 0.9, 0.9, { line: 'fill' }));
    }

    // Face
    const brow = (role === 'outlaw' ? 0.6 : kind === 'shard' ? -0.6 : 0) + (r() - 0.5) * 0.8;
    for (const s of [-1, 1]) {
      const x = s * eyeX;
      if (eyeMod === 'patch' && s === side) {
        M(stroke('dark', [[-hw * 0.95, eyeY - 5], [x, eyeY - 1], [hw * 0.95 * s, eyeY + 2]], 1));
        M(ell('dark', x, eyeY, 3.6, 3.2, { line: 'fill' }));
        continue;
      }
      if (eyeMod === 'cyber' && s === side) {
        P('metal', { cx: x, cy: eyeY, rx: 4.2, ry: 4, n: 3, depth: 2.5 });
        M(ell('lamp', x, eyeY, 1.6, 1.6, { line: 'fill', glow: true }));
        continue;
      }
      if (hat === 'scanner' && s === side) {
        P('metal', { cx: x, cy: eyeY, rx: 3.8, ry: 3.6, n: 2.6, depth: 2.5 });
        M(ell('glass', x, eyeY, 2.4, 2.3, { glow: true }));
        M(ell('lamp', x, eyeY, 0.9, 0.9, { line: 'fill', glow: true }));
        continue;
      }
      M(stroke(beard || hs === 'shaved' ? 'hair2' : 'hair', [[x - s * 3.4, eyeY - 4 + brow * 0.6], [x + s * 3, eyeY - 4.4 - brow]], 1.5));
      M(ell('white', x, eyeY, 2.7, 1.6));
      M(ell('iris', x, eyeY, 1.2, 1.25, { line: 'fill' }));
      if (kind === 'shard' && hat !== 'circlet') M(stroke('accent', [[x, eyeY + 2.6], [x + s * 0.6, eyeY + 7]], 0.9, { glow: true }));
    }
    if (kind === 'shard' && hat === 'circlet' && r() < 0.5) M(ell('accent', 0, eyeY - 6, 0.9, 0.9, { line: 'fill', glow: true }));
    const smile = role === 'outlaw' ? (r() - 0.6) * 1.4 : role ? (r() - 0.2) * 1.4 : (r() - 0.3) * 1.2;
    M(stroke('lip', [[-mw, mouthY - smile * 0.4], [0, mouthY + smile * 0.5], [mw, mouthY - smile * 0.4]], 1.3));
    if (kind === 'drifter' && r() < 0.5) M(ell('metal', side * (hw - 0.6), eyeY + 7.5, 1.3, 1.3));

    return { seed, culture: c, pal, items, traits: { kind: 'human', look: kind, role, hair: hs, hat, beard, eye: eyeMod } };
  }

  // ---------- Aliens ----------

  const ALIEN_HEADS = {
    bulb: { hw: [19, 22], hh: [21, 24], hy: -9, n: 2, taper: 0.42 },
    long: { hw: [13.5, 15.5], hh: [25, 28], hy: -14, n: 2.2, taper: 0.55 },
    mantis: { hw: [21, 24], hh: [17, 19], hy: -10, n: 1.8, taper: 0.22 },
    lobed: { hw: [16, 18], hh: [19, 21], hy: -10, n: 2.3, taper: 0.6 },
  };

  function alien(seed, c) {
    const { r, pick, items, P, M } = base(seed, 11);
    const cp = c.pal, lerp = U.lerp;
    const skin = pick([cp.hull, cp.wing || cp.hull, '#5a7a6a', '#6a5a8e', '#8e7a5a', '#4f6a7a', '#7a4a5a']);
    const glowC = pick([cp.glass, cp.light, '#ff6ad5', '#6ad8ff', '#ffd66b']);
    const pal = {
      skin, skin2: U.shade(skin, 0.74), skin3: U.mix(skin, cp.trim, 0.4), eye: U.mix('#0a0d0a', glowC, 0.28), lamp: glowC, glow: U.mix(glowC, '#ffffff', 0.3),
      suit: cp.hull2, suit2: U.shade(cp.hull2, 0.7), trim: cp.trim, accent: cp.accent, dark: '#120a10', line: cp.line,
    };
    const headType = pick(Object.keys(ALIEN_HEADS)), H = ALIEN_HEADS[headType];
    const hw = lerp(...H.hw, r()), hh = lerp(...H.hh, r()), hy = H.hy, n = H.n, taper = H.taper;
    const eyes = headType === 'mantis' ? pick(['almond', 'almond', 'cluster']) : pick(['almond', 'cluster', 'cyclops', 'stalks']);
    const mouth = pick(['none', 'mandibles', 'tendrils', 'slit']);
    const fronds = r() < 0.45, crest = !fronds && r() < 0.4, gills = r() < 0.5, spots = r() < 0.7;
    const eyeY = hy + hh * (headType === 'mantis' ? -0.05 : 0.1), chinY = hy + hh * (0.55 + (1 - taper) * 0.25);
    const tw = 33 + r() * 9;

    // Fronds behind the head
    if (fronds) {
      const k = 2 + Math.floor(r() * 2);
      for (const s of [-1, 1]) for (let i = 0; i < k; i++) {
        const a = -Math.PI / 2 + s * (0.45 + i * 0.38), L = hh * (0.9 + r() * 0.4);
        const x0 = s * hw * 0.4, y0 = hy - hh * 0.6, x1 = x0 + Math.cos(a) * L * 0.6, y1 = y0 + Math.sin(a) * L * 0.6;
        const x2 = x0 + Math.cos(a + s * 0.35) * L, y2 = y0 + Math.sin(a + s * 0.35) * L;
        M(stroke('skin2', [[x0, y0], [x1, y1], [x2, y2]], 2.6 - i * 0.4));
        M(ell('lamp', x2, y2, 1.4, 1.4, { line: 'fill', glow: true }));
      }
    }
    if (eyes === 'stalks') for (const s of [-1, 1]) {
      const tx = s * hw * 0.85, ty = hy - hh - 9;
      M(stroke('skin2', [[s * hw * 0.3, hy - hh * 0.7], [s * hw * 0.6, hy - hh - 3], [tx, ty]], 2.4));
    }

    // Body: a grown mantle with ribs and shoulder lobes
    P('suit', { cx: 0, cy: 52, rx: tw, ry: 26, n: 2.2, prof: 3, depth: 14, oy: 44 });
    for (const s of [-1, 1]) P('suit2', { cx: s * (tw - 9), cy: 36, rx: 10, ry: 8, n: 2, depth: 6 });
    for (let k = 0; k < 3; k++) M(stroke('suit2', [[-tw * 0.4, 40 + k * 5], [0, 43 + k * 5], [tw * 0.4, 40 + k * 5]], 1.3));
    if (r() < 0.6) M(ell('lamp', 0, 37, 2.2, 2.6, { line: 'fill', glow: true }));
    P('skin2', { cx: 0, cy: hy + hh + 6, rx: hw * (headType === 'long' ? 0.32 : 0.24), ry: 15, n: 2, prof: 3, depth: 4, keep: (x, y) => y < 34 });
    P('trim', { cx: 0, cy: 30, rx: hw * 0.7, ry: 5, n: 2, depth: 4, keep: (x, y) => y > 26 });

    // Head
    if (headType === 'lobed') for (const s of [-1, 1]) P('skin', { cx: s * hw * 0.78, cy: hy - hh * 0.45, rx: hw * 0.55, ry: hh * 0.5, n: 2, depth: 8 });
    P('skin', { cx: 0, cy: hy, rx: hw, ry: hh, n, taper, depth: hw * 0.9, oy: hy - hh * 0.15 });
    if (crest) P('skin2', { cx: 0, cy: hy - hh * 0.55, rx: hw * 0.16, ry: hh * 0.6, n: 2, depth: 4, oy: hy - hh * 0.9, keep: (x, y) => y < eyeY - 5 });
    if (headType === 'long') P('skin3', { cx: 0, cy: hy + hh * 0.3, rx: hw * 0.7, ry: hh * 0.55, n: 2, taper, depth: hw * 0.6, keep: (x, y) => y > eyeY + 3 });
    if (spots) {
      const cnt = 2 + Math.floor(r() * 3);
      for (let i = 0; i < cnt; i++) {
        const x = hw * (0.25 + r() * 0.45), y = hy - hh * (0.2 + r() * 0.55), rr = 0.7 + r() * 0.7;
        for (const s of [-1, 1]) M(ell('lamp', s * x, y, rr, rr, { line: 'fill', glow: true }));
      }
    }
    if (gills) for (const s of [-1, 1]) for (let k = 0; k < 3; k++) {
      const x = s * hw * (0.55 - k * 0.04), y = eyeY + 5 + k * 2.6;
      M(stroke('skin2', [[x, y], [x + s * 2.6, y + 1.2]], 1));
    }

    // Eyes
    if (eyes === 'almond') {
      const ex = hw * (headType === 'mantis' ? 0.5 : 0.4), rx = 4.2 + r() * 2, ry = 2.6 + r() * 1.2;
      for (const s of [-1, 1]) {
        P('eye', { cx: s * ex, cy: eyeY, rx, ry, n: 2, taper: 0.7, depth: 2.5 });
        M(ell('lamp', s * (ex - rx * 0.25), eyeY - ry * 0.25, 1.2, 0.9, { line: 'fill', glow: true }));
      }
    }
    if (eyes === 'cluster') {
      const spots2 = [[0.3, 0], [0.55, -0.35], [0.2, -0.55]];
      for (const s of [-1, 1]) for (const [fx, fy] of spots2) {
        const x = s * hw * fx, y = eyeY + hh * fy * 0.5, rr = 1.6 + r() * 1.2;
        M(ell('eye', x, y, rr + 0.8, rr + 0.8));
        M(ell('lamp', x, y, rr * 0.6, rr * 0.6, { line: 'fill', glow: true }));
      }
    }
    if (eyes === 'cyclops') {
      P('eye', { cx: 0, cy: eyeY, rx: 6.5, ry: 6, n: 2, depth: 3.5 });
      M(ell('lamp', 0, eyeY, 0.9, 4.2, { line: 'fill', glow: true }));
    }
    if (eyes === 'stalks') for (const s of [-1, 1]) {
      const tx = s * hw * 0.85, ty = hy - hh - 9;
      P('eye', { cx: tx, cy: ty, rx: 3.6, ry: 3.4, n: 2, depth: 3 });
      M(ell('lamp', tx, ty, 1.4, 1.4, { line: 'fill', glow: true }));
    }

    // Mouth
    if (mouth === 'mandibles') for (const s of [-1, 1]) P('skin3', { cx: s * hw * 0.2, cy: chinY + 3, rx: 2.4, ry: 5, n: 2, taper: 0.3, depth: 2.5 });
    if (mouth === 'tendrils') for (const x of [-4, -1.3, 1.3, 4]) {
      const L = 8 + r() * 6, sw = (r() - 0.5) * 4;
      M(stroke('skin2', [[x, chinY - 1], [x + sw, chinY + L * 0.5], [x - sw * 0.5, chinY + L]], 1.6));
      if (r() < 0.5) M(ell('lamp', x - sw * 0.5, chinY + L, 0.8, 0.8, { line: 'fill', glow: true }));
    }
    if (mouth === 'slit') M(stroke('dark', [[-hw * 0.18, chinY - 2], [0, chinY - 1.2], [hw * 0.18, chinY - 2]], 1));

    return { seed, culture: c, pal, items, traits: { kind: 'alien', head: headType, eyes, mouth, fronds, crest } };
  }

  function create(seed, culture) {
    seed = seed >>> 0 || 1;
    const lin = culture && culture.lineage;
    if (lin === 'android') return ArtAndroids.create(seed, culture);
    if (lin === 'alien') return alien(seed, culture);
    return human(seed, culture);
  }

  return { create };
})();

export { ArtCrew };
