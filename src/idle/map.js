// The idle game's system view: the star, the planets and moons, the asteroid field and the stations
// on one canvas, in the low-poly style, with the shuttles' haulers flying between them and what was
// just made floating up from where it was made. Not to scale: every thing is an icon of a fixed size
// at its place in the system, and icons that would overlap are pushed apart (moons round their
// planet, stations beside theirs). Drag to pan, pinch or the wheel to zoom, tap a thing to pick it.
//
//   IdleMap.create(canvas, w, { onPick(key | null) }) -> map
//     map.draw(state, now, selected)   one frame
//     map.made(log)                    floaters for a settle's log (rules/industry.js settle)
//     map.resize()                     after the canvas's size changed
// ES module (`IdleMap`); needs a browser.

import { ArtBlueprints } from '../art/blueprints.js';
import { ArtBodies } from '../art/bodies.js';
import { ArtCulture } from '../art/culture.js';
import { Art } from '../art/render.js';
import { ArtStationRoles } from '../art/station-roles.js';
import { Goods } from '../rules/goods.js';
import { IdleRules } from './rules.js';

const IdleMap = (() => {
  const STYLE = 'lowpoly';
  const SIZE = { star: 26, planet: 20, moon: 10, field: 18, station: 18 }; // icon radius, CSS px
  const GAP = 6; // px kept between icons
  const FLOAT = 1600; // ms a floater rises
  const TOP = 56; // px the bar takes along the top

  const hsl = ([h, s, l]) => `hsl(${h} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;
  const colorOf = (kind) => { const t = Goods.type(kind); return t ? hsl(t.color) : '#cfd8ff'; };

  function create(canvas, w, { onPick }) {
    const ctx = canvas.getContext('2d');
    const cultures = ArtCulture.forGalaxy(w.galaxy);
    let dpr = 1, W = 0, H = 0, fit = 1, zoom = 1, cx = 0, cy = 0;
    const sprites = new Map();
    const floaters = [];
    const midY = () => TOP + (H - TOP) / 2;

    // ---------- Icons ----------

    // A sprite of radius r px: drawn once into its own canvas, unit radius scaled up.
    function sprite(key, r, paint) {
      const id = `${key}|${r}|${dpr}`;
      if (sprites.has(id)) return sprites.get(id);
      const cv = document.createElement('canvas'), n = Math.ceil(r * 2.6 * dpr);
      cv.width = cv.height = n;
      const g = cv.getContext('2d');
      paint(g, n / 2, (r * dpr));
      sprites.set(id, cv);
      return cv;
    }
    const bodyIcon = (x, r) => sprite(x.key, r, (g, c, R) => {
      g.setTransform(R, 0, 0, R, c, c);
      const b = { ...x.body, x: 0, y: 0, r: 1 };
      if (x.kind === 'moon') ArtBodies.drawMoon(g, b, STYLE, { force: true });
      else Art.drawPlanet(g, { ...b, ring: false }, STYLE, { force: true });
    });
    const stationArt = new Map();
    function stationIcon(st, r) {
      if (!stationArt.has(st.key)) {
        const role = ArtStationRoles.ROLE_OF[st.type], c = cultures.of(st.culture);
        stationArt.set(st.key, role ? ArtStationRoles.create(role, c, st.seed, st.size) : ArtBlueprints.create(st.size === 'major' ? 'station-major' : 'station-minor', c, st.seed));
      }
      const bp = stationArt.get(st.key);
      return sprite(st.key, r, (g, c, R) => {
        const k = R / (bp.radius || 100);
        g.setTransform(k, 0, 0, k, c, c);
        Art.drawAsset(g, bp, STYLE, { angle: -Math.PI / 2, t: 0, thrust: 0 });
      });
    }
    const fieldIcon = (x, r) => sprite(x.key, r, (g, c, R) => {
      // A scatter of rocks, seeded by the field.
      let s = 0x9e3779b9 ^ (x.key.length * 7919);
      const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
      for (let i = 0; i < 9; i++) {
        const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * R * 0.8, rr = R * (0.12 + rnd() * 0.16);
        g.fillStyle = i % 2 ? '#7d7466' : '#a39784';
        g.beginPath();
        for (let k = 0; k < 6; k++) { const b = (k / 6) * Math.PI * 2, q = rr * (0.75 + rnd() * 0.4); g.lineTo(c + Math.cos(a) * d + Math.cos(b) * q, c + Math.sin(a) * d + Math.sin(b) * q); }
        g.fill();
      }
    });

    // ---------- Layout: where each icon goes, in world units at zoom 1 ----------

    const items = [
      { key: 'star', kind: 'star', x: 0, y: 0, r: SIZE.star },
      ...w.sites.map((s) => ({ key: s.key, kind: s.kind, x: s.x, y: s.y, r: SIZE[s.kind], ref: s })),
      ...w.stations.map((s) => ({ key: s.key, kind: 'station', x: s.x, y: s.y, r: SIZE.station, ref: s })),
    ];
    const at = new Map(); // key -> { x, y } screen px at the current view
    let laidFor = '';
    function layout() {
      const k = fit * zoom, id = `${k}|${cx}|${cy}|${W}|${H}`;
      if (id === laidFor) return;
      laidFor = id;
      const p = items.map((it) => ({ it, x: W / 2 + (it.x - cx) * k, y: midY() + (it.y - cy) * k, fixed: it.kind === 'star' || it.kind === 'planet' || it.kind === 'field' }));
      // Push apart what overlaps; planets, the field and the star stay put while anything else is moved.
      for (let pass = 0; pass < 40; pass++) {
        let moved = false;
        for (let i = 0; i < p.length; i++) {
          for (let j = i + 1; j < p.length; j++) {
            const a = p[i], b = p[j], min = a.it.r + b.it.r + GAP;
            let dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
            if (d >= min) continue;
            if (d < 0.01) { dx = Math.cos(i + j); dy = Math.sin(i + j); d = 1; }
            const push = min - d, ux = dx / d, uy = dy / d;
            if (a.fixed && b.fixed) continue;
            if (a.fixed) { b.x += ux * push; b.y += uy * push; } else if (b.fixed) { a.x -= ux * push; a.y -= uy * push; } else { a.x -= (ux * push) / 2; a.y -= (uy * push) / 2; b.x += (ux * push) / 2; b.y += (uy * push) / 2; }
            moved = true;
          }
        }
        if (!moved) break;
      }
      at.clear();
      for (const q of p) at.set(q.it.key, { x: q.x, y: q.y });
    }

    function resize() {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = canvas.clientWidth; H = canvas.clientHeight;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      // Fit the whole system, framed below the bar, centred on its middle.
      const xs = items.map((it) => it.x), ys = items.map((it) => it.y);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      fit = Math.min((W - 140) / Math.max(1, x1 - x0), (H - TOP - 80) / Math.max(1, y1 - y0));
      cx = (x0 + x1) / 2; cy = (y0 + y1) / 2; zoom = 1;
      laidFor = '';
    }

    // ---------- Drawing ----------

    function haulerPos(state, r, h, now) {
      const n = r.stops.length, to = at.get(r.stops[h.stop].station);
      if (!to) return null;
      if (h.next == null) return { ...to, idle: true };
      const from = at.get(r.stops[(h.stop - 1 + n) % n].station);
      if (!from) return to;
      const f = Math.min(1, Math.max(0, (now - h.at) / Math.max(1, h.next - h.at)));
      return { x: from.x + (to.x - from.x) * f, y: from.y + (to.y - from.y) * f, dir: Math.atan2(to.y - from.y, to.x - from.x) };
    }

    function draw(state, now, selected) {
      layout();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#05060a';
      ctx.fillRect(0, 0, W, H);
      // Routes, faint, under everything.
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 5]);
      ctx.strokeStyle = 'rgba(125, 249, 255, 0.22)';
      for (const r of state.industry.routes) {
        ctx.beginPath();
        r.stops.forEach((s, i) => { const p = at.get(s.station); if (p) ctx[i ? 'lineTo' : 'moveTo'](p.x, p.y); });
        if (r.stops.length > 2) ctx.closePath();
        ctx.stroke();
      }
      ctx.setLineDash([]);
      // The star: a glow.
      const s = at.get('star');
      const glow = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, SIZE.star * 1.8);
      glow.addColorStop(0, '#fff0d6'); glow.addColorStop(0.35, '#ffc27a'); glow.addColorStop(0.6, 'rgba(255,154,60,0.35)'); glow.addColorStop(1, 'rgba(255,154,60,0)');
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(s.x, s.y, SIZE.star * 1.8, 0, Math.PI * 2); ctx.fill();
      // Bodies, the field and the stations.
      ctx.font = '600 11px "Barlow Semi Condensed", system-ui, sans-serif';
      ctx.textAlign = 'center';
      for (const it of items) {
        if (it.kind === 'star') continue;
        const p = at.get(it.key), r = it.r;
        const on = it.kind !== 'station' || IdleRules.online(state, w, it.key);
        const cv = it.kind === 'station' ? stationIcon(it.ref, r) : it.kind === 'field' ? fieldIcon(it.ref, r) : bodyIcon(it.ref, r);
        ctx.globalAlpha = on ? 1 : 0.35;
        ctx.drawImage(cv, p.x - cv.width / dpr / 2, p.y - cv.height / dpr / 2, cv.width / dpr, cv.height / dpr);
        ctx.globalAlpha = 1;
        const drills = state.drills[it.key] || 0;
        if (it.key === selected) {
          ctx.strokeStyle = '#7df9ff'; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(p.x, p.y, r + 5, 0, Math.PI * 2); ctx.stroke();
        }
        if (it.kind === 'station' || drills || it.key === selected) {
          ctx.fillStyle = on ? '#cfd8ff' : '#7d88a8';
          ctx.fillText(it.kind === 'station' && !on ? `${it.ref.name} · offline` : it.ref.name, p.x, p.y + r + 13);
        }
        if (drills) {
          ctx.fillStyle = '#ffcf5a';
          ctx.fillText(`×${drills}`, p.x, p.y - r - 5);
        }
      }
      // Haulers: a small dart with a dot of what it carries.
      for (const r of state.industry.routes) {
        for (const h of r.haulers) {
          const p = haulerPos(state, r, h, now);
          if (!p || p.idle) continue;
          const kinds = Object.keys(h.load);
          ctx.save();
          ctx.translate(p.x, p.y); ctx.rotate(p.dir || 0);
          ctx.fillStyle = '#eef1ff';
          ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(-4, -3.5); ctx.lineTo(-2, 0); ctx.lineTo(-4, 3.5); ctx.closePath(); ctx.fill();
          if (kinds.length) { ctx.fillStyle = colorOf(kinds[0]); ctx.beginPath(); ctx.arc(-6, 0, 2.2, 0, Math.PI * 2); ctx.fill(); }
          ctx.restore();
        }
      }
      // Floaters.
      for (let i = floaters.length - 1; i >= 0; i--) {
        const f = floaters[i], age = performance.now() - f.t0;
        if (age > FLOAT) { floaters.splice(i, 1); continue; }
        const p = at.get(f.key);
        if (!p) continue;
        ctx.globalAlpha = 1 - age / FLOAT;
        ctx.fillStyle = f.color;
        ctx.fillText(f.text, p.x + f.dx, p.y - 24 - (age / FLOAT) * 22);
      }
      ctx.globalAlpha = 1;
    }

    function made(log) {
      const by = new Map();
      for (const x of log) {
        for (const [kind, n] of Object.entries(x.out || x.delivered || {})) {
          const id = `${x.key}|${kind}`;
          by.set(id, { key: x.key, kind, n: (by.get(id)?.n || 0) + n });
        }
      }
      let i = 0;
      for (const f of by.values()) {
        if (floaters.length > 40) break;
        floaters.push({ key: f.key, text: `+${f.n} ${Goods.type(f.kind)?.name || ''}`.trim(), color: colorOf(f.kind), t0: performance.now() + (i % 3) * 120, dx: 0 });
        i++;
      }
    }

    // ---------- Input ----------

    const pointers = new Map();
    let downAt = null, moved = false, pinch = null;
    const toWorld = (x, y) => ({ x: cx + (x - W / 2) / (fit * zoom), y: cy + (y - midY()) / (fit * zoom) });
    function zoomAt(f, x, y) {
      const before = toWorld(x, y);
      zoom = Math.min(8, Math.max(0.6, zoom * f));
      const after = toWorld(x, y);
      cx += before.x - after.x; cy += before.y - after.y;
    }
    function pick(x, y) {
      let best = null, bd = Infinity;
      for (const it of items) {
        if (it.kind === 'star') continue;
        const p = at.get(it.key), d = Math.hypot(p.x - x, p.y - y);
        if (d < Math.max(24, it.r + 8) && d < bd) { best = it.key; bd = d; }
      }
      return best;
    }
    const local = (e) => { const b = canvas.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture?.(e.pointerId);
      pointers.set(e.pointerId, local(e));
      if (pointers.size === 1) { downAt = local(e); moved = false; }
      if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) }; moved = true; }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) return;
      const prev = pointers.get(e.pointerId), p = local(e);
      pointers.set(e.pointerId, p);
      if (pointers.size === 2 && pinch) {
        const [a, b] = [...pointers.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch.d > 0) zoomAt(d / pinch.d, (a.x + b.x) / 2, (a.y + b.y) / 2);
        pinch.d = d;
      } else if (pointers.size === 1) {
        if (downAt && Math.hypot(p.x - downAt.x, p.y - downAt.y) > 6) moved = true;
        if (moved) { cx -= (p.x - prev.x) / (fit * zoom); cy -= (p.y - prev.y) / (fit * zoom); }
      }
    });
    const up = (e) => {
      if (!pointers.has(e.pointerId)) return;
      const p = pointers.get(e.pointerId);
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (!pointers.size && !moved && downAt) onPick(pick(p.x, p.y));
      if (!pointers.size) downAt = null;
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', (e) => { moved = true; up(e); });
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); const p = local(e); zoomAt(Math.exp(-e.deltaY * 0.0015), p.x, p.y); }, { passive: false });

    resize();
    return { draw, made, resize, pick };
  }

  return { create };
})();

export { IdleMap };
