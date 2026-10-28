// Drawing the race over the ground: the track's rails and kerbs, the start gantry and the next checkpoint's gate (the Low-poly
// kit's hardware), the pickups (the game's items), the ships (yours,
// and the rivals') with their shadows, the minimap, the stick, the drag (as game/hud.js
// drawDragIndicator draws it) or the halves held when steering by sides, and the HUD's text.
//
//   Draw.marks(ctx, v, px, time, G, R)   the rails, kerbs and pylons (G.lines), the start, the next checkpoint
//   Draw.pickups(ctx, v, px, time, P, got, ground, style?)   what's on the track to pick up (Pickups.place),
//     bobbing and turning, those in got (taken this race) left out; ground(v, x, y, z) -> [X, Y] | null
//   Draw.storm(ctx, v, px, time, strikes, ground)   lightning (Storm's strikes): a warning ring closing in on
//     the ground, then the bolt down from the sky and its glow
//   Draw.PART[part]   a salvage part's colour (its item's tint)
//   Draw.icon(key, size?, style?) -> image URL   a pickup's item as an icon: key 'chip' or a part
//   Draw.lines(G) -> { edges, kerbs, pylons }   the edges, kerbs and pylons on the ground, worked out once a track (G.lines)
//   Draw.ship(ctx, v, ship, body, { style, time, alpha, shadow, ground, bank })   ship: { art, k (scale), r, z }
//     (ground: needed for the shadow); bank: the roll into a turn, a squash across the ship (0 .. 1)
//   Draw.trail(ctx, v, trails, now, life, width)   the engines' trails: per engine, points { x, y, z, t, a, c }
//     oldest first (t: when, s; a: strength 0 .. 1; c: colour, TRAIL_RGB), gone after life s
//   Draw.streaks(ctx, Wc, Hc, cx, cy, a, time)   a boost's speed streaks in from the screen's edges toward
//     (cx, cy) (CSS px); a: their strength (0 .. 1)
//   Draw.minimap(ctx, Wc, G, R, size, rivals?)    size: the map's side (world units);
//     rivals: [{ x, y, color }]
//   Draw.drag(ctx, drag, maxDrag), Draw.sides(ctx, Wc, Hc, held)
//   Draw.pad(ctx, pad, home, radius, inner, dash, DASH, drift, DRIFT)   the stick (Input.pad, Input.home()),
//     the dash's charges (Run's R.dash, Run.DASH) and the drift's charge (R.drift, Run.DRIFT)
//   Draw.sparks(ctx, v, px, body, z, drift, time, ground)   sparks off the tail while a slide has
//     charged a level, coloured by it (R.drift); z: the ship's height
//   Draw.dust(ctx, v, px, puffs, ground)   dust puffs ({ x, y, z, r, t, life, a, col }: Dust.puffs)
//   Draw.hud(G, R, cfg, missing, pos?) -> { lap, time, total, rest, order }   text ×3, html, html (the standings, '' with no rivals:
//     each a portrait, .rm-face[data-f=its id], the page's to set); missing: chunks still building
//     in view; pos: Rival.standings(), the place and the order, when there are rivals
//   Draw.note(R, cfg, pos?) -> { msg, big }       the message over the track (the countdown, …; at the end,
//     what was banked: R.banked, Career.bank's)
// ES module (`Draw`); needs a browser.

import { ItemIcons } from '../art/icons.js';
import { ArtItems } from '../art/items.js';
import { Art } from '../art/render.js';
import { ArtSurface } from '../art/surface.js';
import { SurfaceGlobe } from '../art/surface-globe.js';
import { ArtUtil } from '../art/util.js';

const Draw = (() => {
  const TAU = Math.PI * 2;

  // The track's hardware is the Low-poly kit's, in the Android materials (ui/kit-lowpoly.css, the
  // culture your Courier is drawn in): dark hull, white trim, blue running lights. Faceted and lit by
  // the art's light (Art.kit.LIGHT) as the low-poly art shades a face. A prism's sides facing the
  // viewer (+y) are drawn, then its top, its shadow first.
  const MAT = { hull: '#3a4048', hull2: '#3a4048', trim: '#e8ecf0', glass: '#e6f6ff', light: '#5ad8ff', marking: '#14181e' };
  const LIGHT = Art.kit.LIGHT;
  const lit = (col, n, jit = 1) => ArtUtil.shade(col, (0.24 + 0.95 * Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2])) * jit);
  const UP = [0, 0, 1];
  function poly(ctx, S, col, px) {
    ctx.fillStyle = ctx.strokeStyle = col; ctx.lineWidth = 0.6 * px;
    ctx.beginPath(); S.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath();
    ctx.fill(); if (px) ctx.stroke();
  }
  // The convex hull of points [[x, y]], anticlockwise.
  function hull2d(P) {
    const s = [...P].sort((a, b) => a[0] - b[0] || a[1] - b[1]), cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const half = (L) => { const h = []; for (const p of L) { while (h.length > 1 && cr(h[h.length - 2], h[h.length - 1], p) <= 0) h.pop(); h.push(p); } h.pop(); return h; };
    return [...half(s), ...half(s.reverse())];
  }
  // A prism over the ground at height gz: footprint base [[x, y]] (convex), from z0 to z1 above it;
  // its top split into facets (a fan, every other one a shade darker).
  function prism(ctx, v, px, gz, base, z0, z1, col) {
    const T = base.map(([x, y]) => SurfaceGlobe.toScreen(v, x, y, gz + z1)), B = base.map(([x, y]) => SurfaceGlobe.toScreen(v, x, y, gz + z0));
    if (T.some((p) => !p) || B.some((p) => !p)) return;
    const [a0, a1] = [z0, z1].map((z) => ArtSurface.shadowShift(z)), sh = hull2d(base.flatMap(([x, y]) => [[x + a0[0], y + a0[1]], [x + a1[0], y + a1[1]]])).map(([x, y]) => SurfaceGlobe.toScreen(v, x, y, gz));
    if (sh.every(Boolean)) poly(ctx, sh, 'rgba(0,0,0,0.26)', 0);
    const cx = base.reduce((s, p) => s + p[0], 0) / base.length, cy = base.reduce((s, p) => s + p[1], 0) / base.length;
    for (let i = 0; i < base.length; i++) {
      const j = (i + 1) % base.length, [ax, ay] = base[i], [bx, by] = base[j], l = Math.hypot(bx - ax, by - ay) || 1;
      let nx = (by - ay) / l, ny = -(bx - ax) / l;
      if (nx * ((ax + bx) / 2 - cx) + ny * ((ay + by) / 2 - cy) < 0) { nx = -nx; ny = -ny; }
      if (ny > 0) poly(ctx, [B[i], B[j], T[j], T[i]], lit(col, [nx, ny, 0]), px);
    }
    for (let i = 1; i + 1 < T.length; i++) poly(ctx, [T[0], T[i], T[i + 1]], lit(col, UP, i % 2 ? 1.04 : 0.96), px);
  }
  // A footprint at (x, y): a rectangle `along` × `across` the way round (tx, ty), or an n-gon of radius r.
  const box = (x, y, tx, ty, along, across) => [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([a, c]) => [x + (tx * along * a - ty * across * c) / 2, y + (ty * along * a + tx * across * c) / 2]);
  const ngon = (x, y, r, n, a0 = 0) => Array.from({ length: n }, (_, i) => [x + Math.cos(a0 + (i / n) * TAU) * r, y + Math.sin(a0 + (i / n) * TAU) * r]);
  // A glow: a soft disc of light in rgb `c` at a screen point, r across.
  function glow(ctx, at, r, c, a) {
    const g = ctx.createRadialGradient(at[0], at[1], 0, at[0], at[1], r);
    g.addColorStop(0, `rgba(${c},${a})`); g.addColorStop(0.35, `rgba(${c},${a * 0.45})`); g.addColorStop(1, `rgba(${c},0)`);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(at[0], at[1], r, 0, TAU); ctx.fill();
  }
  const RGB = (hex) => ArtUtil.hexToRgb(hex).join(',');

  // The edges, a point a centreline point each side, at the ground's height there: a rail inlaid in
  // the ground with running lights along it, chasing the way round (RAIL). Kerbs on the bends tighter
  // than KERB: on the inside through the bend's middle, on the outside over its exit, plates
  // `stripe` points long in trim and hull, raised `h` on a dark lip. f: which edge (+1: the left
  // of the way round, −1: the right). Pylons stand off both edges every PYLON.every points.
  const KERB = { k: 1 / 700, w: 10, h: 1.6, stripe: 2, inside: [0.2, 0.8], outside: [0.5, 1.15] };
  const RAIL = { w: 7, lamp: 4, wave: 48, speed: 70 }, PYLON = { every: 36, out: 12, r: 4.5, h: 20 };
  function lines(G) {
    const { pts, samples: S } = G.tr, at = (p, f, o = 0) => { const x = p.x - p.ty * (p.hw - o) * f, y = p.y + p.tx * (p.hw - o) * f; return { x, y, z: ArtSurface.heightAt(G.W, x, y) }; };
    const edges = [1, -1].map((f) => pts.map((p) => at(p, f)));
    const pylons = [1, -1].flatMap((f) => pts.filter((_, n) => n % PYLON.every === PYLON.every / 2).map((p) => at(p, f, -PYLON.out)));
    const kerbs = [], from = pts.findIndex((p, n) => (p.k > KERB.k) !== (pts[(n + S - 1) % S].k > KERB.k));
    for (let m = 0, start = -1; from >= 0 && m <= S; m++) {
      const n = (from + m) % S, on = m < S && pts[n].k > KERB.k;
      if (on && start < 0) start = m;
      if (!on && start >= 0) {
        const len = m - start, f = pts[(from + start + (len >> 1)) % S].side;
        for (const [g, [a, b]] of [[f, KERB.inside], [-f, KERB.outside]]) {
          const run = [];
          for (let s = Math.round(start + a * len); s <= Math.round(start + b * len); s++) { const p = pts[(from + s) % S]; run.push([at(p, g), at(p, g, KERB.w)]); }
          kerbs.push(run);
        }
        start = -1;
      }
    }
    return { edges, kerbs, pylons };
  }
  const screen = (v, q, z = 0) => SurfaceGlobe.toScreen(v, q.x, q.y, q.z + z);
  function rails(ctx, v, px, time, L) {
    ctx.lineCap = 'butt'; ctx.lineJoin = 'round';
    const path = (e) => {
      ctx.beginPath();
      let was = false;
      for (let n = 0; n <= e.length; n++) { const s = screen(v, e[n % e.length]); if (s) { if (was) ctx.lineTo(s[0], s[1]); else ctx.moveTo(s[0], s[1]); } was = !!s; }
    };
    for (const e of L.edges) {
      path(e);
      ctx.strokeStyle = 'rgba(16,20,28,0.6)'; ctx.lineWidth = RAIL.w; ctx.stroke();
      ctx.strokeStyle = `rgba(${RGB(MAT.trim)},0.55)`; ctx.lineWidth = 1.4; ctx.stroke();
    }
    // Plates: every lip first, then the tops, so a plate's lip never covers the one before it.
    for (const top of [false, true]) for (const run of L.kerbs) for (let n = 0; n + 1 < run.length; n++) {
      const [o0, i0] = run[n], [o1, i1] = run[n + 1], z = top ? KERB.h : 0;
      const S = [screen(v, o0, z), screen(v, o1, z), screen(v, i1, z), screen(v, i0, z)];
      if (S.some((s) => !s)) continue;
      const col = Math.floor(n / KERB.stripe) % 2 ? MAT.hull : MAT.trim;
      if (!top) { poly(ctx, S.map(([x, y]) => [x, y + 0.01]), ArtUtil.shade(col, 0.42), px); continue; }
      poly(ctx, [S[0], S[1], S[2]], lit(col, UP, 1.03), px);
      poly(ctx, [S[0], S[2], S[3]], lit(col, UP, 0.95), px);
    }
    // The running lights: a wave down each edge the way round.
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const c = RGB(MAT.light);
    for (const e of L.edges) for (let n = 0; n < e.length; n += RAIL.lamp) {
      const s = screen(v, e[n], 0.5);
      if (!s) continue;
      const w = (((n - time * RAIL.speed) % RAIL.wave) + RAIL.wave) % RAIL.wave / RAIL.wave, a = 0.18 + 0.7 * Math.pow(1 - w, 3);
      glow(ctx, s, 6, c, a);
    }
    ctx.restore();
    for (const q of L.pylons) pylon(ctx, v, px, time, q.x, q.y, q.z, PYLON.r, PYLON.h, MAT.hull2, MAT.light, q.x + q.y);
  }
  // A pylon: a hex prism with a light on top, blinking (phase: where in its blink).
  function pylon(ctx, v, px, time, x, y, gz, r, h, col, light, phase, a = 0.4 + 0.6 * Math.max(0, Math.sin(time * 3 + phase))) {
    if (!SurfaceGlobe.toScreen(v, x, y, gz)) return;
    prism(ctx, v, px, gz, ngon(x, y, r, 6, 0.3), 0, h, col);
    prism(ctx, v, px, gz, ngon(x, y, r * 0.55, 6, 0.3), h, h + 2.5, light);
    const s = SurfaceGlobe.toScreen(v, x, y, gz + h + 2);
    if (s) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; glow(ctx, s, r * 3, RGB(light), a); ctx.restore(); }
  }

  // The start: a dark plate across the track with a row of lamps, under a gantry (two towers and a
  // beam, lamps along its top). The lamps count down in white, one more third lit at each count, and
  // go blue on the go.
  const GANTRY = { out: 16, tower: 16, h: 66, beam: [54, 66], depth: 9, band: 16, lamps: 14 };
  function startLine(ctx, v, px, time, G, R) {
    const p = G.tr.pts[0], { tx, ty } = p, gz = ArtSurface.heightAt(G.W, p.x, p.y), w = p.hw + GANTRY.out;
    const lampCol = (i, n) => {
      if (R.phase !== 'count') return R.phase === 'race' ? MAT.light : MAT.glass;
      const step = Math.min(2, Math.floor(R.t / 0.8)); // the countdown's 3, 2, 1
      return i / n < (step + 1) / 3 ? MAT.glass : null;
    };
    const lamps = (n, z, across, along) => {
      for (let i = 0; i < n; i++) {
        const f = -1 + (2 * (i + 0.5)) / n, col = lampCol(i, n), q = [p.x - ty * across * f, p.y + tx * across * f];
        const S = box(q[0], q[1], tx, ty, along, (1.3 * across) / n).map(([x, y]) => SurfaceGlobe.toScreen(v, x, y, gz + z));
        if (S.some((s) => !s)) continue;
        poly(ctx, S, col ? ArtUtil.mix(col, '#ffffff', 0.25) : ArtUtil.shade(MAT.hull2, 0.5), px);
        const c = col && SurfaceGlobe.toScreen(v, q[0], q[1], gz + z);
        if (c) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; glow(ctx, c, (2.4 * across) / n, RGB(col), 0.5); ctx.restore(); }
      }
    };
    // The plate on the ground, its edges trimmed.
    const S = box(p.x, p.y, tx, ty, GANTRY.band, 2 * p.hw).map(([x, y]) => SurfaceGlobe.toScreen(v, x, y, gz));
    if (S.every(Boolean)) {
      poly(ctx, S, MAT.marking, px);
      ctx.strokeStyle = `rgba(${RGB(MAT.trim)},0.7)`; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(...S[0]); ctx.lineTo(...S[3]); ctx.moveTo(...S[1]); ctx.lineTo(...S[2]); ctx.stroke();
      lamps(GANTRY.lamps, 0.2, p.hw * 0.92, GANTRY.band * 0.35);
    }
    // The gantry, nearest the viewer drawn last: the towers by their y, the beam between them.
    const parts = [-1, 1].map((f) => ({ y: p.y + tx * w * f, draw: () => prism(ctx, v, px, gz, box(p.x - ty * w * f, p.y + tx * w * f, tx, ty, GANTRY.tower, GANTRY.tower), 0, GANTRY.h, MAT.hull) }));
    parts.push({ y: p.y, draw: () => { prism(ctx, v, px, gz, box(p.x, p.y, tx, ty, GANTRY.depth, 2 * w), GANTRY.beam[0], GANTRY.beam[1], MAT.hull2); lamps(9, GANTRY.beam[1] + 0.2, p.hw * 0.8, GANTRY.depth * 0.5); } });
    for (const o of parts.sort((a, b) => a.y - b.y)) o.draw();
  }

  // The next checkpoint: a gate of two pylons, a curtain of light between their lamps, and chevrons
  // on the ground pointing the way round, all pulsing.
  const GATE = { f: 0.95, h: 44, r: 5.5, chevrons: 7 };
  function gate(ctx, v, px, time, G, R) {
    const p = G.tr.pts[G.tr.cps[R.next]], { tx, ty } = p, pulse = 0.6 + 0.4 * Math.sin(time * 6), c = RGB(MAT.light);
    const side = (f) => { const x = p.x - ty * p.hw * GATE.f * f, y = p.y + tx * p.hw * GATE.f * f; return { x, y, z: ArtSurface.heightAt(G.W, x, y) }; };
    const [A, B] = [side(-1), side(1)];
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = `rgba(${c},${0.85 * pulse})`; ctx.lineWidth = 3;
    for (let i = 0; i < GATE.chevrons; i++) {
      const f = -1 + (2 * (i + 0.5)) / GATE.chevrons, x = p.x - ty * p.hw * 0.8 * f, y = p.y + tx * p.hw * 0.8 * f;
      const S = [[-5, -9], [5, 0], [-5, 9]].map(([u, s]) => SurfaceGlobe.toScreen(v, x + tx * u - ty * s, y + ty * u + tx * s, ArtSurface.heightAt(G.W, x, y)));
      if (S.some((s) => !s)) continue;
      ctx.beginPath(); ctx.moveTo(...S[0]); ctx.lineTo(...S[1]); ctx.lineTo(...S[2]); ctx.stroke();
    }
    const curtain = [screen(v, A), screen(v, B), screen(v, B, GATE.h), screen(v, A, GATE.h)];
    if (curtain.every(Boolean)) {
      const top = (curtain[2][1] + curtain[3][1]) / 2, bot = (curtain[0][1] + curtain[1][1]) / 2, g = ctx.createLinearGradient(0, top, 0, bot);
      g.addColorStop(0, `rgba(${c},${0.22 * pulse})`); g.addColorStop(1, `rgba(${c},0)`);
      ctx.fillStyle = g; ctx.beginPath(); curtain.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.fill();
      ctx.strokeStyle = `rgba(${c},${0.8 * pulse})`; ctx.lineWidth = 1.5; ctx.setLineDash([6, 5]);
      ctx.beginPath(); ctx.moveTo(...curtain[3]); ctx.lineTo(...curtain[2]); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.restore();
    for (const q of [A, B].sort((a, b) => a.y - b.y)) pylon(ctx, v, px, time, q.x, q.y, q.z, GATE.r, GATE.h, MAT.hull, MAT.light, 0, pulse);
  }

  function marks(ctx, v, px, time, G, R) {
    if (G.lines) rails(ctx, v, px, time, G.lines);
    startLine(ctx, v, px, time, G, R);
    if (R.phase === 'race') gate(ctx, v, px, time, G, R);
  }

  // Pickups are the game's items (art/items.js): a credit chip a gold ingot, a crate the salvage
  // component its part is named for, in its part's colour (PART): coil a warp coil, cell a reactor
  // core, vane a hull rib, plate an armour plate. Ringed like a floating item in the game
  // (game/draw-world.js drawItemHalos): crates in its amber, the rare one in its rarity's violet;
  // chips only glow.
  const PART = { coil: '#ffb03a', vane: '#7df9ff', cell: '#8cff6a', plate: '#c8d2e6' };
  const ITEM = { chip: { kind: 'iron', color: [46, 0.95, 0.58] }, coil: { kind: 'drive-components', shape: 2 }, cell: { kind: 'drive-components', shape: 1 }, vane: { kind: 'hull-components', shape: 1 }, plate: { kind: 'hull-components', shape: 0 } };
  const HALO = { crate: '#ffcf5a', rare: '#c77dff', chip: '#ffd84a', period: 1.8 };
  const SIZE = 0.7; // × a pickup's r, drawn (its reach is wider: Pickups.GRAB)
  const itemArt = {}, look = (key) => ({ shape: ITEM[key].shape, color: ITEM[key].color || ArtUtil.toHsl(PART[key]) });
  const art = (key) => (itemArt[key] ||= ArtItems.create(ITEM[key].kind, 1, look(key)));
  // A pickup's item as a menu icon (art/icons.js): an image URL, size CSS px a side.
  const icon = (key, size = 16, style = 'lowpoly') => ItemIcons.url(ITEM[key].kind, style, size, look(key));
  const img = (key, size) => `<img class="rm-icon" src="${icon(key, size)}" alt="" width="${size}" height="${size}">`;
  function pickups(ctx, v, px, time, P, got, ground, style = 'lowpoly') {
    if (!P) return;
    for (const p of P) {
      if (got.has(p.id)) continue;
      const chip = p.kind === 'chip', bob = Math.sin(time * 3 + p.n) * 3, z = (chip ? 12 : 16) + bob;
      const g = ground(v, p.x, p.y), at = ground(v, p.x, p.y, z);
      if (!g || !at) continue;
      const r = p.r * SIZE, c = RGB(HALO[p.kind]), ph = ((time / HALO.period + p.n * 0.137) % 1 + 1) % 1;
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath(); ctx.ellipse(g[0], g[1], r * 0.8, r * 0.8 * v.ct, 0, 0, TAU); ctx.fill();
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      glow(ctx, at, r * (chip ? 1.6 : 2.2), c, chip ? 0.35 : 0.45);
      ctx.restore();
      if (!chip) {
        const R0 = r + 4;
        ctx.save(); ctx.strokeStyle = `rgb(${c})`; ctx.lineWidth = 1.5 * px;
        ctx.globalAlpha = 0.55 + 0.1 * Math.sin((ph + 0.25) * TAU);
        ctx.beginPath(); ctx.ellipse(g[0], g[1], R0, R0 * v.ct, 0, 0, TAU); ctx.stroke();
        ctx.globalAlpha = (1 - ph) * 0.6;
        ctx.beginPath(); ctx.ellipse(g[0], g[1], R0 * (1 + ph * 1.1), R0 * (1 + ph * 1.1) * v.ct, 0, 0, TAU); ctx.stroke();
        ctx.restore();
      }
      const bp = art(chip ? 'chip' : p.part), k = (r * (chip ? 1.15 : 1.35)) / bp.radius;
      ctx.save(); ctx.translate(at[0], at[1]); ctx.scale(k, k);
      Art.drawAsset(ctx, bp, style, { angle: time * (chip ? 1.4 : 0.6) + p.n, t: time });
      ctx.restore();
    }
  }

  // Lightning: while it's coming, a ring on the ground and a second closing in on it, brighter as it
  // nears; when it hits, a jagged bolt (a fresh one 30 times a second) from high over the spot, a
  // glow on the ground, fading over its `bolt` s.
  const BOLT = { h: 900, segs: 12, jag: 26, rgb: '214,226,255', glow: '185,140,255' };
  function storm(ctx, v, px, time, strikes, ground) {
    if (!strikes || !strikes.length) return;
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const s of strikes) {
      const g = ground(v, s.x, s.y);
      if (!g) continue;
      if (s.t > 0) {
        const f = Math.min(1, s.t / s.warn), a = 0.45 + 0.4 * (1 - f) + 0.15 * Math.sin(time * 24);
        ctx.fillStyle = `rgba(${BOLT.glow},${0.1 + 0.15 * (1 - f)})`;
        ctx.beginPath(); ctx.ellipse(g[0], g[1], s.r, s.r * v.ct, 0, 0, TAU); ctx.fill();
        ctx.strokeStyle = `rgba(${BOLT.rgb},${a})`; ctx.lineWidth = 2 * px; ctx.setLineDash([8 * px, 6 * px]);
        ctx.beginPath(); ctx.ellipse(g[0], g[1], s.r, s.r * v.ct, 0, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
        const k = 0.15 + 0.85 * f;
        ctx.lineWidth = 3 * px;
        ctx.beginPath(); ctx.ellipse(g[0], g[1], s.r * k, s.r * k * v.ct, 0, 0, TAU); ctx.stroke();
        continue;
      }
      const life = Math.max(0, 1 + s.t / s.bolt);
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      glow(ctx, g, s.r * 2.2, BOLT.glow, 0.8 * life);
      const seed = s.seed + Math.floor(time * 30), h = (i, k) => { const x = Math.sin((i * 7 + k + seed) * 12.9898) * 43758.5453; return x - Math.floor(x); };
      const pts = [];
      for (let i = 0; i <= BOLT.segs; i++) {
        const f = i / BOLT.segs, j = i && i < BOLT.segs ? BOLT.jag : 0;
        const q = ground(v, s.x + (h(i, 1) - 0.5) * j * 2, s.y + (h(i, 2) - 0.5) * j, BOLT.h * (1 - f));
        if (q) pts.push(q);
      }
      for (const [w, a] of [[9, 0.35], [3.5, 0.9]]) {
        ctx.strokeStyle = `rgba(${a > 0.5 ? '255,255,255' : BOLT.glow},${a * life})`; ctx.lineWidth = w * px;
        ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
      }
      ctx.restore();
    }
    ctx.restore();
  }

  // The ship at flight height, its shadow below and to the side: the ship's own outline (drawn into
  // a canvas and filled black), cast SHADOW.near of as far as the light would (game/landing.js) so it
  // stays close under the ship; a hop still throws it further off.
  const SHADOW = { near: 0.45, a: 0.3 };
  let shadowCanvas = null;
  function ship(ctx, v, s, b, o) {
    // The bank: a squash across the ship's heading as the screen shows it.
    const sa = Math.atan2(Math.sin(b.angle) * v.ct, Math.cos(b.angle)), sq = 1 - Math.abs(o.bank || 0);
    const lean = (c) => { if (sq < 1) { c.rotate(sa); c.scale(1, sq); c.rotate(-sa); } };
    ctx.save();
    ctx.globalAlpha = o.alpha ?? 1;
    if (o.shadow) {
      const [shx, shy] = ArtSurface.shadowShift(s.z), sh = o.ground(v, b.x + shx * SHADOW.near, b.y + shy * SHADOW.near);
      if (sh) shadow(ctx, sh, s, b, o, lean);
    }
    const p = SurfaceGlobe.toScreen(v, b.x, b.y, s.z) || [v.ox + b.x - v.fx, v.oy + (b.y - v.fy) * v.ct - s.z * v.st];
    ctx.translate(p[0], p[1]); lean(ctx); ctx.scale(s.k, s.k);
    Art.drawAsset(ctx, s.art, o.style, { angle: b.angle, t: o.time, thrust: b.thrust || 0 });
    ctx.restore();
  }
  // The ship drawn as it's drawn on screen (the same sprite, without its flames) into a canvas of
  // device pixels, filled black there, and laid on the ground at `at`.
  function shadow(ctx, at, s, b, o, lean) {
    const m = ctx.getTransform(), ppu = Math.hypot(m.a, m.b), half = Math.ceil(s.art.radius * s.k * ppu * 1.4), n = half * 2;
    const c = (shadowCanvas ||= document.createElement('canvas')), g = c.getContext('2d');
    if (c.width < n || c.height < n) c.width = c.height = Math.max(n, c.width);
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over'; g.clearRect(0, 0, n, n);
    g.setTransform(ppu, 0, 0, ppu, half, half); lean(g); g.scale(s.k, s.k);
    Art.drawAsset(g, s.art, o.style, { angle: b.angle, t: o.time, thrust: 0 });
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-in'; g.fillStyle = '#000'; g.fillRect(0, 0, n, n);
    ctx.globalAlpha = (o.alpha ?? 1) * SHADOW.a;
    ctx.drawImage(c, 0, 0, n, n, at[0] - half / ppu, at[1] - half / ppu, n / ppu, n / ppu);
    ctx.globalAlpha = o.alpha ?? 1;
  }

  // The drift's colours by level: none yet, then blue, then orange.
  const DRIFT_RGB = ['207,216,255', '125,249,255', '255,176,58'];

  // The engines' trails' colours (a point's c): flying, the drift's two levels, a boost.
  const TRAIL_RGB = ['190,220,255', DRIFT_RGB[1], DRIFT_RGB[2], '255,236,200'];

  // The engines' trails: a ribbon along where each engine was, narrowing and fading with age.
  function trail(ctx, v, trails, now, life, w) {
    ctx.save(); ctx.lineCap = 'round';
    for (const pts of trails) {
      let q = null;
      for (const p of pts) {
        const s = SurfaceGlobe.toScreen(v, p.x, p.y, p.z), f = 1 - (now - p.t) / life;
        if (q && s && f > 0 && p.a > 0) {
          ctx.globalAlpha = 0.55 * p.a * f; ctx.lineWidth = w * (0.25 + 0.75 * f); ctx.strokeStyle = `rgb(${TRAIL_RGB[p.c]})`;
          ctx.beginPath(); ctx.moveTo(q[0], q[1]); ctx.lineTo(s[0], s[1]); ctx.stroke();
        }
        q = s;
      }
    }
    ctx.restore();
  }

  // A boost's speed streaks: short lines running in from the screen's edges toward (cx, cy), a fresh
  // scatter 30 times a second.
  function streaks(ctx, Wc, Hc, cx, cy, a, time) {
    if (a <= 0.01) return;
    const R0 = Math.hypot(Wc, Hc) / 2, seed = Math.floor(time * 30);
    const h = (i, k) => { const x = Math.sin((i * 7 + k) * 12.9898 + seed * 78.233) * 43758.5453; return x - Math.floor(x); };
    ctx.save(); ctx.strokeStyle = '#ffffff'; ctx.lineCap = 'round';
    for (let i = 0; i < 28; i++) {
      const ang = h(i, 1) * TAU, r1 = R0 * (0.6 + 0.5 * h(i, 2)), r0 = Math.max(R0 * 0.32, r1 - R0 * (0.15 + 0.25 * h(i, 3)) * a);
      const c = Math.cos(ang), sn = Math.sin(ang);
      ctx.globalAlpha = 0.4 * a * (0.4 + 0.6 * h(i, 4)); ctx.lineWidth = 1 + 2 * h(i, 5);
      ctx.beginPath(); ctx.moveTo(cx + c * r1, cy + sn * r1); ctx.lineTo(cx + c * r0, cy + sn * r0); ctx.stroke();
    }
    ctx.restore();
  }

  // Sparks off the tail while a slide has charged a level, in the level's colour.
  function sparks(ctx, v, px, b, z, F, time, ground) {
    if (!F.on || !F.level) return;
    const back = b.angle + Math.PI;
    ctx.save(); ctx.fillStyle = `rgb(${DRIFT_RGB[F.level]})`;
    for (let i = 0; i < 8; i++) {
      const h = Math.sin(i * 12.9898 + Math.floor(time * 30) * 78.233) * 43758.5453, f = h - Math.floor(h);
      const a = back + (f - 0.5) * 1.4, d = 12 + 22 * ((f * 7) % 1);
      const p = ground(v, b.x + Math.cos(a) * d, b.y + Math.sin(a) * d, z * (1 - f));
      if (!p) continue;
      ctx.globalAlpha = 0.9 * (1 - d / 40);
      ctx.beginPath(); ctx.arc(p[0], p[1], 3.2 * (1 + f) * px, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  // Dust: soft puffs on the ground, growing and fading over their life (Dust's).
  function dust(ctx, v, px, puffs, ground) {
    if (!puffs.length) return;
    ctx.save();
    for (const p of puffs) {
      const q = ground(v, p.x, p.y, p.z);
      if (!q) continue;
      const f = p.t / p.life;
      ctx.globalAlpha = p.a * (1 - f) * Math.min(1, f * 6);
      ctx.fillStyle = p.col;
      ctx.beginPath(); ctx.ellipse(q[0], q[1], p.r * (1 + 1.6 * f), p.r * (1 + 1.6 * f) * v.ct, 0, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  function minimap(ctx, Wc, G, R, size, rivals = []) {
    const side = Math.min(170, Wc * 0.32), x0 = Wc - side - 16, y0 = 16, s = side / size, C = R.craft;
    ctx.save();
    ctx.fillStyle = 'rgba(5,6,10,0.7)'; ctx.fillRect(x0, y0, side, side);
    ctx.translate(x0, y0); ctx.scale(s, s);
    ctx.strokeStyle = 'rgba(223,230,242,0.25)'; ctx.lineWidth = 2 * G.hw; ctx.lineJoin = 'round'; ctx.stroke(G.mini);
    const dot = (x, y, r, col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r / s, 0, TAU); ctx.fill(); };
    for (const p of G.holes) dot(p.x, p.y, 1.6, p.emit ? '#ff8a3a' : '#c9a86a');
    for (const p of G.talls) dot(p.x, p.y, 1.8, '#ff5a5a');
    const st = G.tr.pts[0], cp = G.tr.pts[G.tr.cps[R.next]];
    dot(st.x, st.y, 2.5, '#ffffff');
    if (R.phase === 'race') dot(cp.x, cp.y, 3, '#7df9ff');
    for (const o of rivals) dot(o.x, o.y, 2.6, o.color);
    ctx.translate(C.x, C.y); ctx.rotate(C.angle); ctx.scale(1 / s, 1 / s);
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(-4, -4); ctx.lineTo(-4, 4); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  // A dashed ring of full-speed reach round where the drag began, a line to the finger (held to the
  // ring) and the speed it sets.
  function drag(ctx, d, md) {
    if (!d.active) return;
    const dx = d.x - d.x0, dy = d.y - d.y0, len = Math.hypot(dx, dy), k = len > md ? md / len : 1;
    const ex = d.x0 + dx * k, ey = d.y0 + dy * k;
    ctx.save();
    ctx.strokeStyle = '#cfd8ff'; ctx.globalAlpha = 0.5; ctx.lineWidth = 1.5; ctx.setLineDash([4, 6]); // stronger than the game's: it sits on bright ground
    ctx.beginPath(); ctx.arc(d.x0, d.y0, md, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.8; ctx.strokeStyle = '#7df9ff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(d.x0, d.y0); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.beginPath(); ctx.arc(d.x0, d.y0, 4, 0, TAU); ctx.arc(ex, ey, 10, 0, TAU); ctx.stroke();
    if (len > 8) { ctx.fillStyle = '#7df9ff'; ctx.font = "12px 'IBM Plex Mono', ui-monospace, Menlo, Consolas, monospace"; ctx.fillText(`${Math.round(Math.min(len / md, 1) * 100)}%`, ex + 14, ey - 14); }
    ctx.restore();
  }

  // The stick: its ring fixed at home in the band, brighter with a thumb on it, the knob held to the
  // ring; the brake zone in the middle, lit while braking. The dash's
  // charges as pips under the home ring, the next one filling.
  function pad(ctx, P, home, md, inner, dash, DASH, drift, DRIFT) {
    const charges = DASH.charges;
    const on = P.active, bx = on ? P.bx : home.x, by = on ? P.by : home.y;
    ctx.save();
    ctx.strokeStyle = '#cfd8ff'; ctx.lineWidth = 1.5; ctx.globalAlpha = on ? 0.5 : 0.28;
    ctx.beginPath(); ctx.arc(bx, by, md, 0, TAU); ctx.stroke();
    ctx.setLineDash([3, 5]); ctx.beginPath(); ctx.arc(bx, by, md * inner, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    if (on && P.brake) { ctx.globalAlpha = 0.45; ctx.fillStyle = '#ffb03a'; ctx.beginPath(); ctx.arc(bx, by, md * inner, 0, TAU); ctx.fill(); }
    if (on) {
      const dx = P.x - bx, dy = P.y - by, len = Math.hypot(dx, dy), k = len > md ? md / len : 1, kx = bx + dx * k, ky = by + dy * k;
      ctx.globalAlpha = 0.85; ctx.strokeStyle = '#7df9ff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(kx, ky); ctx.stroke();
      ctx.beginPath(); ctx.arc(kx, ky, 14, 0, TAU); ctx.stroke();
    }
    ctx.globalAlpha = 0.8; ctx.lineWidth = 2;
    for (let i = 0; i < charges; i++) {
      const x = home.x + (i - (charges - 1) / 2) * 18, y = home.y + md + 12;
      ctx.strokeStyle = ctx.fillStyle = '#7df9ff';
      ctx.beginPath(); ctx.arc(x, y, 5, 0, TAU); ctx.stroke();
      if (i < dash.charges) ctx.fill();
      else if (i === dash.charges) { ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, 5, -Math.PI / 2, -Math.PI / 2 + TAU * (dash.refill / DASH.refill)); ctx.fill(); }
    }
    // The drift's charge: an arc over the top of the ring filling left to right, a tick at the first
    // level, its colour the level reached.
    if (drift) {
      const r = md + 8, a0 = -Math.PI * 0.75, span = Math.PI / 2, at = DRIFT.at, f = Math.min(1, drift.t / at[1]), tick = a0 + (span * at[0]) / at[1];
      ctx.lineCap = 'round'; ctx.lineWidth = 3; ctx.globalAlpha = 0.25; ctx.strokeStyle = '#cfd8ff';
      ctx.beginPath(); ctx.arc(home.x, home.y, r, a0, a0 + span); ctx.stroke();
      ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(home.x + Math.cos(tick) * (r - 5), home.y + Math.sin(tick) * (r - 5)); ctx.lineTo(home.x + Math.cos(tick) * (r + 5), home.y + Math.sin(tick) * (r + 5)); ctx.stroke();
      if (f > 0) { ctx.lineWidth = 3; ctx.globalAlpha = 0.9; ctx.strokeStyle = `rgb(${DRIFT_RGB[drift.level]})`; ctx.beginPath(); ctx.arc(home.x, home.y, r, a0, a0 + span * f); ctx.stroke(); }
    }
    ctx.restore();
  }

  // Steering by sides: a chevron at each side's edge, lit while held.
  function sides(ctx, Wc, Hc, held) {
    ctx.save();
    ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const [s, on] of [[-1, held.left], [1, held.right]]) {
      const x = Wc / 2 + s * (Wc / 2 - 34), y = Hc * 0.55;
      ctx.strokeStyle = on ? 'rgba(125,249,255,0.9)' : 'rgba(207,216,255,0.3)';
      ctx.beginPath(); ctx.moveTo(x - s * 6, y - 16); ctx.lineTo(x + s * 10, y); ctx.lineTo(x - s * 6, y + 16); ctx.stroke();
    }
    ctx.restore();
  }

  const fmt = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;
  const nth = (n) => `${n}${['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] || 'th'}`;
  function hud(G, R, cfg, missing, pos) {
    const best = R.laps.length ? Math.min(...R.laps) : null, lap = Math.min(cfg.laps, R.laps.length + 1), hullPct = Math.round((100 * R.hull) / cfg.hull);
    const parts = Object.entries(R.haul.parts).map(([k, n]) => `${img(k, 16)}${n}`).join(' ');
    const rest = `Best ${best === null ? '–' : fmt(best)} · last ${R.laps.length ? fmt(R.laps[R.laps.length - 1]) : '–'}<br>${img('chip', 16)}${R.haul.credits}${parts ? ` ${parts}` : ''} · Hull ${hullPct}% · hits ${R.hits}${R.off > 0.5 || R.slow ? ` · <span style="color:#ffb03a">${R.burn ? 'burning' : R.off > 0.5 ? 'off the track' : 'slowed'}</span>` : ''}${missing ? `<br><span style="opacity:.6">${missing} chunks building</span>` : ''}`;
    const order = pos ? `<ol>${pos.rows.map((r, i) => `<li${r.you ? ' class="you"' : ''}><span class="num">${i + 1}</span><i class="rm-face" data-f="${r.id}" style="--c:${r.color}" title="${r.name}" aria-label="${r.name}"></i></li>`).join('')}</ol>` : '';
    return { lap: `Lap ${lap}/${cfg.laps}${pos ? ` · P${pos.place}/${pos.of}` : ''}`, time: fmt(R.lapT), total: `Total ${fmt(R.total)}`, rest, order };
  }
  const banked = (b) => (b ? `\nBanked ${b.credits} credits${Object.entries(b.parts).map(([k, n]) => ` · ${n} ${k}`).join('')} (×${b.mult}${b.purse ? `, purse ${b.purse}` : ''})` : '');
  function note(R, cfg, pos) {
    const best = R.laps.length ? Math.min(...R.laps) : null, hullPct = Math.round((100 * R.hull) / cfg.hull), lap = Math.min(cfg.laps, R.laps.length + 1);
    if (R.phase === 'count') return { msg: R.t < 2.4 ? String(3 - Math.floor(R.t / 0.8)) : 'GO', big: true };
    if (R.phase === 'race' && R.total < 0.8) return { msg: 'GO', big: true };
    if (R.phase === 'race' && R.wrong > 0.8) return { msg: 'Wrong way', big: false };
    if (R.phase === 'done') return { msg: `Finished ${pos ? `${nth(pos.place)} of ${pos.of} ` : ''}in ${fmt(R.total)}\nBest lap ${fmt(best)} · ${R.hits} hits · hull ${hullPct}%${banked(R.banked)}\nR to race again · Menu for the hangar or another planet`, big: false };
    if (R.phase === 'wreck') return { msg: `The hull gave out on lap ${lap}${banked(R.banked)}\nR to try again · Menu for the hangar or another planet`, big: false };
    return { msg: '', big: false };
  }

  return { PART, icon, lines, marks, pickups, storm, ship, trail, streaks, sparks, dust, minimap, drag, pad, sides, hud, note };
})();

export { Draw };
