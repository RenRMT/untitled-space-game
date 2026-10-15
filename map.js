'use strict';

// Full-screen system map overlay. Generates the solar system from SYSTEM_CONFIG
// (data/system-config.js) with SolarSystem.generate (solar-system.js); a ?seed= URL parameter
// overrides the configured seed. It shows the star, orbits, planets and moons, belts and fields,
// nebulae, every station, how safe each part of the system is, and the contacts the player knows
// of (SystemMap.knowledge, see knowledge.js): identified ones by type, pinged ones as signals.
// ?dev shows every contact, plus the testing buttons (Jump, Contacts).
// Map travel: select a place (a station, planet, known contact or any point) and press Travel;
// the flight view runs the trip (travel.js) and the map shows the route, progress, signal
// prompts, Stop and fast-forward.

const SystemMap = (() => {
  const overlay = document.getElementById('map-overlay');
  const canvas = document.getElementById('map-canvas');
  const ctx = canvas.getContext('2d');
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

  const CONTACT = SolarSystem.CONTACT_TYPES; // label, colour and prompt per contact type
  const PLANET_COLOR = { gas: '#e0a868', blue: '#6f97d8', terran: '#58b07a', desert: '#d9a066', ice: '#cfe6f5', lava: '#ff7a3a' };
  const PLANET_LABEL = { gas: 'gas giant', blue: 'ice giant', terran: 'terran world', desert: 'desert world', ice: 'ice world', lava: 'lava world' };
  // Moons by their art/bodies.js type.
  const MOON_COLOR = { grey: '#8e8a84', ice: '#bcd3e2', sulfur: '#d6bf55', rust: '#a35a3b', dark: '#86838e' };
  const MOON_LABEL = { grey: 'grey regolith', ice: 'icy', sulfur: 'volcanic', rust: 'rust', dark: 'carbon' };
  const bodyColor = (p) => (p.parent !== undefined ? MOON_COLOR[p.type] : PLANET_COLOR[p.type]);
  const MARKET_LABEL = { capital: 'capital station · shipyard', major: 'station · shipyard', minor: 'station' };
  const TOP_BAR = 52;
  const BOTTOM_BAR = 56;
  const TINT_CELLS = 80; // the security tint is drawn from a grid this many cells across
  const { clamp } = MathUtil;

  let system = null;
  let tint = null; // the security tint: a small canvas over the system's square
  let showContacts = false;
  let player = null; // the ship's position in world units, set by the flight view
  let onJump = null;
  let onLoad = null; // called with each newly generated system (after the first one)
  let knowledge = null; // fog of war; null shows everything
  const dev = Params.has('dev');
  // Performance readouts on the map and in flight: ?perf or ?dev, toggled with P.
  let perf = dev || Params.has('perf');
  const fog = () => (dev ? null : knowledge);
  let trip = null; // the flight view's Travel instance, for drawing the route
  let hooks = {}; // flight view callbacks: travel(dest), stop(), fast(), investigate(), ignore()
  for (const id of ['map-jump', 'map-contacts']) document.getElementById(id).hidden = !dev;
  // How much of a contact the map shows: 'known', 'ping' or null.
  const contactState = (c) => (showContacts || !fog() ? 'known' : fog().contactState(c.id));

  // scale = screen px per world unit; (ox, oy) = the world point at the screen's top-left.
  const view = { w: 0, h: 0, dpr: 1, scale: 0.01, minScale: 0.001, maxScale: 0.5, ox: 0, oy: 0 };
  let isOpen = false;
  let fitted = false;
  let selected = null; // { station } | { planet } | { contact } | { point: { x, y } }
  let hovered = null;
  let drawQueued = false;
  const stats = { drawMs: 0, frames: 0 }; // for the performance overlay

  const toScreen = (x, y) => [(x - view.ox) * view.scale, (y - view.oy) * view.scale];
  const toWorld = (sx, sy) => [sx / view.scale + view.ox, sy / view.scale + view.oy];

  function hexToRgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }

  // ---------- System ----------

  function load(seed) {
    system = SolarSystem.generate(seed, SYSTEM_CONFIG);
    tint = null;
    selected = null;
    hovered = null;
    titleEl.textContent = `${system.name.toUpperCase()} SYSTEM`;
    // Let the flight view swap its world (fog of war, travel, scene) right away, even while the
    // map stays open; otherwise the map would draw the new system with the old one's charts.
    if (onLoad) onLoad(system);
    updateStats();
    updateInfo();
    requestDraw();
  }

  let statsVersion = -1; // the chart version the stats line was written for
  function updateStats() {
    statsVersion = fog() ? fog().version : -1;
    const c = fog() ? fog().counts() : null;
    const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
    const found = c ? ` · ${plural(c.known, 'contact')} identified${c.pinged ? `, ${plural(c.pinged, 'signal')}` : ''}` : '';
    statsEl.textContent = `seed ${system.seed} · ${system.star.cls}-class star · ${system.planets.length} planets · `
      + `${system.stations.length} stations${found}`;
  }

  function initialSeed() {
    const param = Params.get('seed');
    if (param === null || param === '') return SYSTEM_CONFIG.seed;
    return /^\d+$/.test(param) ? Number(param) : param;
  }

  function reroll() {
    const seed = 1 + Math.floor(Math.random() * 999999);
    Params.set('seed', seed);
    load(seed);
  }

  // ---------- View ----------

  function resize() {
    view.dpr = Math.min(window.devicePixelRatio || 1, 2);
    view.w = window.innerWidth;
    view.h = window.innerHeight;
    canvas.width = Math.round(view.w * view.dpr);
    canvas.height = Math.round(view.h * view.dpr);
    requestDraw();
  }

  // Frame the whole system.
  function fit() {
    const pad = 12;
    const bar = overlay.querySelector('.bar.bottom');
    const bottom = Math.max(BOTTOM_BAR, bar && !overlay.hidden ? bar.getBoundingClientRect().height : 0);
    const availW = view.w - pad * 2, availH = view.h - TOP_BAR - bottom;
    const span = system.radius * 2.1;
    view.scale = Math.min(availW, availH) / span;
    view.minScale = view.scale * 0.5;
    view.ox = -view.w / 2 / view.scale;
    view.oy = -(TOP_BAR + availH / 2) / view.scale;
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

  // Security over the system as a small image, drawn stretched (and so smoothed) over it: safe
  // blue-green near the stations through lawless red at the edge and in the nebulae.
  function securityTint() {
    if (tint) return tint;
    tint = document.createElement('canvas');
    tint.width = tint.height = TINT_CELLS;
    const c = tint.getContext('2d'), R = system.radius, step = (R * 2) / TINT_CELLS;
    for (let j = 0; j < TINT_CELLS; j++) {
      for (let i = 0; i < TINT_CELLS; i++) {
        const x = -R + (i + 0.5) * step, y = -R + (j + 0.5) * step;
        if (Math.hypot(x, y) > R) continue;
        c.fillStyle = Security.LEVELS[system.securityAt(x, y)].color;
        c.fillRect(i, j, 1, 1);
      }
    }
    return tint;
  }

  // A dot's radius on the map: its true size, but never smaller than `min` px.
  const dot = (r, min) => Math.max(min, r * view.scale);

  function draw() {
    const t0 = performance.now();
    if (fog() && fog().version !== statsVersion) updateStats();
    const { w, h, scale } = view;
    const R = system.radius;
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.fillStyle = Theme.color.bg;
    ctx.fillRect(0, 0, w, h);
    const [cx, cy] = toScreen(0, 0);
    const Rpx = R * scale;

    // The system, tinted by security.
    ctx.fillStyle = '#090c14';
    ctx.beginPath(); ctx.arc(cx, cy, Rpx, 0, Math.PI * 2); ctx.fill();
    ctx.save();
    ctx.globalAlpha = 0.09;
    ctx.imageSmoothingEnabled = true;
    ctx.beginPath(); ctx.arc(cx, cy, Rpx, 0, Math.PI * 2); ctx.clip();
    ctx.drawImage(securityTint(), cx - Rpx, cy - Rpx, Rpx * 2, Rpx * 2);
    ctx.restore();
    ctx.strokeStyle = 'rgba(255, 90, 110, 0.55)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.arc(cx, cy, Rpx, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);

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
    const speck = Math.max(1, Math.min(2.5, 30 * scale));
    for (const a of system.asteroids) {
      const [ax, ay] = toScreen(a.x, a.y);
      if (ax < -4 || ay < -4 || ax > w + 4 || ay > h + 4) continue;
      ctx.fillRect(ax - speck / 2, ay - speck / 2, speck, speck);
    }

    // The star, planets and moons.
    ctx.fillStyle = Theme.color.star;
    ctx.beginPath(); ctx.arc(cx, cy, dot(system.star.r, 5), 0, Math.PI * 2); ctx.fill();
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

    // Stations: diamonds in their culture's colour, the capital ringed.
    for (const s of system.stations) {
      const [sx, sy] = toScreen(s.x, s.y), r = s.size === 'major' ? 5 : 3.5;
      ctx.fillStyle = system.cultureColor(s.culture);
      ctx.beginPath(); ctx.moveTo(sx, sy - r); ctx.lineTo(sx + r, sy); ctx.lineTo(sx, sy + r); ctx.lineTo(sx - r, sy); ctx.closePath(); ctx.fill();
      if (s.market.type === 'capital') {
        ctx.strokeStyle = ctx.fillStyle;
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(sx, sy, r + 4, 0, Math.PI * 2); ctx.stroke();
      }
    }

    // Contacts: identified ones by type, pings as '?'.
    ctx.textAlign = 'center';
    for (const c of system.contacts) {
      const state = contactState(c);
      if (!state) continue;
      const [sx, sy] = toScreen(c.x, c.y);
      if (state !== 'known') {
        ctx.fillStyle = '#8a95b3';
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

    // Names by zoom: the star always, then planets and stations, then moons and the rest.
    ctx.font = Theme.font(11);
    const label = (text, x, y, color) => { ctx.fillStyle = color; ctx.fillText(text, x, y); };
    label(system.star.name, cx, cy - dot(system.star.r, 5) - 7, '#e6ebff');
    if (scale >= 0.009) {
      for (const p of system.planets) { const [px, py] = toScreen(p.x, p.y); label(p.name, px, py + dot(p.r, 3.5) + 13, '#8a95b3'); }
    }
    if (scale >= 0.012) {
      for (const s of system.stations) { const [sx, sy] = toScreen(s.x, s.y); label(s.name, sx, sy - 9, '#c3cae0'); }
      for (const n of system.nebulae) { const [nx, ny] = toScreen(n.x, n.y); label(n.name, nx, ny, hexToRgba(n.color, 0.9)); }
    }
    if (scale >= 0.04) {
      for (const m of system.moons) { const [mx, my] = toScreen(m.x, m.y); label(m.name, mx, my + dot(m.r, 1.5) + 12, Theme.color.dim); }
      for (const b of system.belts) { const [bx, by] = toScreen(0, -b.r); label(b.name, bx, by + 4, '#b29d84'); }
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

    // You are here.
    const home = system.stations[system.startStation];
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
        ctx.beginPath(); ctx.arc(sx, sy, sel.planet ? dot(sel.planet.r, 3.5) + 6 : 10, 0, Math.PI * 2); ctx.stroke();
      }
    }

    if (w >= 700) drawLegend();
    stats.frames++;
    stats.drawMs = performance.now() - t0;
    if (perf) drawPerf();
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
    let y = view.h - BOTTOM_BAR - 150;
    ctx.fillStyle = 'rgba(12, 15, 24, 0.85)';
    ctx.fillRect(x - 6, y - 14, 170, 182);
    ctx.font = Theme.font(11);
    const row = (drawIcon, text) => {
      drawIcon(x + 8, y - 4);
      ctx.fillStyle = '#aab3cc';
      ctx.fillText(text, x + 24, y);
      y += 18;
    };
    const diamond = (cx, cy, r) => { ctx.beginPath(); ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy); ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r, cy); ctx.closePath(); ctx.fill(); };
    row((cx, cy) => { ctx.fillStyle = '#aab3cc'; diamond(cx, cy, 5); ctx.strokeStyle = '#aab3cc'; ctx.beginPath(); ctx.arc(cx, cy, 8, 0, 7); ctx.stroke(); }, 'capital station');
    row((cx, cy) => { ctx.fillStyle = '#aab3cc'; diamond(cx, cy, 3.5); }, 'station / base');
    row((cx, cy) => { ctx.fillStyle = PLANET_COLOR.terran; ctx.beginPath(); ctx.arc(cx, cy, 3.5, 0, 7); ctx.fill(); }, 'planet');
    row((cx, cy) => { ctx.fillStyle = 'rgba(178, 157, 132, 0.6)'; for (let i = -1; i <= 1; i++) ctx.fillRect(cx + i * 4 - 1, cy + (i % 2) * 2 - 1, 2, 2); }, 'asteroids');
    row((cx, cy) => { [3, 2, 1, 0].forEach((l, i) => { ctx.fillStyle = Security.LEVELS[l].color; ctx.fillRect(cx - 8 + i * 4, cy - 4, 4, 8); }); }, 'security high → none');
    row((cx, cy) => { ctx.strokeStyle = CONTACT.derelict.color; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(cx - 4, cy - 4); ctx.lineTo(cx + 4, cy + 4); ctx.moveTo(cx + 4, cy - 4); ctx.lineTo(cx - 4, cy + 4); ctx.stroke(); }, 'derelict found');
    row((cx, cy) => { ctx.fillStyle = '#8a95b3'; ctx.textAlign = 'center'; ctx.fillText('?', cx, cy + 4); ctx.textAlign = 'left'; }, 'unidentified signal');
    row((cx, cy) => { const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 7); g.addColorStop(0, 'rgba(138, 92, 255, 0.6)'); g.addColorStop(1, 'rgba(138, 92, 255, 0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, 7, 0, 7); ctx.fill(); }, 'nebula');
  }

  // ---------- Selection & info panel ----------

  // Where a pick is, in world units.
  const placeOf = (p) => p.station || p.planet || p.contact || p.point;

  function pick(sx, sy, tolerancePx) {
    const [wx, wy] = toWorld(sx, sy);
    const at = { x: wx, y: wy };
    let best = null, bestD = Infinity;
    const consider = (o, sel, extra = 0) => {
      const d = Math.hypot(o.x - at.x, o.y - at.y) * view.scale - extra;
      if (d < tolerancePx && d < bestD) { bestD = d; best = sel; }
    };
    for (const s of system.stations) consider(s, { station: s }, 2);
    for (const p of [...system.planets, ...system.moons]) consider(p, { planet: p }, dot(p.r, 2));
    for (const c of system.contacts) if (contactState(c)) consider(c, { contact: c });
    if (best) return best;
    if (Math.hypot(wx, wy) > system.radius) return null;
    return { point: { x: wx, y: wy } };
  }

  const samePick = (a, b) => !!a && !!b && (a.point && b.point ? a.point.x === b.point.x && a.point.y === b.point.y
    : a.station === b.station && a.planet === b.planet && a.contact === b.contact && !a.point && !b.point);

  // Names come from the generator today, but escape them in case they ever come from saves.
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const row = (label, value) => `<div class="row"><span>${esc(label)}</span><span>${esc(value)}</span></div>`;
  const swatchHead = (color, title) => `<div class="head"><span class="swatch" style="background:${esc(color)}"></span>${esc(title)}</div>`;
  const km = (d) => `${(d / 1000).toFixed(1)}k`;
  const securityRow = (x, y) => {
    const s = Security.LEVELS[system.securityAt(x, y)];
    return `<div class="row"><span>security</span><span style="color:${s.color}">${esc(s.label)}</span></div>`;
  };
  const awayRow = (o) => (player ? row('distance', km(Math.hypot(o.x - player.x, o.y - player.y))) : '');

  // Travel destination for a pick.
  function destOf(p) {
    if (p.station) return { kind: 'station', id: p.station.id, x: p.station.x, y: p.station.y, name: p.station.name };
    if (p.planet) return { kind: 'planet', id: p.planet.name, x: p.planet.x, y: p.planet.y, name: p.planet.name };
    if (p.contact) {
      const known = contactState(p.contact) === 'known';
      return { kind: 'contact', id: p.contact.id, x: p.contact.x, y: p.contact.y, name: known ? `the ${CONTACT[p.contact.type].name}` : 'the signal' };
    }
    return { kind: 'point', x: p.point.x, y: p.point.y, name: 'the marked point' };
  }

  function updateTravelUI() {
    const travelling = !!(trip && trip.active);
    travelBtn.hidden = travelling;
    travelBtn.disabled = !selected || !hooks.travel;
    stopBtn.hidden = fastBtn.hidden = travelStatus.hidden = !travelling;
    rerollBtn.disabled = travelling;
    jumpBtn.disabled = travelling || !selected || !onJump;
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

    if (sel.station) {
      const s = sel.station;
      const where = s.planet !== undefined ? system.planets[s.planet].name : null;
      info.innerHTML =
        swatchHead(system.cultureColor(s.culture), s.name) +
        row('type', s.market.kind === 'outpost' ? s.market.type : MARKET_LABEL[s.market.type]) +
        row('culture', system.cultures[s.culture].name) +
        (where ? row('orbits', where) : '') +
        securityRow(s.x, s.y) + awayRow(s);
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
    const { x, y } = sel.point;
    const r = system.regionAt(x, y);
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
  travelBtn.addEventListener('click', () => {
    if (!selected || !hooks.travel) return;
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
    if (!selected || !onJump) return;
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
  window.addEventListener('resize', () => { if (isOpen) resize(); else fitted = false; });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'm' || e.key === 'M') isOpen ? close() : open();
    else if (e.key === 'Escape') close();
    else if (e.key === 'p' || e.key === 'P') { perf = !perf; requestDraw(); }
  });

  load(initialSeed());

  return {
    open,
    close,
    get isOpen() { return isOpen; },
    get system() { return system; },
    // Flight view hooks: where the ship is (world units), and what to do on Jump (a destination).
    setPlayer(x, y) {
      const moved = !player || Math.abs(player.x - x) * view.scale > 1 || Math.abs(player.y - y) * view.scale > 1;
      player = { x, y };
      if (moved) requestDraw();
    },
    set onJump(fn) { onJump = fn; updateInfo(); },
    set onLoad(fn) { onLoad = fn; },
    set knowledge(k) { knowledge = k; updateStats(); updateInfo(); requestDraw(); },
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
