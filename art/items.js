'use strict';

// Item blueprints (low-poly `h` is relative to whatever part lies under the centroid; rings are absolute):
// salvaged components and trade goods, drawn by art/render.js in all four styles.
// Items are culture-neutral. Each item type (goods.js) has its own colour: components are
// salvage tinted toward it, with their accents, lights and outline in it; trade goods are drawn
// in it while their containers stay neutral. Every category has its own shapes; a component
// type names the variant it uses.
//
//   ArtItems.create(typeId, seed) -> blueprint (type 'item'; kind, category 'loot' | 'trade', rarity, label)
//
// Works as a classic browser script (global `ArtItems`) and as a Node module.

const ArtItems = (() => {
  const isNode = typeof require === 'function' && typeof module !== 'undefined';
  const U = isNode ? require('./util.js') : ArtUtil;
  const B = isNode ? require('./blueprints.js') : ArtBlueprints;
  const { mulberry32, hashInt } = isNode ? require('../rng.js') : globalThis;
  const G = isNode ? require('../goods.js') : Goods;
  const { TAU } = U;

  // Rounded rectangle; consecutive duplicate points are dropped so low-poly roofs stay star-shaped.
  function rrect(cx, cy, w, h, rad, a = 0, n = 3) {
    rad = Math.min(rad, w / 2, h / 2);
    const qx = w / 2 - rad, qy = h / 2 - rad, out = [];
    [[qx, qy], [-qx, qy], [-qx, -qy], [qx, -qy]].forEach(([x, y], q) => {
      for (let i = 0; i <= n; i++) {
        const t = (q + i / n) * (TAU / 4);
        out.push([x + Math.cos(t) * rad, y + Math.sin(t) * rad]);
      }
    });
    const pts = out.filter((p, i) => { const o = out[(i + 1) % out.length]; return Math.hypot(p[0] - o[0], p[1] - o[1]) > 1e-4; });
    return pts.map((p) => U.add(U.rot(p, a), [cx, cy]));
  }
  const polar = (r, a) => [Math.cos(a) * r, Math.sin(a) * r];
  const radial = (r0, r1, w, a) => U.rect((r0 + r1) / 2 * Math.cos(a), (r0 + r1) / 2 * Math.sin(a), r1 - r0, w, a);
  const jit = (r, k = 0.08) => 1 - k + r() * k * 2;

  // ---------- Palettes ----------

  const LOOT_PAL = {
    hull: '#a7adb6', hull2: '#5d636d', trim: '#d3d7dd', glass: '#7df9ff', light: '#ffcf5a', flame: '#ffb347',
    panel: '#2f4a3c', accent: '#ffb547', line: '#ffc864', copper: '#c9824a', dark: '#1c2028',
  };
  const CONTAINER = { hull: '#8c939d', hull2: '#4e545d', trim: '#c4c9d0', panel: '#2e343d', light: '#7df9ff', flame: '#ffb347', accent: '#c4c9d0', rock: '#5e5850' };

  // The outline colour (line style) of an item in colour [h, s, l]: bright enough to read on the
  // dark background. Greys stay grey rather than being pushed into a hue, and keep their relative
  // lightness (lightness 0.3..0.95 maps onto 0.55..0.95), so light greys stay apart.
  function lineOf([h, s, l]) {
    if (s < 0.2) return U.fromHsl(h, s, 0.55 + (Math.min(0.95, Math.max(0.3, l)) - 0.3) * (0.4 / 0.65));
    return U.tune(U.mix(U.fromHsl(h, s, l), '#ffffff', 0.2), { s: [0.45, 1], l: [0.62, 0.8] });
  }

  // Trade goods: the goods in the type's colour, containers neutral.
  function goodsPal([h, s, l]) {
    const good = U.fromHsl(h, s, l);
    return {
      ...CONTAINER,
      good,
      good2: U.shade(good, 0.68),
      goodHi: U.mix(good, '#ffffff', 0.3),
      goodAlt: U.fromHsl((h + 38) % 360, s, l * 0.95),
      glass: s < 0.2 ? U.mix(good, '#dff6ff', 0.4) : U.tune(good, { s: [0.6, 1], l: [0.55, 0.68] }),
      line: lineOf([h, s, l]),
    };
  }

  // Components: salvage tinted toward the type's colour, with accents, glass, lights and the
  // outline in it, so each type reads as its own colour in every style.
  function lootPal([h, s, l]) {
    const c = U.fromHsl(h, s, l);
    return {
      ...LOOT_PAL,
      hull: U.mix(LOOT_PAL.hull, c, 0.4),
      hull2: U.mix(LOOT_PAL.hull2, c, 0.35),
      trim: U.mix(LOOT_PAL.trim, c, 0.25),
      accent: c,
      light: U.tune(c, { l: [0.62, 0.75] }),
      glass: s < 0.2 ? U.mix(c, '#dff6ff', 0.35) : U.tune(c, { s: [0.55, 1], l: [0.55, 0.7] }),
      panel: U.mix(c, '#1c2028', 0.72),
      line: lineOf([h, s, l]),
    };
  }

  // ---------- Loot ----------

  const LOOT_BUILD = {
    hull: [
      ['Armour plate', (b, r) => {
        const e = [[8, -6], [6.4 + r(), -3], [8.4, -0.6], [5.6 + r(), 2], [7.4, 4.4], [5, 6]];
        b.poly([[-8, -6], ...e, [-8, 6]], 'hull', { lvl: 1, h: 1.6, bevel: 0.8, lines: [[-3, -6, -3, 6], [-8, 0.5, 4, 0.5]] });
        b.poly(U.rect(-5.5, 3.6, 4, 1.4), 'accent', { lvl: 2, h: 0.3, line: false });
        for (const [x, y] of [[-7, -5], [-7, 5], [5, -5]]) b.circle(x, y, 0.5, 'trim', { lvl: 2, h: 0.4, line: false });
        b.poly(U.blob(5.4, 0.5, 2.6, 3.6, r, 0.4, 8), 'scorch', { lvl: 3, overlay: true });
      }],
      ['Hull rib', (b) => {
        const cy = 12.4, a0 = -TAU / 4 - 0.62, a1 = -TAU / 4 + 0.62;
        b.poly(U.sector(0, cy, 11.6, 3.6, a0 + 0.08, a1 - 0.08, 8), 'hull', { lvl: 0.5, h: 1.2, lines: [[-3, -1.6, -3, 2], [3, -1.6, 3, 2]] });
        b.poly(U.sector(0, cy, 15, 3.2, a0, a1, 8), 'hull2', { lvl: 1, h: 2.2, bevel: 0.8 });
        for (const d of [-0.45, 0, 0.45]) {
          const a = -TAU / 4 + d, [x0, y0] = polar(9.6, a), [x1, y1] = polar(16.6, a);
          b.strut(x0, y0 + cy, x1, y1 + cy, 1.2, 'trim', { lvl: 2, h: 0.8 });
        }
      }],
      ['Bulkhead hatch', (b) => {
        b.poly(rrect(0, 0, 15, 15, 2.5), 'hull', { lvl: 1, h: 2, bevel: 0.8 });
        b.ring(0, 0, 4.6, 1.6, 'trim', { lvl: 2, h: 2.4 });
        b.circle(0, 0, 3.8, 'hull2', { lvl: 1.5, h: 0.3, lines: [[-3.8, 0, 3.8, 0], [0, -3.8, 0, 3.8]] });
        b.poly(U.rect(0, 0, 1.1, 5.4, 0.6), 'accent', { lvl: 3, h: 0.5 });
        for (const [x, y] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) b.circle(x * 5.8, y * 5.8, 0.6, 'trim', { lvl: 2, h: 0.4 });
      }],
    ],
    weapon: [
      ['Railgun barrel', (b) => {
        b.strut(-2, 0, 9, 0, 1.8, 'hull2', { lvl: 0.8, h: 1.6 });
        for (const x of [1.5, 4, 6.5]) b.poly(U.rect(x, 0, 1, 3.2), 'trim', { lvl: 1.2, h: 0.6 });
        b.poly(U.rect(9.6, 0, 1.4, 2.8), 'hull2', { lvl: 1.3, h: 2 });
        b.poly(U.rect(-5, 3.6, 2.4, 2.4), 'hull2', { lvl: 0.5, h: 1.6 });
        b.poly(rrect(-6, 0, 8, 5.6, 1), 'hull', { lvl: 1, h: 3, bevel: 1.2, roof: true });
        b.poly(U.rect(-7, 0, 3, 2.2), 'glass', { lvl: 2, h: 0.6, bevel: 0.3 });
        b.light(10.6, 0, 0.7, b.bp.culture.pal.accent, { blink: 1 });
      }],
      ['Missile rack', (b) => {
        for (const s of [1, -1]) b.poly(U.rect(0, s * 5.2, 11, 1), 'hull2', { lvl: 0.5, h: 1.5 });
        b.poly(rrect(0, 0, 13, 9, 1.2), 'hull', { lvl: 1, h: 3, bevel: 0.8 });
        for (const x of [-4, 0, 4]) for (const y of [-2, 2]) {
          b.circle(x, y, 1.5, 'dark', { lvl: 2, h: 0.4 });
          b.circle(x + 0.2, y, 0.8, 'accent', { lvl: 3, h: 0.4, dome: true });
        }
      }],
      ['Beam emitter', (b) => {
        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * TAU, [x0, y0] = polar(5.2, a), [x1, y1] = polar(9.4, a), [tx, ty] = polar(9.6, a);
          b.strut(x0, y0, x1, y1, 1.4, 'hull2', { lvl: 0.5, h: 1.8 });
          b.circle(tx, ty, 1, 'trim', { lvl: 0.6, h: 2 });
        }
        b.poly(U.circle(0, 0, 6.5, 6, TAU / 12), 'hull', { lvl: 1, h: 3, bevel: 1.4, roof: true });
        b.ring(0, 0, 3.6, 1.2, 'trim', { lvl: 2, h: 3.4 });
        b.circle(0, 0, 2.8, 'glass', { lvl: 2.5, h: 0.7, dome: true });
      }],
    ],
    computer: [
      ['Logic board', (b) => {
        const traces = [[-7, -3, -2, -3], [-2, -3, -2, -1], [-7, -1, -4, -1], [3.5, -4.5, 6.5, -4.5], [3.5, 4.5, 6.5, 2], [-1.5, 4.5, 1, 2.5]];
        b.poly(U.rect(0, 0, 15, 11), 'panel', { lvl: 1, h: 0.8, lines: traces });
        b.poly(U.rect(0, 5.9, 9, 1.2), 'accent', { lvl: 1, h: 0.6, lines: [-3, -1.5, 0, 1.5, 3].map((x) => [x, 5.3, x, 6.5]) });
        for (let i = 0; i < 4; i++) for (const s of [1, -1]) b.poly(U.rect(-0.5 + i * 1.4, s * 2.9, 0.6, 1), 'trim', { lvl: 1.5, h: 0.3 });
        b.poly(U.rect(1.6, 0, 5, 5), 'dark', { lvl: 2, h: 0.8, bevel: 0.3 });
        b.poly(U.rect(-4.5, 2.4, 2.6, 2), 'dark', { lvl: 2, h: 0.5 });
        b.poly(U.rect(-4.5, -2.6, 2.6, 1.4), 'hull2', { lvl: 2, h: 0.4 });
        b.light(6, -4, 0.6, '#6bff8a', { blink: 0.4 });
      }],
      ['Processing core', (b) => {
        for (let i = 0; i < 8; i++) b.poly(radial(5.5, 8.6, 1.6, (i / 8) * TAU + TAU / 16), 'hull2', { lvl: 0.5, h: 2.4 });
        b.circle(0, 0, 7, 'hull', { lvl: 1, h: 3, bevel: 1 });
        b.ring(0, 0, 5.4, 1, 'panel', { lvl: 2, h: 3.2 });
        b.circle(0, 0, 3.4, 'glass', { lvl: 3, h: 0.8, dome: true });
        for (let i = 0; i < 3; i++) { const [x, y] = polar(5.4, (i / 3) * TAU + 0.5); b.light(x, y, 0.5, b.bp.culture.pal.light, { blink: i * 2 }); }
      }],
      ['Memory rack', (b) => {
        for (const s of [1, -1]) b.poly(U.rect(0, s * 8, 4, 1.4), 'trim', { lvl: 0.5, h: 1.5 });
        b.poly(rrect(0, 0, 9, 15, 1), 'hull2', { lvl: 1, h: 3, bevel: 0.6 });
        for (let i = 0; i < 5; i++) {
          const y = -5.6 + i * 2.8;
          b.poly(U.rect(-0.6, y, 6.4, 1.8), 'panel', { lvl: 2, h: 0.4, lines: [[-3, y, 1.6, y]] });
          b.light(3.2, y, 0.45, i % 2 ? '#6bff8a' : b.bp.culture.pal.light, { blink: i * 1.3 });
        }
      }],
    ],
    drive: [
      ['Thruster nozzle', (b) => {
        b.poly([[0, -3], [9, -6], [9, 6], [0, 3]], 'engine', { lvl: 1, h: 3, bevel: 1.2 });
        b.poly([[1.4, -2], [8.6, -4.6], [8.6, 4.6], [1.4, 2]], 'dark', { lvl: 1.5, h: 0.2, line: false });
        b.poly(U.rect(9.2, 0, 1.2, 12.6), 'trim', { lvl: 2, h: 3.4 });
        for (const s of [1, -1]) b.strut(-7, s * 2.2, 1, s * 3.2, 0.9, 'copper', { lvl: 1.8, h: 3.4 });
        b.poly(rrect(-4.5, 0, 7, 7, 1), 'hull', { lvl: 2, h: 3.6, bevel: 0.8, roof: true });
      }],
      ['Reactor core', (b) => {
        for (let i = 0; i < 4; i++) b.poly(U.rect(...polar(7.2, (i / 4) * TAU + TAU / 8), 3, 4, (i / 4) * TAU + TAU / 8), 'hull2', { lvl: 0.5, h: 2.6, grid: [3, 1] });
        b.circle(0, 0, 7.5, 'hull', { lvl: 1, h: 3.4, bevel: 1.4 });
        b.ring(0, 0, 4.8, 1.4, 'trim', { lvl: 2, h: 3.8 });
        b.circle(0, 0, 3.6, 'glass', { lvl: 3, h: 0.8, dome: true });
        b.light(0, -6.4, 0.6, '#ff5a4a', { blink: 0 });
      }],
      ['Warp coil', (b) => {
        for (const s of [1, -1]) b.poly(U.rect(s * 9.4, 0, 2.4, 4), 'hull', { lvl: 0.5, h: 2 });
        b.ring(0, 0, 6.5, 3, 'hull2', { lvl: 1, h: 2.6 });
        for (let i = 0; i < 14; i++) b.poly(radial(4.9, 8.1, 0.9, (i / 14) * TAU), 'copper', { lvl: 2, h: 0.5 });
        b.ring(0, 0, 4.1, 0.9, 'glass', { lvl: 1.5, h: 2.8 });
      }],
    ],
  };

  // ---------- Trade goods ----------

  const crate = (b, cx, cy, s, a, lvl) => {
    const P = (x, y) => U.add(U.rot([x, y], a), [cx, cy]);
    const k = s / 2 - 0.9;
    const lines = [[-k, -k, k, -k], [k, -k, k, k], [k, k, -k, k], [-k, k, -k, -k], [-k, -k, k, k], [-k, k, k, -k]]
      .map(([x0, y0, x1, y1]) => [...P(x0, y0), ...P(x1, y1)]);
    b.poly(U.rect(cx, cy, s, s, a), 'good', { lvl, h: s * 0.45, bevel: 0.5, lines });
    for (const [x, y] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) b.poly(U.rect(...P(x * (s / 2 - 0.7), y * (s / 2 - 0.7)), 1.4, 1.4, a), 'trim', { lvl: lvl + 0.5, h: 0.25, line: false });
  };

  const TRADE_BUILD = {
    metal: ['Ingots', (b) => {
      const ingot = (x, y, lvl, mat = 'good') => b.poly(U.rect(x, y, 10, 4.4), mat, { lvl, h: 2, bevel: 0.9, lines: [[x - 4.2, y - 1.4, x + 4.2, y - 1.4], [x - 4.2, y + 1.4, x + 4.2, y + 1.4]] });
      for (const x of [-5.3, 5.3]) for (const y of [-2.5, 2.5]) ingot(x, y, 1, x < 0 && y < 0 ? 'good2' : 'good');
      ingot(0, 0, 2, 'goodHi');
      b.poly(U.rect(0, 0, 2.6, 1), 'good2', { lvl: 3, h: 0.2, line: false });
    }],
    mineral: ['Ore crystals', (b, r) => {
      b.poly(U.blob(0, 1.5, 9, 6.4, r, 0.35, 9), 'rock', { lvl: 1, h: 2.5, bevel: 1.5, roof: true });
      // Stubby, wide crystals with broad flat tops and small corner chamfers.
      const shards = [[-3.6, 0.8, 4.8, 3.4, -2.1], [0.4, -0.2, 5.6, 3.8, -1.45], [3.6, 1.4, 4.4, 3.2, -0.7], [-1.2, 3.6, 3.6, 2.8, 2.6], [5, 3.6, 3.2, 2.6, 0.4]];
      shards.forEach(([x, y, L, w, a], i) => {
        const c = w * 0.35;
        const pts = [[0, -w], [L - c, -w], [L, -w + c], [L, w - c], [L - c, w], [0, w], [-c, 0]].map((p) => U.add(U.rot(p, a + (r() - 0.5) * 0.3), [x, y]));
        b.poly(pts, i === 1 ? 'glass' : i % 2 ? 'goodHi' : 'good', { lvl: 2 + i * 0.1, h: 1.2 + L * 0.1, bevel: w * 0.3 });
      });
    }],
    gas: ['Gas canister', (b) => {
      b.poly(U.rect(10.2, 0, 2.4, 3), 'hull2', { lvl: 0.5, h: 2.4 });
      b.circle(11.8, 0, 1.6, 'trim', { lvl: 1, h: 2.8 });
      // Hull split around the bands so the bands sit on the ground as collars in low-poly.
      const cap = rrect(0, 0, 18, 8, 4, 0, 4);
      const segs = [U.clipPoly(cap, -1, 0, 6.7), U.clipPoly(U.clipPoly(cap, 1, 0, -5.3), -1, 0, -5.3), U.clipPoly(cap, 1, 0, 6.7)];
      for (const pts of segs) b.poly(pts, 'hull', { lvl: 1, h: 4, bevel: 2.5, roof: true });
      for (const x of [-6, 6]) b.poly(rrect(x, 0, 1.4, 8.6, 0.7), 'trim', { lvl: 1.5, h: 4.3, bevel: 2.6, roof: true });
      b.poly(rrect(0, 0, 9, 4, 1.5), 'glass', { lvl: 2, h: 0.4, bevel: 0.3 });
      b.poly(U.rect(-8.2, 0, 1, 3.6), 'good', { lvl: 2, h: 0.2, line: false });
    }],
    synthetic: ['Composite tiles', (b) => {
      const cells = [[0, 0], ...Array.from({ length: 6 }, (_, i) => polar(Math.sqrt(3) * 3.4, TAU / 12 + (i / 6) * TAU))];
      cells.forEach(([x, y], i) => b.poly(U.circle(x, y, 3.1, 6), i === 0 ? 'goodHi' : i % 3 ? 'good' : 'good2', { lvl: 1, h: 1.6, bevel: 0.6, lines: [[x - 1.2, y - 1.2, x + 1.2, y + 1.2]] }));
    }],
    crates: ['Cargo crates', (b) => {
      crate(b, -2.6, 1.4, 11, 0.08, 1);
      crate(b, 5.6, -4.2, 7, -0.28, 2);
    }],
    barrels: ['Barrels', (b) => {
      for (const [x, y] of [[-4.4, 2.6], [4.4, 2.6], [0, -4.8]]) {
        b.circle(x, y, 4.2, 'good', { lvl: 1, h: 7, lines: [[x - 2.6, y + 1, x + 2.6, y + 1]] });
        b.ring(x, y, 3.9, 0.7, 'trim', { lvl: 2, h: 7.2 });
        b.circle(x + 1.6, y - 1.6, 0.8, 'hull2', { lvl: 2, h: 0.3 });
      }
    }],
    tubes: ['Tube bundle', (b) => {
      for (let i = 0; i < 5; i++) {
        const y = -5.6 + i * 2.8;
        b.poly(rrect(0, y, 18, 2.6, 1.3), i === 2 ? 'goodHi' : 'good', { lvl: 1, h: 2.6, bevel: 1.3, roof: true });
        for (const x of [-8.8, 8.8]) b.poly(U.rect(x, y, 1, 2.2), 'hull2', { lvl: 1.5, h: 0.3 });
      }
      for (const x of [-4.5, 4.5]) b.poly(U.rect(x, 0, 1.4, 14.6), 'hull2', { lvl: 2, h: 0.4 });
    }],
  };

  // Shape names per category (the variant a component type uses is in goods.js).
  const SHAPES = Object.fromEntries(Object.entries(LOOT_BUILD).map(([id, vs]) => [id, vs.map((v) => v[0])]));

  function create(kind, seed = 1) {
    const type = G.type(kind);
    if (!type) throw new Error(`Unknown item: ${kind}`);
    const s = seed >>> 0;
    const r = mulberry32(hashInt(s, 7, kind.length * 131 + kind.charCodeAt(0)));
    const id = `item:${kind}:${s}`; // items have no culture: the type and seed make one
    const loot = LOOT_BUILD[type.category];
    let b;
    if (loot) {
      const vi = (type.shape || 0) % loot.length;
      b = B.builder('item', { pal: lootPal(type.color), seed: 0 }, s);
      loot[vi][1](b, r);
      Object.assign(b.bp, { category: 'loot', variant: vi });
    } else {
      const [, build] = TRADE_BUILD[type.category];
      b = B.builder('item', { pal: goodsPal(type.color), seed: 0 }, s);
      build(b, r);
      b.bp.category = 'trade';
    }
    Object.assign(b.bp, { id, kind, rarity: type.rarity, label: `${loot ? 'Loot' : 'Trade'} · ${type.name}` });
    return B.finish(b.bp);
  }

  return { SHAPES, create };
})();

if (typeof module !== 'undefined') module.exports = ArtItems;
