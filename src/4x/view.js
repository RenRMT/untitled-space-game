// The 4X game's map (notes/4x.md): one canvas and one camera in the main game's world units, zoomed
// without a break from the flight view (the main game's own scale, the ship and station in their
// art) out to the star system (orbits and icons) and on out to the galaxy (its glow and every
// system's star). Like the idle game's map (idle/map.js): drag to pan, pinch or the wheel to zoom
// round the pointer, tap a thing to pick it, and the camera eases to where it's sent. Things draw
// in their Line art once they're big enough to read, as dots and icons below that; a thing whose
// orbit is too small to show folds into what it goes round, and the start system folds into its
// star once it's a few px across.
//
//   MapView.create(canvas, world, { onPick, onOrder, onPress?, onDrag?, onRelease? }) -> view
//     pick: { key } for a node of the start system, { system: i } for a system's star
//     onPick(pick | null, at)    a tap; at: { x, y } screen px, world: { x, y } world units
//     onOrder(pick | null, at)   a right-click or a long press (pick: only places a ship can park)
//     onPress(pick, at) -> bool  a press starts: true claims the pointer (no panning) for a drag;
//     onDrag(at) -> bool           then each move past the threshold (at.snap: the place a ship could
//     onRelease(at)                park under the finger, or null); false gives the drag back to the
//                                  camera; on release (at.moved: whether it ever left the threshold)
//     view.draw(now, { selected, targeting, rings, preview })   one frame (selected: a node key;
//                                               targeting / rings: valid hosts are ringed; preview:
//                                               an order being shaped, { from, stops, finger, label,
//                                               pulse }: from a ship key, stops [{ key } | { x, y }],
//                                               finger a screen point to write the label above)
//                                               build: a station being placed or taken away
//                                               (4x/building.js), { marks: [{ key, ok }], ghost:
//                                               { type, body?, at?, ok } (on a body's orbit, or at a
//                                               screen point), drag: { from, finger, off }, label,
//                                               finger }
//     view.pickAt(x, y, filter?, slop?)         the thing drawn under a screen point; filter: true
//                                               for the places a ship can park, or a list of kinds
//     view.go(band, at?)                        ease to 'flight' | 'system' | 'galaxy' (at: a node
//                                               key to centre on, for flight)
//     view.follow(key | null)                   keep a node in the middle
//     view.band                                 the band the zoom is in now
//     view.inset(top, bottom)                   screen px the header and the card cover
//     view.resize()
// Right-click (or a long press) asks for an order on the thing under it (onOrder).
// ES module (`MapView`); needs a browser.

import { ArtBlueprints } from '../art/blueprints.js';
import { ArtBodies } from '../art/bodies.js';
import { ArtCulture } from '../art/culture.js';
import { Art } from '../art/render.js';
import { mulberry32 } from '../core/rng.js';
import { Theme } from '../core/theme.js';
import { Orbits4X } from './orbits.js';
import { World4X } from './world.js';

const MapView = (() => {
  const STYLE = 'line';
  const TAU = Math.PI * 2;
  const GOOD = '#7dff9a', BAD = '#ff6b6b';
  const INK = '#7df9ff', DIM = 'rgba(125, 249, 255, 0.55)', CHALK = '#e9eef2', AMBER = '#ffcf5a';
  const PLANET_COLOR = { gas: '#e0a868', blue: '#6f97d8', terran: '#58b07a', desert: '#d9a066', ice: '#cfe6f5', lava: '#ff7a3a' };
  const MOON_COLOR = { grey: '#8e8a84', ice: '#bcd3e2', sulfur: '#d6bf55', rust: '#a35a3b', dark: '#86838e' };
  const STAR_COLOR = { M: '#ffb08a', K: '#ffd27a', G: '#fff1c4', A: '#e6eeff', B: '#a8c8ff' };
  const LAYER = 384, SPAN = 1.15; // the galaxy's glow: px across, and how far past R it reaches
  const SYSTEM_FOLD = 14; // px: below this radius on screen, a system is its star alone
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = (a, b, v) => { const x = clamp((v - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); };

  function create(canvas, world, { onPick, onOrder, onPress, onDrag, onRelease }) {
    const ctx = canvas.getContext('2d', { alpha: false });
    const galaxy = world.galaxy, sys = world.start, R = galaxy.shape.R;
    const cultures = ArtCulture.forGalaxy(galaxy);
    let dpr = 1, W = 0, H = 0, top = 0, bottom = 0;
    // The camera: the world point at the middle of the clear area and px per world unit; `want` is
    // where it's going. It eases the target's offset on screen (px) and the zoom (log) separately,
    // so a dive from the galaxy into a ship lands on it rather than swinging past.
    const cam = { x: sys.x, y: sys.y, k: 1 }, want = { x: sys.x, y: sys.y, k: 1 };
    let followKey = null;
    // The zooms the bands start at: flight is the main game's (game/state.js resize), the system its
    // outermost orbit with room round it, the galaxy the whole disc.
    const Z = { flight: 1, system: 0.02, galaxy: 0.0003, min: 0.0002, max: 3 };
    const outermost = Math.max(...sys.nodes.filter((n) => n.parent === 'star').map((n) => n.orbit + (n.width || 0)));
    function fit() {
      const room = Math.min(W - 24, H - top - bottom - 24) / 2;
      Z.flight = clamp(Math.min(W, H) / 800, 0.55, 1.2);
      Z.system = room / (outermost * 1.3);
      Z.galaxy = room / (R * 1.05);
      Z.min = Z.galaxy * 0.6;
      Z.max = Z.flight * 3;
    }
    const bandOf = (k) => (k >= Z.flight * 0.12 ? 'flight' : k >= Math.sqrt(Z.system * Z.galaxy) ? 'system' : 'galaxy');

    // Art, made once each.
    const art = new Map();
    function artOf(n) {
      if (!art.has(n.key)) {
        const c = cultures.of(n.culture);
        art.set(n.key, n.kind === 'station' ? ArtBlueprints.create(n.size === 'major' ? 'station-major' : 'station-minor', c, n.seed) : ArtBlueprints.create('fighter-light', c, n.seed));
      }
      return art.get(n.key);
    }
    // A station's ghost: the art of the kind being placed, one per kind, in the player's culture.
    const ghosts = new Map();
    function ghostArt(type) {
      if (!ghosts.has(type)) {
        const size = World4X.STATIONS[type]?.size, culture = world.units()[0]?.culture ?? 0;
        ghosts.set(type, ArtBlueprints.create(size === 'major' ? 'station-major' : 'station-minor', cultures.of(culture), 977));
      }
      return ghosts.get(type);
    }
    const specks = (() => { const r = mulberry32(7919); return Array.from({ length: 160 }, () => ({ x: r(), y: r(), a: 0.12 + r() * 0.35, s: r() < 0.1 ? 1.4 : 0.9 })); })();

    // The galaxy's glow, drawn once (as the main game's map does, ui/map.js).
    let glow = null;
    function glowLayer() {
      if (glow) return glow;
      glow = document.createElement('canvas');
      glow.width = glow.height = LAYER;
      const g = glow.getContext('2d'), img = g.createImageData(LAYER, LAYER), F = galaxy.space;
      for (let j = 0; j < LAYER; j++) {
        for (let i = 0; i < LAYER; i++) {
          const x = ((i + 0.5) / LAYER * 2 - 1) * SPAN * R, y = ((j + 0.5) / LAYER * 2 - 1) * SPAN * R, o = (j * LAYER + i) * 4;
          const d = Math.min(1.4, galaxy.shape.density(x, y)), dust = F.dustAt(x, y), warm = Math.exp(-((Math.hypot(x, y) / (0.3 * R)) ** 2));
          img.data[o] = 150 + 105 * warm; img.data[o + 1] = 168 + 50 * warm; img.data[o + 2] = 255 - 120 * warm;
          img.data[o + 3] = Math.round(Math.min(1, d * 0.62) * (1 - 0.7 * dust) * 255);
        }
      }
      g.putImageData(img, 0, 0);
      return glow;
    }

    // ---------- Camera ----------

    const midY = () => top + (H - top - bottom) / 2;
    const toScreen = (x, y) => ({ x: W / 2 + (x - cam.x) * cam.k, y: midY() + (y - cam.y) * cam.k });
    const toWorld = (x, y) => ({ x: cam.x + (x - W / 2) / cam.k, y: cam.y + (y - midY()) / cam.k });

    function go(band, at) {
      followKey = null;
      if (band === 'galaxy') { want.x = 0; want.y = 0; want.k = Z.galaxy; return; }
      if (band === 'system') { want.x = sys.x; want.y = sys.y; want.k = Z.system; return; }
      const n = world.node(at) || world.units()[0];
      followKey = n.key;
      want.k = Z.flight;
    }
    function follow(key) { followKey = key; }

    function resize() {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = canvas.clientWidth; H = canvas.clientHeight;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      fit();
    }
    function inset(t, b) { if (t === top && b === bottom) return; top = t; bottom = b; fit(); }

    // ---------- Drawing ----------

    let last = performance.now(), shown = []; // shown: what was drawn and where, for picking
    let aiming = false; // giving an order: a tap picks only the places a ship can park
    function draw(now, { selected = null, targeting = false, rings = false, preview = null, build = null } = {}) {
      Art.beginFrame();
      aiming = targeting;
      const t = world.t, dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (followKey) { const n = world.node(followKey); if (n) { want.x = n.x; want.y = n.y; } }
      const e = 1 - Math.exp(-dt * 5);
      const k1 = cam.k * (want.k / cam.k) ** e;
      const ox = (want.x - cam.x) * cam.k * (1 - e), oy = (want.y - cam.y) * cam.k * (1 - e);
      cam.k = k1; cam.x = want.x - ox / k1; cam.y = want.y - oy / k1;
      const k = cam.k;
      shown = [];

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = Theme.color.bg;
      ctx.fillRect(0, 0, W, H);
      for (const s of specks) { ctx.fillStyle = `rgba(233, 238, 242, ${s.a})`; ctx.fillRect(s.x * W, s.y * H, s.s, s.s); }

      // The galaxy's glow, coming up as the view leaves the system.
      const glowA = 1 - smooth(Math.log(Z.galaxy * 4), Math.log(Z.system * 0.3), Math.log(k));
      if (glowA > 0.01) {
        const p = toScreen(-SPAN * R, -SPAN * R), size = 2 * SPAN * R * k;
        ctx.save(); ctx.globalAlpha = glowA; ctx.imageSmoothingEnabled = true;
        ctx.drawImage(glowLayer(), p.x, p.y, size, size);
        ctx.restore();
      }

      // Every other system: its star, a faint dot until it's near enough for its art. Named as the
      // view comes in on the galaxy.
      ctx.font = Theme.font(11);
      ctx.textAlign = 'center';
      const named = k > Z.galaxy * 2.2;
      for (const s of world.systems) {
        if (s === sys) continue;
        const p = toScreen(s.x, s.y);
        if (p.x < -40 || p.y < -40 || p.x > W + 40 || p.y > H + 40) continue;
        starAt(s.star, p, t, 0.55);
        shown.push({ pick: { system: s.index }, x: p.x, y: p.y, r: Math.max(8, s.star.r * k), rank: 5 });
        if (named) { ctx.fillStyle = 'rgba(138, 149, 179, 0.8)'; ctx.fillText(s.name.toUpperCase(), p.x, p.y + Math.max(5, s.star.r * k) + 14); }
      }

      // The start system: folded into its star when small, else everything by the orbit rules.
      const c = toScreen(sys.x, sys.y);
      if (sys.radius * k < SYSTEM_FOLD) {
        starAt(sys.star, c, t, 1);
        ctx.strokeStyle = INK; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(c.x, c.y, 7, 0, TAU); ctx.stroke();
        ctx.fillStyle = INK; ctx.fillText(sys.name.toUpperCase(), c.x, c.y + 22);
        shown.push({ pick: { system: 0 }, x: c.x, y: c.y, r: 12, rank: 5 });
      } else drawSystem(c, k, t, selected, targeting || rings, preview, build);
      ctx.textAlign = 'left';
    }

    // A star: its art once it's a few px across, else a dot in its class's colour.
    function starAt(star, p, t, alpha) {
      const rpx = star.r * cam.k;
      if (rpx < 3) {
        ctx.fillStyle = STAR_COLOR[star.cls] || CHALK;
        ctx.globalAlpha = alpha;
        ctx.beginPath(); ctx.arc(p.x, p.y, rpx < 1 ? 1.6 : 2.6, 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
        return;
      }
      Art.drawStar(ctx, { ...star, r: rpx }, STYLE, { x: p.x, y: p.y, t });
    }

    function drawSystem(c, k, t, selected, targeting, preview, build) {
      const nodes = sys.nodes, byKey = new Map(nodes.map((n) => [n.key, n]));
      const at = (n) => toScreen(n.x, n.y);
      // A node shows when its orbit (and every orbit above it) is big enough to see. The player's
      // ships always show, so they can be picked and dragged at any zoom (over their host's dot).
      const visible = (n) => {
        if (n.kind === 'ship') return true;
        for (let m = n; m && m.kind !== 'star'; m = byKey.get(m.parent)) {
          if (m.kind === 'ship' && (m.free || m.hold)) continue;
          if (m.kind !== 'belt' && m.kind !== 'graveyard' && m.kind !== 'ship' && m.parent !== 'star' && m.orbit * k < 6) return false;
        }
        return true;
      };
      const fade = smooth(SYSTEM_FOLD, SYSTEM_FOLD * 3, sys.radius * k);
      ctx.globalAlpha = fade;

      // The system's edge, faintly; the orbits round the star; belts as dashed bands; the orbits
      // round the planets and moons once they're big enough.
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(125, 249, 255, 0.07)';
      ctx.setLineDash([2, 6]);
      ctx.beginPath(); ctx.arc(c.x, c.y, sys.radius * k, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
      for (const n of nodes) {
        if (n.kind === 'star' || n.kind === 'graveyard' || (n.kind === 'ship' && (n.free || n.hold))) continue;
        if (n.kind === 'belt') {
          ctx.strokeStyle = 'rgba(178, 157, 132, 0.25)'; ctx.lineWidth = Math.max(1, n.width * k); ctx.setLineDash([2, 4]);
          ctx.beginPath(); ctx.arc(c.x, c.y, n.orbit * k, 0, TAU); ctx.stroke();
          ctx.setLineDash([]); ctx.lineWidth = 1;
          continue;
        }
        if (n.orbit * k < 6 || !visible(byKey.get(n.parent))) continue;
        const p = at(byKey.get(n.parent));
        ctx.strokeStyle = n.parent === 'star' ? 'rgba(125, 249, 255, 0.2)' : n.kind === 'ship' ? 'rgba(233, 238, 242, 0.1)' : 'rgba(125, 249, 255, 0.13)';
        ctx.beginPath(); ctx.arc(p.x, p.y, n.orbit * k, 0, TAU); ctx.stroke();
      }

      // The star, the bodies, the graveyards, the stations, then the ships over them all.
      starAt(sys.star, c, t, 1);
      shown.push({ pick: { key: 'star' }, x: c.x, y: c.y, r: Math.max(10, sys.star.r * k), rank: 4 });
      const order = { planet: 0, moon: 1, graveyard: 2, station: 3, ship: 4 };
      for (const n of nodes.filter((m) => m.kind in order).sort((a, b) => order[a.kind] - order[b.kind])) {
        if (!visible(n)) continue;
        const p = at(n), rpx = n.r * k;
        if (p.x < -80 || p.y < -80 || p.x > W + 80 || p.y > H + 80) continue;
        if (n.kind === 'planet' || n.kind === 'moon') body(n, p, rpx, Math.atan2(c.y - p.y, c.x - p.x));
        else if (n.kind === 'station') station(n, p, rpx, t);
        else if (n.kind === 'ship') ship(n, p, rpx, t);
        else graveyard(p);
        shown.push({ pick: { key: n.key }, kind: n.kind, x: p.x, y: p.y, r: Math.max(n.kind === 'ship' ? 22 : 14, rpx), rank: { ship: 0, station: 1, moon: 2, graveyard: 2, planet: 3 }[n.kind] });
      }

      // A ship under way: a dashed line through the stops still to reach; a ship holding a point
      // in space: a small cross under it.
      for (const s of world.units()) {
        if (s.hold) { const p = at(s); cross(p, 5, 'rgba(255, 207, 90, 0.5)'); continue; }
        if (!s.free) continue;
        route(s, s.route, s.key === selected ? AMBER : 'rgba(255, 207, 90, 0.4)', [4, 5]);
      }

      // An order being shaped: its route brighter, its end ringed (a body) or crossed (a point), and
      // what it is written above the finger (or above the end).
      if (preview) {
        const s = byKey.get(preview.from);
        if (s && preview.stops?.length) {
          route(s, preview.stops, AMBER, [6, 4], 1.6);
          const end = preview.stops[preview.stops.length - 1], p = toScreen(...xy(end));
          if (end.key) { const n = byKey.get(end.key); ctx.strokeStyle = AMBER; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(12, n.r * k) + 10, 0, TAU); ctx.stroke(); ctx.lineWidth = 1; }
          else cross(p, 8, AMBER);
          if (preview.label) { const f = preview.finger; tag(preview.label, f ? f.x : p.x, f ? f.y - 64 : p.y - 26, AMBER); }
        }
        if (s && preview.pulse) {
          const p = at(s), r = 14 + 10 * preview.pulse;
          ctx.strokeStyle = AMBER; ctx.globalAlpha = 1 - preview.pulse * 0.6; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.stroke();
          ctx.globalAlpha = fade; ctx.lineWidth = 1;
        }
      }

      // Giving an order: every place a ship could park ringed.
      if (targeting) {
        ctx.strokeStyle = AMBER; ctx.lineWidth = 1;
        for (const n of nodes) {
          if (!Orbits4X.HOSTS.ship.includes(n.kind) || !visible(n)) continue;
          const p = at(n), r = Math.max(10, n.r * k) + 8;
          ctx.setLineDash([3, 4]);
          ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.stroke();
        }
        ctx.setLineDash([]);
      }

      if (build) drawBuild(build, byKey, visible, k, t);

      // The pick: a turning dashed ring.
      const sel = selected && byKey.get(selected);
      if (sel && visible(sel)) {
        const p = at(sel), r = Math.max(9, sel.r * k * (sel.kind === 'star' ? 1.1 : 1)) + 6, a0 = (performance.now() / 4000) % TAU;
        ctx.strokeStyle = INK; ctx.lineWidth = 1.2; ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.arc(p.x, p.y, r, a0, a0 + TAU); ctx.stroke();
        ctx.setLineDash([]);
      }

      // Names: the picked thing's first, then ships, stations, planets, moons and the star, each
      // left out where it would cover one already written.
      ctx.font = Theme.font(10);
      const RANK = { ship: 1, station: 2, planet: 3, moon: 4, graveyard: 5, star: 6 };
      const boxes = [];
      for (const n of nodes.filter((m) => m.kind in RANK && visible(m)).sort((a, b) => (b.key === selected) - (a.key === selected) || RANK[a.kind] - RANK[b.kind])) {
        const p = at(n), rpx = Math.max(n.r * k, 4);
        if (p.x < -20 || p.x > W + 20 || p.y < 0 || p.y > H) continue;
        const text = n.kind === 'ship' || n.kind === 'station' ? n.name : n.name.toUpperCase();
        const y = n.kind === 'ship' || n.kind === 'station' ? p.y - rpx - 8 : p.y + rpx + 14, half = ctx.measureText(text).width / 2 + 4;
        const box = [p.x - half, y - 10, p.x + half, y + 3];
        if (n.key !== selected && boxes.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
        boxes.push(box);
        ctx.fillStyle = n.key === selected ? CHALK : n.kind === 'ship' ? AMBER : n.kind === 'station' ? INK : DIM;
        ctx.fillText(text, p.x, y);
      }
      ctx.globalAlpha = 1;
    }

    // Building (4x/building.js): the bodies a station can (green) or can't (red) go round, the ghost
    // of the one being placed, a station being dragged off, and what it all is above the finger.
    function drawBuild(b, byKey, visible, k, t) {
      ctx.lineWidth = 1.2;
      for (const m of b.marks || []) {
        const n = byKey.get(m.key);
        if (!n || !visible(n)) continue;
        const p = toScreen(n.x, n.y), r = Math.max(10, n.r * k) + 8;
        ctx.strokeStyle = m.ok ? GOOD : BAD; ctx.globalAlpha = m.ok ? 0.9 : 0.45; ctx.setLineDash([3, 4]);
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.stroke();
      }
      ctx.setLineDash([]); ctx.globalAlpha = 1;
      let at = null;
      const g = b.ghost;
      if (g) {
        const host = g.body && byKey.get(g.body), color = g.ok ? GOOD : BAD;
        if (host) {
          const w = world.ghostAt(host.key), p = toScreen(host.x, host.y);
          at = toScreen(w.x, w.y);
          ctx.strokeStyle = color; ctx.setLineDash([2, 4]); ctx.globalAlpha = 0.6;
          ctx.beginPath(); ctx.arc(p.x, p.y, Math.hypot(at.x - p.x, at.y - p.y), 0, TAU); ctx.stroke();
          ctx.setLineDash([]); ctx.lineWidth = 2; ctx.globalAlpha = 1;
          ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(10, host.r * k) + 8, 0, TAU); ctx.stroke();
          ctx.lineWidth = 1.2;
        } else at = g.at;
        if (at) {
          const spec = World4X.STATIONS[g.type] || { r: 100 }, rpx = Math.max(10, spec.r * k);
          const bp = ghostArt(g.type), s = rpx / (bp.radius || 100);
          ctx.save();
          ctx.globalAlpha = 0.55;
          ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * at.x, dpr * at.y);
          Art.drawAsset(ctx, bp, STYLE, { angle: 0, t, thrust: 0 });
          ctx.restore();
          ctx.strokeStyle = color; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(at.x, at.y, rpx + 6, 0, TAU); ctx.stroke();
          ctx.lineWidth = 1;
        }
      }
      const d = b.drag && byKey.get(b.drag.from);
      if (d && b.drag.finger) {
        const p = toScreen(d.x, d.y), f = b.drag.finger;
        ctx.strokeStyle = b.drag.off ? BAD : DIM; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(f.x, f.y); ctx.stroke();
        ctx.setLineDash([]);
        if (b.drag.off) { cross(f, 9, BAD); ctx.strokeStyle = BAD; ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(10, d.r * k) + 8, 0, TAU); ctx.stroke(); }
        ctx.lineWidth = 1;
      }
      if (b.label) {
        const f = b.finger || at;
        if (f) tag(b.label, f.x, b.finger ? f.y - 64 : f.y - 30, g ? (g.ok ? GOOD : BAD) : b.drag?.off ? BAD : AMBER);
      }
    }

    // A label in a box, centred on x, kept on screen.
    function tag(text, x, y, color) {
      ctx.font = Theme.font(12); ctx.textAlign = 'center';
      y = clamp(y, top + 22, H - bottom - 12); // clear of the header and the card
      const w = ctx.measureText(text).width + 16, x0 = clamp(x - w / 2, 8, W - w - 8);
      ctx.fillStyle = 'rgba(5, 6, 10, 0.85)'; ctx.fillRect(x0, y - 15, w, 22);
      ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.strokeRect(x0 + 0.5, y - 14.5, w - 1, 21);
      ctx.fillStyle = color; ctx.fillText(text, x0 + w / 2, y);
    }

    // Where a stop is now, in world units.
    function xy(stop) { if (stop.key) { const n = world.node(stop.key); return [n.x, n.y]; } return [stop.x, stop.y]; }
    // A dashed line from a ship through a list of stops.
    function route(s, stops, color, dash, width = 1) {
      const a = toScreen(s.x, s.y);
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash);
      ctx.beginPath(); ctx.moveTo(a.x, a.y);
      for (const st of stops) { const p = toScreen(...xy(st)); ctx.lineTo(p.x, p.y); }
      ctx.stroke();
      ctx.setLineDash([]); ctx.lineWidth = 1;
    }
    function cross(p, r, color) {
      ctx.strokeStyle = color; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(p.x - r, p.y - r); ctx.lineTo(p.x + r, p.y + r); ctx.moveTo(p.x + r, p.y - r); ctx.lineTo(p.x - r, p.y + r); ctx.stroke();
      ctx.lineWidth = 1;
    }

    // A planet or moon in Line art at its true size, or a dot in its colour when too small to read.
    function body(n, p, rpx, lightAngle) {
      if (rpx < 7) {
        const r = Math.max(n.kind === 'moon' ? 2 : 3.5, rpx), col = (n.kind === 'moon' ? MOON_COLOR : PLANET_COLOR)[n.type] || CHALK;
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.fill();
        if (n.ring) { ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(p.x, p.y, r * 1.9, r * 0.6, n.ringTilt || 0, 0, TAU); ctx.stroke(); }
        return;
      }
      const s = rpx / n.r;
      ctx.save();
      ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * p.x, dpr * p.y);
      if (n.kind === 'moon') ArtBodies.drawMoon(ctx, { ...n, x: 0, y: 0 }, STYLE);
      else Art.drawPlanet(ctx, { ...n, x: 0, y: 0 }, STYLE, { lightAngle });
      ctx.restore();
    }

    // A station: its art once it reads, else a diamond in its culture's colour.
    function station(n, p, rpx, t) {
      if (rpx < 6) {
        const r = n.size === 'major' ? 4 : 3, f = world.building(n);
        ctx.fillStyle = galaxy.cultureColor(n.culture);
        ctx.beginPath(); ctx.moveTo(p.x, p.y - r); ctx.lineTo(p.x + r, p.y); ctx.lineTo(p.x, p.y + r); ctx.lineTo(p.x - r, p.y); ctx.closePath(); ctx.fill();
        if (f != null) underway(p, r + 2, f);
        return;
      }
      const bp = artOf(n), s = rpx / (bp.radius || 100), f = world.building(n);
      ctx.save();
      if (f != null) ctx.globalAlpha *= 0.3 + 0.5 * f;
      ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * p.x, dpr * p.y);
      Art.drawAsset(ctx, bp, STYLE, { angle: n.a + Math.PI / 2, t, thrust: 0 });
      ctx.restore();
      if (f != null) underway(p, rpx, f);
    }
    // A station still being built: a ring filling round it.
    function underway(p, rpx, f) {
      ctx.strokeStyle = GOOD; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x, p.y, rpx + 6, -Math.PI / 2, -Math.PI / 2 + TAU * f); ctx.stroke();
      ctx.lineWidth = 1;
    }

    // A ship: its art once it reads (facing along its orbit, or where it's going), else a dart.
    function ship(n, p, rpx, t) {
      const dir = n.free || n.hold ? n.dir : n.a + Math.PI / 2;
      if (rpx < 6) {
        ctx.save();
        ctx.translate(p.x, p.y); ctx.rotate(dir);
        ctx.strokeStyle = AMBER; ctx.lineWidth = 1.2; ctx.fillStyle = Theme.color.bg;
        ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(-4.5, -3.8); ctx.lineTo(-2, 0); ctx.lineTo(-4.5, 3.8); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.restore();
        return;
      }
      const bp = artOf(n), s = rpx / (bp.radius || 20);
      ctx.save();
      ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * p.x, dpr * p.y);
      Art.drawAsset(ctx, bp, STYLE, { angle: dir, t, thrust: n.free ? 1 : 0 });
      ctx.restore();
    }

    // Wrecks at a Lagrange point: a few crossed marks.
    function graveyard(p) {
      ctx.strokeStyle = 'rgba(178, 157, 132, 0.8)'; ctx.lineWidth = 1;
      for (const [dx, dy] of [[-4, -2], [3, 3], [2, -4]]) {
        ctx.beginPath(); ctx.moveTo(p.x + dx - 2, p.y + dy - 2); ctx.lineTo(p.x + dx + 2, p.y + dy + 2); ctx.moveTo(p.x + dx + 2, p.y + dy - 2); ctx.lineTo(p.x + dx - 2, p.y + dy + 2); ctx.stroke();
      }
    }

    // ---------- Input ----------

    // The nearest thing drawn under (x, y), the smaller kinds winning a close call; for an order
    // (hosts), only the places a ship can park.
    function pickAt(x, y, filter = false, slop = 6) {
      const kinds = filter === true ? Orbits4X.HOSTS.ship : Array.isArray(filter) ? filter : null;
      let best = null, bd = Infinity;
      for (const s of shown) {
        if (kinds && !kinds.includes(s.kind)) continue;
        const d = Math.hypot(s.x - x, s.y - y);
        if (d > s.r + slop) continue;
        const score = d + s.rank * 2;
        if (score < bd) { bd = score; best = s.pick; }
      }
      return best;
    }
    function zoomAt(f, x, y) {
      const before = toWorld(x, y);
      cam.k = clamp(cam.k * f, Z.min, Z.max);
      const after = toWorld(x, y);
      cam.x += before.x - after.x; cam.y += before.y - after.y;
      followKey = null; want.x = cam.x; want.y = cam.y; want.k = cam.k;
    }
    const DRAG = 10, PRESS = 500, SNAP = 40; // px before a press is a drag; ms for a long press; px a drag snaps to a place
    const pointers = new Map();
    let downAt = null, moved = false, pinch = null, press = null, claimed = false;
    const local = (e) => { const b = canvas.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
    const at = (p, extra) => ({ x: p.x, y: p.y, world: toWorld(p.x, p.y), ...extra });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture?.(e.pointerId);
      const p = local(e);
      if (e.button === 2) { onOrder(pickAt(p.x, p.y, true), at(p)); return; }
      pointers.set(e.pointerId, p);
      if (pointers.size === 1) {
        downAt = p; moved = false;
        claimed = !!onPress?.(pickAt(p.x, p.y), at(p));
        clearTimeout(press);
        if (!claimed) press = setTimeout(() => { if (!moved && downAt) { const q = downAt; downAt = null; onOrder(pickAt(q.x, q.y, true), at(q)); } }, PRESS);
      }
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) }; moved = true;
        if (claimed) { claimed = false; onRelease?.(at(p, { cancel: true, moved: true, snap: null })); }
      }
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
        if (downAt && Math.hypot(p.x - downAt.x, p.y - downAt.y) > DRAG) { moved = true; clearTimeout(press); }
        if (!moved) return;
        if (claimed) {
          if (onDrag(at(p, { snap: pickAt(p.x, p.y, true, SNAP) })) === false) claimed = false;
          else return;
        }
        cam.x -= (p.x - prev.x) / cam.k; cam.y -= (p.y - prev.y) / cam.k; followKey = null; want.x = cam.x; want.y = cam.y; want.k = cam.k;
      }
    });
    const up = (e, cancel = false) => {
      if (!pointers.has(e.pointerId)) return;
      const p = pointers.get(e.pointerId);
      pointers.delete(e.pointerId);
      clearTimeout(press);
      if (pointers.size < 2) pinch = null;
      if (!pointers.size && claimed) {
        claimed = false;
        onRelease(at(p, { cancel, moved, snap: moved ? pickAt(p.x, p.y, true, SNAP) : null }));
        if (!moved && !cancel && downAt) onPick(pickAt(p.x, p.y, aiming), at(p));
      } else if (!pointers.size && !moved && downAt && !cancel) onPick(pickAt(p.x, p.y, aiming), at(p));
      if (!pointers.size) downAt = null;
    };
    canvas.addEventListener('pointerup', (e) => up(e));
    canvas.addEventListener('pointercancel', (e) => { moved = true; up(e, true); });
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); const p = local(e); zoomAt(Math.exp(-e.deltaY * 0.0015), p.x, p.y); }, { passive: false });

    resize();
    cam.k = want.k = Z.flight;
    go('flight');
    const u = world.units()[0];
    if (u) { cam.x = u.x; cam.y = u.y; }
    return {
      draw, go, follow, resize, inset, pickAt, toScreen, toWorld,
      get band() { return bandOf(cam.k); },
      get camera() { return { ...cam }; },
      get zooms() { return { ...Z }; },
    };
  }

  return { create };
})();

export { MapView };
