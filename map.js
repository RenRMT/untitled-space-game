'use strict';

// Full-screen galaxy map overlay. Generates the galaxy from GALAXY_CONFIG (data/galaxy-config.js)
// with Galaxy.generate (galaxy.js); a ?seed= URL parameter overrides the configured seed.

const GalaxyMap = (() => {
  const overlay = document.getElementById('map-overlay');
  const canvas = document.getElementById('map-canvas');
  const ctx = canvas.getContext('2d');
  const info = document.getElementById('map-info');
  const statsEl = document.getElementById('map-stats');
  const hiddenBtn = document.getElementById('map-hidden');
  const contactsBtn = document.getElementById('map-contacts');
  const jumpBtn = document.getElementById('map-jump');

  const ZONE_LABEL = { pocket: 'Charted pocket', claimed: 'Claimed · uncharted', deep: 'Deep space', frontier: 'Frontier' };
  const CONTACT_COLORS = { derelict: '#9aa4b8', distress: '#ffd166', ambush: '#ff4d4d', anomaly: '#c77dff', story: '#7df9ff' };
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

  // scale = screen px per sector; (ox, oy) = sector coordinate at the screen's top-left.
  const view = { w: 0, h: 0, dpr: 1, scale: 1, minScale: 0.3, ox: 0, oy: 0 };
  let isOpen = false;
  let fitted = false;
  let selected = null; // { system } or { sector: { x, y } }
  let hovered = null;
  let drawQueued = false;

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
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
    const count = (kind) => galaxy.factions.filter((f) => f.kind === kind).length;
    const systems = galaxy.systems.filter((s) => !s.freeport).length;
    const freeports = galaxy.systems.length - systems;
    const charted = cells.filter((c) => c.zone === 'pocket').length / cells.length;
    statsEl.textContent = `seed ${galaxy.seed} · ${count('major')} major + ${count('minor')} minor factions · `
      + `${systems} systems · ${galaxy.outposts.length} outposts · ${freeports} Freeports · ${Math.round(charted * 100)}% charted`;
    updateInfo();
    requestDraw();
  }

  function initialSeed() {
    const param = new URLSearchParams(location.search).get('seed');
    if (param === null || param === '') return GALAXY_CONFIG.seed;
    return /^\d+$/.test(param) ? Number(param) : param;
  }

  function reroll() {
    const seed = 1 + Math.floor(Math.random() * 999999);
    try {
      const url = new URL(location.href);
      url.searchParams.set('seed', seed);
      history.replaceState(null, '', url);
    } catch (e) { /* file:// in some browsers */ }
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

  function fit() {
    const pad = 12;
    const availW = view.w - pad * 2;
    const availH = view.h - TOP_BAR - BOTTOM_BAR;
    view.scale = Math.min(availW / galaxy.size, availH / galaxy.size);
    view.minScale = view.scale * 0.5;
    view.ox = galaxy.size / 2 - view.w / 2 / view.scale;
    view.oy = galaxy.size / 2 - (TOP_BAR + availH / 2) / view.scale;
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

  function draw() {
    const { w, h, scale } = view;
    const { size, frontier: F, factions, systems } = galaxy;
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.fillStyle = '#05060a';
    ctx.fillRect(0, 0, w, h);

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

    // Territories; tint strength follows the owner's dominance.
    const px = Math.ceil(scale) + 1;
    for (const c of cells) {
      if (c.owner === null) continue;
      const [sx, sy] = toScreen(c.x, c.y);
      if (sx + px < 0 || sy + px < 0 || sx > w || sy > h) continue;
      ctx.fillStyle = hexToRgba(factions[c.owner].color, 0.06 + 0.5 * c.dominance * c.dominance);
      ctx.fillRect(Math.floor(sx), Math.floor(sy), px, px);
      // Contested: a stripe in the rival's colour.
      if (c.contestedBy !== null && scale >= 4) {
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

    // Deep-space contacts (dev layer); story points of interest always show.
    for (const c of contacts) {
      if (!showContacts && c.type !== 'story') continue;
      const [sx, sy] = toScreen(c.x + 0.5, c.y + 0.5);
      const r = clamp(scale * 0.22, 2, 6);
      ctx.strokeStyle = CONTACT_COLORS[c.type];
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(sx - r, sy - r); ctx.lineTo(sx + r, sy + r);
      ctx.moveTo(sx + r, sy - r); ctx.lineTo(sx - r, sy + r);
      ctx.stroke();
    }

    // Outposts.
    if (scale >= 4) {
      const op = clamp(scale * 0.25, 2, 5);
      for (const o of galaxy.outposts) {
        const [sx, sy] = toScreen(o.x + 0.5, o.y + 0.5);
        if (sx < -5 || sy < -5 || sx > w + 5 || sy > h + 5) continue;
        ctx.fillStyle = o.faction === null ? '#7d869e' : factions[o.faction].color;
        ctx.fillRect(sx - op / 2, sy - op / 2, op, op);
      }
    }

    // Lanes and gates.
    const centreOf = (id) => toScreen(systems[id].x + 0.5, systems[id].y + 0.5);
    ctx.lineWidth = clamp(scale * 0.12, 1.5, 3);
    ctx.globalAlpha = 0.85;
    for (const l of galaxy.lanes) {
      const [ax, ay] = centreOf(l.a);
      const [bx, by] = centreOf(l.b);
      ctx.strokeStyle = factions[systems[l.a].faction].color;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1.5;
    for (const g of galaxy.gates) {
      if (g.hidden && !showHidden) continue;
      const [ax, ay] = centreOf(g.a);
      const [bx, by] = centreOf(g.b);
      ctx.strokeStyle = g.hidden ? '#ff5a6e' : '#cfd8ff';
      ctx.setLineDash(g.hidden ? [2, 4] : [7, 5]);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    }
    ctx.setLineDash([]);

    // Systems, capitals and Freeports.
    const r = clamp(scale * 0.28, 2.5, 8);
    for (const s of systems) {
      const [sx, sy] = centreOf(s.id);
      if (sx < -20 || sy < -20 || sx > w + 20 || sy > h + 20) continue;
      const color = s.faction === null ? '#9aa4b8' : factions[s.faction].color;
      const sr = s.faction !== null && factions[s.faction].kind === 'minor' ? r * 0.75 : r;
      ctx.fillStyle = color;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (s.faction === null) {
        ctx.arc(sx, sy, sr * 0.8, 0, Math.PI * 2);
        ctx.stroke();
      } else if (s.freeport) {
        const d = r + 2;
        ctx.moveTo(sx, sy - d); ctx.lineTo(sx + d, sy); ctx.lineTo(sx, sy + d); ctx.lineTo(sx - d, sy);
        ctx.closePath();
        ctx.fillStyle = '#05060a';
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

    // Names by zoom: major capitals first, then minor capitals and Freeports, then everything.
    ctx.font = '11px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = 'center';
    const labelZoom = (s) => {
      if (s.capital && factions[s.faction].kind === 'major') return 6;
      if (s.capital || s.freeport) return 14;
      return 24;
    };
    const labelColor = { 6: '#e6ebff', 14: '#c3cae0', 24: '#8a95b3' };
    for (const s of systems) {
      const z = labelZoom(s);
      if (scale < z) continue;
      const [sx, sy] = centreOf(s.id);
      if (sx < -60 || sy < -20 || sx > w + 60 || sy > h + 20) continue;
      ctx.fillStyle = labelColor[z];
      ctx.fillText(s.name, sx, sy - r - 7);
    }
    if (scale >= 36) {
      ctx.fillStyle = '#6f7a99';
      ctx.font = '10px ui-monospace, Menlo, Consolas, monospace';
      for (const o of galaxy.outposts) {
        const [sx, sy] = toScreen(o.x + 0.5, o.y + 0.5);
        if (sx > -60 && sy > -20 && sx < w + 60 && sy < h + 20) ctx.fillText(o.name, sx, sy + 14);
      }
    }
    ctx.textAlign = 'left';

    // You are here.
    const [hx, hy] = player ? toScreen(player.x, player.y) : centreOf(galaxy.startSystem);
    ctx.strokeStyle = '#7df9ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(hx, hy, r + 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#7df9ff';
    ctx.font = '10px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillText('YOU', hx + r + 10, hy + r + 12);

    // Hover / selection highlights.
    for (const [sel, color] of [[hovered, '#cfd8ff'], [selected, '#7df9ff']]) {
      if (!sel) continue;
      if (sel.system) {
        const [sx, sy] = centreOf(sel.system.id);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(sx, sy, r + 6, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        const [sx, sy] = toScreen(sel.sector.x, sel.sector.y);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(sx, sy, Math.max(scale, 3), Math.max(scale, 3));
      }
    }

    if (w >= 700) drawLegend();
  }

  function drawLegend() {
    const x = 14;
    let y = view.h - BOTTOM_BAR - 164;
    ctx.fillStyle = 'rgba(12, 15, 24, 0.85)';
    ctx.fillRect(x - 6, y - 14, 160, 164);
    ctx.font = '11px ui-monospace, Menlo, Consolas, monospace';
    const row = (drawIcon, label) => {
      drawIcon(x + 8, y - 4);
      ctx.fillStyle = '#aab3cc';
      ctx.fillText(label, x + 24, y);
      y += 18;
    };
    row((cx, cy) => { ctx.fillStyle = '#aab3cc'; ctx.beginPath(); ctx.arc(cx, cy, 3.5, 0, 7); ctx.fill(); ctx.strokeStyle = '#aab3cc'; ctx.beginPath(); ctx.arc(cx, cy, 7, 0, 7); ctx.stroke(); }, 'capital / system');
    row((cx, cy) => { ctx.fillStyle = '#aab3cc'; ctx.beginPath(); ctx.arc(cx, cy, 2.6, 0, 7); ctx.fill(); }, 'minor faction');
    row((cx, cy) => { ctx.strokeStyle = '#9aa4b8'; ctx.beginPath(); ctx.arc(cx, cy, 3, 0, 7); ctx.stroke(); }, 'independent');
    row((cx, cy) => { ctx.fillStyle = '#7d869e'; ctx.fillRect(cx - 1.5, cy - 1.5, 3, 3); }, 'outpost');
    row((cx, cy) => { ctx.strokeStyle = '#f2f2f2'; ctx.beginPath(); ctx.moveTo(cx, cy - 6); ctx.lineTo(cx + 6, cy); ctx.lineTo(cx, cy + 6); ctx.lineTo(cx - 6, cy); ctx.closePath(); ctx.stroke(); }, 'Freeport');
    row((cx, cy) => { ctx.strokeStyle = '#aab3cc'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx - 8, cy); ctx.lineTo(cx + 8, cy); ctx.stroke(); ctx.lineWidth = 1.5; }, 'lane');
    row((cx, cy) => { ctx.strokeStyle = '#cfd8ff'; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(cx - 8, cy); ctx.lineTo(cx + 8, cy); ctx.stroke(); ctx.setLineDash([]); }, 'gate');
    row((cx, cy) => { ctx.fillStyle = 'rgba(61, 139, 255, 0.4)'; ctx.fillRect(cx - 7, cy - 5, 14, 10); ctx.strokeStyle = '#e0a030'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx - 7, cy + 5); ctx.lineTo(cx + 3, cy - 5); ctx.stroke(); }, 'contested');
    row((cx, cy) => { ctx.fillStyle = 'rgba(255, 90, 110, 0.25)'; ctx.fillRect(cx - 7, cy - 5, 14, 10); }, 'frontier');
  }

  // ---------- Selection & info panel ----------

  function pick(sx, sy, tolerancePx) {
    const [gx, gy] = toGrid(sx, sy);
    let best = null;
    let bestDist = Math.max(tolerancePx / view.scale, 0.6);
    for (const s of galaxy.systems) {
      const d = Math.hypot(s.x + 0.5 - gx, s.y + 0.5 - gy);
      if (d < bestDist) { bestDist = d; best = s; }
    }
    if (best) return { system: best };
    if (view.scale >= 4) {
      let bestO = null;
      let bestOD = Math.max(tolerancePx * 0.6 / view.scale, 0.35);
      for (const o of galaxy.outposts) {
        const d = Math.hypot(o.x + 0.5 - gx, o.y + 0.5 - gy);
        if (d < bestOD) { bestOD = d; bestO = o; }
      }
      if (bestO) return { outpost: bestO };
    }
    const x = Math.floor(gx);
    const y = Math.floor(gy);
    if (x < 0 || y < 0 || x >= galaxy.size || y >= galaxy.size) return null;
    return { sector: { x, y } };
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
  const row = (label, value) => `<div class="row"><span>${label}</span><span>${value}</span></div>`;
  const pct = (v) => `${Math.round(v * 100)}%`;
  const swatchHead = (color, title) => `<div class="head"><span class="swatch" style="background:${color}"></span>${title}</div>`;

  // Sector of a pick, for jumping there.
  const sectorOfPick = (p) => (p.system ? { x: p.system.x, y: p.system.y } : p.outpost ? { x: p.outpost.x, y: p.outpost.y } : p.sector);

  function updateInfo() {
    jumpBtn.disabled = !selected || !onJump;
    const sel = selected || hovered;
    info.hidden = !sel;
    if (!sel) return;
    const { factions, systems } = galaxy;

    if (sel.system) {
      const s = sel.system;
      const f = s.faction === null ? { name: 'Independent', color: '#9aa4b8', kind: 'independent' } : factions[s.faction];
      const links = [
        ...galaxy.lanes.filter((l) => l.a === s.id || l.b === s.id).map((l) => ['lane', l]),
        ...galaxy.gates.filter((g) => (g.a === s.id || g.b === s.id) && (!g.hidden || showHidden)).map((g) => [g.hidden ? 'hidden' : 'gate', g]),
      ].map(([kind, l]) => `${systems[l.a === s.id ? l.b : l.a].name} (${kind})`);
      const counts = {};
      for (const loc of s.locations) counts[loc.type] = (counts[loc.type] || 0) + 1;
      info.innerHTML =
        swatchHead(f.color, s.name) +
        row('type', s.freeport ? 'Freeport · safe haven'
          : f.kind === 'independent' ? 'independent system'
          : `${f.name}${s.capital ? ' capital' : s.exclave ? ' colony' : ''}`) +
        (f.kind === 'minor' ? row('tier', 'minor faction') : '') +
        row('sector', `${s.x}, ${s.y}`) +
        (s.freeport ? row('faction', 'neutral')
          : f.kind === 'independent' ? presenceRows(s.presence)
          : row('dominance', pct(s.dominance)) + presenceRows(s.presence, s.faction)) +
        row('locations', Object.entries(counts).map(([t, n]) => `${n} ${t}${n > 1 ? 's' : ''}`).join(', ')) +
        row('links', links.length ? '' : 'none · deep space only') +
        links.map((l) => `<div class="row"><span></span><span>${l}</span></div>`).join('');
      return;
    }

    if (sel.outpost) {
      const o = sel.outpost;
      const f = o.faction === null ? null : factions[o.faction];
      info.innerHTML =
        swatchHead(f ? f.color : '#7d869e', o.name) +
        row('type', o.type) +
        row('faction', f ? f.name : 'independent') +
        row('sector', `${o.x}, ${o.y}`);
      return;
    }

    const t = galaxy.territoryOf(sel.sector.x, sel.sector.y);
    const contact = galaxy.deepSector(t.x, t.y);
    const owner = t.owner === null ? null : factions[t.owner];
    info.innerHTML =
      swatchHead(owner ? owner.color : '#2a3350', `Sector ${t.x}, ${t.y}`) +
      row('zone', ZONE_LABEL[t.zone]) +
      (owner ? row('owner', `${owner.name} ${pct(t.dominance)}`) : '') +
      (t.contestedBy !== null ? row('contested by', factions[t.contestedBy].name) : '') +
      (owner ? presenceRows(t.presence, t.owner) : presenceRows(t.presence)) +
      (t.zone === 'pocket' ? '' : row('contact', contact && (showContacts || contact.type === 'story')
        ? (contact.name || contact.type) + (contact.hostile ? ' · hostile' : '')
        : showContacts ? 'none' : 'unidentified'));
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
    zoomAt(e.clientX, e.clientY, view.scale * Math.pow(1.0015, -e.deltaY));
  }, { passive: false });

  // ---------- Open / close & controls ----------

  function open() {
    if (isOpen) return;
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
  };
})();
