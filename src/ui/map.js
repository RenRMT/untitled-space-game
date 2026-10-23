// Full-screen map overlay of the galaxy the flight view gives it (SystemMap.galaxy = ...). Two
// views, switched with the Local / Galaxy toggle at the bottom (or L and G):
// - Local: the system the ship is in (off in deep space and during map travel): the star, orbits, planets and
//   moons, belts and fields, nebulae, every station and gate, and the contacts the player knows
//   of (SystemMap.knowledge, see rules/knowledge.js): identified ones by type, pinged ones as signals.
// - Galaxy: the star of every system charted (entered at least once), by name (who holds it
//   shows on its callout: world/galaxy.js), and the gate links between them; a link to a system not yet charted leads
//   to a '?'. The system the ship is in is ringed; in deep space, the ship shows where it is.
// ?dev shows every system and contact, plus the testing buttons (Jump, Contacts).
// A mission's objective (SystemMap.objective, set by the flight view) shows as an amber ring; it
// can be picked and travelled to like anything else.
// Selecting a place shows its name and security above it and what can be done below it
// (ui/callout.js):
// - Local view: a station, gate, planet, known contact, the objective or any point: Set marker
//   (SystemMap.marker, one at a time, which the flight view points to) or Clear marker. While a
//   marker is set, Erase marker in the bottom bar clears it from either view.
// - Galaxy view, map travel: a system or any point in space, and Travel. The flight view runs the
//   trip (flight/travel.js) and the map shows the route (its dashed line is the progress), signal
//   prompts, Stop and fast-forward. Slower than the jump gates, on purpose.

import { ArtUtil } from '../art/util.js';
import { Display } from '../core/display.js';
import { MathUtil } from '../core/math.js';
import { Params } from '../core/store.js';
import { Theme } from '../core/theme.js';
import { Factions } from '../world/factions.js';
import { Security } from '../world/security.js';
import { SolarSystem } from '../world/solar-system.js';
import { Callout } from './callout.js';

const SystemMap = (() => {
  const overlay = document.getElementById('map-overlay');
  const canvas = document.getElementById('map-canvas');
  const ctx = canvas.getContext('2d', { alpha: false }); // each draw starts with an opaque fill
  const titleEl = document.getElementById('map-title');
  const contactsBtn = document.getElementById('map-contacts');
  const stopBtn = document.getElementById('map-stop');
  const fastBtn = document.getElementById('map-fast');
  const eraseBtn = document.getElementById('map-erase');
  const promptEl = document.getElementById('map-prompt');
  const promptText = document.getElementById('map-prompt-text');
  const ACTIONS = { travel: () => travelTo(), jump: () => jumpTo(), mark: () => setMarker(), unmark: () => clearMarker() };
  const callout = Callout.create(overlay, { onAction: (id) => ACTIONS[id] && ACTIONS[id]() });
  const viewBtns = ['local', 'galaxy'].map((view) => ({ view, el: document.getElementById(`map-view-${view}`) }));

  const CONTACT = SolarSystem.CONTACT_TYPES; // label, colour and prompt per contact type
  const PLANET_COLOR = { gas: '#e0a868', blue: '#6f97d8', terran: '#58b07a', desert: '#d9a066', ice: '#cfe6f5', lava: '#ff7a3a' };
  // Moons by their art/bodies.js type.
  const MOON_COLOR = { grey: '#8e8a84', ice: '#bcd3e2', sulfur: '#d6bf55', rust: '#a35a3b', dark: '#86838e' };
  const UNCHARTED = '#8a95b3';
  const TOP_BAR = 52;
  const BOTTOM_BAR = 56; // at least; the bar wraps on narrow screens (bottomBar() measures it)
  const ARRIVE_EDGE = 0.95; // travel to a system ends this far out from its star, in system radii
  const { clamp } = MathUtil;

  let galaxy = null;
  let system = null; // the local view's system: the one the ship is in or nearest to
  let mode = 'local'; // 'local' | 'galaxy'
  let showContacts = false;
  let player = null; // the ship's position in world units, set by the flight view
  let onJump = null;
  let knowledge = null; // fog of war; null shows everything
  let objective = null; // the mission's next step: { x, y, label, station (id) | null }, or null
  const OBJECTIVE_COLOR = Theme.color.amber;
  let marker = null; // the player's marker: { x, y, name (null for a point) }, or null
  let offline = null; // (station key) -> whether the station is offline (drawn faded), or null
  let routes = null; // () -> [[{ x, y }]]: each route's stops, drawn as a dashed loop, or null
  let onMarker = null; // told when the marker changes
  const MARKER_COLOR = Theme.color.marker;
  const dev = Params.has('dev');
  // Performance readouts on the map and in flight: ?perf or ?dev, toggled with P.
  let perf = dev || Params.has('perf');
  const fog = () => (dev ? null : knowledge);
  let trip = null; // the flight view's Travel instance, for drawing the route
  let hooks = {}; // flight view callbacks: travel(dest), stop(), fast(), investigate(), ignore()
  // What the player may know of yet: system(s), whether a system shows at all; gate(g), whether a
  // gate is online and says where it leads. Everything, until the flight view says otherwise.
  let access = { system: () => true, gate: () => true };
  const gateName = (g) => (access.gate(g) ? g.name : 'Jump gate');
  contactsBtn.hidden = !dev;
  // How much of a contact the map shows: 'known', 'ping' or null.
  const contactState = (c) => (showContacts || !fog() ? 'known' : fog().contactState(c.id));
  const charted = (s) => !fog() || fog().visited(s.index);

  // scale = screen px per world unit; (ox, oy) = the world point at the screen's top-left.
  // Each view keeps its own pan and zoom while the other is shown.
  const view = { w: 0, h: 0, dpr: 1, scale: 0.01, minScale: 0.001, maxScale: 0.5, ox: 0, oy: 0 };
  const kept = { local: null, galaxy: null }; // { scale, minScale, ox, oy } of the view not shown
  let isOpen = false;
  let fitted = false;
  // Local view: { station } | { planet } | { gate } | { contact } | { objective } | { point: { x, y } };
  // galaxy view: { system } | { point: { x, y } }
  let selected = null;
  let hovered = null;
  let drawQueued = false;
  const stats = { drawMs: 0, frames: 0 }; // for the performance overlay

  const toScreen = (x, y) => [(x - view.ox) * view.scale, (y - view.oy) * view.scale];
  const toWorld = (sx, sy) => [sx / view.scale + view.ox, sy / view.scale + view.oy];

  const hexToRgba = ArtUtil.rgba; // art/util.js

  // ---------- Galaxy and the local system ----------

  function setGalaxy(g) {
    galaxy = g;
    system = null;
    player = null;
    marker = null;
    kept.local = kept.galaxy = null;
    fitted = false;
    setLocal(galaxy.systems[galaxy.stations[galaxy.startStation].system]);
    if (isOpen) fit();
    updateCallout();
    requestDraw();
  }

  // Show another system in the local view (the ship flew or jumped there): framed afresh.
  function setLocal(s) {
    if (s === system) return;
    system = s;
    if (mode === 'local') { selected = hovered = null; fitted = false; if (isOpen) { fit(); fitted = true; } } else kept.local = null;
    updateTitle();
    updateCallout();
  }

  function updateTitle() {
    titleEl.textContent = mode === 'galaxy' ? 'GALAXY' : `${system.name.toUpperCase()} SYSTEM`;
    for (const b of viewBtns) b.el.setAttribute('aria-checked', String(b.view === mode));
  }


  // ---------- View ----------

  function resize() {
    view.dpr = Display.dpr();
    view.w = window.innerWidth;
    view.h = window.innerHeight;
    canvas.width = Math.round(view.w * view.dpr);
    canvas.height = Math.round(view.h * view.dpr);
    requestDraw();
  }

  // What the galaxy view frames: the charted systems and those their gates lead to, if the player
  // may know of them yet.
  const shownSystems = () => galaxy.systems.filter((s) => access.system(s) && (charted(s) || linked(s).some(charted)));
  const linked = (s) => galaxy.links.flatMap(([a, b]) => (a === s.index ? [galaxy.systems[b]] : b === s.index ? [galaxy.systems[a]] : []));

  // Frame the local system, or every system the galaxy view shows.
  function bottomBar() {
    const bar = overlay.querySelector('.bar.bottom');
    return Math.max(BOTTOM_BAR, bar && !overlay.hidden ? bar.getBoundingClientRect().height : 0);
  }
  function fit() {
    const pad = 12;
    const bottom = bottomBar();
    const availW = view.w - pad * 2, availH = view.h - TOP_BAR - bottom;
    let x0, y0, x1, y1;
    if (mode === 'galaxy') {
      const list = shownSystems();
      x0 = Math.min(...list.map((s) => s.origin.x - s.radius)); x1 = Math.max(...list.map((s) => s.origin.x + s.radius));
      y0 = Math.min(...list.map((s) => s.origin.y - s.radius)); y1 = Math.max(...list.map((s) => s.origin.y + s.radius));
      if (player) { x0 = Math.min(x0, player.x); x1 = Math.max(x1, player.x); y0 = Math.min(y0, player.y); y1 = Math.max(y1, player.y); }
      const m = Math.max(x1 - x0, y1 - y0) * 0.08;
      x0 -= m; x1 += m; y0 -= m; y1 += m;
    } else {
      const { x, y } = system.origin, R = system.radius * 1.05;
      x0 = x - R; x1 = x + R; y0 = y - R; y1 = y + R;
    }
    view.scale = Math.min(availW / (x1 - x0), availH / (y1 - y0));
    view.minScale = view.scale * 0.5;
    view.ox = (x0 + x1) / 2 - view.w / 2 / view.scale;
    view.oy = (y0 + y1) / 2 - (TOP_BAR + availH / 2) / view.scale;
    requestDraw();
  }

  function setMode(m) {
    if (m === mode) return;
    kept[mode] = { scale: view.scale, minScale: view.minScale, ox: view.ox, oy: view.oy };
    mode = m;
    selected = hovered = null;
    if (kept[mode]) Object.assign(view, kept[mode]);
    else if (isOpen) fit();
    else fitted = false;
    updateTitle();
    updateCallout();
    requestDraw();
  }

  function zoomAt(sx, sy, newScale) {
    const [wx, wy] = toWorld(sx, sy);
    view.scale = clamp(newScale, view.minScale, view.maxScale);
    view.ox = wx - sx / view.scale;
    view.oy = wy - sy / view.scale;
    requestDraw();
  }

  function requestDraw() {
    if (drawQueued || !isOpen) return;
    drawQueued = true;
    requestAnimationFrame(() => { drawQueued = false; draw(); });
  }

  // ---------- Drawing ----------

  // A dot's radius on the map: its true size, but never smaller than `min` px.
  const dot = (r, min) => Math.max(min, r * view.scale);
  const diamond = (cx, cy, r) => { ctx.beginPath(); ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy); ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r, cy); ctx.closePath(); ctx.fill(); };
  // A gate: a ring with a dot in its aperture.
  function gateIcon(x, y, color, r = 5) {
    ctx.strokeStyle = ctx.fillStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, 1.5, 0, Math.PI * 2); ctx.fill();
  }

  // The selection ring's radius, in px.
  const markRadius = (sel) => (sel.point ? 7 : sel.planet ? dot(sel.planet.r, 3.5) + 6 : sel.system ? STAR_DOT + 6 : 10);

  // The player's marker: a pin where it is (local view only; it marks a place in a system).
  function drawMarker() {
    if (!marker || mode !== 'local') return;
    const [x, y] = toScreen(marker.x, marker.y);
    ctx.fillStyle = MARKER_COLOR;
    ctx.beginPath(); ctx.arc(x, y - 16, 5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = MARKER_COLOR;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, y - 11); ctx.lineTo(x, y - 2); ctx.stroke();
    if (marker.name) {
      ctx.font = Theme.font(11);
      ctx.fillText(marker.name, x + 9, y - 12);
    }
  }

  function draw() {
    const t0 = performance.now();
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.fillStyle = Theme.color.bg;
    ctx.fillRect(0, 0, view.w, view.h);
    if (mode === 'galaxy') drawGalaxy();
    else drawLocal();
    drawMarker();
    drawRoute();

    // You are here: in the galaxy view, a ring round the system the ship is in (in deep space, the
    // ship itself).
    const home = galaxy.stations[galaxy.startStation];
    const at = player || home;
    const inSystem = mode === 'galaxy' && galaxy.systemAt(at.x, at.y);
    const [hx, hy] = inSystem ? toScreen(inSystem.origin.x, inSystem.origin.y) : toScreen(at.x, at.y);
    const hr = inSystem ? STAR_DOT + 9 : 8;
    ctx.strokeStyle = Theme.color.cyan;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(hx, hy, hr, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = Theme.color.cyan;
    ctx.font = Theme.font(10);
    ctx.fillText('YOU', hx + hr + 3, hy - hr + 4);

    // Hover / selection highlights.
    for (const [sel, color] of [[hovered, Theme.color.hud], [selected, Theme.color.cyan]]) {
      if (!sel) continue;
      const p = placeOf(sel);
      const [sx, sy] = toScreen(p.x, p.y);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      if (sel.point) {
        ctx.beginPath();
        ctx.moveTo(sx - 7, sy); ctx.lineTo(sx + 7, sy); ctx.moveTo(sx, sy - 7); ctx.lineTo(sx, sy + 7);
        ctx.stroke();
      } else {
        ctx.beginPath(); ctx.arc(sx, sy, markRadius(sel), 0, Math.PI * 2); ctx.stroke();
      }
    }
    if (callout.isShown) {
      const p = placeOf(selected);
      const [sx, sy] = toScreen(p.x, p.y);
      callout.place(sx, sy, markRadius(selected) + 6);
    }

    if (view.w >= 700) drawLegend();
    stats.frames++;
    stats.drawMs = performance.now() - t0;
    if (perf) drawPerf();
  }

  function drawLocal() {
    const { w, h, scale } = view;
    const S = system.star;
    const [cx, cy] = toScreen(S.x, S.y);
    const Rpx = system.radius * scale;

    // The system: a darker disc, with no edge to stop at.
    ctx.fillStyle = '#090c14';
    ctx.beginPath(); ctx.arc(cx, cy, Rpx, 0, Math.PI * 2); ctx.fill();

    // Nebulae: their blobs as soft clouds.
    for (const n of system.nebulae) {
      for (const b of n.blobs) {
        const [bx, by] = toScreen(n.x + b.dx, n.y + b.dy), br = b.r * scale;
        const g = ctx.createRadialGradient(bx, by, 0, bx, by, br);
        g.addColorStop(0, hexToRgba(n.color, 0.3));
        g.addColorStop(1, hexToRgba(n.color, 0));
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.fill();
      }
    }

    // Orbits, then belts as bands and fields as clouds of specks.
    ctx.strokeStyle = 'rgba(138, 180, 255, 0.13)';
    ctx.lineWidth = 1;
    for (const p of system.planets) { ctx.beginPath(); ctx.arc(cx, cy, p.orbit * scale, 0, Math.PI * 2); ctx.stroke(); }
    for (const b of system.belts) {
      ctx.strokeStyle = 'rgba(178, 157, 132, 0.07)';
      ctx.lineWidth = Math.max(2, b.width * scale);
      ctx.beginPath(); ctx.arc(cx, cy, b.r * scale, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(178, 157, 132, 0.4)';
    const speck = clamp(30 * scale, 1, 2.5);
    for (const a of system.asteroids) {
      const [ax, ay] = toScreen(a.x, a.y);
      if (ax < -4 || ay < -4 || ax > w + 4 || ay > h + 4) continue;
      ctx.fillRect(ax - speck / 2, ay - speck / 2, speck, speck);
    }

    // The star, planets and moons.
    ctx.fillStyle = Theme.color.star;
    ctx.beginPath(); ctx.arc(cx, cy, dot(S.r, 5), 0, Math.PI * 2); ctx.fill();
    for (const p of system.planets) {
      const [px, py] = toScreen(p.x, p.y);
      ctx.fillStyle = PLANET_COLOR[p.type];
      ctx.beginPath(); ctx.arc(px, py, dot(p.r, 3.5), 0, Math.PI * 2); ctx.fill();
      if (p.ring) {
        ctx.strokeStyle = hexToRgba(PLANET_COLOR[p.type], 0.7);
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.ellipse(px, py, dot(p.r, 3.5) * 1.9, dot(p.r, 3.5) * 0.6, p.ringTilt, 0, Math.PI * 2); ctx.stroke();
      }
    }
    for (const m of system.moons) {
      const [mx, my] = toScreen(m.x, m.y);
      ctx.fillStyle = MOON_COLOR[m.type];
      ctx.beginPath(); ctx.arc(mx, my, dot(m.r, 1.5), 0, Math.PI * 2); ctx.fill();
    }

    // Routes and shuttles (game/industry.js): dashed loops through their stops.
    if (routes) {
      ctx.save();
      ctx.strokeStyle = Theme.color.cyan;
      ctx.globalAlpha = 0.4;
      ctx.lineWidth = 1.2;
      ctx.setLineDash([4, 5]);
      for (const stops of routes()) {
        if (stops.length < 2) continue;
        ctx.beginPath();
        stops.forEach((p, i) => { const [x, y] = toScreen(p.x, p.y); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
        if (stops.length > 2) ctx.closePath();
        ctx.stroke();
      }
      ctx.restore();
    }
    // Stations: diamonds in their culture's colour, the capital ringed, an offline one faded. Gates: rings.
    for (const s of system.stations) {
      const [sx, sy] = toScreen(s.x, s.y), r = s.size === 'major' ? 5 : 3.5;
      ctx.globalAlpha = offline?.(s.key) ? 0.35 : 1;
      ctx.fillStyle = galaxy.cultureColor(s.culture);
      diamond(sx, sy, r);
      if (s.market.type === 'capital') {
        ctx.strokeStyle = ctx.fillStyle;
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(sx, sy, r + 4, 0, Math.PI * 2); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    for (const g of system.gates) gateIcon(...toScreen(g.x, g.y), g.color || galaxy.cultureColor(g.culture));

    // Contacts: identified ones by type, pings as '?'.
    ctx.textAlign = 'center';
    for (const c of system.contacts) {
      const state = contactState(c);
      if (!state) continue;
      const [sx, sy] = toScreen(c.x, c.y);
      if (state !== 'known') {
        ctx.fillStyle = UNCHARTED;
        ctx.font = Theme.font(13);
        ctx.fillText('?', sx, sy + 4);
        continue;
      }
      const r = 4;
      ctx.strokeStyle = CONTACT[c.type].color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(sx - r, sy - r); ctx.lineTo(sx + r, sy + r);
      ctx.moveTo(sx + r, sy - r); ctx.lineTo(sx - r, sy + r);
      ctx.stroke();
    }

    // The mission's objective: an amber ring with its step beside it.
    if (objective && system === galaxy.nearestSystem(objective.x, objective.y)) {
      const [ox, oy] = toScreen(objective.x, objective.y);
      ctx.strokeStyle = OBJECTIVE_COLOR;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(ox, oy, 9, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 0.35;
      ctx.beginPath(); ctx.arc(ox, oy, 14, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = OBJECTIVE_COLOR;
      ctx.font = Theme.font(11);
      ctx.fillText(objective.label, ox, oy + 27);
    }

    // Names by zoom: the star always, then planets, gates and stations, then moons and the rest.
    ctx.font = Theme.font(11);
    // The selected thing's name is on its callout instead, and the marked thing's on its pin.
    const chosen = selected && pickedOf(selected), pinned = marker && marker.ref;
    const label = (text, x, y, color, of) => { if (of && (of === chosen || of === pinned)) return; ctx.fillStyle = color; ctx.fillText(text, x, y); };
    label(S.name, cx, cy - dot(S.r, 5) - 7, '#e6ebff');
    if (scale >= 0.009 * (48000 / system.radius)) {
      for (const p of system.planets) { const [px, py] = toScreen(p.x, p.y); label(p.name, px, py + dot(p.r, 3.5) + 13, '#8a95b3', p); }
    }
    for (const g of system.gates) { const [gx, gy] = toScreen(g.x, g.y); label(gateName(g), gx, gy - 10, hexToRgba(g.color || galaxy.cultureColor(g.culture), 0.95), g); }
    if (scale >= 0.012 * (48000 / system.radius)) {
      for (const s of system.stations) { const [sx, sy] = toScreen(s.x, s.y); label(s.name, sx, sy - 9, '#c3cae0', s); }
      for (const n of system.nebulae) { const [nx, ny] = toScreen(n.x, n.y); label(n.name, nx, ny, hexToRgba(n.color, 0.9)); }
    }
    if (scale >= 0.04) {
      for (const m of system.moons) { const [mx, my] = toScreen(m.x, m.y); label(m.name, mx, my + dot(m.r, 1.5) + 12, Theme.color.dim, m); }
      for (const b of system.belts) { const [bx, by] = toScreen(b.cx, b.cy - b.r); label(b.name, bx, by + 4, '#b29d84'); }
    }
    ctx.textAlign = 'left';
  }

  // Map travel: the plotted route and destination.
  function drawRoute() {
    if (trip && trip.active) {
      const { to } = trip.route;
      const p = trip.pos;
      const [ax, ay] = toScreen(p.x, p.y);
      const [bx, by] = toScreen(to.x, to.y);
      ctx.strokeStyle = Theme.color.cyan;
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 5]);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(bx, by, 9, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
      if (trip.prompt) {
        const [qx, qy] = toScreen(trip.prompt.contact.x, trip.prompt.contact.y);
        ctx.strokeStyle = '#ffd166';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(qx, qy, 13, 0, Math.PI * 2); ctx.stroke();
      }
    }
  }

  // A system in the galaxy view is just its star, this many px across (half).
  const STAR_DOT = 5;

  function drawGalaxy() {
    const list = shownSystems();
    // Gate links, star to star: solid between charted systems, dashed toward one not yet charted.
    ctx.lineWidth = 1.5;
    for (const [a, b] of galaxy.links) {
      const A = galaxy.systems[a], B = galaxy.systems[b];
      if (!list.includes(A) || !list.includes(B)) continue;
      const both = charted(A) && charted(B);
      const [ax, ay] = toScreen(A.origin.x, A.origin.y), [bx, by] = toScreen(B.origin.x, B.origin.y);
      ctx.strokeStyle = both ? 'rgba(125, 249, 255, 0.4)' : 'rgba(138, 149, 179, 0.4)';
      ctx.setLineDash(both ? [] : [6, 6]);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.textAlign = 'center';
    for (const s of list) {
      const [x, y] = toScreen(s.origin.x, s.origin.y);
      if (!charted(s)) {
        ctx.fillStyle = Theme.color.bg; // the link stops short of the '?'
        ctx.beginPath(); ctx.arc(x, y, STAR_DOT + 4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = UNCHARTED;
        ctx.font = Theme.font(16);
        ctx.fillText('?', x, y + 6);
        continue;
      }
      ctx.fillStyle = Theme.color.star;
      ctx.beginPath(); ctx.arc(x, y, STAR_DOT, 0, Math.PI * 2); ctx.fill();
      ctx.font = Theme.font(12);
      ctx.fillStyle = '#e6ebff';
      ctx.fillText(s.name.toUpperCase(), x, y + STAR_DOT + 20);
    }
    ctx.textAlign = 'left';
  }

  // Performance readout (?perf or ?dev, or the P key), under the top bar.
  function drawPerf() {
    ctx.save();
    ctx.font = Theme.font(11);
    ctx.fillStyle = 'rgba(12, 15, 24, 0.85)';
    ctx.fillRect(8, TOP_BAR, 260, 23);
    ctx.fillStyle = Theme.color.cyan;
    ctx.fillText(`map draw ${stats.drawMs.toFixed(1)} ms · ${stats.frames} frames`, 14, TOP_BAR + 16);
    ctx.restore();
  }

  function drawLegend() {
    const x = 14;
    const rows = [];
    const row = (drawIcon, text) => rows.push([drawIcon, text]);
    const cross = (color) => (cx, cy) => { ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(cx - 4, cy - 4); ctx.lineTo(cx + 4, cy + 4); ctx.moveTo(cx + 4, cy - 4); ctx.lineTo(cx - 4, cy + 4); ctx.stroke(); };
    const question = (cx, cy) => { ctx.fillStyle = UNCHARTED; ctx.textAlign = 'center'; ctx.fillText('?', cx, cy + 4); ctx.textAlign = 'left'; };
    if (mode === 'galaxy') {
      row((cx, cy) => { ctx.fillStyle = Theme.color.star; ctx.beginPath(); ctx.arc(cx, cy, 3.5, 0, 7); ctx.fill(); }, 'charted system');
      row(question, 'uncharted system');
      row((cx, cy) => { ctx.strokeStyle = 'rgba(125, 249, 255, 0.7)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(cx - 8, cy); ctx.lineTo(cx + 8, cy); ctx.stroke(); }, 'gate link');
    } else {
      row((cx, cy) => { ctx.fillStyle = '#aab3cc'; diamond(cx, cy, 5); ctx.strokeStyle = '#aab3cc'; ctx.beginPath(); ctx.arc(cx, cy, 8, 0, 7); ctx.stroke(); }, 'capital station');
      row((cx, cy) => { ctx.fillStyle = '#aab3cc'; diamond(cx, cy, 3.5); }, 'station / base');
      row((cx, cy) => gateIcon(cx, cy, '#aab3cc'), 'jump gate');
      row((cx, cy) => { ctx.fillStyle = PLANET_COLOR.terran; ctx.beginPath(); ctx.arc(cx, cy, 3.5, 0, 7); ctx.fill(); }, 'planet');
      row((cx, cy) => { ctx.fillStyle = 'rgba(178, 157, 132, 0.6)'; for (let i = -1; i <= 1; i++) ctx.fillRect(cx + i * 4 - 1, cy + (i % 2) * 2 - 1, 2, 2); }, 'asteroids');
      if (marker) row((cx, cy) => { ctx.fillStyle = ctx.strokeStyle = MARKER_COLOR; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy - 3, 3.5, 0, 7); ctx.fill(); ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx, cy + 5); ctx.stroke(); }, 'your marker');
      if (objective) row((cx, cy) => { ctx.strokeStyle = OBJECTIVE_COLOR; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(cx, cy, 5, 0, 7); ctx.stroke(); }, 'mission objective');
      row(cross(CONTACT.derelict.color), 'derelict found');
      row(question, 'unidentified signal');
      row((cx, cy) => { const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 7); g.addColorStop(0, 'rgba(138, 92, 255, 0.6)'); g.addColorStop(1, 'rgba(138, 92, 255, 0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, 7, 0, 7); ctx.fill(); }, 'nebula');
    }
    let y = view.h - bottomBar() - rows.length * 18 + 6;
    ctx.fillStyle = 'rgba(12, 15, 24, 0.85)';
    ctx.fillRect(x - 6, y - 14, 170, rows.length * 18 + 10);
    ctx.font = Theme.font(11);
    for (const [drawIcon, text] of rows) {
      drawIcon(x + 8, y - 4);
      ctx.fillStyle = '#aab3cc';
      ctx.fillText(text, x + 24, y);
      y += 18;
    }
  }

  // ---------- Selection & its callout ----------

  // Where a pick is, in world units.
  const placeOf = (p) => p.station || p.planet || p.gate || p.contact || p.objective || (p.system && p.system.origin) || p.point;

  function pick(sx, sy, tolerancePx) {
    const [wx, wy] = toWorld(sx, sy);
    const at = { x: wx, y: wy };
    let best = null, bestD = Infinity;
    const consider = (o, sel, extra = 0) => {
      const d = Math.hypot(o.x - at.x, o.y - at.y) * view.scale - extra;
      if (d < tolerancePx && d < bestD) { bestD = d; best = sel; }
    };
    if (mode === 'galaxy') {
      // A system by its star, or else any point in space.
      for (const s of shownSystems()) consider(s.origin, { system: s }, STAR_DOT);
      return best || { point: { x: wx, y: wy } };
    }
    for (const s of system.stations) consider(s, { station: s }, 2);
    for (const g of system.gates) consider(g, { gate: g }, 3);
    for (const p of [...system.planets, ...system.moons]) consider(p, { planet: p }, dot(p.r, 2));
    for (const c of system.contacts) if (contactState(c)) consider(c, { contact: c });
    if (objective && !objective.station) consider(objective, { objective }, 6); // a station objective is picked as the station
    if (best) return best;
    if (Math.hypot(wx - system.origin.x, wy - system.origin.y) > system.radius) return null;
    return { point: { x: wx, y: wy } };
  }

  const pickedOf = (p) => p.station || p.planet || p.gate || p.contact || p.objective || p.system;
  const samePick = (a, b) => !!a && !!b && (a.point && b.point ? a.point.x === b.point.x && a.point.y === b.point.y
    : !a.point && !b.point && pickedOf(a) === pickedOf(b));


  // Travel destination for a pick.
  function destOf(p) {
    if (p.station) return { kind: 'station', id: p.station.id, x: p.station.x, y: p.station.y, name: p.station.name };
    if (p.gate) return { kind: 'gate', id: p.gate.id, x: p.gate.x, y: p.gate.y, name: `the ${p.gate.name}` };
    if (p.planet) return { kind: 'planet', id: p.planet.name, x: p.planet.x, y: p.planet.y, name: p.planet.name };
    if (p.contact) {
      const known = contactState(p.contact) === 'known';
      return { kind: 'contact', id: p.contact.id, x: p.contact.x, y: p.contact.y, name: known ? `the ${CONTACT[p.contact.type].name}` : 'the signal' };
    }
    if (p.objective) return { kind: 'objective', x: p.objective.x, y: p.objective.y, name: 'the objective' };
    if (p.system) {
      // Its edge, on the side the ship comes from.
      const { origin: o, radius: R } = p.system;
      const from = player || o, a = Math.atan2(from.y - o.y, from.x - o.x);
      const name = charted(p.system) ? `the ${p.system.name} system` : 'the uncharted system';
      return { kind: 'system', id: p.system.index, x: o.x + Math.cos(a) * R * ARRIVE_EDGE, y: o.y + Math.sin(a) * R * ARRIVE_EDGE, name };
    }
    return { kind: 'point', x: p.point.x, y: p.point.y, name: 'the marked point' };
  }

  // Map travel runs between systems, from the galaxy view: why it can't go to a pick, or null.
  function cantTravel(p) {
    if (!hooks.travel || !player) return 'Map travel is not available right now';
    if (p.system && galaxy.systemAt(player.x, player.y) === p.system) return 'You are in this system';
    return null;
  }

  // The local view is off outside a system (deep space, map travel): the galaxy view shows instead.
  const localOff = () => !!(trip && trip.active) || (!!player && !galaxy.systemAt(player.x, player.y));

  // The bottom bar: the view toggle, Erase marker, and during map travel Stop, ×4 and any signal.
  function updateTravelUI() {
    const travelling = !!(trip && trip.active);
    stopBtn.hidden = fastBtn.hidden = !travelling;
    eraseBtn.hidden = !marker;
    const off = localOff();
    for (const b of viewBtns) b.el.disabled = off && b.view === 'local';
    if (off && mode === 'local' && isOpen) { setMode('galaxy'); return; }
    fastBtn.setAttribute('aria-pressed', String(travelling && trip.fast));
    promptEl.hidden = !(travelling && trip.prompt);
    if (!travelling) return;
    if (trip.prompt) promptText.textContent = `Signal detected: ${CONTACT[trip.prompt.contact.type]?.prompt || 'a contact'} nearby.`;
  }

  // What a pick is called on its callout; null for a point in space.
  function nameOf(p) {
    if (p.system) return charted(p.system) ? `${p.system.name} system` : 'Uncharted system';
    if (p.station) return p.station.name;
    if (p.gate) return gateName(p.gate);
    if (p.planet) return p.planet.name;
    if (p.contact) return contactState(p.contact) === 'known' ? CONTACT[p.contact.type].label : 'Unidentified signal';
    if (p.objective) return p.objective.label;
    return null;
  }

  // The marker, if it is on this pick.
  const markedBy = (p) => !!marker && (p.point ? !marker.ref && marker.x === p.point.x && marker.y === p.point.y : marker.ref === pickedOf(p));

  // The selection's callout: its name and security above it, and below it Set / Clear marker in
  // the local view, Travel in the galaxy view (and ?dev's Jump in both).
  function updateCallout() {
    updateTravelUI();
    if (!selected || (trip && trip.active)) { callout.hide(); return; }
    const at = placeOf(selected);
    const sec = Security.LEVELS[galaxy.securityAt(at.x, at.y)];
    const name = nameOf(selected);
    const why = cantTravel(selected);
    // A charted system says who holds it.
    const sys = selected.system && charted(selected.system) ? selected.system : null;
    const holder = sys && (sys.holder ? Factions.get(sys.holder) : { name: 'No one', color: UNCHARTED });
    callout.show({
      lines: [name && { text: name, kind: 'name' }, holder && { text: `${sys.region.label} · ${holder.name}`, color: holder.color }, { text: `Security: ${sec.label}`, color: sec.color }].filter(Boolean),
      actions: [
        mode === 'galaxy'
          ? { id: 'travel', label: 'Travel', kind: 'primary', enabled: !why, title: why || 'Plot a course here' }
          : markedBy(selected)
            ? { id: 'unmark', label: 'Clear marker', title: 'Remove your marker' }
            : { id: 'mark', label: 'Set marker', kind: 'primary', title: 'Mark this place: the flight view points the way' },
        dev && { id: 'jump', label: 'Jump', enabled: !!onJump, title: 'Testing: move the ship here' },
      ].filter(Boolean).map((a) => ({ enabled: true, ...a })),
    });
    requestDraw(); // draw() places it
  }

  // The player's marker on the local view's selection, or none.
  function setMarker() {
    if (!selected || mode !== 'local') return;
    const at = placeOf(selected);
    marker = { x: at.x, y: at.y, name: nameOf(selected), ref: selected.point ? null : pickedOf(selected) };
    markerChanged();
  }
  function clearMarker() { marker = null; markerChanged(); }
  function markerChanged() {
    selected = null;
    updateCallout();
    requestDraw();
    if (onMarker) onMarker(marker);
  }

  // ---------- Input: drag to pan, wheel/pinch to zoom, tap to select ----------

  const pointers = new Map();
  let gesture = null;

  function startGesture() {
    const pts = [...pointers.values()];
    if (pts.length === 1) {
      gesture = { type: 'pan', x: pts[0].x, y: pts[0].y, ox: view.ox, oy: view.oy, moved: 0 };
    } else if (pts.length >= 2) {
      const [a, b] = pts;
      gesture = {
        type: 'pinch',
        dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2,
        scale: view.scale, ox: view.ox, oy: view.oy,
      };
    } else {
      gesture = null;
    }
  }

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    startGesture();
    canvas.style.cursor = 'grabbing';
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) {
      if (e.pointerType === 'mouse') {
        const p = pick(e.clientX, e.clientY, 10);
        // Hovering empty space shows nothing; only things get a hover card.
        const h = p && !p.point ? p : null;
        if (!samePick(h, hovered) && (h || hovered)) { hovered = h; updateCallout(); requestDraw(); }
      }
      return;
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!gesture) return;

    if (gesture.type === 'pan') {
      const dx = e.clientX - gesture.x;
      const dy = e.clientY - gesture.y;
      gesture.moved = Math.max(gesture.moved, Math.hypot(dx, dy));
      view.ox = gesture.ox - dx / view.scale;
      view.oy = gesture.oy - dy / view.scale;
    } else {
      const [a, b] = [...pointers.values()];
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const gx = gesture.ox + gesture.mx / gesture.scale;
      const gy = gesture.oy + gesture.my / gesture.scale;
      view.scale = clamp(gesture.scale * Math.hypot(a.x - b.x, a.y - b.y) / gesture.dist, view.minScale, view.maxScale);
      view.ox = gx - mx / view.scale;
      view.oy = gy - my / view.scale;
    }
    requestDraw();
  });

  function endPointer(e) {
    if (!pointers.has(e.pointerId)) return;
    const wasTap = e.type === 'pointerup' && gesture && gesture.type === 'pan' && gesture.moved < 6;
    pointers.delete(e.pointerId);
    if (wasTap) {
      const p = pick(e.clientX, e.clientY, e.pointerType === 'mouse' ? 10 : 18);
      selected = p && !samePick(p, selected) ? p : null;
      if (e.pointerType !== 'mouse') hovered = null;
      updateCallout();
      requestDraw();
    }
    // Lifting one finger of a pinch continues as a pan with the other.
    startGesture();
    if (!pointers.size) canvas.style.cursor = '';
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse' && hovered && !pointers.size) { hovered = null; updateCallout(); requestDraw(); }
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    // Firefox often reports wheel deltas in lines or pages rather than pixels.
    const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? view.h : 1);
    zoomAt(e.clientX, e.clientY, view.scale * Math.pow(1.0015, -dy));
  }, { passive: false });

  // ---------- Open / close & controls ----------

  let blocked = false; // set by the flight view while docked or fighting
  // The flight view's map button stays above the overlay: a second tap closes the map.
  const mapBtn = document.getElementById('map-btn');
  function open() {
    if (isOpen || blocked) return;
    isOpen = true;
    overlay.hidden = false;
    mapBtn.setAttribute('aria-expanded', 'true');
    resize();
    if (!fitted) { fit(); fitted = true; }
    updateCallout();
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    overlay.hidden = true;
    mapBtn.setAttribute('aria-expanded', 'false');
    pointers.clear();
    gesture = null;
  }

  mapBtn.addEventListener('click', () => (isOpen ? close() : open()));
  eraseBtn.addEventListener('click', () => clearMarker());
  for (const b of viewBtns) b.el.addEventListener('click', () => { if (!b.el.disabled) setMode(b.view); });
  function travelTo() {
    if (!selected || mode !== 'galaxy' || cantTravel(selected)) return;
    hooks.travel(destOf(selected));
    selected = null;
    updateCallout();
    requestDraw();
  }
  stopBtn.addEventListener('click', () => hooks.stop && hooks.stop());
  fastBtn.addEventListener('click', () => hooks.fast && hooks.fast());
  document.getElementById('map-investigate').addEventListener('click', () => hooks.investigate && hooks.investigate());
  document.getElementById('map-ignore').addEventListener('click', () => hooks.ignore && hooks.ignore());
  function jumpTo() {
    if (!selected || !onJump) return;
    onJump(destOf(selected));
    selected = null;
    updateCallout();
    close();
  }
  contactsBtn.addEventListener('click', () => {
    showContacts = !showContacts;
    contactsBtn.setAttribute('aria-pressed', String(showContacts));
    updateCallout();
    requestDraw();
  });
  document.getElementById('map-reset').addEventListener('click', () => {
    selected = null;
    hovered = null;
    updateCallout();
    fit();
  });
  window.addEventListener('resize', () => { if (isOpen) resize(); else fitted = false; kept.local = kept.galaxy = null; });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'm' || e.key === 'M') isOpen ? close() : open();
    else if (e.key === 'Escape') close();
    else if (e.key === 'p' || e.key === 'P') { perf = !perf; requestDraw(); }
    else if (isOpen && (e.key === 'g' || e.key === 'G')) setMode('galaxy');
    else if (isOpen && (e.key === 'l' || e.key === 'L') && !localOff()) setMode('local');
  });

  return {
    open,
    close,
    get isOpen() { return isOpen; },
    get galaxy() { return galaxy; },
    set galaxy(g) { setGalaxy(g); },
    get system() { return system; }, // the local view's
    get mode() { return mode; },
    setMode,
    // Flight view hooks: where the ship is (world units), and what to do on Jump (a destination).
    // The local view follows the ship to whichever system it is nearest.
    setPlayer(x, y) {
      const moved = !player || Math.abs(player.x - x) * view.scale > 1 || Math.abs(player.y - y) * view.scale > 1;
      const wasOff = localOff();
      player = { x, y };
      if (!(trip && trip.active)) setLocal(galaxy.nearestSystem(x, y));
      // Crossing a system's edge turns the local view off or on.
      if ((moved || wasOff !== localOff()) && isOpen) { updateCallout(); requestDraw(); } // open() brings both up to date
    },
    set onJump(fn) { onJump = fn; updateCallout(); },
    set knowledge(k) { knowledge = k; updateCallout(); requestDraw(); },
    set access(a) { access = a; updateCallout(); requestDraw(); },
    // The mission's objective to mark ({ x, y, label, station }), or null; redrawn only when it changes.
    set objective(o) {
      const same = o === objective || (o && objective && o.x === objective.x && o.y === objective.y && o.label === objective.label);
      if (same) return;
      if (selected && selected.objective) selected = null;
      objective = o;
      if (isOpen) { updateCallout(); requestDraw(); }
    },
    get objective() { return objective; },
    // The player's marker ({ x, y, name }, or null), set on the local view; the flight view points
    // to it and clears it on arrival (SystemMap.marker = null). onMarker(m) hears every change.
    get marker() { return marker; },
    set marker(m) { if (m === marker) return; marker = m; if (isOpen) { updateCallout(); requestDraw(); } },
    set onMarker(fn) { onMarker = fn; },
    // Which stations are offline (game/restoration.js): (key) -> bool.
    set offline(fn) { offline = fn; requestDraw(); },
    // The routes to draw (game/industry.js): () -> [[{ x, y }]].
    set routes(fn) { routes = fn; requestDraw(); },
    get perf() { return perf; },
    set blocked(b) { blocked = b; if (b) close(); },
    stats,
    // Map travel: the trip to draw, the flight view's callbacks, and a cheap redraw during a trip.
    set trip(t) { trip = t; updateCallout(); },
    set hooks(h) { hooks = h; updateCallout(); },
    get hooks() { return hooks; },
    redraw() { updateCallout(); requestDraw(); },
    callout, // the selection's (ui/callout.js), for the tests
    toScreen, // where a world point is on the map, in px
  };
})();

export { SystemMap };
