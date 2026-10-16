// Selection (tap something for its context card, ui/context.js) and the approach autopilot (fly
// to it and stop beside it).
// Part of the flight view; src/main.js starts it.

import { Format } from '../core/format.js';
import { clamp } from '../core/math.js';
import { COLORS } from '../core/theme.js';
import { Entities } from '../flight/entities.js';
import { ContextCard } from '../ui/context.js';
import { packOf } from './combat.js';
import { actions, gapTo } from './docking.js';
import { rx, ry } from './draw-world.js';
import { navMarkerAt } from './hud.js';
import { drag } from './input.js';
import { stopMining } from './mining.js';
import { SHIP, autopilot, cam, ctx, inFight, ship, view } from './state.js';
import { world } from './world.js';

// ---------- Selection: tap something for its context card ----------

// Tapping a station, asteroid or ship selects it: a bracket marks it in space and the
// context card (ui/context.js) offers what can be done there. Off-screen stations are selected by
// tapping their marker at the screen edge. A tap on empty space clears the
// selection (and, in Cruise mode, stops the ship as before).
export const TAP_SLOP = 26; // CSS px of forgiveness around a tap target
export const SELECT_COLOR = COLORS.cyan;
export const HOSTILE_COLOR = COLORS.hostile;
export let selected = null; // { key, e }: the selected entity, found again by key every frame
export let frameList = []; // the entities posed last frame, for hit-testing taps

// What each kind of thing is: draw order, labels, the minimap, the context card (flight/entities.js).
export const KINDS = Entities.KINDS;

// A stable identity for anything selectable, or null.
export const entityKey = (e) => (KINDS[e.kind].selectable && e.key ? `${e.kind}:${e.key}` : null);

// How far from its centre a tap still hits the object (for stations only their core).
export const hitRadius = (e) => e.radius * (KINDS[e.kind].hit || 1);

export const screenToWorld = (sx, sy) => [(sx - view.w / 2) / view.zoom + cam.x, (sy - view.h / 2) / view.zoom + cam.y];

// The object under a tap. When several overlap, the one whose centre is relatively closest wins,
// so a ship passing in front of a station gets picked over the station.
export function pickAt(sx, sy) {
  const marker = navMarkerAt(sx, sy); // off-screen stations, by their edge marker
  if (marker) return marker;
  const [wx, wy] = screenToWorld(sx, sy);
  const slop = TAP_SLOP / view.zoom;
  let best = null, bestScore = Infinity;
  for (const e of frameList) {
    if (!entityKey(e)) continue;
    const reach = hitRadius(e) + slop;
    const score = Math.hypot(wx - e.x, wy - e.y) / reach;
    if (score <= 1 && score < bestScore) { best = e; bestScore = score; }
  }
  return best;
}

export function select(e) {
  selected = e ? { key: entityKey(e), e } : null;
  if (!selected) ContextCard.hide();
}

export const isHostile = (e) => Entities.isHostile(e);
export const fmtDist = Format.dist; // core/format.js

// An action's button on the context card, from its state.
export function primary(id, state) {
  return { id, label: state.label, enabled: state.ok, busy: !!state.busy, progress: state.progress };
}

// Approach: offered while the object is out of reach, and as Cancel while flying there.
export function approachActions(e, inRange) {
  if (autopilot.key === entityKey(e)) return [{ id: 'cancel-approach', label: 'Cancel approach', enabled: true }];
  return inRange ? [] : [{ id: 'approach', label: 'Approach', enabled: true }];
}

// What the context card shows for the selected object: what it is (its kind's card) and what can
// be done with it (its actions), plus Approach while it's out of reach. Anything without an
// action (a friendly ship) can always be approached, and ships are followed.
export function describe(e) {
  const card = KINDS[e.kind].card(e, world.galaxy);
  const states = actions.of(e).map((a) => [a, actions.state(a, e)]);
  const inRange = states.length > 0 && states.every(([, s]) => s.inRange);
  // A pirate's card says how many would fight with it, so a pack can be told from a lone ship.
  const n = isHostile(e) ? packOf(e).length : 0;
  const pack = n ? ` · ${n === 1 ? 'alone' : `pack of ${n}`}` : '';
  return {
    title: card.title, subtitle: `${card.sub}${pack} · ${fmtDist(gapTo(e))}`, color: card.color, tag: card.tag || '', tone: card.tone || '',
    actions: [...states.map(([a, s]) => primary(a.id, s)), ...approachActions(e, inRange)],
  };
}

// Find the selected and approached objects among this frame's entities, and refresh the card.
// Something that's gone (mined, out of range) drops its selection.
export function updateSelection(list) {
  frameList = list;
  if (autopilot.key) {
    autopilot.e = list.find((x) => entityKey(x) === autopilot.key) || null;
    if (!autopilot.e) autopilot.key = null;
  }
  if (!selected) return;
  selected.e = list.find((x) => entityKey(x) === selected.key) || null;
  if (!selected.e) { select(null); return; }
  ContextCard.show(describe(selected.e));
}

// ---------- Approach: fly to an object and stop beside it ----------

// Stop halfway into the reach of the object's action; things that move (ships) are followed at
// their kind's distance.
export function approach(e) {
  if (inFight()) return;
  const follow = KINDS[e.kind].follow, a = actions.of(e)[0];
  const reach = follow || (a ? actions.range(a) : 600);
  Object.assign(autopilot, { key: entityKey(e), e, stop: e.radius + reach * 0.5, follow: !!follow });
  stopMining();
}

// Steer toward the target, braking so the ship comes to rest at the stop distance. Any drag
// takes the controls back. Moving targets (ships) are followed until cancelled.
export function tickAutopilot() {
  const t = autopilot.e;
  if (!autopilot.key || !t || drag.active) return;
  const dx = t.x - ship.x, dy = t.y - ship.y;
  const left = Math.hypot(dx, dy) - autopilot.stop;
  if (left <= 8) {
    ship.targetSpeed = 0;
    if (!autopilot.follow) autopilot.key = null;
    return;
  }
  ship.targetAngle = Math.atan2(dy, dx);
  const facing = Math.cos(ship.targetAngle - ship.angle);
  const braking = Math.sqrt(2 * SHIP.accel * 0.7 * left);
  ship.targetSpeed = clamp(braking, 40, SHIP.maxSpeed) * (facing > 0.8 ? 1 : 0.35);
}

// Corner brackets around the selected object, and a dashed line to the approach target.
export function drawSelection(t) {
  ctx.save();
  if (autopilot.key && autopilot.e) {
    ctx.strokeStyle = SELECT_COLOR;
    ctx.globalAlpha = 0.3;
    ctx.lineWidth = 1.5 / view.zoom;
    ctx.setLineDash([10 / view.zoom, 10 / view.zoom]);
    ctx.beginPath();
    ctx.moveTo(rx(ship.x), ry(ship.y));
    ctx.lineTo(rx(autopilot.e.x), ry(autopilot.e.y));
    ctx.stroke();
    ctx.setLineDash([]);
  }
  const e = selected && selected.e;
  if (e) {
    ctx.strokeStyle = isHostile(e) ? HOSTILE_COLOR : SELECT_COLOR;
    ctx.globalAlpha = 0.7 + 0.25 * Math.sin(t * 4);
    ctx.lineWidth = 2 / view.zoom;
    brackets(rx(e.x), ry(e.y), hitRadius(e), { arm: 22 });
  }
  ctx.restore();
}

// Corner brackets around something `radius` across (selection, a ship in a fight), with arms up
// to `arm` screen px; `open` (0..1) pushes them out (a lock coming on).
export function brackets(x, y, radius, { open = 0, arm = 18 } = {}) {
  const R = (radius + 12 / view.zoom) * (1 + open * 0.9), len = Math.min(R * 0.45, arm / view.zoom);
  ctx.beginPath();
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    ctx.moveTo(x + sx * R, y + sy * (R - len));
    ctx.lineTo(x + sx * R, y + sy * R);
    ctx.lineTo(x + sx * (R - len), y + sy * R);
  }
  ctx.stroke();
}

// Wiring, run once every module has loaded (src/main.js).
export function init() {
  ContextCard.onClose = () => select(null);
  ContextCard.onAction = (id) => {
    const e = selected && selected.e;
    if (!e) return;
    if (id === 'approach') approach(e);
    else if (id === 'cancel-approach') { autopilot.key = null; ship.targetSpeed = 0; }
    else if (actions.get(id)) actions.get(id).run(e);
  };
}
