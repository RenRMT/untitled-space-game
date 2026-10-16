// Full-screen map overlay of the galaxy the flight view gives it (SystemMap.galaxy = ...; its Reroll
// button asks for a new one: SystemMap.onReroll). Two views, switched with the Local / Galaxy toggle
// (or L and G):
// - Local: the system the ship is in (or nearest to, in deep space): the star, orbits, planets and
//   moons, belts and fields, nebulae, every station and gate, and the contacts the player knows
//   of (SystemMap.knowledge, see rules/knowledge.js): identified ones by type, pinged ones as signals.
// - Galaxy: every system charted (entered at least once) and the jump gates between them; a gate
//   to a system not yet charted leads to a '?'.
// ?dev shows every system and contact, plus the testing buttons (Jump, Contacts).
// A mission's objective (SystemMap.objective, set by the flight view) shows as an amber ring; it
// can be picked and travelled to like anything else.
// Map travel (local view, from inside the system): select a place (a station, gate, planet, known
// contact, the objective or any point) and press Travel; the flight view runs the trip (flight/travel.js) and the map
// shows the route, progress, signal prompts, Stop and fast-forward.

import { ArtUtil } from '../art/util.js';
import { Format } from '../core/format.js';
import { Display } from '../core/display.js';
import { MathUtil } from '../core/math.js';
import { Params } from '../core/store.js';
import { Theme } from '../core/theme.js';
import { Security } from '../world/security.js';
import { SolarSystem } from '../world/solar-system.js';

const SystemMap = (() => {
  const overlay = document.getElementById('map-overlay');
  const canvas = document.getElementById('map-canvas');
  const ctx = canvas.getContext('2d', { alpha: false }); // each draw starts with an opaque fill
  const info = document.getElementById('map-info');
  const titleEl = document.getElementById('map-title');
  const statsEl = document.getElementById('map-stats');
  const contactsBtn = document.getElementById('map-contacts');
  const jumpBtn = document.getElementById('map-jump');
  const travelBtn = document.getElementById('map-travel');
  const stopBtn = document.getElementById('map-stop');
  const fastBtn = document.getElementById('map-fast');
  const rerollBtn = document.getElementById('map-reroll');
  const travelStatus = document.getElementById('map-travel-status');
  const promptEl = document.getElementById('map-prompt');
  const promptText = document.getElementById('map-prompt-text');
  const viewBtns = ['local', 'galaxy'].map((view) => ({ view, el: document.getElementById(`map-view-${view}`) }));

  const CONTACT = SolarSystem.CONTACT_TYPES; // label, colour and prompt per contact type
  const PLANET_COLOR = { gas: '#e0a868', blue: '#6f97d8', terran: '#58b07a', desert: '#d9a066', ice: '#cfe6f5', lava: '#ff7a3a' };
  const PLANET_LABEL = { gas: 'gas giant', blue: 'ice giant', terran: 'terran world', desert: 'desert world', ice: 'ice world', lava: 'lava world' };
  // Moons by their art/bodies.js type.
  const MOON_COLOR = { grey: '#8e8a84', ice: '#bcd3e2', sulfur: '#d6bf55', rust: '#a35a3b', dark: '#86838e' };
  const MOON_LABEL = { grey: 'grey regolith', ice: 'icy', sulfur: 'volcanic', rust: 'rust', dark: 'carbon' };
  const bodyColor = (p) => (p.parent !== undefined ? MOON_COLOR[p.type] : PLANET_COLOR[p.type]);
  const MARKET_LABEL = { capital: 'capital station · shipyard', major: 'station · shipyard', minor: 'station' };
  const UNCHARTED = '#8a95b3';
  const TOP_BAR = 52;
  const BOTTOM_BAR = 56;
  const TRAVEL_REACH = 1.25; // map travel works this many system radii from its star
  const { clamp } = MathUtil;

  let galaxy = null;
  let system = null; // the local view's system: the one the ship is in or nearest to
  let mode = 'local'; // 'local' | 'galaxy'
  let showContacts = false;
  let player = null; // the ship's position in world units, set by the flight view
  let onJump = null;
  let onReroll = null; // asked for a new galaxy, with a random seed
  let knowledge = null; // fog of war; null shows everything
  let objective = null; // the mission's next step: { x, y, label, station (id) | null }, or null
  const OBJECTIVE_COLOR = Theme.color.amber;
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
  for (const id of ['map-jump', 'map-contacts']) document.getElementById(id).hidden = !dev;
  // How much of a contact the map shows: 'known', 'ping' or null.
  const contactState = (c) => (showContacts || !fog() ? 'known' : fog().contactState(c.id));
  const charted = (s) => !fog() || fog().visited(s.index);

  // scale = screen px per world unit; (ox, oy) = the world point at the screen's top-left.
  // Each view keeps its own pan and zoom while the other is shown.
  const view = { w: 0, h: 0, dpr: 1, scale: 0.01, minScale: 0.001, maxScale: 0.5, ox: 0, oy: 0 };
  const kept = { local: null, galaxy: null }; // { scale, minScale, ox, oy } of the view not shown
  let isOpen = false;
  let fitted = false;
  // { station } | { planet } | { gate } | { contact } | { point: { x, y } }, or in the galaxy
  // view { system }
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
    kept.local = kept.galaxy = null;
    fitted = false;
    setLocal(galaxy.systems[galaxy.stations[galaxy.startStation].system]);
    if (isOpen) fit();
    updateStats();
    updateInfo();
    requestDraw();
  }

  // Show another system in the local view (the ship flew or jumped there): framed afresh.
  function setLocal(s) {
    if (s === system) return;
    system = s;
    if (mode === 'local') { selected = hovered = null; fitted = false; if (isOpen) { fit(); fitted = true; } } else kept.local = null;
    updateTitle();
    updateStats();
    updateInfo();
  }

  function updateTitle() {
    titleEl.textContent = mode === 'galaxy' ? 'GALAXY' : `${system.name.toUpperCase()} SYSTEM`;
    for (const b of viewBtns) b.el.setAttribute('aria-checked', String(b.view === mode));
  }

  let statsVersion = -1; // the chart version the stats line was written for
  function updateStats() {
    statsVersion = fog() ? fog().version : -1;
    const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
    if (mode === 'galaxy') {
      const known = galaxy.systems.filter(charted);
      const shown = new Set(shownSystems());
      const links = galaxy.links.filter(([a, b]) => shown.has(galaxy.systems[a]) && shown.has(galaxy.systems[b])).length;
      statsEl.textContent = `seed ${galaxy.seed} · ${plural(known.length, 'system')} charted · ${plural(links, 'gate link')}`;
      return;
    }
    const c = fog() ? fog().counts() : null;
    const found = c ? ` · ${plural(c.known, 'contact')} identified${c.pinged ? `, ${plural(c.pinged, 'signal')}` : ''}` : '';
    statsEl.textContent = `seed ${galaxy.seed} · ${system.star.cls}-class star · ${system.planets.length} planets · `
      + `${system.stations.length} stations${found}`;
  }

  function reroll() {
    if (onReroll) onReroll(1 + Math.floor(Math.random() * 999999));
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
  function fit() {
    const pad = 12;
    const bar = overlay.querySelector('.bar.bottom');
    const bottom = Math.max(BOTTOM_BAR, bar && !overlay.hidden ? bar.getBoundingClientRect().height : 0);
    const availW = view.w - pad * 2, availH = view.h - TOP_BAR - bottom;
    let x0, y0, x1, y1;
    if (mode === 'galaxy') {
      const list = shownSystems();
      x0 = Math.min(...list.map((s) => s.origin.x - s.radius)); x1 = Math.max(...list.map((s) => s.origin.x + s.radius));
      y0 = Math.min(...list.map((s) => s.origin.y - s.radius)); y1 = Math.max(...list.map((s) => s.origin.y + s.radius));
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
    updateStats();
    updateInfo();
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

  function draw() {
    const t0 = performance.now();
    if (fog() && fog().version !== statsVersion) updateStats();
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.fillStyle = Theme.color.bg;
    ctx.fillRect(0, 0, view.w, view.h);
    if (mode === 'galaxy') drawGalaxy();
    else drawLocal();

    // You are here.
    const home = galaxy.stations[galaxy.startStation];
    const [hx, hy] = player ? toScreen(player.x, player.y) : toScreen(home.x, home.y);
    ctx.strokeStyle = Theme.color.cyan;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(hx, hy, 8, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = Theme.color.cyan;
    ctx.font = Theme.font(10);
    ctx.fillText('YOU', hx + 11, hy + 14);

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
        const r = sel.planet ? dot(sel.planet.r, 3.5) + 6 : sel.system ? systemDot(sel.system) + 6 : 10;
        ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.stroke();
      }
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

    // Stations: diamonds in their culture's colour, the capital ringed. Gates: rings.
    for (const s of system.stations) {
      const [sx, sy] = toScreen(s.x, s.y), r = s.size === 'major' ? 5 : 3.5;
      ctx.fillStyle = galaxy.cultureColor(s.culture);
      diamond(sx, sy, r);
      if (s.market.type === 'capital') {
        ctx.strokeStyle = ctx.fillStyle;
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(sx, sy, r + 4, 0, Math.PI * 2); ctx.stroke();
      }
    }
    for (const g of system.gates) gateIcon(...toScreen(g.x, g.y), galaxy.cultureColor(g.culture));

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
    const label = (text, x, y, color) => { ctx.fillStyle = color; ctx.fillText(text, x, y); };
    label(S.name, cx, cy - dot(S.r, 5) - 7, '#e6ebff');
    if (scale >= 0.009 * (48000 / system.radius)) {
      for (const p of system.planets) { const [px, py] = toScreen(p.x, p.y); label(p.name, px, py + dot(p.r, 3.5) + 13, '#8a95b3'); }
    }
    for (const g of system.gates) { const [gx, gy] = toScreen(g.x, g.y); label(gateName(g), gx, gy - 10, hexToRgba(galaxy.cultureColor(g.culture), 0.95)); }
    if (scale >= 0.012 * (48000 / system.radius)) {
      for (const s of system.stations) { const [sx, sy] = toScreen(s.x, s.y); label(s.name, sx, sy - 9, '#c3cae0'); }
      for (const n of system.nebulae) { const [nx, ny] = toScreen(n.x, n.y); label(n.name, nx, ny, hexToRgba(n.color, 0.9)); }
    }
    if (scale >= 0.04) {
      for (const m of system.moons) { const [mx, my] = toScreen(m.x, m.y); label(m.name, mx, my + dot(m.r, 1.5) + 12, Theme.color.dim); }
      for (const b of system.belts) { const [bx, by] = toScreen(b.cx, b.cy - b.r); label(b.name, bx, by + 4, '#b29d84'); }
    }
    ctx.textAlign = 'left';

    // Map travel: the plotted route and destination.
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

  // A system's disc in the galaxy view: its true size, but at least a few px.
  const systemDot = (s) => Math.max(6, s.radius * view.scale);

  function drawGalaxy() {
    const list = shownSystems();
    // Gate links, gate to gate: solid between charted systems, dashed toward one not yet charted.
    ctx.lineWidth = 1.5;
    for (const [a, b] of galaxy.links) {
      const A = galaxy.systems[a], B = galaxy.systems[b];
      if (!list.includes(A) || !list.includes(B)) continue;
      const both = charted(A) && charted(B);
      const gate = A.gates.find((g) => g.to === b), there = galaxy.gates[gate.link];
      const [ax, ay] = toScreen(gate.x, gate.y), [bx, by] = toScreen(there.x, there.y);
      ctx.strokeStyle = both ? 'rgba(125, 249, 255, 0.55)' : 'rgba(138, 149, 179, 0.5)';
      ctx.setLineDash(both ? [] : [6, 6]);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.textAlign = 'center';
    for (const s of list) {
      const [x, y] = toScreen(s.origin.x, s.origin.y), r = systemDot(s);
      if (!charted(s)) {
        ctx.strokeStyle = UNCHARTED;
        ctx.setLineDash([3, 4]);
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = UNCHARTED;
        ctx.font = Theme.font(16);
        ctx.fillText('?', x, y + 6);
        ctx.font = Theme.font(11);
        ctx.fillText('Uncharted system', x, y + r + 16);
        continue;
      }
      ctx.fillStyle = '#090c14';
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(138, 180, 255, 0.25)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = Theme.color.star;
      ctx.beginPath(); ctx.arc(x, y, Math.max(3, r * 0.12), 0, Math.PI * 2); ctx.fill();
      // Its gates, where they sit on the disc.
      for (const g of s.gates) {
        const [gx, gy] = toScreen(g.x, g.y);
        gateIcon(gx, gy, galaxy.cultureColor(g.culture), 4);
      }
      ctx.font = Theme.font(12);
      ctx.fillStyle = '#e6ebff';
      ctx.fillText(`${s.name.toUpperCase()}`, x, y + r + 16);
      ctx.font = Theme.font(10);
      ctx.fillStyle = Theme.color.dim;
      ctx.fillText(`${s.star.cls}-class · ${s.planets.length} planets · ${s.stations.length} stations`, x, y + r + 30);
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
      row((cx, cy) => gateIcon(cx, cy, '#aab3cc', 4), 'jump gate');
      row((cx, cy) => { ctx.strokeStyle = 'rgba(125, 249, 255, 0.7)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(cx - 8, cy); ctx.lineTo(cx + 8, cy); ctx.stroke(); }, 'gate link');
    } else {
      row((cx, cy) => { ctx.fillStyle = '#aab3cc'; diamond(cx, cy, 5); ctx.strokeStyle = '#aab3cc'; ctx.beginPath(); ctx.arc(cx, cy, 8, 0, 7); ctx.stroke(); }, 'capital station');
      row((cx, cy) => { ctx.fillStyle = '#aab3cc'; diamond(cx, cy, 3.5); }, 'station / base');
      row((cx, cy) => gateIcon(cx, cy, '#aab3cc'), 'jump gate');
      row((cx, cy) => { ctx.fillStyle = PLANET_COLOR.terran; ctx.beginPath(); ctx.arc(cx, cy, 3.5, 0, 7); ctx.fill(); }, 'planet');
      row((cx, cy) => { ctx.fillStyle = 'rgba(178, 157, 132, 0.6)'; for (let i = -1; i <= 1; i++) ctx.fillRect(cx + i * 4 - 1, cy + (i % 2) * 2 - 1, 2, 2); }, 'asteroids');
      if (objective) row((cx, cy) => { ctx.strokeStyle = OBJECTIVE_COLOR; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(cx, cy, 5, 0, 7); ctx.stroke(); }, 'mission objective');
      row(cross(CONTACT.derelict.color), 'derelict found');
      row(question, 'unidentified signal');
      row((cx, cy) => { const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 7); g.addColorStop(0, 'rgba(138, 92, 255, 0.6)'); g.addColorStop(1, 'rgba(138, 92, 255, 0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, 7, 0, 7); ctx.fill(); }, 'nebula');
    }
    let y = view.h - BOTTOM_BAR - rows.length * 18 + 6;
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

  // ---------- Selection & info panel ----------

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
      for (const s of shownSystems()) consider(s.origin, { system: s }, systemDot(s));
      return best;
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

  // Names come from the generator today, but escape them in case they ever come from saves.
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const row = (label, value) => `<div class="row"><span>${esc(label)}</span><span>${esc(value)}</span></div>`;
  const swatchHead = (color, title) => `<div class="head"><span class="swatch" style="background:${esc(color)}"></span>${esc(title)}</div>`;
  const km = Format.dist;
  const securityRow = (x, y) => {
    const s = Security.LEVELS[galaxy.securityAt(x, y)];
    return `<div class="row"><span>security</span><span style="color:${s.color}">${esc(s.label)}</span></div>`;
  };
  const awayRow = (o) => (player ? row('distance', km(Math.hypot(o.x - player.x, o.y - player.y))) : '');

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
    return { kind: 'point', x: p.point.x, y: p.point.y, name: 'the marked point' };
  }

  // Map travel runs within a system: from inside (or just outside) the one shown.
  const canTravel = () => mode === 'local' && !!player
    && Math.hypot(player.x - system.origin.x, player.y - system.origin.y) <= system.radius * TRAVEL_REACH;

  function updateTravelUI() {
    const travelling = !!(trip && trip.active);
    travelBtn.hidden = travelling;
    travelBtn.disabled = !selected || selected.system || !hooks.travel || !canTravel();
    travelBtn.title = mode === 'galaxy' ? 'Plot a course in the local view'
      : canTravel() ? 'Plot a course to the selected place' : 'Map travel works inside a system: fly or jump there first';
    stopBtn.hidden = fastBtn.hidden = travelStatus.hidden = !travelling;
    rerollBtn.disabled = travelling;
    jumpBtn.disabled = travelling || !selected || selected.system || !onJump;
    for (const b of viewBtns) b.el.disabled = travelling && b.view !== 'local';
    fastBtn.setAttribute('aria-pressed', String(travelling && trip.fast));
    promptEl.hidden = !(travelling && trip.prompt);
    if (!travelling) return;
    travelStatus.textContent = `Travelling to ${trip.dest.name} · ${km(trip.remaining)} · ${Math.ceil(trip.eta)} s`;
    if (trip.prompt) promptText.textContent = `Signal detected: ${CONTACT[trip.prompt.contact.type]?.prompt || 'a contact'} nearby.`;
  }

  function updateInfo() {
    updateTravelUI();
    const sel = selected || hovered;
    info.hidden = !sel;
    if (!sel) return;

    if (sel.system) {
      const s = sel.system;
      if (!charted(s)) {
        const via = s.gates.map((g) => galaxy.systems[galaxy.gates[g.link].system]).filter(charted).map((o) => o.name);
        info.innerHTML = swatchHead('#2a3350', 'Uncharted system') + (via.length ? row('reached from', via.join(', ')) : '') + awayRow(s.origin);
        return;
      }
      info.innerHTML =
        swatchHead(Theme.color.star, `${s.name} system`) +
        row('star', `${s.star.cls}-class`) +
        row('planets', String(s.planets.length)) +
        row('stations', String(s.stations.length)) +
        row('gates to', s.gates.map((g) => (!access.gate(g) ? 'offline' : charted(galaxy.systems[g.to]) ? galaxy.systems[g.to].name : 'uncharted')).join(', ') || 'none') +
        awayRow(s.origin);
      return;
    }
    if (sel.station) {
      const s = sel.station;
      const where = s.planet !== undefined ? galaxy.planets[s.planet].name : null;
      info.innerHTML =
        swatchHead(galaxy.cultureColor(s.culture), s.name) +
        row('type', s.market.kind === 'outpost' ? s.market.type : MARKET_LABEL[s.market.type]) +
        row('culture', galaxy.cultures[s.culture].name) +
        (where ? row('orbits', where) : '') +
        securityRow(s.x, s.y) + awayRow(s);
      return;
    }
    if (sel.gate) {
      const g = sel.gate, to = galaxy.systems[g.to];
      info.innerHTML =
        swatchHead(galaxy.cultureColor(g.culture), gateName(g)) +
        row('type', 'jump gate') +
        (access.gate(g) ? row('leads to', charted(to) ? `${to.name} system` : 'an uncharted system') : row('status', 'offline')) +
        row('built by', galaxy.cultures[g.culture].name) +
        securityRow(g.x, g.y) + awayRow(g);
      return;
    }
    if (sel.planet) {
      const p = sel.planet;
      const moons = p.moons ? p.moons.length : 0;
      info.innerHTML =
        swatchHead(bodyColor(p), p.name) +
        row('type', p.parent !== undefined ? `moon · ${MOON_LABEL[p.type]}` : PLANET_LABEL[p.type] + (p.ring ? ' · rings' : '')) +
        (p.parent === undefined ? row('orbit', km(p.orbit)) : '') +
        (moons ? row('moons', String(moons)) : '') +
        securityRow(p.x, p.y) + awayRow(p);
      return;
    }
    if (sel.contact) {
      const c = sel.contact, known = contactState(c) === 'known';
      info.innerHTML =
        swatchHead(known ? CONTACT[c.type].color : '#2a3350', known ? CONTACT[c.type].label : 'Unidentified signal') +
        (known && c.hostile ? row('threat', 'pirates lying in wait') : '') +
        securityRow(c.x, c.y) + awayRow(c);
      return;
    }
    if (sel.objective) {
      const o = sel.objective;
      info.innerHTML = swatchHead(OBJECTIVE_COLOR, 'Mission objective') + row('next', o.label) + securityRow(o.x, o.y) + awayRow(o);
      return;
    }
    const { x, y } = sel.point;
    const r = galaxy.regionAt(x, y);
    info.innerHTML =
      swatchHead(r.nebula ? r.nebula.color : '#2a3350', r.nebula ? r.nebula.name : 'Open space') +
      (r.near ? row('near', r.near.name) : '') +
      row('from the star', km(r.fromStar)) +
      securityRow(x, y) + awayRow(sel.point);
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
        if (!samePick(h, hovered) && (h || hovered)) { hovered = h; updateInfo(); requestDraw(); }
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
      updateInfo();
      requestDraw();
    }
    // Lifting one finger of a pinch continues as a pan with the other.
    startGesture();
    if (!pointers.size) canvas.style.cursor = '';
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse' && hovered && !pointers.size) { hovered = null; updateInfo(); requestDraw(); }
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
  function open() {
    if (isOpen || blocked) return;
    isOpen = true;
    overlay.hidden = false;
    resize();
    if (!fitted) { fit(); fitted = true; }
    updateStats();
    updateInfo();
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    overlay.hidden = true;
    pointers.clear();
    gesture = null;
  }

  document.getElementById('map-btn').addEventListener('click', open);
  document.getElementById('map-close').addEventListener('click', close);
  document.getElementById('map-reroll').addEventListener('click', reroll);
  for (const b of viewBtns) b.el.addEventListener('click', () => setMode(b.view));
  travelBtn.addEventListener('click', () => {
    if (!selected || !hooks.travel || !canTravel()) return;
    hooks.travel(destOf(selected));
    selected = null;
    updateInfo();
    requestDraw();
  });
  stopBtn.addEventListener('click', () => hooks.stop && hooks.stop());
  fastBtn.addEventListener('click', () => hooks.fast && hooks.fast());
  document.getElementById('map-investigate').addEventListener('click', () => hooks.investigate && hooks.investigate());
  document.getElementById('map-ignore').addEventListener('click', () => hooks.ignore && hooks.ignore());
  jumpBtn.addEventListener('click', () => {
    if (!selected || selected.system || !onJump) return;
    onJump(destOf(selected));
    selected = null;
    updateInfo();
    close();
  });
  contactsBtn.addEventListener('click', () => {
    showContacts = !showContacts;
    contactsBtn.setAttribute('aria-pressed', String(showContacts));
    updateInfo();
    requestDraw();
  });
  document.getElementById('map-reset').addEventListener('click', () => {
    selected = null;
    hovered = null;
    updateInfo();
    fit();
  });
  window.addEventListener('resize', () => { if (isOpen) resize(); else fitted = false; kept.local = kept.galaxy = null; });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'm' || e.key === 'M') isOpen ? close() : open();
    else if (e.key === 'Escape') close();
    else if (e.key === 'p' || e.key === 'P') { perf = !perf; requestDraw(); }
    else if (isOpen && (e.key === 'g' || e.key === 'G') && !(trip && trip.active)) setMode('galaxy');
    else if (isOpen && (e.key === 'l' || e.key === 'L')) setMode('local');
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
      player = { x, y };
      if (!(trip && trip.active)) setLocal(galaxy.nearestSystem(x, y));
      if (moved && isOpen) { updateTravelUI(); requestDraw(); } // open() brings both up to date
    },
    set onJump(fn) { onJump = fn; updateInfo(); },
    set onReroll(fn) { onReroll = fn; },
    set knowledge(k) { knowledge = k; updateStats(); updateInfo(); requestDraw(); },
    set access(a) { access = a; updateStats(); updateInfo(); requestDraw(); },
    // The mission's objective to mark ({ x, y, label, station }), or null; redrawn only when it changes.
    set objective(o) {
      const same = o === objective || (o && objective && o.x === objective.x && o.y === objective.y && o.label === objective.label);
      if (same) return;
      if (selected && selected.objective) selected = null;
      objective = o;
      if (isOpen) { updateInfo(); requestDraw(); }
    },
    get objective() { return objective; },
    get perf() { return perf; },
    set blocked(b) { blocked = b; if (b) close(); },
    stats,
    // Map travel: the trip to draw, the flight view's callbacks, and a cheap redraw during a trip.
    set trip(t) { trip = t; updateTravelUI(); },
    set hooks(h) { hooks = h; updateTravelUI(); },
    get hooks() { return hooks; },
    redraw() { updateTravelUI(); requestDraw(); },
  };
})();

export { SystemMap };
