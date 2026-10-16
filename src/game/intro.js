// The introduction: the escape pod drifting in, talked to the waystation (story/intro.js), its
// tractor beam and the camera's arrival shot.
// Part of the flight view; src/main.js starts it.

import { ArtPortraits } from '../art/portraits.js';
import { Params } from '../core/store.js';
import { COLORS } from '../core/theme.js';
import { Intro } from '../story/intro.js';
import { Comms } from '../ui/comms.js';
import { applyShip, cargo, saveCargo } from './cargo.js';
import { dock, gapTo } from './docking.js';
import { rx, ry } from './draw-world.js';
import { HULL_ART, artStyle, moveMode, setting } from './options.js';
import { placeBeside, placeShip } from './outfitting.js';
import { SHIP, cam, clamp, ctx, fight, intro, lerp, setMode, ship, turnToward, view } from './state.js';
import { world } from './world.js';

//
// A new game opens on an escape pod near the waystation (world/galaxy.js), with the station's android
// on the comms (ui/comms.js) running the script in story/intro.js: its answers set the art style and the
// movement mode (the combat mode comes with the first mission's launch). Mid-way the pod is the player's to fly, until it's in reach of the station's
// tractor beam, which brings it in to dock as the station finishes talking. Then the player has
// the usual ship again. ?skipintro (or the Skip button) goes straight to the docked station.
// It opens on the pod drifting in toward the station (a tap skips that), before anyone speaks.
// While it runs there is no map, no settings, no HUD, no selecting things, no squad and no pirates.

// The pod: slow and gentle, so the first flight is short and easy to steer.
export const POD = { name: 'Escape pod', radius: 15, maxSpeed: 170, accel: 120, turnRate: 2.4, cargo: 0 };
// start: how far from the station's edge the pod drifts; range: where the tractor beam takes it
// (from the station's edge); hold: where the beam holds it, docked; speed: how fast it pulls.
// zoom: the view is this much wider throughout, so the station and the pod are both on screen.
export const TRACTOR = { start: 560, range: 260, hold: 90, speed: 150, zoom: 0.65 };
// The opening shot: the pod drifts in this far toward its starting spot over this many seconds,
// slowing as it comes, before the station first speaks. A tap cuts it short. The view starts close
// on the pod (zoom: view.k), holds there for the first `hold` of the time, then pulls back to the
// introduction's wide view, bringing the station in.
export const ARRIVE = { dist: 700, time: 5, zoom: 3, hold: 0.2 };
export const INTRO_FROM = Intro.STATION;
export const APPROACH_HINT = {
  cruise: 'Drag anywhere to set a heading: the further you drag, the faster you go. The pod keeps drifting when you let go; tap empty space to stop.',
  direct: 'Drag anywhere to steer: the further you drag, the faster you go. Let go and the pod stops.',
};

export function introDue() {
  return !cargo.story.has('intro') && world.galaxy.waystation >= 0 && !Params.has('skipintro');
}

// A portrait (art/portraits.js) in an art style (the current one by default), filling a square:
// a face(ctx, size) drawer for the comms box and the station screen.
export function faceOf(portrait, style) {
  return (c, size) => {
    c.fillStyle = COLORS.bg;
    c.fillRect(0, 0, size, size);
    c.translate(size / 2, size / 2);
    c.scale(size / 100, size / 100);
    ArtPortraits.draw(c, portrait, style || artStyle.value, { texel: 2 });
  };
}
// The station android's portrait.
export const introFace = (style) => faceOf(intro.face, style);
export const waystation = () => world.scene.stations[world.galaxy.waystation] || null;

export function startIntro() {
  const st = waystation();
  Object.assign(intro, { on: true, station: st, flying: false, beam: null });
  intro.face = world.wayFace;
  intro.run = Intro.create(introAnswer);
  Object.assign(SHIP, POD);
  ship.art = HULL_ART.pod();
  // It ends up adrift below the station (on screen: above the comms box), turned a little away
  // from it; first it drifts in from further out, nose first, coming to rest there.
  const a = Math.PI / 2 - 0.25, d = st.radius + TRACTOR.start;
  const to = { x: st.x + Math.cos(a) * d, y: st.y + Math.sin(a) * d };
  const from = { x: st.x + Math.cos(a) * (d + ARRIVE.dist), y: st.y + Math.sin(a) * (d + ARRIVE.dist) };
  intro.arrive = { t: 0, from, to, a0: a + Math.PI, a1: a + Math.PI + 0.9 };
  placeShip(from.x, from.y, intro.arrive.a0); // the camera on the pod
  view.k = ARRIVE.zoom;
  view.zoom = view.base * view.k;
  fight.grace = Infinity;
  setMode('intro', true);
  Comms.onSkip = skipIntro;
  Comms.hide(); // nothing is said until the pod has drifted in
}

// The opening drift: in along a straight line, slowing to a stop (ease-out), and turning a little
// away from the station as it settles. Then the station speaks.
export function tickArrive(dt) {
  const A = intro.arrive;
  A.t = Math.min(ARRIVE.time, A.t + dt);
  const u = A.t / ARRIVE.time, k = 1 - (1 - u) ** 2, speed = (2 * (1 - u) * ARRIVE.dist) / ARRIVE.time;
  const dir = Math.atan2(A.to.y - A.from.y, A.to.x - A.from.x);
  ship.x = lerp(A.from.x, A.to.x, k);
  ship.y = lerp(A.from.y, A.to.y, k);
  ship.vx = Math.cos(dir) * speed;
  ship.vy = Math.sin(dir) * speed;
  ship.angle = ship.targetAngle = A.a0 + (A.a1 - A.a0) * (u * u * (3 - 2 * u));
  ship.thrust = 0;
  if (u >= 1) endArrive();
}
// The opening shot's camera: close on the pod, then (after the hold) pulling back and over to the
// point between the pod and the station, zooming out to the introduction's view as it goes.
export function arriveView() {
  const u = intro.arrive.t / ARRIVE.time, st = intro.station;
  const v = clamp((u - ARRIVE.hold) / (1 - ARRIVE.hold), 0, 1), w = v * v * (3 - 2 * v);
  view.k = Math.exp(lerp(Math.log(ARRIVE.zoom), Math.log(TRACTOR.zoom), w));
  view.zoom = view.base * view.k;
  cam.x = lerp(ship.x, (ship.x + st.x) / 2, w);
  cam.y = lerp(ship.y, (ship.y + st.y) / 2, w);
}
export function endArrive() {
  const A = intro.arrive;
  intro.arrive = null;
  placeShip(A.to.x, A.to.y, A.a1);
  showIntroStep();
}

export function introAnswer(setting, value) {
  if (setting === 'style') artStyle.set(value);
  else if (setting === 'move') moveMode.set(value);
}

// The comms box for the script's current step: a line or a question, the flying hint, or
// nothing while the beam brings the pod in.
export function showIntroStep() {
  const step = intro.run.step;
  if (!step || step.wait === 'docked') { Comms.hide(); return; }
  if (step.wait === 'approach') {
    intro.flying = true;
    Comms.hint({ from: 'Pod controls', text: APPROACH_HINT[moveMode.value] });
    return;
  }
  Comms.show({
    from: INTRO_FROM, text: step.say, face: intro.run.portrait ? introFace() : null,
    choices: step.ask ? step.options.map((o) => ({ label: o.label, face: step.portraits ? introFace(o.value) : null })) : null,
    onNext: () => { intro.run.next(); showIntroStep(); },
    onChoose: (i) => { intro.run.choose(i); showIntroStep(); },
  });
}

// Each frame: into the beam's reach, the beam takes over; once it has the pod in and the station
// has had its say, the pod docks.
export function tickIntro(dt) {
  if (!intro.on) return;
  const st = intro.station;
  if (intro.flying && gapTo(st) <= TRACTOR.range) {
    intro.flying = false;
    intro.beam = { t: 0, in: false };
    ship.targetSpeed = 0;
    intro.run.signal('approach');
    showIntroStep();
  }
  if (intro.beam && intro.beam.in && intro.run.step && intro.run.step.wait === 'docked') {
    intro.run.signal('docked');
    endIntro({ played: true });
    dock(st);
  }
}

// The beam pulls the pod to its berth beside the station and turns it to face in; the pod's own
// engine is off.
export function tickBeam(dt) {
  const st = intro.station, b = intro.beam;
  b.t += dt;
  const a = Math.atan2(ship.y - st.y, ship.x - st.x), reach = st.radius + TRACTOR.hold;
  const tx = st.x + Math.cos(a) * reach, ty = st.y + Math.sin(a) * reach;
  const d = Math.hypot(tx - ship.x, ty - ship.y);
  const speed = Math.min(TRACTOR.speed * Math.min(1, b.t / 1.5), d * 2 + 20);
  if (d > 1) {
    ship.vx = ((tx - ship.x) / d) * speed;
    ship.vy = ((ty - ship.y) / d) * speed;
  } else ship.vx = ship.vy = 0;
  ship.x += ship.vx * dt;
  ship.y += ship.vy * dt;
  ship.angle = ship.targetAngle = turnToward(ship.angle, a + Math.PI, 1.2 * dt);
  ship.thrust = 0;
  b.in = d < 10;
}

// The beam: a pale cone from the station to the pod, with bands of light running down it.
export function drawTractorBeam(t) {
  const b = intro.beam;
  if (!b) return;
  const st = intro.station, color = st.color;
  const x0 = rx(st.x), y0 = ry(st.y), x1 = rx(ship.x), y1 = ry(ship.y);
  const a = Math.atan2(y1 - y0, x1 - x0), len = Math.hypot(x1 - x0, y1 - y0);
  const fade = Math.min(1, b.t / 0.6);
  ctx.save();
  ctx.translate(x0, y0);
  ctx.rotate(a);
  ctx.globalAlpha = 0.2 * fade;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(st.radius * 0.6, -st.radius * 0.35);
  ctx.lineTo(len + 16, -15);
  ctx.lineTo(len + 16, 15);
  ctx.lineTo(st.radius * 0.6, st.radius * 0.35);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  for (let k = 0; k < 4; k++) {
    const u = ((t * 0.5 + k / 4) % 1), x = lerp(len + 16, st.radius * 0.6, u), w = lerp(15, st.radius * 0.35, u);
    ctx.globalAlpha = 0.5 * fade * Math.sin(u * Math.PI);
    ctx.beginPath();
    ctx.moveTo(x, -w);
    ctx.lineTo(x, w);
    ctx.stroke();
  }
  ctx.restore();
}

// Out of the introduction: the usual ship (and squad, and pirates) back. played: it ran to the
// end (or was skipped), so it won't run again in this galaxy.
export function endIntro({ played }) {
  Object.assign(intro, { on: false, run: null, flying: false, beam: null, arrive: null });
  Comms.onSkip = null;
  Comms.hide();
  setMode('intro', false);
  fight.grace = 0;
  applyShip();
  cargo.hull = SHIP.hull;
  if (played) {
    cargo.story.add('intro');
    saveCargo();
  }
}

// Skip: straight to docked at the waystation, with the settings as they are.
export function skipIntro() {
  const st = intro.station;
  endIntro({ played: true });
  placeBeside(st);
  dock(st);
}
