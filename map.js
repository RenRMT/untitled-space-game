'use strict';

// Full-screen galaxy map overlay. Generates the galaxy from GALAXY_CONFIG (data/galaxy-config.js)
// with Galaxy.generate (galaxy.js); a ?seed= URL parameter overrides the configured seed.
// With fog of war (GalaxyMap.knowledge, see knowledge.js) it shows only what the player knows:
// explored sectors, charted pockets, known systems, outposts and routes, and contacts as signals.
// ?dev shows everything, plus the testing buttons (Jump, Hidden, Contacts).
// Map travel: select a known place or any sector and press Travel; the flight view runs the trip
// (travel.js) and the map shows the route, progress, signal prompts, Stop and fast-forward.

const GalaxyMap = (() => {
  const overlay = document.getElementById('map-overlay');
  const canvas = document.getElementById('map-canvas');
  const ctx = canvas.getContext('2d');
  const info = document.getElementById('map-info');
  const statsEl = document.getElementById('map-stats');
  const hiddenBtn = document.getElementById('map-hidden');
  const contactsBtn = document.getElementById('map-contacts');
  const jumpBtn = document.getElementById('map-jump');
  const travelBtn = document.getElementById('map-travel');
  const stopBtn = document.getElementById('map-stop');
  const fastBtn = document.getElementById('map-fast');
  const rerollBtn = document.getElementById('map-reroll');
  const travelStatus = document.getElementById('map-travel-status');
  const promptEl = document.getElementById('map-prompt');
  const promptText = document.getElementById('map-prompt-text');

  const ZONE_LABEL = { pocket: 'Charted pocket', claimed: 'Claimed · uncharted', deep: 'Deep space', frontier: 'Frontier' };
  const CONTACT = Galaxy.CONTACT_TYPES; // label, colour and prompt per contact type
  const TOP_BAR = 52;
  const BOTTOM_BAR = 56;
  const MAX_SCALE = 90;

  let galaxy = null;
  let cells = []; // territoryOf() per sector, cached for drawing
  let contacts = []; // deep-space encounters, for the dev layer
  let showHidden = false;
  let showContacts = false;
  let player = null; // the ship's position in sector units, set by the flight view
  let onJump = null;
  let onLoad = null; // called with each newly generated galaxy (after the first one)
  let knowledge = null; // fog of war; null shows everything
  let knowledgeId = 0; // bumps when the knowledge object is replaced (new galaxy), for the layer cache
  const dev = Params.has('dev');
  // Performance readouts on the map and in flight: ?perf or ?dev, toggled with P.
  let perf = dev || Params.has('perf');
  const fog = () => (dev ? null : knowledge);
  let trip = null; // the flight view's Travel instance, for drawing the route
  let hooks = {}; // flight view callbacks: travel(dest), stop(), fast(), investigate(), ignore()
  for (const id of ['map-jump', 'map-hidden', 'map-contacts']) document.getElementById(id).hidden = !dev;
  const sysKnown = (s) => !fog() || fog().knowsSystem(s.id);
  const outpostKnown = (o) => !fog() || fog().knowsOutpost(o.id);
  const routeKnown = (r) => (!fog() || fog().knowsRoute(r.link)) && (r.kind !== 'hidden' || showHidden || fog());

  // scale = screen px per sector; (ox, oy) = sector coordinate at the screen's top-left.
  const view = { w: 0, h: 0, dpr: 1, scale: 1, minScale: 0.3, ox: 0, oy: 0 };
  let isOpen = false;
  let fitted = false;
  let selected = null; // { system } or { sector: { x, y } }
  let hovered = null;
  let drawQueued = false;

  const { clamp } = MathUtil;
  const toScreen = (x, y) => [(x - view.ox) * view.scale, (y - view.oy) * view.scale];
  const toGrid = (sx, sy) => [sx / view.scale + view.ox, sy / view.scale + view.oy];

  function hexToRgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }

  // ---------- Galaxy ----------

  function load(seed) {
    galaxy = Galaxy.generate(seed, GALAXY_CONFIG);
    cells = [];
    contacts = [];
    for (let y = 0; y < galaxy.size; y++) {
      for (let x = 0; x < galaxy.size; x++) {
        cells.push(galaxy.territoryOf(x, y));
        const c = galaxy.deepSector(x, y);
        if (c) contacts.push({ x, y, ...c });
      }
    }
    selected = null;
    hovered = null;
    // Let the flight view swap its world (fog of war, travel, sectors) right away, even while the
    // map stays open; otherwise the map would draw the new galaxy with the old galaxy's charts.
    if (onLoad) onLoad(galaxy);
    updateStats();
    updateInfo();
    requestDraw();
  }

  function updateStats() {
    statsVersion = fog() ? fog().version : -1;
    const count = (kind) => galaxy.factions.filter((f) => f.kind === kind).length;
    const systems = galaxy.systems.filter((s) => !s.waystation).length;
    const waystations = galaxy.systems.length - systems;
    const charted = cells.filter((c) => c.zone === 'pocket').length / cells.length;
    const known = fog() ? ` · ${fog().counts().systems}/${galaxy.systems.length} systems on your charts` : '';
    statsEl.textContent = `seed ${galaxy.seed} · ${count('major')} major + ${count('minor')} minor factions · `
      + `${systems} systems · ${galaxy.outposts.length} outposts · ${waystations} Waystations · ${Math.round(charted * 100)}% charted space${known}`;
  }

  function initialSeed() {
    const param = Params.get('seed');
    if (param === null || param === '') return GALAXY_CONFIG.seed;
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

  // The area to frame: the whole galaxy.
  const frameArea = () => ({ x0: 0, y0: 0, x1: galaxy.size, y1: galaxy.size });

  function fit() {
    const pad = 12;
    const availW = view.w - pad * 2;
    // The bottom bar wraps to two rows on narrow screens; leave room for what it really covers.
    const bar = overlay.querySelector('.bar.bottom');
    const bottom = Math.max(BOTTOM_BAR, bar && !overlay.hidden ? bar.getBoundingClientRect().height : 0);
    const availH = view.h - TOP_BAR - bottom;
    const a = frameArea();
    view.scale = Math.min(availW / (a.x1 - a.x0), availH / (a.y1 - a.y0));
    view.minScale = Math.min(view.scale, availW / galaxy.size, availH / galaxy.size) * 0.5;
    // Centre on the area, but when the screen shows less than the whole galaxy, don't look past its edge.
    const keepIn = (c, span) => (span < galaxy.size ? clamp(c, span / 2, galaxy.size - span / 2) : c);
    const cx = keepIn((a.x0 + a.x1) / 2, availW / view.scale);
    const cy = keepIn((a.y0 + a.y1) / 2, availH / view.scale);
    view.ox = cx - view.w / 2 / view.scale;
    view.oy = cy - (TOP_BAR + availH / 2) / view.scale;
    requestDraw();
  }

  function zoomAt(sx, sy, newScale) {
    const [gx, gy] = toGrid(sx, sy);
    view.scale = clamp(newScale, view.minScale, MAX_SCALE);
    view.ox = gx - sx / view.scale;
    view.oy = gy - sy / view.scale;
    requestDraw();
  }

  function requestDraw() {
    if (drawQueued || !isOpen) return;
    drawQueued = true;
    requestAnimationFrame(() => { drawQueued = false; draw(); });
  }

  // ---------- Drawing ----------
  //
  // Everything that only changes with the view, the player's charts or the testing toggles is drawn
  // once into an offscreen layer; each frame copies it and adds the route, the ship and highlights.
  // While a drag, pinch or wheel zoom is moving the view, the last layer is moved and scaled to
  // follow instead of being redrawn; it is redrawn once the gesture ends (or the wheel has been
  // still for WHEEL_SETTLE_MS). The layer reaches a margin past each screen edge, so a pan shows
  // what was just off screen rather than empty space.

  const WHEEL_SETTLE_MS = 150;
  const layer = { canvas: null, key: null, view: null, pad: 0 };
  const stats = { drawMs: 0, staticMs: 0, rebuilds: 0, frames: 0 }; // for the performance overlay
  // Signature of everything the static layer depends on, other than where the view is.
  const layerKey = () => [galaxy.seed, galaxy.systems.length, view.w, view.h, view.dpr,
    fog() ? fog().version : -1, knowledgeId, showHidden, showContacts].join('|');
  const sameView = (v) => v.ox === view.ox && v.oy === view.oy && v.scale === view.scale;

  let wheeling = false; // a wheel zoom is under way
  let wheelTimer = null;
  const moving = () => wheeling || !!(gesture && (gesture.type === 'pinch' || gesture.moved > 0));

  function staticLayer() {
    const key = layerKey();
    if (layer.canvas && layer.key === key && (moving() || sameView(layer.view))) return layer.canvas;
    const t0 = performance.now();
    const pad = Math.round(Math.min(view.w, view.h) / 4 * view.dpr); // the margin in canvas px
    if (!layer.canvas) layer.canvas = document.createElement('canvas');
    const cw = canvas.width + pad * 2, chh = canvas.height + pad * 2;
    if (layer.canvas.width !== cw || layer.canvas.height !== chh) { layer.canvas.width = cw; layer.canvas.height = chh; }
    drawStatic(layer.canvas.getContext('2d'), pad / view.dpr);
    layer.key = key;
    layer.view = { ox: view.ox, oy: view.oy, scale: view.scale };
    layer.pad = pad;
    stats.rebuilds++;
    stats.staticMs = performance.now() - t0;
    return layer.canvas;
  }
  // Free the layer's memory while the map is closed.
  function dropLayer() {
    if (layer.canvas) { layer.canvas.width = layer.canvas.height = 0; }
    layer.canvas = null;
    layer.key = null;
    layer.view = null;
  }

  // Draws the layer for the current view onto the screen: moved and scaled by how far the view has
  // gone since the layer was drawn (not at all, once it has been redrawn).
  function drawLayer() {
    const bg = staticLayer();
    const { view: v, pad } = layer;
    const k = view.scale / v.scale, d = view.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (!sameView(v)) { ctx.fillStyle = Theme.color.bg; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    ctx.setTransform(k, 0, 0, k, d * (v.ox - view.ox) * view.scale - pad * k, d * (v.oy - view.oy) * view.scale - pad * k);
    ctx.drawImage(bg, 0, 0);
  }

  // margin: how far past each screen edge to draw, in screen px.
  function drawStatic(ctx, margin) {
    const { w, h, scale } = view;
    const { size, frontier: F, factions, systems } = galaxy;
    // The area drawn, in screen px, and whether a point (with this much around it) is in it.
    const x0 = -margin, y0 = -margin, x1 = w + margin, y1 = h + margin;
    const inside = (sx, sy, padX, padY = padX) => sx > x0 - padX && sy > y0 - padY && sx < x1 + padX && sy < y1 + padY;
    ctx.setTransform(view.dpr, 0, 0, view.dpr, margin * view.dpr, margin * view.dpr);
    ctx.fillStyle = Theme.color.bg;
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);

    const [bx0, by0] = toScreen(0, 0);
    const [bx1, by1] = toScreen(size, size);
    const [ix0, iy0] = toScreen(F, F);
    const [ix1, iy1] = toScreen(size - F, size - F);
    ctx.fillStyle = '#090c14';
    ctx.fillRect(bx0, by0, bx1 - bx0, by1 - by0);

    // Frontier ring.
    ctx.beginPath();
    ctx.rect(bx0, by0, bx1 - bx0, by1 - by0);
    ctx.rect(ix0, iy0, ix1 - ix0, iy1 - iy0);
    ctx.fillStyle = 'rgba(255, 90, 110, 0.07)';
    ctx.fill('evenodd');

    // Explored sectors are lighter than the unknown.
    const px = Math.ceil(scale) + 1;
    const onScreen = (sx, sy) => sx + px >= x0 && sy + px >= y0 && sx <= x1 && sy <= y1;
    if (fog()) {
      for (const c of cells) {
        if (!fog().isExplored(c.x, c.y)) continue;
        const [sx, sy] = toScreen(c.x, c.y);
        if (!onScreen(sx, sy)) continue;
        ctx.fillStyle = '#101727';
        ctx.fillRect(Math.floor(sx), Math.floor(sy), px, px);
      }
    }

    // Faction borders: a faint tint and an outline, for factions on the player's charts.
    const knownFactions = new Set(factions.filter((f) => !fog() || fog().knowsFaction(f.id)).map((f) => f.id));
    const ownerAt = (x, y) => (x < 0 || y < 0 || x >= size || y >= size ? null : cells[y * size + x].owner);
    ctx.lineWidth = 1;
    for (const c of cells) {
      if (c.owner === null || !knownFactions.has(c.owner)) continue;
      const [sx, sy] = toScreen(c.x, c.y);
      if (!onScreen(sx, sy)) continue;
      const color = factions[c.owner].color;
      ctx.fillStyle = hexToRgba(color, 0.035);
      ctx.fillRect(Math.floor(sx), Math.floor(sy), px, px);
      ctx.strokeStyle = hexToRgba(color, 0.32);
      ctx.beginPath();
      if (ownerAt(c.x, c.y - 1) !== c.owner) { ctx.moveTo(sx, sy); ctx.lineTo(sx + scale, sy); }
      if (ownerAt(c.x, c.y + 1) !== c.owner) { ctx.moveTo(sx, sy + scale); ctx.lineTo(sx + scale, sy + scale); }
      if (ownerAt(c.x - 1, c.y) !== c.owner) { ctx.moveTo(sx, sy); ctx.lineTo(sx, sy + scale); }
      if (ownerAt(c.x + 1, c.y) !== c.owner) { ctx.moveTo(sx + scale, sy); ctx.lineTo(sx + scale, sy + scale); }
      ctx.stroke();
      // Contested: a stripe in the rival's colour.
      if (c.contestedBy !== null && knownFactions.has(c.contestedBy) && scale >= 4) {
        ctx.strokeStyle = hexToRgba(factions[c.contestedBy].color, 0.8);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(sx, sy + scale);
        ctx.lineTo(sx + scale, sy);
        ctx.stroke();
      }
    }

    // Sector grid: every sector when zoomed in, else every 8.
    const step = scale >= 10 ? 1 : 8;
    ctx.strokeStyle = scale >= 10 ? '#141a2c' : '#18203a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= size; i += step) {
      const [sx, sy] = toScreen(i, i);
      ctx.moveTo(Math.round(sx) + 0.5, by0);
      ctx.lineTo(Math.round(sx) + 0.5, by1);
      ctx.moveTo(bx0, Math.round(sy) + 0.5);
      ctx.lineTo(bx1, Math.round(sy) + 0.5);
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255, 90, 110, 0.35)';
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(Math.round(ix0) + 0.5, Math.round(iy0) + 0.5, Math.round(ix1 - ix0), Math.round(iy1 - iy0));
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(255, 90, 110, 0.6)';
    ctx.strokeRect(Math.round(bx0) + 0.5, Math.round(by0) + 0.5, Math.round(bx1 - bx0), Math.round(by1 - by0));

    // Charted pockets: soft discs in the owner's colour around known settlements.
    for (const pk of galaxy.pockets) {
      if (pk.kind === 'system' ? !sysKnown(systems[pk.id]) : !outpostKnown(galaxy.outposts[pk.id])) continue;
      const [sx, sy] = toScreen(pk.x, pk.y);
      const pr = pk.r * scale;
      if (sx + pr < x0 || sy + pr < y0 || sx - pr > x1 || sy - pr > y1) continue;
      const color = galaxy.factionColor(pk.faction);
      ctx.fillStyle = hexToRgba(color, 0.3);
      ctx.strokeStyle = hexToRgba(color, 0.8);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(sx, sy, Math.max(pr, 2), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // Deep-space contacts: identified ones by type, pings as '?'. The Contacts toggle shows all.
    ctx.textAlign = 'center';
    for (const c of contacts) {
      const state = showContacts || !fog() ? 'known' : fog().contactState(c.x, c.y);
      if (!state) continue;
      const [sx, sy] = toScreen(c.x + 0.5, c.y + 0.5);
      const r = clamp(scale * 0.22, 2, 6);
      if (state !== 'known') {
        ctx.fillStyle = '#8a95b3';
        ctx.font = Theme.font(Math.round(clamp(scale * 0.6, 9, 14)));
        ctx.fillText('?', sx, sy + r * 0.8);
        continue;
      }
      ctx.strokeStyle = CONTACT[c.type].color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(sx - r, sy - r); ctx.lineTo(sx + r, sy + r);
      ctx.moveTo(sx + r, sy - r); ctx.lineTo(sx - r, sy + r);
      ctx.stroke();
    }
    ctx.textAlign = 'left';

    // Outposts.
    if (scale >= 4) {
      const op = clamp(scale * 0.25, 2, 5);
      for (const o of galaxy.outposts) {
        if (!outpostKnown(o)) continue;
        const [sx, sy] = toScreen(o.x + 0.5, o.y + 0.5);
        if (!inside(sx, sy, 5)) continue;
        ctx.fillStyle = o.faction === null ? '#7d869e' : factions[o.faction].color;
        ctx.fillRect(sx - op / 2, sy - op / 2, op, op);
      }
    }

    // Lanes and gates.
    const centreOf = (id) => toScreen(systems[id].x + 0.5, systems[id].y + 0.5);
    ctx.lineWidth = clamp(scale * 0.12, 1.5, 3);
    ctx.globalAlpha = 0.85;
    for (const l of galaxy.routes) {
      if (l.kind !== 'lane' || !routeKnown(l)) continue;
      const [ax, ay] = centreOf(l.a);
      const [bx, by] = centreOf(l.b);
      ctx.strokeStyle = factions[systems[l.a].faction].color;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1.5;
    for (const g of galaxy.routes) {
      if (g.kind === 'lane' || !routeKnown(g)) continue;
      const hidden = g.kind === 'hidden';
      const [ax, ay] = centreOf(g.a);
      const [bx, by] = centreOf(g.b);
      ctx.strokeStyle = hidden ? Theme.color.hostile : Theme.color.hud;
      ctx.setLineDash(hidden ? [2, 4] : [7, 5]);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    }
    ctx.setLineDash([]);

    // Systems, capitals and Waystations.
    const r = clamp(scale * 0.28, 2.5, 8);
    for (const s of systems) {
      if (!sysKnown(s)) continue;
      const [sx, sy] = centreOf(s.id);
      if (!inside(sx, sy, 20)) continue;
      const color = galaxy.factionColor(s.faction);
      const sr = s.faction !== null && factions[s.faction].kind === 'minor' ? r * 0.75 : r;
      ctx.fillStyle = color;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (s.faction === null) {
        ctx.arc(sx, sy, sr * 0.8, 0, Math.PI * 2);
        ctx.stroke();
      } else if (s.waystation) {
        const d = r + 2;
        ctx.moveTo(sx, sy - d); ctx.lineTo(sx + d, sy); ctx.lineTo(sx, sy + d); ctx.lineTo(sx - d, sy);
        ctx.closePath();
        ctx.fillStyle = Theme.color.bg;
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.arc(sx, sy, sr, 0, Math.PI * 2);
        ctx.fill();
        if (s.capital && factions[s.faction].kind === 'major') {
          ctx.beginPath();
          ctx.arc(sx, sy, sr + 3.5, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }

    // Names by zoom: major capitals first, then minor capitals and Waystations, then everything.
    ctx.font = Theme.font(11);
    ctx.textAlign = 'center';
    const labelZoom = (s) => {
      if (s.capital && factions[s.faction].kind === 'major') return 6;
      if (s.capital || s.waystation) return 14;
      return 24;
    };
    const labelColor = { 6: '#e6ebff', 14: '#c3cae0', 24: '#8a95b3' };
    for (const s of systems) {
      if (!sysKnown(s)) continue;
      const z = labelZoom(s);
      if (scale < z) continue;
      const [sx, sy] = centreOf(s.id);
      if (!inside(sx, sy, 60, 20)) continue;
      ctx.fillStyle = labelColor[z];
      ctx.fillText(s.name, sx, sy - r - 7);
    }
    if (scale >= 36) {
      ctx.fillStyle = Theme.color.dim;
      ctx.font = Theme.font(10);
      for (const o of galaxy.outposts) {
        if (!outpostKnown(o)) continue;
        const [sx, sy] = toScreen(o.x + 0.5, o.y + 0.5);
        if (inside(sx, sy, 60, 20)) ctx.fillText(o.name, sx, sy + 14);
      }
    }
    ctx.textAlign = 'left';
  }

  let statsVersion = -1; // the chart version the stats line was written for

  function draw() {
    const t0 = performance.now();
    if (fog() && fog().version !== statsVersion) updateStats();
    const { w, h, scale } = view;
    const { systems } = galaxy;
    const centreOf = (id) => toScreen(systems[id].x + 0.5, systems[id].y + 0.5);
    const r = clamp(scale * 0.28, 2.5, 8); // system dot radius, as in drawStatic
    drawLayer();
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);

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
      ctx.beginPath(); ctx.arc(bx, by, r + 5, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
      if (trip.prompt) {
        const [qx, qy] = toScreen(trip.prompt.x + 0.5, trip.prompt.y + 0.5);
        ctx.strokeStyle = '#ffd166';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(qx, qy, r + 9, 0, Math.PI * 2); ctx.stroke();
      }
    }

    // You are here.
    const [hx, hy] = player ? toScreen(player.x, player.y) : centreOf(galaxy.startSystem);
    ctx.strokeStyle = Theme.color.cyan;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(hx, hy, r + 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = Theme.color.cyan;
    ctx.font = Theme.font(10);
    ctx.fillText('YOU', hx + r + 10, hy + r + 12);

    // Hover / selection highlights.
    for (const [sel, color] of [[hovered, Theme.color.hud], [selected, Theme.color.cyan]]) {
      if (!sel) continue;
      if (sel.system || sel.outpost) {
        const [sx, sy] = sel.system ? centreOf(sel.system.id) : toScreen(sel.outpost.x + 0.5, sel.outpost.y + 0.5);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(sx, sy, sel.system ? r + 6 : clamp(scale * 0.25, 2, 5) + 5, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        const [sx, sy] = toScreen(sel.sector.x, sel.sector.y);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(sx, sy, Math.max(scale, 3), Math.max(scale, 3));
      }
    }

    if (w >= 700) drawLegend();
    stats.frames++;
    stats.drawMs = performance.now() - t0;
    if (perf) drawPerf();
  }

  // Performance readout (?perf or ?dev, or the P key), under the top bar.
  function drawPerf() {
    const lines = [
      `map draw ${stats.drawMs.toFixed(1)} ms · static layer ${stats.staticMs.toFixed(1)} ms`,
      `static rebuilds ${stats.rebuilds} in ${stats.frames} frames`,
    ];
    ctx.save();
    ctx.font = Theme.font(11);
    ctx.fillStyle = 'rgba(12, 15, 24, 0.85)';
    ctx.fillRect(8, TOP_BAR, 330, lines.length * 15 + 8);
    ctx.fillStyle = Theme.color.cyan;
    lines.forEach((l, i) => ctx.fillText(l, 14, TOP_BAR + 16 + i * 15));
    ctx.restore();
  }

  function drawLegend() {
    const x = 14;
    let y = view.h - BOTTOM_BAR - 200;
    ctx.fillStyle = 'rgba(12, 15, 24, 0.85)';
    ctx.fillRect(x - 6, y - 14, 160, 200);
    ctx.font = Theme.font(11);
    const row = (drawIcon, label) => {
      drawIcon(x + 8, y - 4);
      ctx.fillStyle = '#aab3cc';
      ctx.fillText(label, x + 24, y);
      y += 18;
    };
    row((cx, cy) => { ctx.fillStyle = '#aab3cc'; ctx.beginPath(); ctx.arc(cx, cy, 3.5, 0, 7); ctx.fill(); ctx.strokeStyle = '#aab3cc'; ctx.beginPath(); ctx.arc(cx, cy, 7, 0, 7); ctx.stroke(); }, 'capital / system');
    row((cx, cy) => { ctx.fillStyle = '#aab3cc'; ctx.beginPath(); ctx.arc(cx, cy, 2.6, 0, 7); ctx.fill(); }, 'minor faction');
    row((cx, cy) => { ctx.strokeStyle = Theme.color.neutral; ctx.beginPath(); ctx.arc(cx, cy, 3, 0, 7); ctx.stroke(); }, 'independent');
    row((cx, cy) => { ctx.fillStyle = '#7d869e'; ctx.fillRect(cx - 1.5, cy - 1.5, 3, 3); }, 'outpost');
    row((cx, cy) => { ctx.strokeStyle = '#f2f2f2'; ctx.beginPath(); ctx.moveTo(cx, cy - 6); ctx.lineTo(cx + 6, cy); ctx.lineTo(cx, cy + 6); ctx.lineTo(cx - 6, cy); ctx.closePath(); ctx.stroke(); }, 'Waystation');
    row((cx, cy) => { ctx.strokeStyle = '#aab3cc'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx - 8, cy); ctx.lineTo(cx + 8, cy); ctx.stroke(); ctx.lineWidth = 1.5; }, 'lane');
    row((cx, cy) => { ctx.strokeStyle = Theme.color.hud; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(cx - 8, cy); ctx.lineTo(cx + 8, cy); ctx.stroke(); ctx.setLineDash([]); }, 'gate');
    row((cx, cy) => { ctx.fillStyle = 'rgba(61, 139, 255, 0.4)'; ctx.fillRect(cx - 7, cy - 5, 14, 10); ctx.strokeStyle = '#e0a030'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx - 7, cy + 5); ctx.lineTo(cx + 3, cy - 5); ctx.stroke(); }, 'contested');
    row((cx, cy) => { ctx.fillStyle = 'rgba(255, 90, 110, 0.25)'; ctx.fillRect(cx - 7, cy - 5, 14, 10); }, 'frontier');
    row((cx, cy) => { ctx.fillStyle = 'rgba(170, 179, 204, 0.2)'; ctx.strokeStyle = 'rgba(170, 179, 204, 0.55)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy, 6, 0, 7); ctx.fill(); ctx.stroke(); }, 'charted pocket');
    row((cx, cy) => { ctx.fillStyle = '#8a95b3'; ctx.textAlign = 'center'; ctx.fillText('?', cx, cy + 4); ctx.textAlign = 'left'; }, 'unidentified signal');
  }

  // ---------- Selection & info panel ----------

  function pick(sx, sy, tolerancePx) {
    const [gx, gy] = toGrid(sx, sy);
    let best = null;
    let bestDist = Math.max(tolerancePx / view.scale, 0.6);
    for (const s of galaxy.systems) {
      if (!sysKnown(s)) continue;
      const d = Math.hypot(s.x + 0.5 - gx, s.y + 0.5 - gy);
      if (d < bestDist) { bestDist = d; best = s; }
    }
    if (best) return { system: best };
    if (view.scale >= 4) {
      let bestO = null;
      let bestOD = Math.max(tolerancePx * 0.6 / view.scale, 0.35);
      for (const o of galaxy.outposts) {
        if (!outpostKnown(o)) continue;
        const d = Math.hypot(o.x + 0.5 - gx, o.y + 0.5 - gy);
        if (d < bestOD) { bestOD = d; bestO = o; }
      }
      if (bestO) return { outpost: bestO };
    }
    const x = Math.floor(gx);
    const y = Math.floor(gy);
    if (x < 0 || y < 0 || x >= galaxy.size || y >= galaxy.size) return null;
    return { sector: { x, y, fx: gx, fy: gy } };
  }

  const samePick = (a, b) => a && b && (a.system || a.outpost
    ? a.system === b.system && a.outpost === b.outpost
    : !!b.sector && a.sector.x === b.sector.x && a.sector.y === b.sector.y);

  function presenceRows(presence, skip) {
    const { factions } = galaxy;
    return presence
      .filter((p) => p.faction !== skip && p.share >= 0.05)
      .slice(0, 3)
      .map((p) => row(p.faction === null ? 'unaligned' : factions[p.faction].name, pct(p.share)))
      .join('');
  }
  // Names come from config and the generator today, but escape them in case they ever come from
  // saves or players.
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const row = (label, value) => `<div class="row"><span>${esc(label)}</span><span>${esc(value)}</span></div>`;
  const pct = (v) => `${Math.round(v * 100)}%`;
  const swatchHead = (color, title) => `<div class="head"><span class="swatch" style="background:${esc(color)}"></span>${esc(title)}</div>`;

  // Sector of a pick, for jumping there.
  const sectorOfPick = (p) => (p.system ? { x: p.system.x, y: p.system.y } : p.outpost ? { x: p.outpost.x, y: p.outpost.y } : p.sector);

  // Travel destination for a pick: known systems and outposts by name, any sector by coordinates.
  function destOf(p) {
    if (p.system) return { kind: 'system', id: p.system.id, x: p.system.x + 0.5, y: p.system.y + 0.5, name: p.system.name };
    if (p.outpost) return { kind: 'outpost', id: p.outpost.id, x: p.outpost.x + 0.5, y: p.outpost.y + 0.5, name: p.outpost.name };
    const { x, y, fx, fy } = p.sector;
    return { kind: 'sector', x: fx ?? x + 0.5, y: fy ?? y + 0.5, name: `sector ${x}, ${y}` };
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
    travelStatus.textContent = `Travelling to ${trip.dest.name} · ${trip.remaining.toFixed(1)} sectors · ${Math.ceil(trip.eta)} s`;
    if (trip.prompt) promptText.textContent = `Signal detected: ${CONTACT[trip.prompt.contact.type]?.prompt || 'a contact'} in sector ${trip.prompt.x}, ${trip.prompt.y}.`;
  }

  // A sector's security (security.js): how likely pirates are, and how well armed.
  const securityRow = (x, y) => {
    const s = Security.LEVELS[galaxy.securityOf(x, y)];
    return `<div class="row"><span>security</span><span style="color:${s.color}">${esc(s.label)}</span></div>`;
  };

  function updateInfo() {
    updateTravelUI();
    const sel = selected || hovered;
    info.hidden = !sel;
    if (!sel) return;
    const { factions, systems } = galaxy;

    if (sel.system) {
      const s = sel.system;
      const f = s.faction === null ? { name: galaxy.factionName(null), color: galaxy.factionColor(null), kind: 'independent' } : factions[s.faction];
      const links = galaxy.routes
        .filter((l) => (l.a === s.id || l.b === s.id) && routeKnown(l))
        .map((l) => `${systems[l.a === s.id ? l.b : l.a].name} (${l.kind})`);
      const counts = {};
      for (const loc of s.locations) counts[loc.type] = (counts[loc.type] || 0) + 1;
      info.innerHTML =
        swatchHead(f.color, s.name) +
        row('type', s.waystation ? 'Waystation · safe haven'
          : f.kind === 'independent' ? 'independent system'
          : `${f.name}${s.capital ? ' capital' : s.exclave ? ' colony' : ''}`) +
        (f.kind === 'minor' ? row('tier', 'minor faction') : '') +
        row('sector', `${s.x}, ${s.y}`) +
        securityRow(s.x, s.y) +
        (s.waystation ? row('faction', 'neutral')
          : f.kind === 'independent' ? presenceRows(s.presence)
          : row('dominance', pct(s.dominance)) + presenceRows(s.presence, s.faction)) +
        row('locations', Object.entries(counts).map(([t, n]) => `${n} ${t}${n > 1 ? 's' : ''}`).join(', ')) +
        row('links', links.length ? '' : 'none · deep space only') +
        links.map((l) => row('', l)).join('');
      return;
    }

    if (sel.outpost) {
      const o = sel.outpost;
      const f = o.faction === null ? null : factions[o.faction];
      info.innerHTML =
        swatchHead(f ? f.color : '#7d869e', o.name) +
        row('type', o.type) +
        row('faction', f ? f.name : 'independent') +
        row('sector', `${o.x}, ${o.y}`) +
        securityRow(o.x, o.y);
      return;
    }

    const t = galaxy.territoryOf(sel.sector.x, sel.sector.y);
    if (fog() && !fog().isExplored(t.x, t.y)) {
      const signal = fog().contactState(t.x, t.y) === 'ping';
      info.innerHTML = swatchHead('#2a3350', `Sector ${t.x}, ${t.y}`) + row('status', 'uncharted') + (signal ? row('contact', 'unidentified signal') : '');
      return;
    }
    const contact = galaxy.deepSector(t.x, t.y);
    const contactShown = contact && (showContacts || !fog() || fog().contactState(t.x, t.y) === 'known');
    const owner = t.owner === null ? null : factions[t.owner];
    info.innerHTML =
      swatchHead(owner ? owner.color : '#2a3350', `Sector ${t.x}, ${t.y}`) +
      row('zone', ZONE_LABEL[t.zone]) +
      securityRow(t.x, t.y) +
      (owner ? row('owner', `${owner.name} ${pct(t.dominance)}`) : '') +
      (t.contestedBy !== null ? row('contested by', factions[t.contestedBy].name) : '') +
      (owner ? presenceRows(t.presence, t.owner) : presenceRows(t.presence)) +
      (t.zone === 'pocket' ? '' : row('contact', contactShown
        ? (contact.name || contact.type) + (contact.hostile ? ' · hostile' : '')
        : contact && fog()?.contactState(t.x, t.y) === 'ping' ? 'unidentified signal' : 'none detected'));
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
        const p = pick(e.clientX, e.clientY, 8);
        if (!samePick(p, hovered)) { hovered = p; updateInfo(); requestDraw(); }
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
      view.scale = clamp(gesture.scale * Math.hypot(a.x - b.x, a.y - b.y) / gesture.dist, view.minScale, MAX_SCALE);
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
      const p = pick(e.clientX, e.clientY, e.pointerType === 'mouse' ? 8 : 16);
      selected = p && !samePick(p, selected) ? p : null;
      if (e.pointerType !== 'mouse') hovered = null;
      updateInfo();
      requestDraw();
    }
    // Lifting one finger of a pinch continues as a pan with the other.
    const wasMoving = moving();
    startGesture();
    if (wasMoving && !moving()) requestDraw(); // redraw the layer where the view has come to rest
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
    wheeling = true;
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => { wheeling = false; requestDraw(); }, WHEEL_SETTLE_MS);
    zoomAt(e.clientX, e.clientY, view.scale * Math.pow(1.0015, -dy));
  }, { passive: false });

  // ---------- Open / close & controls ----------

  let blocked = false; // set by the flight view while docked
  function open() {
    if (isOpen || blocked) return;
    isOpen = true;
    overlay.hidden = false;
    resize();
    if (!fitted) { fit(); fitted = true; }
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    overlay.hidden = true;
    pointers.clear();
    gesture = null;
    clearTimeout(wheelTimer);
    wheeling = false;
    dropLayer();
  }

  function setToggle(btn, on) {
    btn.setAttribute('aria-pressed', String(on));
    updateInfo();
    requestDraw();
    return on;
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
    const { x, y } = sectorOfPick(selected);
    onJump(x, y);
    selected = null;
    updateInfo();
    close();
  });
  hiddenBtn.addEventListener('click', () => { showHidden = setToggle(hiddenBtn, !showHidden); });
  contactsBtn.addEventListener('click', () => { showContacts = setToggle(contactsBtn, !showContacts); });
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
    get galaxy() { return galaxy; },
    // Flight view hooks: where the ship is (in sector units), and what to do on Jump.
    setPlayer(x, y) {
      const moved = !player || Math.floor(player.x * 4) !== Math.floor(x * 4) || Math.floor(player.y * 4) !== Math.floor(y * 4);
      player = { x, y };
      if (moved) requestDraw();
    },
    set onJump(fn) { onJump = fn; updateInfo(); },
    set onLoad(fn) { onLoad = fn; },
    set knowledge(k) { knowledge = k; knowledgeId++; updateStats(); updateInfo(); requestDraw(); },
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
