// The idle game's system view, drawn like the game's own system map (ui/map.js) and in its Line art
// style: the star in the middle, the planets and the asteroid field each on an orbit round it, the
// moons on small orbits round their planets, and the stations built in orbit round the bodies they
// were built at. It's a schematic, not to scale: the orbits are evenly spaced and the bodies far
// larger than they'd be, so the system fits a phone held upright. Everything goes round on the real
// clock, the inner orbits faster (Kepler's 1.5 power), so the system looks the same whenever it's
// opened. Bodies not yet charted are signals on their orbits (a dashed ring and a '?'); a moon
// shows only once its planet is charted. A body being surveyed has the probe's sweep round it.
// Shuttles' haulers fly between where their stops are now (and haulers sent by hand from where they
// left to where they go), and what was just made floats up from
// where it was made. Drag to pan, pinch or the wheel to zoom, tap a thing to pick it; a picked
// thing is followed, zoomed in on, and kept clear of the sheet over the bottom of the screen.
// A station just built has its scene: the camera comes to it, a scaffold ring and brackets go up
// round its berth, the station fades in and settles, and a pulse goes out as it comes online; a
// tap ends it early.
//
//   IdleMap.create(canvas, w, { onPick(key | null) }) -> map
//     map.draw(state, now, selected)   one frame
//     map.made(log)                    floaters for a settle's log (rules/industry.js settle)
//     map.focus(key | null)            follow and zoom in on that thing; null: the whole system
//     map.inset(top, bottom)           the screen px the bar and the sheet cover (kept clear)
//     map.resize()                     after the canvas's size changed
//     map.built(key, onDone)           the build scene for that station; onDone() once it ends (or is tapped)
//     map.skip()                       end the build scene now; map.scene: whether one is playing
// ES module (`IdleMap`); needs a browser.

import { ArtBlueprints } from '../art/blueprints.js';
import { ArtBodies } from '../art/bodies.js';
import { ArtCulture } from '../art/culture.js';
import { Art } from '../art/render.js';
import { ArtStationRoles } from '../art/station-roles.js';
import { mulberry32 } from '../core/rng.js';
import { Theme } from '../core/theme.js';
import { Goods } from '../rules/goods.js';
import { IdleRules } from './rules.js';

const IdleMap = (() => {
  const STYLE = 'line';
  const TAU = Math.PI * 2;
  // The schematic, in map units: the star's radius, the first orbit and the gap between orbits.
  const STAR = 40, RING0 = 130, GAP = 86;
  const PERIOD0 = 300; // s the innermost orbit takes; the others by Kepler
  const MOON_PERIOD = [50, 80, 120]; // s, by the moon's place round its planet
  const STATION_PERIOD = 70;
  const FIELD = 24; // the field's rocks lie within this of its centre
  const FLOAT = 1600; // ms a floater rises
  const SCENE = 3200; // ms the build scene lasts
  const INK = '#7df9ff', DIM = 'rgba(125, 249, 255, 0.55)', FAINT = 'rgba(125, 249, 255, 0.16)', CHALK = '#e9eef2', AMBER = '#ffcf5a';

  // Planets and moons too small for their art: dots in the game map's colours (ui/map.js).
  const PLANET_COLOR = { gas: '#e0a868', blue: '#6f97d8', terran: '#58b07a', desert: '#d9a066', ice: '#cfe6f5', lava: '#ff7a3a' };
  const MOON_COLOR = { grey: '#8e8a84', ice: '#bcd3e2', sulfur: '#d6bf55', rust: '#a35a3b', dark: '#86838e' };
  const hsl = ([h, s, l]) => `hsl(${h} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;
  const colorOf = (kind) => { const t = Goods.type(kind); return t ? hsl(t.color) : CHALK; };
  const angleOf = (x, y, ox, oy) => Math.atan2(y - oy, x - ox);

  function create(canvas, w, { onPick }) {
    const ctx = canvas.getContext('2d', { alpha: false });
    const cultures = ArtCulture.forGalaxy(w.galaxy);
    const star = w.star;
    let dpr = 1, W = 0, H = 0, top = 0, bottom = 0;
    // The camera: the map point at the middle of the clear area, and px per map unit. `want` is where
    // it's heading (eased toward every frame); following, it tracks a moving thing.
    const cam = { x: 0, y: 0, k: 1 }, want = { x: 0, y: 0, k: 1 };
    let follow = null, fitK = 1;
    const floaters = [];

    // ---------- The schematic ----------

    // Sizes in map units: a planet's from its real radius, a moon's likewise; the orbits round a planet.
    const planetR = (b) => 15 + Math.max(0, b.r - 150) * 0.065;
    const moonR = (b) => 5 + Math.max(0, b.r - 55) * 0.06;
    const ringR = (i) => RING0 + i * GAP;
    const outer = ringR(w.rings - 1) + FIELD + 12;
    const things = []; // every site and station: { key, kind, ref, r, parent?, at(t) -> { x, y, a } }
    const byKey = new Map();
    const sizeOf = (s) => (s.kind === 'planet' ? planetR(s.body) : s.kind === 'moon' ? moonR(s.body) : FIELD);
    for (const s of w.sites) {
      if (s.kind === 'moon') continue;
      const R = ringR(s.ring), a0 = angleOf(s.x, s.y, star.x, star.y), om = TAU / (PERIOD0 * (R / RING0) ** 1.5);
      const it = { key: s.key, kind: s.kind, ref: s, r: sizeOf(s), ring: R, at: (t) => { const a = a0 + om * t; return { x: Math.cos(a) * R, y: Math.sin(a) * R, a }; } };
      things.push(it); byKey.set(s.key, it);
    }
    for (const s of w.sites) {
      if (s.kind !== 'moon') continue;
      const p = byKey.get(s.parent), k = p.ref.body.moons.indexOf(s.body.id);
      const d = p.r + 18 + k * 13, a0 = angleOf(s.x, s.y, p.ref.x, p.ref.y), om = TAU / MOON_PERIOD[Math.min(k, MOON_PERIOD.length - 1)];
      const it = { key: s.key, kind: 'moon', ref: s, r: sizeOf(s), parent: p, orbit: d, at: (t) => { const c = p.at(t), a = a0 + om * t; return { x: c.x + Math.cos(a) * d, y: c.y + Math.sin(a) * d, a }; } };
      things.push(it); byKey.set(s.key, it);
    }
    // Stations go where they're built: round their host, the second berth across from the first.
    const stationAt = new Map(); // station key -> it, rebuilt when the hosts change
    let hostsSeen = '';
    function placeStations(state) {
      const id = JSON.stringify(state.hosts);
      if (id === hostsSeen) return;
      hostsSeen = id;
      for (const it of stationAt.values()) byKey.delete(it.key);
      stationAt.clear();
      const berth = new Map();
      for (const st of w.stations) {
        const hk = state.hosts[st.key], host = hk && byKey.get(hk);
        if (!host) continue;
        const n = berth.get(hk) || 0;
        berth.set(hk, n + 1);
        const d = host.r + (host.kind === 'field' ? 10 : 11), a0 = n * Math.PI + (st.seed % 100) / 100, om = TAU / STATION_PERIOD;
        const it = { key: st.key, kind: 'station', ref: st, r: host.kind === 'moon' ? 5 : 7, parent: host, orbit: d, at: (t) => { const c = host.at(t), a = a0 + om * t; return { x: c.x + Math.cos(a) * d, y: c.y + Math.sin(a) * d, a }; } };
        stationAt.set(st.key, it); byKey.set(st.key, it);
      }
    }
    // The field's rocks: some of the real field's, set out within FIELD of its middle.
    const field = w.sites.find((s) => s.kind === 'field');
    const rocks = field ? w.galaxy.asteroids
      .map((a) => ({ a, d: Math.hypot(a.x - field.x, a.y - field.y) }))
      .filter((x) => x.d < field.field.spread * 1.1).slice(0, 18)
      .map(({ a }) => ({ a, dx: ((a.x - field.x) / field.field.spread) * FIELD * 0.9, dy: ((a.y - field.y) / field.field.spread) * FIELD * 0.9, r: 1.8 + a.r * 0.07 })) : [];
    // A faint scatter of stars behind it all, in screen space.
    const specks = (() => { const r = mulberry32(w.seed * 7919 + 1); return Array.from({ length: 140 }, () => ({ x: r(), y: r(), a: 0.15 + r() * 0.35, s: r() < 0.1 ? 1.4 : 0.9 })); })();

    // Art for the stations, made once each.
    const stationArt = new Map();
    function artOf(st) {
      if (!stationArt.has(st.key)) {
        const role = ArtStationRoles.ROLE_OF[st.type], c = cultures.of(st.culture);
        stationArt.set(st.key, role ? ArtStationRoles.create(role, c, st.seed, st.size) : ArtBlueprints.create(st.size === 'major' ? 'station-major' : 'station-minor', c, st.seed));
      }
      return stationArt.get(st.key);
    }

    // ---------- Camera ----------

    const midY = () => top + (H - top - bottom) / 2;
    const toScreen = (p) => ({ x: W / 2 + (p.x - cam.x) * cam.k, y: midY() + (p.y - cam.y) * cam.k });
    const toMap = (x, y) => ({ x: cam.x + (x - W / 2) / cam.k, y: cam.y + (y - midY()) / cam.k });
    function fit() {
      const room = Math.min(W - 16, H - top - bottom - 16) / 2;
      fitK = Math.max(0.05, room / outer);
    }
    // How near to come to a thing: its planet's moons, or the field, filling a good part of the clear area.
    function focusK(it) {
      const host = it.kind === 'moon' || it.kind === 'station' ? it.parent : it;
      const moons = things.filter((x) => x.parent === host && x.kind === 'moon');
      const reach = host.kind === 'moon' ? host.r + 14 : Math.max(host.r + 14, ...moons.map((m) => m.orbit + m.r + 4));
      const room = Math.min(W, H - top - bottom) * 0.36;
      return Math.max(fitK, Math.min(fitK * 9, room / reach));
    }
    // A station only has a place once it's built and drawn: until then its focus waits (pending).
    let pending = null;
    function focus(key) {
      pending = null;
      const it = key && byKey.get(key);
      if (key && !it) { pending = key; return; }
      if (!it) { follow = null; want.x = 0; want.y = 0; want.k = fitK; return; }
      follow = it.kind === 'station' ? it.parent : it;
      want.k = focusK(it);
    }
    function resize() {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = canvas.clientWidth; H = canvas.clientHeight;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      const was = fitK;
      fit();
      if (!follow && Math.abs(want.k - was) < 1e-6) want.k = fitK;
    }
    function inset(t, b) {
      if (t === top && b === bottom) return;
      top = t; bottom = b;
      const was = fitK;
      fit();
      if (!follow && Math.abs(want.k - was) < 1e-6) want.k = fitK;
      else if (follow) want.k = focusK(follow);
    }

    // ---------- Drawing ----------

    let last = performance.now();
    function draw(state, now, selected) {
      placeStations(state);
      if (pending && byKey.has(pending)) focus(pending);
      // The build scene comes in closer than a pick does, once the station has its place.
      if (scene?.close && !pending && byKey.has(scene.key)) { follow = byKey.get(scene.key); want.k = Math.min(fitK * 14, focusK(follow) * 2.2); scene.close = false; }
      Art.beginFrame();
      const t = now / 1000, perf = performance.now(), dt = Math.min(0.1, (perf - last) / 1000);
      last = perf;
      const pos = new Map(); // key -> { x, y, a } map units, this frame
      for (const it of things) pos.set(it.key, it.at(t));
      for (const it of stationAt.values()) pos.set(it.key, it.at(t));
      // The camera eases toward where it's going; following, toward the thing.
      if (follow) { const p = pos.get(follow.key); want.x = p.x; want.y = p.y; }
      const e = 1 - Math.exp(-dt * 6);
      cam.x += (want.x - cam.x) * e; cam.y += (want.y - cam.y) * e;
      cam.k *= (want.k / cam.k) ** e;
      const k = cam.k;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = Theme.color.bg;
      ctx.fillRect(0, 0, W, H);
      for (const s of specks) { ctx.fillStyle = `rgba(233, 238, 242, ${s.a})`; ctx.fillRect(s.x * W, s.y * H, s.s, s.s); }

      const c0 = toScreen({ x: 0, y: 0 });
      const shown = (it) => it.kind === 'station' || (it.kind === 'moon' ? IdleRules.charted(state, it.parent.key) : true);
      const isCharted = (it) => it.kind === 'station' || IdleRules.charted(state, it.key);

      // Orbits: the planets' and the field's round the star (the field's dashed, a band of rocks), the
      // moons' and the stations' round their bodies.
      ctx.lineWidth = 1;
      for (const it of things) {
        if (it.kind === 'moon') continue;
        ctx.strokeStyle = isCharted(it) ? 'rgba(125, 249, 255, 0.2)' : 'rgba(125, 249, 255, 0.1)';
        ctx.setLineDash(it.kind === 'field' ? [2, 5] : []);
        ctx.beginPath(); ctx.arc(c0.x, c0.y, it.ring * k, 0, TAU); ctx.stroke();
      }
      ctx.setLineDash([]);
      for (const it of [...things, ...stationAt.values()]) {
        if (!it.orbit || !shown(it) || it.orbit * k < 6) continue;
        const c = toScreen(pos.get(it.parent.key));
        ctx.strokeStyle = it.kind === 'station' ? 'rgba(125, 249, 255, 0.12)' : FAINT;
        ctx.beginPath(); ctx.arc(c.x, c.y, it.orbit * k, 0, TAU); ctx.stroke();
      }

      // Routes: dashed lines between where their stops are now.
      ctx.save();
      ctx.setLineDash([3, 5]);
      ctx.strokeStyle = 'rgba(125, 249, 255, 0.35)';
      for (const r of state.industry.routes) {
        ctx.beginPath();
        r.stops.forEach((s, i) => { const p = pos.get(s.station); if (p) { const q = toScreen(p); ctx[i ? 'lineTo' : 'moveTo'](q.x, q.y); } });
        if (r.stops.length > 2) ctx.closePath();
        ctx.stroke();
      }
      ctx.restore();

      // The star.
      Art.drawStar(ctx, { ...star, r: Math.max(6, STAR * k) }, STYLE, { x: c0.x, y: c0.y, t });

      // Bodies, then stations over them.
      ctx.font = Theme.font(10);
      ctx.textAlign = 'center';
      for (const it of things) {
        if (!shown(it)) continue;
        const p = toScreen(pos.get(it.key)), rpx = it.r * k;
        if (p.x < -60 || p.y < -60 || p.x > W + 60 || p.y > H + 60) continue;
        if (!isCharted(it)) { signal(p, rpx, it.kind === 'moon'); continue; }
        if (it.kind === 'field') fieldRocks(p, k, t);
        else if (it.kind === 'planet') body(it, p, rpx, Math.atan2(c0.y - p.y, c0.x - p.x));
        else body(it, p, rpx);
      }
      const sf = scene ? (perf - scene.t0) / SCENE : 0;
      for (const it of stationAt.values()) {
        const p = toScreen(pos.get(it.key)), rpx = it.r * k;
        if (scene && it.key === scene.key) sceneIcon(it, p, rpx, pos.get(it.key).a + Math.PI / 2, t, Math.min(1, sf));
        else stationIcon(it, p, rpx, pos.get(it.key).a + Math.PI / 2, t);
      }
      if (scene && sf >= 1) end();

      // The survey under way: the probe's sweep round its body, and how far along it is.
      if (state.survey) {
        const it = byKey.get(state.survey.key);
        if (it && shown(it)) {
          const p = toScreen(pos.get(it.key)), rr = Math.max(10, it.r * k) + 7;
          const f = Math.min(1, Math.max(0, (now - state.survey.at) / Math.max(1, state.survey.end - state.survey.at)));
          ctx.strokeStyle = INK; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(p.x, p.y, rr, -Math.PI / 2, -Math.PI / 2 + f * TAU); ctx.stroke();
          const a = (perf / 1000) * 2.4;
          ctx.save();
          ctx.globalAlpha = 0.5;
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.arc(p.x, p.y, rr + 6, a, a + 0.5); ctx.closePath();
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rr + 6);
          g.addColorStop(0, 'rgba(125, 249, 255, 0)'); g.addColorStop(1, 'rgba(125, 249, 255, 0.45)');
          ctx.fillStyle = g; ctx.fill();
          ctx.restore();
        }
      }

      // Selection: a ring round the picked thing.
      const sel = selected && byKey.get(selected);
      if (sel && pos.has(sel.key)) {
        const p = toScreen(pos.get(sel.key)), rr = Math.max(7, sel.r * k * (sel.kind === 'field' ? 1.15 : 1)) + 5;
        ctx.strokeStyle = INK; ctx.lineWidth = 1.2;
        ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.arc(p.x, p.y, rr, (perf / 4000) % TAU, (perf / 4000) % TAU + TAU); ctx.stroke();
        ctx.setLineDash([]);
      }

      // Names: charted planets and the field always; moons and stations once they're big enough.
      // The picked thing's first, then stations, planets, the field and moons, each left out where
      // it would cover one already written.
      const RANK = { station: 1, planet: 2, field: 3, moon: 4 };
      const labelled = [...things, ...stationAt.values()].filter(shown)
        .sort((a, b) => (b.key === selected) - (a.key === selected) || RANK[a.kind] - RANK[b.kind]);
      const boxes = [];
      for (const it of labelled) {
        const p = toScreen(pos.get(it.key)), rpx = Math.max(it.r * k, 3);
        if (p.x < -20 || p.x > W + 20 || p.y < 0 || p.y > H) continue;
        const big = it.kind === 'planet' || it.kind === 'field' ? true : rpx >= (it.kind === 'station' ? 5 : 4);
        if (!big && it.key !== selected) continue;
        const name = isCharted(it) ? it.ref.name : it.key === selected ? 'Uncharted' : null;
        if (!name) continue;
        // A station's name above it, a body's below, with its drills after it in amber.
        const drills = (it.kind !== 'station' && state.drills[it.key]) || 0;
        const text = it.kind === 'station' ? name : name.toUpperCase(), tag = drills ? `  ${drills} DRILL${drills > 1 ? 'S' : ''}` : '';
        const wText = ctx.measureText(text).width, wTag = tag ? ctx.measureText(tag).width : 0, half = (wText + wTag) / 2 + 4;
        const cx = Math.min(W - half, Math.max(half, p.x)), x = cx - wTag / 2;
        const y = it.kind === 'station' ? p.y - rpx - 6 : p.y + rpx * (it.kind === 'field' ? 1.2 : 1) + 13;
        const box = [cx - half, y - 10, cx + half, y + 3];
        if (it.key !== selected && boxes.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
        boxes.push(box);
        ctx.fillStyle = it.key === selected ? CHALK : it.kind === 'station' ? INK : DIM;
        ctx.fillText(text, x, y);
        if (tag) { ctx.fillStyle = AMBER; ctx.textAlign = 'left'; ctx.fillText(tag, x + wText / 2, y); ctx.textAlign = 'center'; }
      }

      // Haulers: a small outlined dart, a dot of what it carries behind it. Shuttles' and routes'
      // haulers, and those sent by hand (state.hauls: one way, from where they left to where they go).
      const flying = [];
      for (const r of state.industry.routes) for (const h of r.haulers) flying.push([haulerPos(r, h, now, pos), h.load]);
      for (const h of state.hauls) flying.push([haulerPos({ stops: [{ station: h.from }, { station: h.to }] }, { stop: 1, at: h.at, next: h.end }, now, pos), h.load]);
      for (const [p, load] of flying) {
        if (!p) continue;
        const kinds = Object.keys(load);
        ctx.save();
        ctx.translate(p.x, p.y); ctx.rotate(p.dir);
        ctx.strokeStyle = CHALK; ctx.lineWidth = 1; ctx.fillStyle = Theme.color.bg;
        ctx.beginPath(); ctx.moveTo(5.5, 0); ctx.lineTo(-4, -3.2); ctx.lineTo(-2, 0); ctx.lineTo(-4, 3.2); ctx.closePath(); ctx.fill(); ctx.stroke();
        if (kinds.length) { ctx.fillStyle = colorOf(kinds[0]); ctx.beginPath(); ctx.arc(-6.5, 0, 2, 0, TAU); ctx.fill(); }
        ctx.restore();
      }

      // Floaters.
      ctx.font = Theme.font(11);
      for (let i = floaters.length - 1; i >= 0; i--) {
        const f = floaters[i], age = perf - f.t0;
        if (age > FLOAT) { floaters.splice(i, 1); continue; }
        if (age < 0 || !pos.has(f.key)) continue;
        const p = toScreen(pos.get(f.key));
        ctx.globalAlpha = 1 - age / FLOAT;
        ctx.fillStyle = f.color;
        ctx.fillText(f.text, p.x, p.y - 18 - (age / FLOAT) * 22);
      }
      ctx.globalAlpha = 1;
      ctx.textAlign = 'left';
      lastPos = pos;
    }
    let lastPos = new Map();

    // An uncharted body: a dashed ring and a '?'.
    function signal(p, rpx, small) {
      const r = Math.max(small ? 3 : 5, rpx * 0.8);
      ctx.strokeStyle = 'rgba(138, 149, 179, 0.7)'; ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
      if (r >= 5) { ctx.fillStyle = '#8a95b3'; ctx.font = Theme.font(Math.max(9, Math.min(16, r))); ctx.fillText('?', p.x, p.y + Math.min(16, r) * 0.35); ctx.font = Theme.font(10); }
    }

    // A planet or moon in Line art, drawn at its true size and scaled: one sprite per zoom step.
    // Too small for its art to read, it's a dot in its colour, as on the game's map (ui/map.js).
    function body(it, p, rpx, lightAngle) {
      const b = it.ref.body;
      if (rpx < 7) {
        const r = Math.max(it.kind === 'moon' ? 1.5 : 3, rpx * 0.9), col = (it.kind === 'moon' ? MOON_COLOR : PLANET_COLOR)[b.type] || CHALK;
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.fill();
        if (b.ring) { ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(p.x, p.y, r * 1.9, r * 0.6, b.ringTilt || 0, 0, TAU); ctx.stroke(); }
        return;
      }
      const s = rpx / b.r;
      ctx.save();
      ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * p.x, dpr * p.y);
      if (it.kind === 'moon') ArtBodies.drawMoon(ctx, { ...b, x: 0, y: 0 }, STYLE);
      else Art.drawPlanet(ctx, { ...b, x: 0, y: 0 }, STYLE, lightAngle === undefined ? {} : { lightAngle });
      ctx.restore();
    }

    function fieldRocks(p, k, t) {
      for (const q of rocks) {
        const rp = Math.max(0.8, q.r * k), s = rp / q.a.r;
        ctx.save();
        ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * (p.x + q.dx * k), dpr * (p.y + q.dy * k));
        if (rp < 1.5) { ctx.fillStyle = '#b29d84'; ctx.fillRect(-q.a.r, -q.a.r, q.a.r * 2, q.a.r * 2); }
        else Art.drawAsteroid(ctx, { ...q.a, x: 0, y: 0 }, STYLE, { spin: q.a.spin0 + t * q.a.tumble * 0.2 });
        ctx.restore();
      }
    }

    // A station: its art once it's big enough to read, else a diamond in its culture's colour.
    function stationIcon(it, p, rpx, angle, t) {
      const st = it.ref;
      if (rpx < 6) {
        const r = Math.max(2.5, rpx);
        ctx.fillStyle = w.galaxy.cultureColor(st.culture);
        ctx.beginPath(); ctx.moveTo(p.x, p.y - r); ctx.lineTo(p.x + r, p.y); ctx.lineTo(p.x, p.y + r); ctx.lineTo(p.x - r, p.y); ctx.closePath(); ctx.fill();
        return;
      }
      const bp = artOf(st), s = rpx / (bp.radius || 100);
      ctx.save();
      ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * p.x, dpr * p.y);
      Art.drawAsset(ctx, bp, STYLE, { angle, t, thrust: 0 });
      ctx.restore();
    }

    // ---------- The build scene ----------

    let scene = null; // { key, t0, onDone }
    const ease = (x) => 1 - (1 - x) ** 3;
    const easeBack = (x) => 1 + 2.2 * (x - 1) ** 3 + 1.2 * (x - 1) ** 2;
    function built(key, onDone) {
      if (scene) end();
      scene = { key, t0: performance.now(), onDone, close: true };
      focus(key);
    }
    function end() {
      const s0 = scene;
      scene = null;
      s0?.onDone?.();
    }
    // The station under construction, in place of its icon: up to 0.5 the scaffold (a dashed ring
    // drawn round, four brackets closing in, the station a ghost inside); to 0.8 the station fading
    // in and settling to its size; then a pulse going out.
    function sceneIcon(it, p, rpx, angle, t, f) {
      const R = Math.max(12, rpx * 1.9);
      ctx.save();
      ctx.strokeStyle = INK; ctx.lineWidth = 1.2;
      const a = ease(Math.min(1, f / 0.5)), fade = f < 0.8 ? 1 : Math.max(0, 1 - (f - 0.8) / 0.2);
      ctx.globalAlpha = fade;
      ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.arc(p.x, p.y, R, -Math.PI / 2, -Math.PI / 2 + a * TAU); ctx.stroke();
      ctx.setLineDash([]);
      const spin = (performance.now() / 1600) % TAU, d = R * (1.5 - 0.35 * a), arm = Math.max(4, R * 0.35);
      for (let i = 0; i < 4; i++) {
        const q = spin + (i * Math.PI) / 2, cx = p.x + Math.cos(q) * d, cy = p.y + Math.sin(q) * d;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(q + 2.2) * arm, cy + Math.sin(q + 2.2) * arm);
        ctx.lineTo(cx, cy);
        ctx.lineTo(cx + Math.cos(q - 2.2) * arm, cy + Math.sin(q - 2.2) * arm);
        ctx.stroke();
      }
      ctx.restore();
      const g = f < 0.5 ? 0 : Math.min(1, (f - 0.5) / 0.3);
      ctx.save();
      ctx.globalAlpha = 0.25 + 0.75 * g;
      stationIcon(it, p, Math.max(6, rpx * (0.55 + 0.45 * easeBack(g))), angle, t);
      ctx.restore();
      if (f > 0.75) {
        const q = Math.min(1, (f - 0.75) / 0.25);
        ctx.save();
        ctx.strokeStyle = INK; ctx.lineWidth = 2 * (1 - q) + 0.5;
        ctx.globalAlpha = 1 - q;
        ctx.beginPath(); ctx.arc(p.x, p.y, R * (1 + 2.2 * ease(q)), 0, TAU); ctx.stroke();
        ctx.restore();
      }
    }

    function haulerPos(r, h, now, pos) {
      if (h.next == null) return null;
      const n = r.stops.length, to = pos.get(r.stops[h.stop].station), from = pos.get(r.stops[(h.stop - 1 + n) % n].station);
      if (!to || !from) return null;
      const a = toScreen(from), b = toScreen(to);
      const f = Math.min(1, Math.max(0, (now - h.at) / Math.max(1, h.next - h.at)));
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, dir: Math.atan2(b.y - a.y, b.x - a.x) };
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
        floaters.push({ key: f.key, text: `+${f.n} ${Goods.type(f.kind)?.name || ''}`.trim(), color: colorOf(f.kind), t0: performance.now() + (i % 3) * 140 });
        i++;
      }
    }

    // ---------- Input ----------

    function pick(x, y) {
      let best = null, bd = Infinity;
      for (const [key, m] of lastPos) {
        const it = byKey.get(key);
        if (!it) continue;
        if (it.kind === 'moon' && !lastPos.has(it.parent.key)) continue;
        const p = toScreen(m), d = Math.hypot(p.x - x, p.y - y), r = it.r * cam.k * (it.kind === 'field' ? 1.2 : 1);
        // Stations and moons win a close call over the body they're round.
        const bias = it.kind === 'station' ? 0.6 : it.kind === 'moon' ? 0.8 : 1;
        if (d < Math.max(it.kind === 'station' ? 14 : 18, r + 6) && d * bias < bd) { best = key; bd = d * bias; }
      }
      return best;
    }
    const pointers = new Map();
    let downAt = null, moved = false, pinch = null;
    function zoomAt(f, x, y) {
      const before = toMap(x, y);
      cam.k = Math.min(fitK * 14, Math.max(fitK * 0.7, cam.k * f));
      const after = toMap(x, y);
      cam.x += before.x - after.x; cam.y += before.y - after.y;
      follow = null; want.x = cam.x; want.y = cam.y; want.k = cam.k;
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
        if (moved) { cam.x -= (p.x - prev.x) / cam.k; cam.y -= (p.y - prev.y) / cam.k; follow = null; want.x = cam.x; want.y = cam.y; want.k = cam.k; }
      }
    });
    const up = (e) => {
      if (!pointers.has(e.pointerId)) return;
      const p = pointers.get(e.pointerId);
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (!pointers.size && !moved && downAt) { if (scene) end(); else onPick(pick(p.x, p.y)); }
      if (!pointers.size) downAt = null;
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', (e) => { moved = true; up(e); });
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); const p = local(e); zoomAt(Math.exp(-e.deltaY * 0.0015), p.x, p.y); }, { passive: false });

    resize();
    cam.k = want.k = fitK;
    return { draw, made, resize, focus, inset, pick, built, skip: () => scene && end(), get scene() { return !!scene; } };
  }

  return { create };
})();

export { IdleMap };
