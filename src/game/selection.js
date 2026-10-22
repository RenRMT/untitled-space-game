// Selection (tap something for its context menu, ui/context.js, shown round it) and the approach
// autopilot (fly to it and stop beside it).
// Part of the flight view; src/main.js starts it.

import { Format } from '../core/format.js';
import { clamp } from '../core/math.js';
import { COLORS, Theme } from '../core/theme.js';
import { Entities } from '../flight/entities.js';
import { ContextCard } from '../ui/context.js';
import { threat } from './combat.js';
import { actions, gapTo } from './docking.js';
import { rx, ry } from './draw-world.js';
import { navMarkerAt, worldToScreen } from './hud.js';
import { drag } from './input.js';
import { SHIP, autopilot, cam, ctx, inFight, ship, view } from './state.js';
import { world } from './world.js';

// ---------- Selection: tap something for its context menu ----------

// Tapping a station, asteroid or ship selects it: a bracket marks it in space and the
// context menu (ui/context.js) offers what can be done there. Off-screen stations are selected by
// tapping their marker at the screen edge. A tap on empty space clears the
// selection (and, in Cruise mode, stops the ship as before).
export const TAP_SLOP = 26; // CSS px of forgiveness around a tap target
export const SELECT_COLOR = COLORS.cyan;
export let HOSTILE_COLOR = COLORS.hostile;
Theme.onPalette(() => { HOSTILE_COLOR = COLORS.hostile; }); // the colour-safe palette changes it
export let selected = null; // { key, e }: the selected entity, found again by key every frame
export let frameList = []; // the entities posed last frame, for hit-testing taps

// What each kind of thing is: draw order, labels, the minimap, the context menu (flight/entities.js).
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

// An action's button on the context menu, from its state. One that only needs the ship closer or
// slower can be pressed: the ship approaches and then does it (act); while it is on its way there
// the button shows busy.
export function primary(id, state, e) {
  const a = actions.get(id);
  const pending = !!e && autopilot.then === id && autopilot.key === entityKey(e);
  const label = state.approach && a ? a.verb : state.label;
  return { id, label, enabled: state.ok || !!state.approach, busy: !!state.busy || pending, progress: state.progress };
}

// Approach: offered for things with nothing else to do (a friendly ship), and as Cancel while
// flying to anything.
export function approachActions(e, hasActions) {
  if (autopilot.key === entityKey(e)) return [{ id: 'cancel-approach', label: 'Cancel approach', enabled: true }];
  return hasActions ? [] : [{ id: 'approach', label: 'Approach', enabled: true }];
}

// Do an action on e: now if it can be done, else (too far, too fast) fly there and do it on arrival.
export function act(e, id) {
  const a = actions.get(id);
  if (!a || !e) return;
  const s = actions.state(a, e);
  if (s.ok) a.run(e);
  else if (s.approach) approach(e, a);
}

// What the context menu shows for the selected object: what it is (its kind's card) and what can
// be done with it (its actions), plus Approach for anything without an action (a friendly ship;
// ships are followed). The card's text is kept for the tests and screen readers: the menu shows
// only the buttons.
export function describe(e) {
  const card = KINDS[e.kind].card(e, world.galaxy);
  const states = actions.of(e).map((a) => [a, actions.state(a, e)]);
  // A pirate's card says in one word how a fight would go (Weak, Even, Outmatched); its pack and
  // gear are a tap away, in the card's detail line.
  const t = isHostile(e) ? threat(e) : null;
  return {
    title: card.title, subtitle: `${card.sub} · ${fmtDist(gapTo(e))}`, color: card.color,
    tag: t ? t.word : card.tag || '', tone: t ? t.tone : card.tone || '', detail: t ? t.detail : '',
    actions: [...states.map(([a, s]) => primary(a.id, s, e)), ...approachActions(e, states.length > 0)],
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

// Stop halfway into the reach of the object's action (`then`, if given, done on arrival); things
// that move (ships) are followed at their kind's distance.
export function approach(e, then = null) {
  if (inFight()) return;
  const follow = KINDS[e.kind].follow, a = then || actions.of(e)[0];
  const reach = follow || (a ? actions.range(a) : 600);
  Object.assign(autopilot, { key: entityKey(e), e, stop: e.radius + reach * 0.5, follow: !!follow, then: then ? then.id : null });
}

// Steer toward the target, braking so the ship comes to rest at the stop distance. Any drag
// takes the controls back. Moving targets (ships) are followed until cancelled. An action waiting
// for the ship to arrive is done as soon as it can be (and dropped if it no longer can).
export function tickAutopilot() {
  const t = autopilot.e;
  if (!autopilot.key || !t || drag.active) return;
  if (autopilot.then) {
    const s = actions.state(autopilot.then, t);
    if (s.ok) {
      const a = actions.get(autopilot.then);
      Object.assign(autopilot, { key: null, then: null });
      ship.targetSpeed = 0;
      a.run(t);
      return;
    }
    if (!s.approach) { Object.assign(autopilot, { key: null, then: null }); ship.targetSpeed = 0; return; }
  }
  const dx = t.x - ship.x, dy = t.y - ship.y;
  const left = Math.hypot(dx, dy) - autopilot.stop;
  if (left <= 8) {
    ship.targetSpeed = 0;
    if (!autopilot.follow && !autopilot.then) autopilot.key = null; // with an action to do, wait to slow down
    return;
  }
  ship.targetAngle = Math.atan2(dy, dx);
  const facing = Math.cos(ship.targetAngle - ship.angle);
  const braking = Math.sqrt(2 * SHIP.accel * 0.7 * left);
  ship.targetSpeed = clamp(braking, 40, SHIP.maxSpeed) * (facing > 0.8 ? 1 : 0.35);
}

// The context menu follows the selected object across the screen (in screen px, round its brackets).
export function placeMenu() {
  const e = selected && selected.e;
  if (!e || !ContextCard.isOpen) return;
  const [x, y] = worldToScreen(e.x, e.y);
  ContextCard.place(x, y, (hitRadius(e) + 12 / view.zoom) * view.zoom);
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
    else if (id === 'cancel-approach') { Object.assign(autopilot, { key: null, then: null }); ship.targetSpeed = 0; }
    else act(e, id);
  };
}
