// Drawing the race over the ground: the track's edges and kerbs, the start line and the next checkpoint, the ships (yours,
// the rivals' and your best lap's ghost) with their shadows, the minimap, the stick, the drag (as game/hud.js
// drawDragIndicator draws it) or the halves held when steering by sides, and the HUD's text.
//
//   Draw.marks(ctx, v, px, time, G, R, ground)    ground(v, x, y, z) -> [X, Y] | null
//   Draw.lines(G) -> { edges, kerbs }   the edges and kerbs on the ground, worked out once a track (G.lines)
//   Draw.ship(ctx, v, ship, body, { style, time, alpha, shadow, ground, bank })   ship: { art, k (scale), r, z }
//     (ground: needed for the shadow); bank: the roll into a turn, a squash across the ship (0 .. 1)
//   Draw.trail(ctx, v, trails, now, life, width)   the engines' trails: per engine, points { x, y, z, t, a, c }
//     oldest first (t: when, s; a: strength 0 .. 1; c: colour, TRAIL_RGB), gone after life s
//   Draw.streaks(ctx, Wc, Hc, cx, cy, a, time)   a boost's speed streaks in from the screen's edges toward
//     (cx, cy) (CSS px); a: their strength (0 .. 1)
//   Draw.minimap(ctx, Wc, G, R, size, ghost?, rivals?)    size: the map's side (world units); ghost: { x, y };
//     rivals: [{ x, y, color }]
//   Draw.drag(ctx, drag, maxDrag), Draw.sides(ctx, Wc, Hc, held)
//   Draw.pad(ctx, pad, home, radius, inner, dash, DASH, drift, DRIFT)   the stick (Input.pad, Input.home()),
//     the dash's charges (Run's R.dash, Run.DASH) and the drift's charge (R.drift, Run.DRIFT)
//   Draw.sparks(ctx, v, px, body, z, drift, time, ground)   sparks off the tail while a slide has
//     charged a level, coloured by it (R.drift); z: the ship's height
//   Draw.dust(ctx, v, px, puffs, ground)   dust puffs ({ x, y, z, r, t, life, a, col }: Dust.puffs)
//   Draw.hud(G, R, cfg, missing, pos?) -> { lap, time, total, rest, order }   text ×3, html, html (the standings, '' with no rivals); missing: chunks still building
//     in view; pos: Rival.standings(), the place and the order, when there are rivals
//   Draw.note(R, cfg, pos?) -> { msg, big }       the message over the track (the countdown, …)
// ES module (`Draw`); needs a browser.

import { Art } from '../art/render.js';
import { ArtSurface } from '../art/surface.js';
import { SurfaceGlobe } from '../art/surface-globe.js';

const Draw = (() => {
  const TAU = Math.PI * 2;

  // A line across the track at centreline point n, from −f to +f of its half-width.
  function across(v, G, ground, n, f, z = 0) {
    const p = G.tr.pts[n];
    return [-1, 1].map((s) => ground(v, p.x - p.ty * p.hw * f * s, p.y + p.tx * p.hw * f * s, z));
  }

  // The edges, a point a centreline point each side, at the ground's height there; kerbs on the bends
  // tighter than KERB: on the inside through the bend's middle, on the outside over its exit, striped
  // `stripe` points a colour. f: which edge (+1: the left of the way round, −1: the right).
  const KERB = { k: 1 / 700, w: 10, stripe: 2, inside: [0.2, 0.8], outside: [0.5, 1.15] };
  function lines(G) {
    const { pts, samples: S } = G.tr, at = (p, f, o = 0) => { const x = p.x - p.ty * (p.hw - o) * f, y = p.y + p.tx * (p.hw - o) * f; return { x, y, z: ArtSurface.heightAt(G.W, x, y) }; };
    const edges = [1, -1].map((f) => pts.map((p) => at(p, f)));
    const kerbs = [], from = pts.findIndex((p, n) => (p.k > KERB.k) !== (pts[(n + S - 1) % S].k > KERB.k));
    for (let m = 0, start = -1; from >= 0 && m <= S; m++) {
      const n = (from + m) % S, on = m < S && pts[n].k > KERB.k;
      if (on && start < 0) start = m;
      if (!on && start >= 0) {
        const len = m - start, f = pts[(from + start + (len >> 1)) % S].side;
        for (const [g, [a, b]] of [[f, KERB.inside], [-f, KERB.outside]]) {
          const run = [];
          for (let s = Math.round(start + a * len); s <= Math.round(start + b * len); s++) run.push(at(pts[(from + s) % S], g, KERB.w / 2));
          kerbs.push(run);
        }
        start = -1;
      }
    }
    return { edges, kerbs };
  }
  const screen = (v, q) => SurfaceGlobe.toScreen(v, q.x, q.y, q.z);
  function edgesAndKerbs(ctx, v, L) {
    ctx.lineCap = 'butt'; ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(245,248,255,0.5)'; ctx.lineWidth = 3;
    ctx.beginPath();
    for (const e of L.edges) {
      let was = false;
      for (let n = 0; n <= e.length; n++) { const s = screen(v, e[n % e.length]); if (s) { if (was) ctx.lineTo(s[0], s[1]); else ctx.moveTo(s[0], s[1]); } was = !!s; }
    }
    ctx.stroke();
    ctx.lineWidth = KERB.w;
    for (const [col, odd] of [['rgba(240,244,250,0.85)', -1], ['rgba(214,52,44,0.9)', 1]]) {
      ctx.strokeStyle = col; ctx.beginPath();
      for (const run of L.kerbs) for (let n = 0; n + 1 < run.length; n++) {
        if (odd >= 0 && Math.floor(n / KERB.stripe) % 2 !== odd) continue;
        const a = screen(v, run[n]), b = screen(v, run[n + 1]);
        if (a && b) { ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
      }
      ctx.stroke();
    }
  }

  function marks(ctx, v, px, time, G, R, ground) {
    if (G.lines) edgesAndKerbs(ctx, v, G.lines);
    // The start line: a chequered strip.
    const p = G.tr.pts[0], segs = 12;
    ctx.lineWidth = 9 * px; ctx.lineCap = 'butt';
    for (let s = 0; s < segs; s++) {
      const f0 = -1 + (2 * s) / segs, f1 = f0 + 2 / segs;
      const a = ground(v, p.x - p.ty * p.hw * f0, p.y + p.tx * p.hw * f0), b = ground(v, p.x - p.ty * p.hw * f1, p.y + p.tx * p.hw * f1);
      if (!a || !b) continue;
      ctx.strokeStyle = s % 2 ? 'rgba(20,22,28,0.85)' : 'rgba(240,244,250,0.9)';
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
    // The next checkpoint: a dashed line across and a beacon at each side.
    if (R.phase !== 'race') return;
    const n = G.tr.cps[R.next], pulse = 0.6 + 0.4 * Math.sin(time * 6);
    const [a, b] = across(v, G, ground, n, 0.95), [a2, b2] = across(v, G, ground, n, 0.95, 60);
    ctx.strokeStyle = `rgba(125,249,255,${0.5 * pulse})`; ctx.lineWidth = 2 * px; ctx.setLineDash([8 * px, 8 * px]);
    if (a && b) { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
    ctx.setLineDash([]); ctx.lineWidth = 3 * px; ctx.strokeStyle = `rgba(125,249,255,${pulse})`;
    for (const [g, t] of [[a, a2], [b, b2]]) if (g && t) { ctx.beginPath(); ctx.moveTo(g[0], g[1]); ctx.lineTo(t[0], t[1]); ctx.stroke(); }
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

  function minimap(ctx, Wc, G, R, size, ghost, rivals = []) {
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
    if (ghost) dot(ghost.x, ghost.y, 2.2, 'rgba(200,190,255,0.8)');
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
    const rest = `Best ${best === null ? '–' : fmt(best)} · last ${R.laps.length ? fmt(R.laps[R.laps.length - 1]) : '–'}${R.ghost ? ` · ghost ${fmt(R.ghost.time)}` : ''}<br>Hull ${hullPct}% · hits ${R.hits}${R.off > 0.5 || R.slow ? ` · <span style="color:#ffb03a">${R.burn ? 'burning' : R.off > 0.5 ? 'off the track' : 'slowed'}</span>` : ''}${missing ? `<br><span style="opacity:.6">${missing} chunks building</span>` : ''}`;
    const order = pos ? `<ol>${pos.rows.map((r, i) => `<li${r.you ? ' class="you"' : ''}><span class="num">${i + 1}</span><span style="color:${r.color}">${r.name}</span></li>`).join('')}</ol>` : '';
    return { lap: `Lap ${lap}/${cfg.laps}${pos ? ` · P${pos.place}/${pos.of}` : ''}`, time: fmt(R.lapT), total: `Total ${fmt(R.total)}`, rest, order };
  }
  function note(R, cfg, pos) {
    const best = R.laps.length ? Math.min(...R.laps) : null, hullPct = Math.round((100 * R.hull) / cfg.hull), lap = Math.min(cfg.laps, R.laps.length + 1);
    if (R.phase === 'count') return { msg: R.t < 2.4 ? String(3 - Math.floor(R.t / 0.8)) : 'GO', big: true };
    if (R.phase === 'race' && R.total < 0.8) return { msg: 'GO', big: true };
    if (R.phase === 'race' && R.wrong > 0.8) return { msg: 'Wrong way', big: false };
    if (R.phase === 'done') return { msg: `Finished ${pos ? `${nth(pos.place)} of ${pos.of} ` : ''}in ${fmt(R.total)}\nBest lap ${fmt(best)}${R.newBest ? ' · new best' : ''} · ${R.hits} hits · hull ${hullPct}%\nR to race again · Menu for another planet`, big: false };
    if (R.phase === 'wreck') return { msg: `The hull gave out on lap ${lap}\nR to try again · Menu for another planet`, big: false };
    return { msg: '', big: false };
  }

  return { lines, marks, ship, trail, streaks, sparks, dust, minimap, drag, pad, sides, hud, note };
})();

export { Draw };
