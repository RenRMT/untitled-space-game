// Screen-space overlays: labels, edge markers for stations and foes, the drag indicator, the
// minimap and the HUD.
// Part of the flight view; src/main.js starts it.

import { COLORS, Theme } from '../core/theme.js';
import { ContextCard } from '../ui/context.js';
import { SystemMap } from '../ui/map.js';
import { Messages } from '../ui/messages.js';
import { Security } from '../world/security.js';
import { cargo } from './cargo.js';
import { visible } from './draw-world.js';
import { DEADZONE, drag, interacted, maxDrag } from './input.js';
import { mission } from './missions.js';
import { CONTROLS, moveMode } from './options.js';
import { KINDS, SELECT_COLOR, TAP_SLOP, entityKey, fmtDist, selected } from './selection.js';
import { NAV_RANGE, SHIP, TAU, cam, clamp, ctx, here, inFight, intro, notify, ship, view } from './state.js';
import { world } from './world.js';

export const worldToScreen = (x, y) => [
  (x - cam.x) * view.zoom + view.w / 2,
  (y - cam.y) * view.zoom + view.h / 2,
];

export function drawLabels(list) {
  ctx.font = Theme.font(12);
  ctx.textAlign = 'center';
  ctx.globalAlpha = 0.75;
  const menu = ContextCard.isOpen && selected ? selected.e : null; // its menu names it
  for (const e of list) {
    if (!e.name || e === menu || !visible(e)) continue;
    const l = KINDS[e.kind].label(e);
    if (!l) continue;
    const [sx, sy] = worldToScreen(e.x, e.y + l[1]);
    ctx.fillStyle = l[0];
    ctx.fillText(e.name.toUpperCase(), sx, sy + 14);
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = 'left';
}

// Markers at the screen edge for things off screen, pointing their way: an arrow in the item's
// colour, a ring round it when `ring` (a colour) is set, and its label (if it has one) set inward
// from the arrow so it never covers it. items: [{ ref, x, y (world), color, ring, label, alpha }],
// alpha (optional) fading that one further than the `alpha` they all share. bottom: how far up
// from the bottom edge to stay (the speed bar, or the panel when one is open); the other margins
// keep clear of the HUD text, the buttons and the screen's safe area. Returns where each was
// drawn, for markerAt().
export function edgeMarkers(items, bottom, alpha) {
  const I = view.inset;
  const inset = { l: 26 + I.l, r: 26 + I.r, t: Math.max(70, hudBottom + 16), b: bottom + I.b };
  const cx = view.w / 2, cy = view.h / 2;
  const hits = [];
  ctx.save();
  ctx.font = Theme.font(11);
  ctx.textAlign = 'left';
  for (const m of items) {
    ctx.globalAlpha = alpha * (m.alpha ?? 1);
    const [px, py] = worldToScreen(m.x, m.y);
    const dx = px - cx, dy = py - cy;
    // Where the line from the screen centre to it leaves the inset screen rectangle.
    const k = Math.min((dx > 0 ? cx - inset.r : cx - inset.l) / Math.abs(dx || 1e-6), (dy > 0 ? cy - inset.b : cy - inset.t) / Math.abs(dy || 1e-6));
    const x = cx + dx * k, y = cy + dy * k, a = Math.atan2(dy, dx);
    ctx.fillStyle = m.color;
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(10, 0);
    ctx.lineTo(-4, 7);
    ctx.lineTo(-4, -7);
    ctx.closePath();
    ctx.fill();
    if (m.ring) {
      ctx.strokeStyle = m.ring;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(2, 0, 14, 0, TAU);
      ctx.stroke();
    }
    ctx.rotate(-a);
    ctx.translate(-x, -y);
    if (!m.label) { // a bare arrow: tapped by the arrow alone
      hits.push({ ref: m.ref, x, y, box: [x - 18, y - 18, x + 18, y + 18], text: [x, y, x, y] });
      continue;
    }
    const tw = ctx.measureText(m.label).width;
    const tx = clamp(x - Math.cos(a) * (tw / 2 + 16) - tw / 2, 8, view.w - tw - 8);
    // A label that would overlap one already drawn (two things in about the same direction)
    // moves a line further in from the edge.
    const overlaps = (t) => hits.some((h) => tx < h.text[2] && tx + tw > h.text[0] && t - 11 < h.text[3] && t + 3 > h.text[1]);
    const lh = Math.round(15 * Theme.scale);
    let ty = clamp(y - Math.sin(a) * 18 + 4, 14, view.h - 8);
    for (let i = 0; i < hits.length && overlaps(ty); i++) ty += y < cy ? lh : -lh;
    ctx.fillText(m.label, tx, ty);
    hits.push({ ref: m.ref, x, y, box: [tx - 6, ty - 15, tx + tw + 6, ty + 7], text: [tx, ty - 11, tx + tw, ty + 3] });
  }
  ctx.restore();
  return hits;
}

// What an edge marker (its arrow or its label) under a tap stands for, if any.
export function markerAt(hits, sx, sy) {
  for (const m of hits) {
    const [x0, y0, x1, y1] = m.box;
    if (Math.hypot(sx - m.x, sy - m.y) < TAP_SLOP + 8 || (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1)) return m.ref;
  }
  return null;
}

// Off-screen stations and gates within NAV_RANGE get an edge marker; a tap on one selects its
// station. Only the selected one, the objective and the player's own marker carry a name and a
// distance: the rest are bare arrows, so the screen's edge doesn't fill with text near busy
// systems. (A tap names one: it becomes the selected one.)
export let navHits = [];

// How strongly an edge marker shows at distance d: in full close by, fading to `far` at `range`
// and beyond, so near places stand out from far ones and a crowded edge stays readable.
export const markerFade = (d, range, far) => {
  const u = clamp(d / range, 0, 1);
  return far + (1 - far) * (1 - u * u * (3 - 2 * u));
};

// The mission's objective gets one too, at any distance: the station's own marker ringed in amber
// when it's a station, else an amber one of its own. It fades with distance too, but less, and
// the selected station's never falls below MARKED.
// Stations and gates are few, so they come from the scene's own lists rather than the frame's
// (which reaches only NEAR).
const MARKED = 0.6;
export function drawNavMarkers() {
  if (!hudShown()) { navHits = []; return; }
  const stations = [];
  const obj = here.objective;
  const mark = (st) => {
    if (visible(st)) return;
    const d = Math.hypot(st.x - ship.x, st.y - ship.y);
    if (d > NAV_RANGE) return;
    // The selected station's marker, or the objective's.
    const chosen = selected && selected.key === entityKey(st), goal = obj && obj.station === st;
    const ring = chosen ? SELECT_COLOR : goal ? COLORS.amber : null;
    const alpha = Math.max(markerFade(d, NAV_RANGE, goal ? 0.4 : 0.22), chosen ? MARKED : 0);
    const label = chosen || goal ? `${st.name.toUpperCase()} · ${fmtDist(d - st.radius)}` : ''; // to its edge, as the card shows
    stations.push({ ref: st, x: st.x, y: st.y, d, color: st.color, ring, alpha, label });
  };
  world.scene.stations.forEach(mark);
  world.scene.gates.forEach(mark);
  const R = obj && (obj.r ?? (obj.station ? obj.station.radius : mission.site ? mission.site.spread : 600));
  if (obj && !visible({ x: obj.x, y: obj.y, radius: R }) && !stations.some((m) => m.ref === obj.station)) {
    const d = Math.hypot(obj.x - ship.x, obj.y - ship.y);
    const label = `${obj.station ? obj.station.name.toUpperCase() : 'OBJECTIVE'} · ${fmtDist(d - (obj.station ? R : 0))}`;
    stations.push({ ref: obj.station, x: obj.x, y: obj.y, d, color: COLORS.amber, ring: COLORS.amber, alpha: markerFade(d, NAV_RANGE * 2, 0.4), label });
  }
  // The player's marker (set on the map): an edge marker at any distance while off screen, else a
  // pin where it is.
  const mk = SystemMap.marker;
  if (mk) {
    const d = Math.hypot(mk.x - ship.x, mk.y - ship.y);
    if (!visible({ x: mk.x, y: mk.y, radius: 0 })) {
      stations.push({ ref: null, x: mk.x, y: mk.y, d, color: COLORS.marker, ring: COLORS.marker, alpha: markerFade(d, NAV_RANGE * 2, 0.5), label: `${(mk.name || 'Marker').toUpperCase()} · ${fmtDist(d)}` });
    } else drawMarkerPin(...worldToScreen(mk.x, mk.y));
  }
  stations.sort((a, b) => a.d - b.d); // the nearest keep their place at the edge when labels collide
  stations.sort((a, b) => (b.label ? 1 : 0) - (a.label ? 1 : 0)); // named ones first, so they keep their place
  navHits = edgeMarkers(stations, 64, 0.95);
}

// A pin standing on (x, y), screen px: the player's marker, as the map draws it.
function drawMarkerPin(x, y) {
  ctx.save();
  ctx.fillStyle = ctx.strokeStyle = COLORS.marker;
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(x, y - 18, 6, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.moveTo(x, y - 12); ctx.lineTo(x, y - 2); ctx.stroke();
  ctx.globalAlpha = 0.5;
  ctx.beginPath(); ctx.arc(x, y, 4, 0, TAU); ctx.stroke();
  ctx.restore();
}

// The marker clears once the ship gets this close to it (plus a planet's or contact's size).
export const MARKER_REACH = 800;
export function checkMarker() {
  const m = SystemMap.marker;
  if (!m || Math.hypot(m.x - ship.x, m.y - ship.y) > MARKER_REACH + ((m.ref && m.ref.r) || 0)) return;
  SystemMap.marker = null;
  notify(m.name ? `Reached your marker: ${m.name}` : 'Reached your marker', 3, { priority: 1 });
}

// The station whose edge marker is under a tap, if any.
export function navMarkerAt(sx, sy) { return markerAt(navHits, sx, sy); }

export function drawDragIndicator() {
  if (!drag.active) return;
  const md = maxDrag();
  const dx = drag.x - drag.x0;
  const dy = drag.y - drag.y0;
  const len = Math.hypot(dx, dy);
  const k = len > md ? md / len : 1;
  const ex = drag.x0 + dx * k;
  const ey = drag.y0 + dy * k;

  ctx.save();
  ctx.strokeStyle = COLORS.hud;
  ctx.globalAlpha = 0.25;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 6]);
  ctx.beginPath();
  ctx.arc(drag.x0, drag.y0, md, 0, TAU);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.globalAlpha = 0.8;
  ctx.strokeStyle = COLORS.cyan;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(drag.x0, drag.y0);
  ctx.lineTo(ex, ey);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(drag.x0, drag.y0, 4, 0, TAU);
  ctx.arc(ex, ey, 10, 0, TAU);
  ctx.stroke();

  if (len > DEADZONE) {
    ctx.fillStyle = COLORS.cyan;
    ctx.font = Theme.font(12);
    ctx.fillText(`${Math.round(Math.min(len / md, 1) * 100)}%`, ex + 14, ey - 14);
  }
  ctx.restore();
}

// The minimap: a radar of the space around the ship, RADAR world units each way, framed in the
// colour of the security there. Hidden wrecks show once the sensors have found them.
export const RADAR = 6000;
// Where the minimap is on screen (px), for the HUD text beside it.
export const minimap = { x: 0, y: 0, size: 0 };
// Its square, top right (also the surface's minimap, game/landing.js).
export function minimapBox() {
  const size = Math.round(clamp(view.w * 0.28, 90, 150)), pad = 12;
  return Object.assign(minimap, { x: view.w - size - pad - view.inset.r, y: pad + view.inset.t, size });
}
export function drawMinimap(list) {
  const { x: x0, y: y0, size } = minimapBox();
  const s = size / (RADAR * 2);
  const ox = ship.x - RADAR, oy = ship.y - RADAR;
  const security = Security.LEVELS[here.region.security];
  const hidden = (e) => e.kind === 'wreck' && e.contact && world.knowledge.contactState(e.contact) !== 'known';

  ctx.save();
  ctx.fillStyle = 'rgba(5, 6, 10, 0.75)';
  ctx.fillRect(x0, y0, size, size);
  ctx.strokeStyle = security.color;
  ctx.globalAlpha = 0.6;
  ctx.lineWidth = 1;
  ctx.strokeRect(x0 + 0.5, y0 + 0.5, size - 1, size - 1);
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.rect(x0, y0, size, size);
  ctx.clip();

  // Orbits crossing the radar, faintly: the planets' around the nearest system's star.
  ctx.strokeStyle = COLORS.planet;
  ctx.globalAlpha = 0.18;
  ctx.lineWidth = 1;
  const sys = world.galaxy.nearestSystem(ship.x, ship.y);
  const cx = x0 + (sys.star.x - ox) * s, cy = y0 + (sys.star.y - oy) * s;
  for (const p of sys.planets) { ctx.beginPath(); ctx.arc(cx, cy, p.orbit * s, 0, TAU); ctx.stroke(); }
  ctx.globalAlpha = 1;

  for (const e of list) {
    if (Math.abs(e.x - ship.x) > RADAR + e.radius || Math.abs(e.y - ship.y) > RADAR + e.radius || hidden(e)) continue;
    const m = KINDS[e.kind].mark(e, world.galaxy); // a dot, or a ring
    if (!m) continue;
    ctx.beginPath();
    ctx.arc(x0 + (e.x - ox) * s, y0 + (e.y - oy) * s, m.r, 0, TAU);
    if (m.ring) {
      ctx.strokeStyle = m.color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else {
      ctx.fillStyle = m.color;
      ctx.fill();
    }
  }

  // The player's marker.
  const mk = SystemMap.marker;
  if (mk) {
    ctx.fillStyle = COLORS.marker;
    ctx.beginPath();
    ctx.arc(x0 + clamp((mk.x - ox) * s, 3, size - 3), y0 + clamp((mk.y - oy) * s, 3, size - 3), 3, 0, TAU); // pinned to the edge when beyond
    ctx.fill();
  }

  ctx.translate(x0 + (ship.x - ox) * s, y0 + (ship.y - oy) * s);
  ctx.rotate(ship.angle);
  ctx.fillStyle = COLORS.cyan;
  ctx.beginPath();
  ctx.moveTo(5, 0);
  ctx.lineTo(-3, 3);
  ctx.lineTo(-3, -3);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// No HUD (minimap, speed, location, edge markers) in the introduction: it appears once the player
// first launches.
export const hudShown = () => !intro.on;

// Where the top-left text ends on screen (px): the edge markers keep below it.
export let hudBottom = 0;
// The location line shows for LOCATION_TIME seconds on entering a system, a region of another
// security or a nebula, then fades: the minimap's frame keeps the security's colour.
export const LOCATION_TIME = 5;
const shownLocation = { key: '', at: -Infinity };

// Text cut to fit a width, in the current font, ending in '…' if it had to be.
function fit(text, width) {
  if (ctx.measureText(text).width <= width) return text;
  let n = text.length;
  while (n > 1 && ctx.measureText(`${text.slice(0, n).trimEnd()}…`).width > width) n--;
  return `${text.slice(0, n).trimEnd()}…`;
}

// Text wrapped to a width, in the current font: lines.
function wrap(text, width) {
  const words = text.split(' '), lines = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (line && ctx.measureText(next).width > width) { lines.push(line); line = w; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

// The HUD: top left, where you are (for a moment) and the mission's next step, with the flight
// hints until the first touch, and under them the event log (ui/messages.js): plain text, the
// last few notices, each fading as its time runs out; bottom left, the speed bar with its throttle mark, the hold once
// anything is in it, and the hull while it is damaged (in a fight the combat panel shows it).
// The event log from (left, y): one line per notice, no backing (a shadow keeps it readable), newest
// at the bottom. Beside the minimap a line has `room` px; below it, the screen's width; a longer one
// ends in '…'. Returns where the next line would go.
const TONE = () => ({ info: COLORS.hud, good: COLORS.good, warn: COLORS.amber, hostile: COLORS.hostile });
export function drawEventLog(left, y, room) {
  const logged = Messages.log, I = view.inset, pad = 12, lh = Math.round(19 * Theme.scale), tone = TONE();
  if (!logged.length) return y;
  ctx.save();
  ctx.font = Theme.font(13);
  ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
  ctx.shadowBlur = 4;
  for (const l of logged) {
    const below = !minimap.size || y - lh > minimap.y + minimap.size;
    ctx.globalAlpha = 0.9 * clamp(Messages.LOG_TIME - l.age, 0, 1); // fades over its last second
    ctx.fillStyle = tone[l.tone] || COLORS.hud;
    ctx.fillText(fit(l.n > 1 ? `${l.text} ×${l.n}` : l.text, below ? view.w - pad - I.r - left : room), left, y);
    y += lh;
  }
  ctx.restore();
  return y;
}

// Text sits on a dark backing so it reads over nebulae and stars, and wraps short of the minimap.
export function drawHud() {
  const k = Theme.scale, I = view.inset;
  const pad = 12, left = pad + I.l, lh = Math.round(19 * k);
  const now = performance.now() / 1000;
  const speed = Math.hypot(ship.vx, ship.vy);

  ctx.save();
  ctx.font = Theme.font(14);
  ctx.textBaseline = 'alphabetic';
  const room = (minimap.size ? minimap.x - 12 : view.w - pad - I.r) - left;

  // Top left: the lines to show, each [text, colour, alpha].
  const lines = [];
  const r = here.region;
  const key = `${r.system ? r.system.name : ''}|${r.security}|${r.nebula ? r.nebula.name : ''}`;
  if (key !== shownLocation.key) { shownLocation.key = key; shownLocation.at = now; }
  const locAlpha = clamp((LOCATION_TIME - (now - shownLocation.at)) / 0.8, 0, 1);
  if (locAlpha > 0) {
    const security = Security.LEVELS[r.security]; // how dangerous it is here (world/security.js)
    lines.push([`${r.system ? `${r.system.name.toUpperCase()} SYSTEM` : 'DEEP SPACE'} · SECURITY ${security.label.toUpperCase()}`, security.color, locAlpha]);
    if (r.nebula) lines.push([`${r.nebula.name} · sensors dampened`, r.nebula.color, locAlpha]);
  }
  const obj = here.objective;
  if (obj) for (const t of wrap(`◇ ${obj.text}`, room)) lines.push([t, COLORS.amber, 1]);
  if (!interacted && !intro.on) { // the introduction has its own hint
    const pulse = 0.75 + 0.25 * Math.sin(now * 2.5);
    for (const tip of CONTROLS[moveMode.value]) for (const t of wrap(tip, room)) lines.push([t, COLORS.hud, pulse]);
  }
  let y = pad + I.t + lh - 4;
  if (lines.length) {
    const w = Math.min(room, Math.max(...lines.map(([t]) => ctx.measureText(t).width)));
    ctx.globalAlpha = 0.55 * Math.max(...lines.map((l) => l[2]));
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(left - 6, pad + I.t - 4, w + 12, lines.length * lh + 8);
    for (const [t, color, a] of lines) {
      ctx.globalAlpha = 0.95 * a;
      ctx.fillStyle = color;
      ctx.fillText(t, left, y);
      y += lh;
    }
  }
  const logged = Messages.log;
  y = drawEventLog(left, lines.length ? y + 6 : y, room);
  hudBottom = lines.length || logged.length ? y - lh + 8 : pad + I.t;

  ctx.restore();
  drawStatus(speed / SHIP.maxSpeed, ship.targetSpeed / SHIP.maxSpeed, logged.length ? 13 : 14);
}

// Bottom left: the speed bar (speed, a share of the top speed, filled; the throttle set, marked),
// and above it the hold and a damaged hull. Also on a planet's surface (game/landing.js).
export function drawStatus(speed, set, fontSize = 14) {
  const k = Theme.scale, I = view.inset, pad = 12, left = pad + I.l;
  ctx.save();
  ctx.font = Theme.font(fontSize);
  ctx.textBaseline = 'alphabetic';
  const barW = Math.min(160, view.w * 0.4);
  const by = view.h - pad - 8 - I.b;
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = COLORS.hud;
  ctx.fillRect(left, by, barW, 6);
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = COLORS.cyan;
  ctx.fillRect(left, by, barW * Math.min(1, speed), 6);
  ctx.fillStyle = COLORS.flame;
  ctx.fillRect(left + barW * set - 1, by - 3, 2, 12);
  let x = left;
  const ty = by - 10;
  ctx.globalAlpha = 0.9;
  if (cargo.items.length) {
    ctx.fillStyle = cargo.items.length >= SHIP.cargo ? COLORS.flame : COLORS.hud;
    const t = `HOLD ${cargo.items.length}/${SHIP.cargo}`;
    ctx.fillText(t, x, ty);
    x += ctx.measureText(t).width + 16;
  }
  if (cargo.hull < SHIP.hull && !inFight()) { // damage shows until it's repaired at a station
    const f = cargo.hull / SHIP.hull, tone = f < 0.35 ? COLORS.hostile : COLORS.flame;
    ctx.fillStyle = tone;
    ctx.fillText('HULL', x, ty);
    const gx = x + ctx.measureText('HULL').width + 6, gw = 56 * k, gh = Math.round(5 * k);
    ctx.globalAlpha = 0.3;
    ctx.fillRect(gx, ty - gh - 2, gw, gh);
    ctx.globalAlpha = 0.95;
    ctx.fillRect(gx, ty - gh - 2, gw * f, gh);
  }
  ctx.restore();
}
