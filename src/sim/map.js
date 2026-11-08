// Redshift's system view: the star in the middle, its bodies on evenly spaced orbits round it (a
// condensed take on the idle game's map, idle/map.js: tighter orbits and larger bodies, so a whole
// system fits a phone held upright), moons round their planets, the asteroid belt as a ring of rocks
// with its slot where they bunch, a nebula as a cloud on its orbit, and the gate site on the
// outermost orbit, where the Ark waits. Stations orbit the bodies they were built at, their ships
// round them; the gate grows stage by stage.
//
// Everything turns on the system's local time (view.time, in cycles), which the black hole slows:
// as the horizon fills, orbits crawl. The hole itself creeps in from the top of the screen (Core A*,
// art/sites.js), larger as the meter fills; the stars streak toward it, the edges darken and the
// light reddens. A past system (view.frozen) is drawn still, in the hole's red.
//
//   SimMap.create(canvas, { style, onPick(key | null) }) -> map
//     map.setSystem(system)              the system to draw (SimWorld.generate's)
//     map.draw(view)                     one frame. view: { time, pull, stations: { [body key]: station }, gate,
//                                        selected, marks: { [key]: { text, tone } }, frozen, hazard }
//       station: { type, level, ships, building (0..1) | null, culture, seed, blocked, rogue, alien }
//       gate: { stage (done), building: { stage, f } | null, charge }
//     map.focus(key | null)              follow and zoom in on a body; null: the whole system
//     map.inset(top, bottom)             screen px the header and the sheet cover (kept clear)
//     map.resize(), map.setStyle(style)
//     map.screenOf(key) -> { x, y, r } | null   where a body is on screen (for the bubbles over it)
//     map.pulse(key, color)              a ring going out from a body (something happened there)
// ES module (`SimMap`); needs a browser.

import { ArtBlueprints } from '../art/blueprints.js';
import { ArtBodies } from '../art/bodies.js';
import { ArtCulture } from '../art/culture.js';
import { Art } from '../art/render.js';
import { ArtSites } from '../art/sites.js';
import { ArtStationRoles } from '../art/station-roles.js';
import { ArtTurrets } from '../art/turrets.js';
import { mulberry32 } from '../core/rng.js';
import { Theme } from '../core/theme.js';
import { SimConfig } from './config.js';

const SimMap = (() => {
  const TAU = Math.PI * 2;
  // The schematic, in map units: the star's radius, the first orbit and the gap between orbits
  // (idle/map.js has 40, 130 and 86: this is the condensed system).
  const STAR = 28, RING0 = 74, GAP = 46;
  const PERIOD0 = 90; // cycles the innermost orbit takes; the others by Kepler
  const MOON_PERIOD = [24, 36, 52];
  const STATION_PERIOD = 20;
  const BELT = 18; // the belt's slot: rocks bunch within this of it
  const PLANET_COLOR = { gas: '#e0a868', blue: '#6f97d8', terran: '#58b07a', desert: '#d9a066', ice: '#cfe6f5', lava: '#ff7a3a' };
  const MOON_COLOR = { grey: '#8e8a84', ice: '#bcd3e2', sulfur: '#d6bf55', rust: '#a35a3b', dark: '#86838e' };
  const TONE = { good: '#b6ff8a', warn: '#ffb347', bad: '#ff5a6e', dim: '#7d88a8' };

  // The cultures' art, made once per seed: settled ones by lineage, the Drifters kitbashed from them.
  const cultureCache = new Map();
  function cultureArt(id, seed) {
    const key = `${id}.${seed}`;
    if (cultureCache.has(key)) return cultureCache.get(key);
    const C = SimConfig.CULTURES[id] || SimConfig.CULTURES.android;
    let c;
    if (id === 'android' || id === 'alien') c = ArtCulture.xeno(seed)[id];
    else if (id === 'drifters') c = ArtCulture.kitbash(ArtCulture.HUMAN.map((l, i) => ArtCulture.create(l, seed + i, SimConfig.CULTURES[l].color)), seed + 9, C.color, { name: 'Drifters', color: C.color });
    else c = ArtCulture.create(C.lineage, seed, C.color, { name: C.name, color: C.color });
    cultureCache.set(key, c);
    return c;
  }

  function create(canvas, { style = 'line', onPick }) {
    const ctx = canvas.getContext('2d', { alpha: false });
    let STYLE = style;
    let sys = null, dpr = 1, W = 0, H = 0, top = 0, bottom = 0;
    const cam = { x: 0, y: 0, k: 1 }, want = { x: 0, y: 0, k: 1 };
    let follow = null, fitK = 1, outer = 400, things = [], byKey = new Map(), rocks = [], specks = [], hole = null;
    const pulses = [];
    let lastPos = new Map(), lastView = null;

    const ink = () => (STYLE === 'lowpoly' ? '#ffd27a' : '#7df9ff');
    const inkA = (a) => (STYLE === 'lowpoly' ? `rgba(255, 210, 122, ${a})` : `rgba(125, 249, 255, ${a})`);
    const ringR = (i) => RING0 + i * GAP;
    const planetR = (b) => 17 + Math.max(0, b.art.r - 140) * 0.06;
    const moonR = (b) => 6 + Math.max(0, b.art.r - 55) * 0.06;

    function setSystem(system) {
      sys = system;
      things = []; byKey = new Map();
      for (const b of sys.bodies) {
        if (b.kind === 'moon') continue;
        const R = ringR(b.ring), om = TAU / (PERIOD0 * (R / RING0) ** 1.5);
        const r = b.kind === 'planet' ? planetR(b) : b.kind === 'belt' ? BELT : b.kind === 'nebula' ? 26 : 14;
        const it = { key: b.key, kind: b.kind, body: b, r, ring: R, at: (t) => { const a = b.angle + om * t; return { x: Math.cos(a) * R, y: Math.sin(a) * R, a }; } };
        things.push(it); byKey.set(b.key, it);
      }
      for (const b of sys.bodies) {
        if (b.kind !== 'moon') continue;
        const p = byKey.get(b.parent);
        const d = p.r + 9 + b.slot * 8, om = TAU / MOON_PERIOD[Math.min(b.slot, 2)];
        const it = { key: b.key, kind: 'moon', body: b, r: moonR(b), parent: p, orbit: d, at: (t) => { const c = p.at(t), a = b.angle + om * t; return { x: c.x + Math.cos(a) * d, y: c.y + Math.sin(a) * d, a }; } };
        things.push(it); byKey.set(b.key, it);
      }
      outer = ringR(sys.rings - 1) + 24;
      // The belt's rocks: a thin ring all round, and a knot at its slot.
      const rr = mulberry32(sys.seed * 31 + 7), belt = things.find((x) => x.kind === 'belt');
      rocks = [];
      if (belt) {
        for (let i = 0; i < 70; i++) {
          const a = rr() * TAU, d = belt.ring + (rr() - 0.5) * 12;
          rocks.push({ a, d, knot: false, ast: rock(rr), r: 1.6 + rr() * 2 });
        }
        for (let i = 0; i < 12; i++) {
          const a = (rr() - 0.5) * 0.32, d = (rr() - 0.5) * BELT * 1.2;
          rocks.push({ a, d, knot: true, ast: rock(rr), r: 3.5 + rr() * 4 });
        }
      }
      specks = Array.from({ length: 160 }, () => ({ x: rr(), y: rr(), a: 0.15 + rr() * 0.4, s: rr() < 0.1 ? 1.4 : 0.9, v: 0.3 + rr() }));
      hole = ArtSites.sample('smbh', sys.seed % 97 + 3);
      stationArt.clear();
      fit();
      want.x = want.y = 0; want.k = fitK; cam.x = cam.y = 0; cam.k = fitK; follow = null;
    }
    const rock = (r) => ({ type: Art.ASTEROID_TYPES[Math.floor(r() * Art.ASTEROID_TYPES.length)], r: 20, seed: Math.floor(r() * 9973), spin0: r() * TAU, tumble: (r() - 0.5) * 0.6 });

    // Art, made once per thing.
    const stationArt = new Map();
    function artFor(key, make) {
      if (!stationArt.has(key)) stationArt.set(key, make());
      return stationArt.get(key);
    }
    function stationBp(bodyKey, st) {
      const S = SimConfig.STATIONS[st.type];
      const cid = st.alien ? 'alien' : st.rogue ? 'drifters' : (st.culture || S?.culture || 'android');
      const culture = cultureArt(cid, sys.seed);
      return artFor(`st:${bodyKey}:${st.type}:${cid}:${st.level}`, () => {
        const art = st.rogue ? 'station-minor' : st.alien ? 'station-major' : S.art;
        const size = st.level >= 3 ? 'major' : S?.size || 'minor';
        if (ArtStationRoles.ROLES.includes(art)) return ArtStationRoles.create(art, culture, st.seed || 1, size);
        return ArtBlueprints.create(art, culture, st.seed || 1);
      });
    }
    const shipBp = (bodyKey, st, i) => {
      const S = SimConfig.STATIONS[st.type];
      const cid = st.culture || S?.culture || 'android';
      const hull = st.level >= 3 && S.ship.heavy ? S.ship.heavy : S.ship.hull;
      return artFor(`sh:${bodyKey}:${hull}:${cid}:${i}`, () => ArtBlueprints.create(hull, cultureArt(cid, sys.seed), (st.seed || 1) + i * 31));
    };
    const turretBp = (bodyKey, st, i) => artFor(`tu:${bodyKey}:${i}`, () => ArtTurrets.create(i % 2 ? 'gun' : 'missile', cultureArt(st.culture || 'wedge', sys.seed), (st.seed || 1) + i));
    const gateBp = () => artFor('gate', () => ArtBlueprints.create('gate', cultureArt('android', sys.seed), sys.seed % 991 + 1));
    const arkBp = () => artFor('ark', () => ArtBlueprints.playerShip(cultureArt('android', sys.seed)));
    const wreckBp = (key) => artFor(`wr:${key}`, () => ArtBlueprints.create('wreck-station', cultureArt('drifters', sys.seed), sys.seed + key.length * 13));
    const wormholeBp = () => artFor('wormhole', () => ArtBlueprints.create('wormhole', null, sys.seed % 77 + 1));

    // ---------- Camera ----------
    const midY = () => top + (H - top - bottom) / 2;
    const toScreen = (p) => ({ x: W / 2 + (p.x - cam.x) * cam.k, y: midY() + (p.y - cam.y) * cam.k });
    const toMap = (x, y) => ({ x: cam.x + (x - W / 2) / cam.k, y: cam.y + (y - midY()) / cam.k });
    function fit() {
      const room = Math.min(W - 12, H - top - bottom - 12) / 2;
      fitK = Math.max(0.05, room / outer);
    }
    function focusK(it) {
      const host = it.kind === 'moon' ? it.parent : it;
      const moons = things.filter((x) => x.parent === host);
      const reach = Math.max(host.r + 22, ...moons.map((m) => m.orbit + m.r + 10));
      const room = Math.min(W, H - top - bottom) * 0.3;
      return Math.max(fitK * 1.2, Math.min(fitK * 6, room / reach));
    }
    function focus(key) {
      const it = key && byKey.get(key);
      if (!it) { follow = null; want.x = 0; want.y = 0; want.k = fitK; return; }
      follow = it.kind === 'moon' ? it.parent : it;
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
    function draw(view) {
      if (!sys) return;
      lastView = view;
      Art.beginFrame();
      const perf = performance.now(), dt = Math.min(0.1, (perf - last) / 1000);
      last = perf;
      const t = view.time, pull = view.pull || 0;
      const pos = new Map();
      for (const it of things) pos.set(it.key, it.at(t));
      if (follow) { const p = pos.get(follow.key); want.x = p.x; want.y = p.y; }
      const e = 1 - Math.exp(-dt * 6);
      cam.x += (want.x - cam.x) * e; cam.y += (want.y - cam.y) * e;
      cam.k *= (want.k / cam.k) ** e;
      const k = cam.k;
      // Seconds for what moves on its own (lights, engines), slowed with everything else.
      const tl = t * 0.6;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = Theme.color.bg;
      ctx.fillRect(0, 0, W, H);
      drawSky(pull, perf, view.frozen);
      drawHole(pull, view.frozen, perf);

      const c0 = toScreen({ x: 0, y: 0 });
      ctx.lineWidth = 1;
      // Orbits round the star; the gate's dashed.
      for (const it of things) {
        if (it.kind === 'moon') continue;
        ctx.strokeStyle = inkA(it.kind === 'gate' ? 0.22 : 0.16);
        ctx.setLineDash(it.kind === 'gate' ? [3, 6] : []);
        ctx.beginPath(); ctx.arc(c0.x, c0.y, it.ring * k, 0, TAU); ctx.stroke();
      }
      ctx.setLineDash([]);
      for (const it of things) {
        if (!it.orbit || it.orbit * k < 6) continue;
        const c = toScreen(pos.get(it.parent.key));
        ctx.strokeStyle = inkA(0.1);
        ctx.beginPath(); ctx.arc(c.x, c.y, it.orbit * k, 0, TAU); ctx.stroke();
      }

      // The belt, the nebula, the star, the bodies.
      const belt = things.find((x) => x.kind === 'belt');
      if (belt) drawBelt(belt, pos.get(belt.key), c0, k, t);
      for (const it of things) if (it.kind === 'nebula') drawNebula(it, toScreen(pos.get(it.key)), k, t);
      Art.drawStar(ctx, { ...sys.star, r: Math.max(8, STAR * k) }, STYLE, { x: c0.x, y: c0.y, t: tl });
      for (const it of things) {
        const p = toScreen(pos.get(it.key)), rpx = it.r * k;
        if (p.x < -80 || p.y < -80 || p.x > W + 80 || p.y > H + 80) continue;
        if (it.kind === 'planet') drawBody(it, p, rpx, Math.atan2(c0.y - p.y, c0.x - p.x));
        else if (it.kind === 'moon') drawBody(it, p, rpx);
        else if (it.kind === 'gate') drawGate(it, p, k, tl, view.gate);
      }

      // Stations round their bodies, their ships and turrets round them.
      const stations = view.stations || {};
      for (const [key, st] of Object.entries(stations)) {
        const it = byKey.get(key);
        if (!it) continue;
        const c = pos.get(key), host = toScreen(c);
        const d = (it.kind === 'belt' ? 0 : it.r + 7) * k, a = (st.seed % 100) / 16 + (TAU / STATION_PERIOD) * t * (it.kind === 'belt' ? 0 : 1);
        const p = it.kind === 'belt' ? host : { x: host.x + Math.cos(a) * d, y: host.y + Math.sin(a) * d };
        const rpx = Math.max(5, (st.level >= 3 ? 9 : 7) * k);
        if (st.wreck) { drawAsset(wreckBp(key), p, rpx, a, tl); continue; }
        drawStation(key, st, p, rpx, a + Math.PI / 2, tl);
        if (st.type === 'defense' && !st.building) {
          for (let i = 0; i < st.level; i++) {
            const ta = -a * 1.4 + (i / st.level) * TAU, td = rpx + 7 * Math.max(1, k * 0.8);
            drawAsset(turretBp(key, st, i), { x: p.x + Math.cos(ta) * td, y: p.y + Math.sin(ta) * td }, Math.max(2.5, 2.4 * k), ta, tl);
          }
        }
        for (let i = 0; i < (st.ships || 0); i++) {
          const sa = a * 2.1 + (i / Math.max(1, st.ships)) * TAU + 1, sd = rpx + (11 + i * 4) * Math.max(0.7, k * 0.6);
          const sp = { x: p.x + Math.cos(sa) * sd, y: p.y + Math.sin(sa) * sd };
          if (st.dark) { ctx.globalAlpha = 0.35; }
          drawAsset(shipBp(key, st, i), sp, Math.max(2.5, 2.8 * k), sa + Math.PI / 2, tl, 0.6);
          ctx.globalAlpha = 1;
        }
        if (st.blocked) drawBlockade(p, rpx, perf);
      }

      // Build marks (what a station would make here), the selection ring.
      ctx.font = Theme.font(10);
      ctx.textAlign = 'center';
      const marks = view.marks || {};
      for (const [key, m] of Object.entries(marks)) {
        if (!pos.has(key)) continue;
        const it = byKey.get(key), p = toScreen(pos.get(key)), rr = Math.max(9, it.r * k) + 6;
        const col = TONE[m.tone] || ink();
        ctx.strokeStyle = col; ctx.lineWidth = 1.4;
        ctx.setLineDash([2, 3]);
        ctx.beginPath(); ctx.arc(p.x, p.y, rr + Math.sin(perf / 300) * 1.5, 0, TAU); ctx.stroke();
        ctx.setLineDash([]);
        if (m.text) label(m.text, p.x, p.y - rr - 5, col, true);
      }
      const sel = view.selected && byKey.get(view.selected);
      if (sel) {
        const p = toScreen(pos.get(sel.key)), rr = Math.max(8, sel.r * k) + 8;
        ctx.strokeStyle = ink(); ctx.lineWidth = 1.2;
        ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.arc(p.x, p.y, rr, (perf / 4000) % TAU, (perf / 4000) % TAU + TAU); ctx.stroke();
        ctx.setLineDash([]);
      }

      // Names: planets, the belt, the nebula and the gate always; moons once big enough.
      const boxes = [];
      const RANK = { planet: 1, gate: 2, belt: 3, nebula: 3, moon: 4 };
      for (const it of [...things].sort((a, b) => (b.key === view.selected) - (a.key === view.selected) || RANK[a.kind] - RANK[b.kind])) {
        const p = toScreen(pos.get(it.key)), rpx = Math.max(it.r * k, 3);
        if (it.kind === 'moon' && rpx < 5 && it.key !== view.selected) continue;
        const text = it.body.name;
        const y = p.y + rpx * (it.kind === 'belt' ? 1.1 : 1) + 13;
        const w = ctx.measureText(text).width / 2 + 3, box = [p.x - w, y - 10, p.x + w, y + 3];
        if (it.key !== view.selected && boxes.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
        boxes.push(box);
        ctx.fillStyle = it.key === view.selected ? '#eef1ff' : inkA(it.kind === 'moon' ? 0.45 : 0.6);
        ctx.fillText(it.kind === 'moon' ? text : text.toUpperCase(), p.x, y);
      }

      // Pulses: rings going out where something happened.
      for (let i = pulses.length - 1; i >= 0; i--) {
        const q = (perf - pulses[i].t0) / 900;
        if (q > 1 || !pos.has(pulses[i].key)) { pulses.splice(i, 1); continue; }
        const it = byKey.get(pulses[i].key), p = toScreen(pos.get(it.key));
        ctx.save();
        ctx.globalAlpha = 1 - q; ctx.strokeStyle = pulses[i].color; ctx.lineWidth = 2 * (1 - q) + 0.5;
        ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(8, it.r * k) * (1 + 2 * q), 0, TAU); ctx.stroke();
        ctx.restore();
      }

      drawVeil(pull, view.frozen);
      ctx.textAlign = 'left';
      lastPos = pos;
    }

    function label(text, x, y, color, boxed) {
      if (boxed) {
        const w = ctx.measureText(text).width + 8;
        ctx.fillStyle = 'rgba(5, 6, 10, 0.78)';
        ctx.fillRect(x - w / 2, y - 11, w, 15);
      }
      ctx.fillStyle = color;
      ctx.fillText(text, x, y);
    }

    function drawAsset(bp, p, rpx, angle, t, thrust = 0) {
      const s = rpx / (bp.radius || 100);
      ctx.save();
      ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * p.x, dpr * p.y);
      Art.drawAsset(ctx, bp, STYLE, { angle, t, thrust });
      ctx.restore();
    }

    function drawStation(key, st, p, rpx, angle, t) {
      const bp = stationBp(key, st);
      if (st.building != null) {
        // Under construction: a scaffold ring drawn round as it goes, the station a ghost inside.
        const R = rpx * 1.6, f = st.building;
        ctx.save();
        ctx.strokeStyle = ink(); ctx.lineWidth = 1.2;
        ctx.setLineDash([3, 4]);
        ctx.beginPath(); ctx.arc(p.x, p.y, R, -Math.PI / 2, -Math.PI / 2 + f * TAU); ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 0.25 + 0.6 * f;
        drawAsset(bp, p, rpx * (0.6 + 0.4 * f), angle, t);
        ctx.restore();
        return;
      }
      if (rpx < 5) {
        ctx.fillStyle = SimConfig.CULTURES[st.culture]?.color || ink();
        ctx.beginPath(); ctx.moveTo(p.x, p.y - rpx); ctx.lineTo(p.x + rpx, p.y); ctx.lineTo(p.x, p.y + rpx); ctx.lineTo(p.x - rpx, p.y); ctx.closePath(); ctx.fill();
        return;
      }
      drawAsset(bp, p, rpx, angle, t);
    }

    function drawBlockade(p, rpx, perf) {
      // A ring of Drifter ships round a blockaded station: red marks circling it.
      ctx.save();
      ctx.strokeStyle = TONE.bad; ctx.lineWidth = 1.2;
      const R = rpx + 9, a0 = perf / 1400;
      for (let i = 0; i < 5; i++) {
        const a = a0 + (i / 5) * TAU, x = p.x + Math.cos(a) * R, y = p.y + Math.sin(a) * R;
        ctx.beginPath(); ctx.moveTo(x + Math.cos(a + 1.9) * 3, y + Math.sin(a + 1.9) * 3); ctx.lineTo(x, y); ctx.lineTo(x + Math.cos(a - 1.9) * 3, y + Math.sin(a - 1.9) * 3); ctx.stroke();
      }
      ctx.restore();
    }

    function drawBody(it, p, rpx, lightAngle) {
      const b = it.body, art = it.body.art;
      if (rpx < 6) {
        const r = Math.max(it.kind === 'moon' ? 1.6 : 3, rpx * 0.9), col = (it.kind === 'moon' ? MOON_COLOR : PLANET_COLOR)[art.type] || '#ccc';
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.fill();
        traitMark(b, p, r);
        return;
      }
      const s = rpx / art.r;
      ctx.save();
      ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * p.x, dpr * p.y);
      if (it.kind === 'moon') ArtBodies.drawMoon(ctx, { ...art, x: 0, y: 0 }, STYLE);
      else Art.drawPlanet(ctx, { ...art, x: 0, y: 0 }, STYLE, lightAngle === undefined ? {} : { lightAngle });
      ctx.restore();
      traitMark(b, p, rpx);
    }
    // A trait: a small diamond above the body in its culture's colour.
    function traitMark(b, p, rpx) {
      if (!b.trait) return;
      const tr = SimConfig.TRAITS[b.trait], col = tr.culture ? SimConfig.CULTURES[tr.culture].color : '#ffcf5a';
      ctx.fillStyle = col;
      const y = p.y - rpx - 6;
      ctx.beginPath(); ctx.moveTo(p.x, y - 3.5); ctx.lineTo(p.x + 3.5, y); ctx.lineTo(p.x, y + 3.5); ctx.lineTo(p.x - 3.5, y); ctx.closePath(); ctx.fill();
    }

    function drawBelt(it, at, c0, k, t) {
      // Rocks round the whole orbit turn with it; the knot sits at the slot.
      const R = it.ring * k;
      for (const q of rocks) {
        let x, y;
        if (q.knot) {
          const a = at.a + q.a, d = it.ring + q.d;
          x = c0.x + Math.cos(a) * d * k; y = c0.y + Math.sin(a) * d * k;
        } else {
          const a = q.a + at.a * 0.98;
          x = c0.x + Math.cos(a) * q.d * k; y = c0.y + Math.sin(a) * q.d * k;
        }
        const rp = Math.max(0.7, q.r * k);
        if (rp < 1.6 || R < 30) { ctx.fillStyle = '#9a8a76'; ctx.fillRect(x - rp / 2, y - rp / 2, rp, rp); continue; }
        const s = rp / q.ast.r;
        ctx.save();
        ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * x, dpr * y);
        Art.drawAsteroid(ctx, { ...q.ast, x: 0, y: 0 }, STYLE, { spin: q.ast.spin0 + t * q.ast.tumble * 0.05 });
        ctx.restore();
      }
      traitMark(it.body, toScreen(at), it.r * k * 0.6);
    }

    function drawNebula(it, p, k, t) {
      // A cloud on its orbit (drawn at a fixed scale and sized, as art/sites.js does), its gas
      // pockets knotted in it.
      const R = it.r * k * 2.2;
      ctx.save();
      ctx.setTransform(dpr * (R / 60), 0, 0, dpr * (R / 60), dpr * p.x, dpr * p.y);
      ArtBodies.drawNebula(ctx, { type: it.body.art.type, seed: it.body.art.seed, x: -60, y: -60, w: 120, h: 120, scale: 60, blobs: [{ x: 0, y: 0, r: 52 }, { x: 20, y: -14, r: 30 }, { x: -22, y: 16, r: 28 }] }, STYLE, { texel: 2 });
      ctx.restore();
      const g = Math.max(4, it.r * k * 0.35), s = g / 20;
      ctx.save();
      ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * p.x, dpr * p.y);
      ArtBodies.drawGas(ctx, { type: it.body.art.type, seed: it.body.art.seed, r: 20 }, STYLE, { t: t * 0.4 });
      ctx.restore();
      traitMark(it.body, p, it.r * k * 0.6);
    }

    function drawGate(it, p, k, t, gate) {
      // The gate site: a dashed square until the frame goes up; the gate itself once it does, the
      // stage being built in scaffold. The Ark waits beside it.
      const rpx = Math.max(10, it.r * k);
      const done = gate?.stage || 0, b = gate?.building;
      if (!done && !b) {
        ctx.strokeStyle = inkA(0.6); ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.strokeRect(p.x - rpx * 0.7, p.y - rpx * 0.7, rpx * 1.4, rpx * 1.4);
        ctx.setLineDash([]);
      } else {
        const f = Math.min(1, (done + (b ? b.f : 0)) / SimConfig.GATE.length);
        ctx.save();
        ctx.globalAlpha = 0.3 + 0.7 * f;
        drawAsset(gateBp(), p, rpx * (0.7 + 0.3 * f), 0, done >= SimConfig.GATE.length ? t * (1 + (gate.charge || 0) * 3) : t * f);
        ctx.restore();
        if (b) {
          ctx.strokeStyle = ink(); ctx.lineWidth = 1.2; ctx.setLineDash([3, 4]);
          ctx.beginPath(); ctx.arc(p.x, p.y, rpx * 1.25, -Math.PI / 2, -Math.PI / 2 + b.f * TAU); ctx.stroke();
          ctx.setLineDash([]);
        }
        if (done >= SimConfig.GATE.length && gate.charge > 0) {
          // Overcharge: the gate's mouth glows brighter.
          ctx.save();
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rpx * 1.4);
          g.addColorStop(0, `rgba(185, 252, 255, ${0.15 + 0.45 * gate.charge})`); g.addColorStop(1, 'rgba(125, 249, 255, 0)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, rpx * 1.4, 0, TAU); ctx.fill();
          ctx.restore();
        }
      }
      drawAsset(arkBp(), { x: p.x + rpx * 1.7, y: p.y + rpx * 0.9 }, Math.max(4, 6 * k), -Math.PI / 2 + Math.sin(t * 0.2) * 0.1, t, 0.3);
    }

    // The sky: faint stars, drifting toward the hole (the top of the screen) as the horizon nears,
    // stretched into streaks past half.
    function drawSky(pull, perf, frozen) {
      const drift = frozen ? 0 : (pull / 100) ** 2, stretch = frozen ? 0 : Math.max(0, (pull - 40) / 60);
      for (const s of specks) {
        const y = (((s.y - drift * s.v * perf / 40000) % 1) + 1) % 1;
        const a = s.a * (frozen ? 0.6 : 1);
        ctx.fillStyle = pull > 60 || frozen ? `rgba(255, ${Math.round(220 - pull)}, ${Math.round(200 - pull * 1.4)}, ${a})` : `rgba(233, 238, 242, ${a})`;
        ctx.fillRect(s.x * W, y * H, s.s, s.s + stretch * 9 * s.v);
      }
    }

    // The hole: Core A* (art/sites.js) at the top of the screen, larger as the meter fills.
    function drawHole(pull, frozen, perf) {
      if (!hole) return;
      const f = frozen ? 1 : pull / 100;
      const R = Math.max(W, H) * (0.18 + 0.75 * f ** 1.4);
      const y = -R * (0.62 - 0.25 * f);
      const s = R / hole.r;
      ctx.save();
      ctx.globalAlpha = frozen ? 0.5 : 0.35 + 0.65 * f;
      ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * W / 2, dpr * y);
      ArtSites.draw(ctx, hole, STYLE, { phase: { jet: -Math.PI / 2 + Math.sin(perf / 9000) * 0.05 } });
      ctx.restore();
    }

    // The veil: the edges darken and the light reddens as the horizon nears; a past system is
    // all red and still.
    function drawVeil(pull, frozen) {
      const f = frozen ? 0.85 : Math.max(0, (pull - 35) / 65);
      if (f <= 0) return;
      const g = ctx.createRadialGradient(W / 2, H * 0.55, Math.min(W, H) * (0.55 - 0.3 * f), W / 2, H * 0.55, Math.max(W, H) * 0.85);
      g.addColorStop(0, 'rgba(0, 0, 0, 0)');
      g.addColorStop(1, `rgba(${frozen ? 60 : 30}, 0, ${frozen ? 8 : 4}, ${0.25 + 0.6 * f})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = `rgba(255, ${Math.round(255 - 90 * f)}, ${Math.round(255 - 140 * f)}, 1)`;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }

    function screenOf(key) {
      const it = byKey.get(key);
      if (!it || !lastPos.has(key)) return null;
      const p = toScreen(lastPos.get(key));
      return { x: p.x, y: p.y, r: Math.max(6, it.r * cam.k) };
    }
    const pulse = (key, color = ink()) => pulses.push({ key, color, t0: performance.now() });

    // ---------- Input ----------
    function pick(x, y) {
      let best = null, bd = Infinity;
      for (const [key, m] of lastPos) {
        const it = byKey.get(key);
        const p = toScreen(m), d = Math.hypot(p.x - x, p.y - y), r = it.r * cam.k;
        const bias = it.kind === 'moon' ? 0.75 : 1;
        if (d < Math.max(20, r + 8) && d * bias < bd) { best = key; bd = d * bias; }
      }
      return best;
    }
    const pointers = new Map();
    let downAt = null, moved = false, pinch = null;
    function zoomAt(f, x, y) {
      const before = toMap(x, y);
      cam.k = Math.min(fitK * 8, Math.max(fitK * 0.8, cam.k * f));
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
      if (!pointers.size && !moved && downAt) onPick(pick(p.x, p.y));
      if (!pointers.size) downAt = null;
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', (e) => { moved = true; up(e); });
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); const p = local(e); zoomAt(Math.exp(-e.deltaY * 0.0015), p.x, p.y); }, { passive: false });

    resize();
    return {
      setSystem, draw, focus, inset, resize, screenOf, pulse, pick,
      setStyle(s) { STYLE = s; stationArt.clear(); },
      get view() { return lastView; },
      wormhole: wormholeBp,
    };
  }

  return { create, cultureArt };
})();

export { SimMap };
