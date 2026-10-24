// Drawing the race over the ground: the start line and the next checkpoint, the ships (yours and
// your best lap's ghost) with their shadows, the minimap, the drag (as game/hud.js drawDragIndicator
// draws it) or the halves held when steering by sides, and the HUD's text.
//
//   Draw.marks(ctx, v, px, time, G, R, ground)    ground(v, x, y, z) -> [X, Y] | null
//   Draw.ship(ctx, v, ship, body, { style, time, alpha, shadow, ground })   ship: { art, k (scale), r, z }
//     (ground: needed for the shadow)
//   Draw.minimap(ctx, Wc, G, R, size, ghost?)    size: the map's side (world units); ghost: { x, y }
//   Draw.drag(ctx, drag, maxDrag), Draw.sides(ctx, Wc, Hc, held)
//   Draw.hud(G, R, cfg, missing) -> { lap, time, rest }   text, text, html; missing: chunks still building in view
//   Draw.note(R, cfg) -> { msg, big }             the message over the track (the countdown, …)
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

  function marks(ctx, v, px, time, G, R, ground) {
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

  // The ship at flight height, its shadow below and to the side (as game/landing.js draws it).
  function ship(ctx, v, s, b, o) {
    const [shx, shy] = ArtSurface.shadowShift(s.z);
    ctx.save();
    ctx.globalAlpha = o.alpha ?? 1;
    if (o.shadow) {
      const sh = o.ground(v, b.x + shx, b.y + shy);
      if (sh) { ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(sh[0], sh[1], s.r * 1.3, s.r * 1.3 * v.ct, 0, 0, TAU); ctx.fill(); }
    }
    const p = SurfaceGlobe.toScreen(v, b.x, b.y, s.z) || [v.ox + b.x - v.fx, v.oy + (b.y - v.fy) * v.ct - s.z * v.st];
    ctx.translate(p[0], p[1]); ctx.scale(s.k, s.k);
    Art.drawAsset(ctx, s.art, o.style, { angle: b.angle, t: o.time, thrust: b.thrust || 0 });
    ctx.restore();
  }

  function minimap(ctx, Wc, G, R, size, ghost) {
    const side = Math.min(170, Wc * 0.32), x0 = Wc - side - 16, y0 = 64, s = side / size, C = R.craft;
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
  function hud(G, R, cfg, missing) {
    const best = R.laps.length ? Math.min(...R.laps) : null, lap = Math.min(cfg.laps, R.laps.length + 1), hullPct = Math.round((100 * R.hull) / cfg.hull);
    const rest = `Best ${best === null ? '–' : fmt(best)} · last ${R.laps.length ? fmt(R.laps[R.laps.length - 1]) : '–'}${R.ghost ? ` · ghost ${fmt(R.ghost.time)}` : ''}<br>Hull ${hullPct}% · hits ${R.hits}${R.slow ? ` · <span style="color:#ffb03a">${R.burn ? 'burning' : 'slowed'}</span>` : ''}<br><span style="opacity:.6">${G.b.label} · seed ${G.seed} · ${Math.round(G.tr.len)} u a lap · ${G.talls.length} rocks, ${G.holes.length} holes on the track${missing ? ` · ${missing} chunks building` : ''}</span>`;
    return { lap: `Lap ${lap}/${cfg.laps}`, time: `${fmt(R.lapT)} · total ${fmt(R.total)}`, rest };
  }
  function note(R, cfg) {
    const best = R.laps.length ? Math.min(...R.laps) : null, hullPct = Math.round((100 * R.hull) / cfg.hull), lap = Math.min(cfg.laps, R.laps.length + 1);
    if (R.phase === 'count') return { msg: R.t < 2.4 ? String(3 - Math.floor(R.t / 0.8)) : 'GO', big: true };
    if (R.phase === 'race' && R.total < 0.8) return { msg: 'GO', big: true };
    if (R.phase === 'race' && R.wrong > 0.8) return { msg: 'Wrong way', big: false };
    if (R.phase === 'done') return { msg: `Finished in ${fmt(R.total)}\nBest lap ${fmt(best)}${R.newBest ? ' · new best' : ''} · ${R.hits} hits · hull ${hullPct}%\nR to race again · N for a new track`, big: false };
    if (R.phase === 'wreck') return { msg: `The hull gave out on lap ${lap}\nR to try again · N for a new track`, big: false };
    return { msg: '', big: false };
  }

  return { marks, ship, minimap, drag, sides, hud, note };
})();

export { Draw };
