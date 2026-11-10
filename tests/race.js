// Node checks for the race. No dependencies: `node tests/race.js` (ONLY=text runs the tests whose
// names include it); `node tests/run.js` runs every game's.

import assert from 'node:assert';
import { mulberry32 } from '../src/core/rng.js';
import { Collide } from '../src/flight/collide.js';
import { Config as RaceConfig } from '../src/race/config.js';
import { Track } from '../src/race/track.js';
import { Contact } from '../src/race/contact.js';
import { Input as RaceInput } from '../src/race/input.js';
import { Run } from '../src/race/run.js';
import { Handling } from '../src/race/handling.js';
import { Pilot } from '../src/race/pilot.js';
import { Line } from '../src/race/line.js';
import { Rival } from '../src/race/rival.js';
import { Dust } from '../src/race/dust.js';
import { Career } from '../src/race/career.js';
import { Pickups } from '../src/race/pickups.js';
import { Storm } from '../src/race/storm.js';
import { View as RaceView } from '../src/race/view.js';
import * as AppSw from '../tools/app-sw.js';
import { finish, test } from './harness.js';

// The race (src/race/, notes/race.md): the track's loop, sliding along walls.
const RACE = RaceConfig.TRACK;

test('race track: a closed loop inside the map, never too narrow, its bends wider than the track, checkpoints in order', () => {
  for (const style of ['regular', 'advanced', 'expert']) for (let seed = 1; seed <= 20; seed++) {
    const opts = RaceConfig.map(style).TRACK, tr = Track.loop(seed, opts), S = tr.samples;
    assert.strictEqual(tr.pts.length, S);
    assert.deepStrictEqual(tr, Track.loop(seed, opts), 'the same seed, the same track');
    let len = 0;
    tr.pts.forEach((p, n) => {
      const q = tr.pts[(n + 1) % S];
      len += Math.hypot(q.x - p.x, q.y - p.y);
      assert(Math.hypot(q.x - p.x, q.y - p.y) < 4 * tr.ds, `no jumps (seed ${seed}, point ${n})`);
      assert(p.x - p.hw > opts.margin * 0.5 && p.y - p.hw > opts.margin * 0.5 && p.x + p.hw < opts.size - opts.margin * 0.5 && p.y + p.hw < opts.size - opts.margin * 0.5, `inside the map (seed ${seed})`);
      assert(p.hw >= opts.minHw, `wide enough (seed ${seed})`);
      assert(Math.abs(Math.hypot(p.tx, p.ty) - 1) < 1e-9);
    });
    assert(Math.abs(len - tr.len) < 1e-6 * len);
    assert(Track.minRadius(tr).r >= 2, `the tightest bend is wider than the track (seed ${seed}: ${Track.minRadius(tr).r.toFixed(2)})`);
    assert(tr.pts.every((p) => p.side === 1 || p.side === -1), 'every point bends one way or the other');
    // Two stretches further apart round the loop than a bend could bring them keep their run-offs
    // and a wall between them.
    const far = Math.ceil((1.6 * (2 * Math.max(...tr.pts.map((p) => p.hw)) + opts.gap)) / tr.ds);
    for (let a = 0; a < S; a += 3) for (let b = a + far; b < S && S - (b - a) >= far; b += 3) {
      const p = tr.pts[a], q = tr.pts[b];
      assert(Math.hypot(p.x - q.x, p.y - q.y) - p.hw - q.hw >= 2 * (RaceConfig.RUNOFF + RaceConfig.CARVE.open) + RaceConfig.T * 0.9, `a wall between two stretches (seed ${seed}, points ${a}, ${b})`);
    }
    assert.strictEqual(tr.cps[0], 0, 'the first checkpoint is the start line');
    for (let k = 1; k < tr.cps.length; k++) assert(tr.cps[k] > tr.cps[k - 1]);
  }
  // A wobbly loop squeezed until its bends fold over itself is smoothed out.
  const tight = Track.loop(3, { ...RACE, hw: 250, minHw: 250, margin: 0 });
  assert(Track.minRadius(tight).r >= 2, `smoothed: ${Track.minRadius(tight).r.toFixed(2)}`);
});

test('race track: corners of many kinds, bending both ways, a few that need a lift', () => {
  const seen = new Set();
  let lifts = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const tr = Track.loop(seed, RACE), m = Track.measure(tr, RACE);
    assert(tr.corners.length >= 6, `corners (seed ${seed})`);
    for (const c of tr.corners) {
      seen.add(c.type);
      assert([c.from, c.apex, c.to].every((n) => Number.isInteger(n) && n >= 0 && n < tr.samples) && Math.abs(c.side) === 1 && c.r > 0, `a corner (seed ${seed})`);
    }
    assert(m.flips >= 4 && m.oneWay <= 0.85, `bends both ways (seed ${seed}: ${m.flips} flips, ${m.oneWay.toFixed(2)} one way)`);
    assert(m.lap > 18 && m.lap < 30, `a lap of ${m.lap.toFixed(1)} s (seed ${seed})`);
    if (m.underRv >= 1) lifts++;
  }
  assert(lifts >= 15, `most tracks have a corner that needs a lift (${lifts} of 20)`);
  for (const k of ['hairpin', 'square', 'sweeper', 'double-apex', 'decreasing', 'chicane']) assert(seen.has(k), `a ${k} somewhere`);
});

test('race track: the advanced style folds in on itself, bends both ways, and leaves the regular one as it was', () => {
  const fills = { regular: [], advanced: [] }, ADV = RaceConfig.map('advanced').TRACK;
  let own = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const tr = Track.loop(seed, ADV), m = Track.measure(tr, RACE);
    if (tr.from === 'skeleton') own++;
    assert(tr.corners.length >= 6, `corners (seed ${seed})`);
    assert(m.flips >= 4 && m.oneWay <= 0.85, `bends both ways (seed ${seed}: ${m.flips} flips, ${m.oneWay.toFixed(2)} one way)`);
    assert(m.lap > 22 && m.lap < 44, `a lap of ${m.lap.toFixed(1)} s (seed ${seed})`);
    fills.advanced.push(m.fill);
    fills.regular.push(Track.measure(Track.loop(seed, RACE), RACE).fill);
  }
  assert(own >= 17, `advanced layouts, not the regular fallback (${own} of 20)`);
  const median = (v) => [...v].sort((a, b) => a - b)[v.length >> 1];
  assert(median(fills.advanced) <= 0.8 && median(fills.advanced) < median(fills.regular) - 0.08, `folds in more than the regular style (fill ${median(fills.advanced).toFixed(2)} vs ${median(fills.regular).toFixed(2)})`);
  assert.deepStrictEqual(Track.loop(5, { ...RACE, style: 'regular' }), Track.loop(5, RACE), 'regular is the default');
  assert.deepStrictEqual(RaceConfig.map().TRACK, { ...RACE, style: 'regular' }, 'the regular map is the one it was');
  assert(ADV.size > RACE.size, 'a bigger map for the advanced style');
});

test('race track: the expert style folds in further, with tight corners and few long straights', () => {
  const EXP = RaceConfig.map('expert').TRACK, ADV = RaceConfig.map('advanced').TRACK, fills = { advanced: [], expert: [] }, longs = [];
  let own = 0, slow = 0, all = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const tr = Track.loop(seed, EXP), m = Track.measure(tr, EXP);
    if (tr.from === 'grid') own++;
    assert(tr.corners.length >= 8, `corners (seed ${seed})`);
    assert(m.flips >= 6 && m.oneWay <= 0.85, `bends both ways (seed ${seed}: ${m.flips} flips, ${m.oneWay.toFixed(2)} one way)`);
    assert(m.lap > 26 && m.lap < 48, `a lap of ${m.lap.toFixed(1)} s (seed ${seed})`);
    assert(m.straightS < 8, `no straight too long (seed ${seed}: ${m.straightS.toFixed(1)} s)`);
    for (const c of tr.corners) { all++; if (['square', 'hairpin', 'decreasing', 'double-apex', 'chicane'].includes(c.type)) slow++; }
    fills.expert.push(m.fill); longs.push(m.longs);
    fills.advanced.push(Track.measure(Track.loop(seed, ADV), ADV).fill);
  }
  const median = (v) => [...v].sort((a, b) => a - b)[v.length >> 1];
  assert(own >= 18, `expert layouts, not a fallback (${own} of 20)`);
  assert(median(fills.expert) <= 0.67 && median(fills.expert) < median(fills.advanced) - 0.04, `folds in more than the advanced style (fill ${median(fills.expert).toFixed(2)} vs ${median(fills.advanced).toFixed(2)})`);
  assert(median(longs) <= 3, `few long straights (median ${median(longs)})`);
  assert(slow / all >= 0.85, `tight corners almost everywhere (${slow} of ${all})`);
  assert.strictEqual(RaceConfig.map('expert').N, RaceConfig.N_EXP);
});

test('race track: how far outside the edge, the way out, and the point further round', () => {
  const tr = Track.loop(1, RACE), p = tr.pts[100], nx = -p.ty, ny = p.tx;
  let e = Track.edgeDist(tr, p.x, p.y);
  assert(Math.abs(e.d + p.hw) < 1, 'on the centreline: a half-width inside the edge');
  assert(Math.abs(e.n - 100) <= 1);
  e = Track.edgeDist(tr, p.x + nx * (p.hw + 50), p.y + ny * (p.hw + 50), 100, 40);
  assert(Math.abs(e.d - 50) < 2, `50 outside: ${e.d}`);
  assert(e.nx * nx + e.ny * ny > 0.99, 'the way out points away from the centreline');
  assert.deepStrictEqual(Track.edgeDist(tr, p.x + 3, p.y - 2, 100, 40).n, Track.edgeDist(tr, p.x + 3, p.y - 2).n, 'a guess finds the same point');
  assert.strictEqual(Track.ahead(tr, 100, tr.ds * 10), 110);
  assert.strictEqual(Track.ahead(tr, 5, -tr.ds * 10), tr.samples - 5, 'back past the start wraps round');
});

test('race carve: the track, its run-off and the walls; nothing left on the track', () => {
  const T = RaceConfig.T, n = 40, tr = Track.loop(2, { ...RACE, size: n * T, hw: 1.6 * T, minHw: 1.2 * T, margin: 2 * T, gap: 4.3 * T });
  const grid = (v) => Array.from({ length: n + 1 }, () => new Array(n + 1).fill(v));
  const key = (x, y) => Math.floor(x / T) * 1000 + Math.floor(y / T);
  const at = (n, o) => { const p = tr.pts[n]; return [p.x - p.ty * (p.hw + o), p.y + p.tx * (p.hw + o)]; }; // o past the edge (< 0: on the track)
  const W = { w: n, h: n, C: grid(1), G: grid(0.5), G2: grid(0.5), props: {} };
  const put = (type, [x, y], r = 10) => { W.props[key(x, y)] = { type, x, y, r }; return key(x, y); };
  const onTall = put('tall', at(200, -T)), onSmall = put('small', at(300, -T)), offHole = put('hole', at(400, RaceConfig.RUNOFF * 0.5));
  // A tile on the run-off clear of the walls: its middle off the track, its corners all opened.
  const d = (i, j) => Track.edgeDist(tr, i * T, j * T).d, open = RaceConfig.RUNOFF + RaceConfig.CARVE.open;
  let off = null;
  for (let i = 0; i < n && !off; i++) for (let j = 0; j < n && !off; j++) if (d(i + 0.5, j + 0.5) > 0 && [d(i, j), d(i + 1, j), d(i, j + 1), d(i + 1, j + 1)].every((v) => v < open) && key((i + 0.5) * T, (j + 0.5) * T) !== offHole) off = [(i + 0.5) * T, (j + 0.5) * T];
  const offSmall = put('small', off);
  assert.strictEqual(new Set([onTall, onSmall, offHole, offSmall]).size, 4, 'a tile each');
  Track.carve(W, tr, 2, { ...RaceConfig.CARVE, T, kinds: { track: 'b', off: 'c' } });
  for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) {
    const d = Track.edgeDist(tr, i * T, j * T).d;
    if (d < RaceConfig.RUNOFF + RaceConfig.CARVE.open) assert.strictEqual(W.C[i][j], 0, `open on the track and its run-off (${i}, ${j})`);
    else assert.strictEqual(W.C[i][j], 1, `high ground beyond (${i}, ${j})`);
    if (d < 0) assert.deepStrictEqual([W.G[i][j], W.G2[i][j]], [0, 0], 'the track: kind b');
    else assert.deepStrictEqual([W.G[i][j], W.G2[i][j]], [0, 1], 'the run-off and beyond: kind c, beside b');
  }
  assert(!W.props[onTall] && !W.props[onSmall] && !W.props[offHole], 'nothing on the track, no holes on the run-off');
  assert(W.props[offSmall], 'clutter on the run-off stays');
});

test('race contact: a wall you slide along, not stick to; rocks are circles', () => {
  // A wall along the line x + y = 0, the track on the side where x + y > 0.
  const s = Math.SQRT1_2, r = 14, tune = { restitution: 0.2, friction: 0.04, reach: 160 };
  const world = { rocks: () => [], blocked: (x, y, rr) => (x + y) * s < rr, normal: () => [s, s] };
  // A graze: flying along it, a little into it.
  const body = { x: 0, y: 0, vx: 400 * s + 40 * -s, vy: -400 * s + 40 * -s }, from = { x: 20, y: 20 };
  const hit = Contact.step(body, r, world, tune, from);
  assert(Math.abs(hit - 40) < 1e-6, `the hit is its speed into the wall: ${hit}`);
  const along = body.vx * s - body.vy * s, into = body.vx * s + body.vy * s;
  assert(along > 400 * 0.95, `keeps its speed along the wall: ${along}`);
  assert(into > 0 && into < 40 * 0.5, 'bounces off it, softly');
  const d = (body.x + body.y) * s;
  assert(d >= r && d < r + 1, `rests against the wall: ${d}`);
  // The game's own bounce, untouched: more lost along the wall.
  const game = { vx: 400 * s + 40 * -s, vy: -400 * s + 40 * -s };
  Collide.bounce(game, s, s);
  assert(game.vx * s - game.vy * s < along);
  // Head on: what's left is what bounced back.
  const head = { x: 0, y: 0, vx: -300 * s, vy: -300 * s };
  assert(Math.abs(Contact.step(head, r, world, tune, from) - 300) < 1e-6);
  assert(Math.abs(head.vx * s + head.vy * s - 300 * tune.restitution) < 1e-6);
  // Nowhere to go within reach: back where it was.
  const stuck = { x: -500, y: -500, vx: 10, vy: 0 };
  Contact.step(stuck, r, world, tune, from);
  assert.deepStrictEqual([stuck.x, stuck.y], [20, 20]);
  // A rock: pushed out to its edge.
  const rock = { x: 100, y: 100, r: 30 }, b2 = { x: 120, y: 100, vx: -200, vy: 0 };
  Contact.step(b2, r, { ...world, rocks: () => [rock] }, tune, from);
  assert(Math.abs(b2.x - (100 + 30 + r)) < 1e-9 && b2.vx > 0);
});

test('race input: a tap is short and still, a flick short and quick, anything else steers', () => {
  const g = RaceInput.gesture;
  assert.strictEqual(g({ dt: 0.12, dist: 2, moved: 3 }), 'tap');
  assert.strictEqual(g({ dt: 0.15, dist: 60, moved: 60 }), 'flick');
  assert.strictEqual(g({ dt: 0.6, dist: 2, moved: 3 }), null, 'held: not a tap');
  assert.strictEqual(g({ dt: 0.15, dist: 10, moved: 40 }), null, 'out and back: not a flick');
  assert.strictEqual(g({ dt: 0.5, dist: 80, moved: 80 }), null, 'a slow drag steers');
});

test('race view: on a portrait phone the ship stays above the stick\'s band, whichever way it flies', () => {
  const W = 390, H = 844, band = 0.28, zoom = 0.8, ct = Math.cos(0.6), { BOX } = RaceView;
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
    const lx = Math.cos(a) * 600, ly = Math.sin(a) * 600, f = RaceView.frame({ W, H, lx, ly, zoom, ct, band, reach: 0.3 });
    const sx = W / 2 - f.lx * zoom, sy = f.oy - f.ly * zoom * ct;
    assert(sy <= H * (1 - band) - BOX.gap + 1e-9 && sy >= H * BOX.top - 1e-9, `heading ${a.toFixed(2)}: the ship at ${sy.toFixed(0)} px`);
    assert(sx >= W * BOX.x[0] - 1e-9 && sx <= W * BOX.x[1] + 1e-9);
  }
  // Flying up the ship rests low, the screen ahead of it; flying down it rises.
  const up = RaceView.frame({ W, H, lx: 0, ly: -600, zoom, ct, band, reach: 0.3 }), down = RaceView.frame({ W, H, lx: 0, ly: 600, zoom, ct, band, reach: 0.3 });
  assert(up.oy - up.ly * zoom * ct > H * 0.6 && down.oy - down.ly * zoom * ct < H * 0.25);
  // A short lead isn't moved.
  assert.deepStrictEqual(RaceView.frame({ W, H, lx: 20, ly: -30, zoom, ct, band, reach: 0.3 }).lx, 20);
  // No band: the lead held to reach of the shorter side, as before.
  const f = RaceView.frame({ W, H, lx: 0, ly: -600, zoom, ct, band: 0, reach: 0.3 });
  assert(Math.abs(Math.hypot(f.lx, f.ly) * zoom - 0.3 * W) < 1e-9 && f.oy === H * 0.55);
});

test('race maneuvers: the brake, a boost, a sidestep, an airbrake, charges, and a hop', () => {
  // Flat open ground (no walls), flown at full speed into the race from the start.
  const { N } = RaceConfig, tr = Track.loop(1, RaceConfig.TRACK), grid = (v) => Array.from({ length: N + 1 }, () => new Array(N + 1).fill(v));
  const G = { W: { w: N, h: N, C: grid(0), G: grid(0.5), G2: grid(0.5), props: {} }, tr };
  const cfg = { stats: RaceConfig.STATS, ship: RaceConfig.SHIP, hull: 100, r: RaceConfig.R_SHIP, laps: 3, mode: 'cruise', steer: 'pad', assist: true, cam: { lead: 0.6, pull: 0, track: 0.6, wide: 1, tight: 1 } };
  const top = cfg.stats.maxSpeed, speed = (R) => Math.hypot(R.craft.vx, R.craft.vy);
  // Steered along the track, as a player would.
  const run = (R, ctl, s) => { for (let t = 0; t < s; t += Run.STEP) { const p = tr.pts[Track.ahead(tr, R.n, 150)]; ctl.angle = Math.atan2(p.ty, p.tx); Run.step(R, G, cfg, ctl); } };
  const fresh = () => {
    const R = Run.create(G, cfg), ctl = { angle: R.craft.angle, speed: 1, brake: false, events: [] };
    ctl.events.push({ type: 'flick' }); // during the countdown: ignored
    run(R, ctl, 3 + 1.5);
    assert(R.phase === 'race' && Math.abs(speed(R) - top) < 1 && R.dash.charges === Run.DASH.charges && !ctl.events.length);
    return [R, ctl];
  };
  let [R, ctl] = fresh();
  ctl.brake = true; run(R, ctl, 1);
  assert(Math.abs(speed(R) - top * Run.BRAKE.speed) < 5, `braked to ${speed(R)}`);

  [R, ctl] = fresh();
  ctl.events.push({ type: 'flick', angle: R.craft.angle + 0.1 });
  run(R, ctl, Run.STEP);
  assert(Math.abs(speed(R) - top * Run.DASH.boost) < 1 && R.dash.kind === 'boost' && R.dash.charges === 1 && R.fx.includes('boost'), 'a boost');
  run(R, ctl, 0.3);
  assert(speed(R) > top * 1.2, 'still fast after the burst');
  run(R, ctl, 1);
  assert(speed(R) <= top + 1, `eased back down: ${speed(R)}`);

  [R, ctl] = fresh();
  const v0 = [R.craft.vx, R.craft.vy], way = Math.atan2(v0[1], v0[0]);
  ctl.events.push({ type: 'flick', rel: Math.PI / 2 });
  run(R, ctl, Run.STEP);
  const across = -R.craft.vx * Math.sin(way) + R.craft.vy * Math.cos(way);
  assert(R.dash.kind === 'side' && Math.abs(across - top * Run.DASH.side) < 1, `a sidestep to the right of the way: ${across}`);
  run(R, ctl, Run.DASH.sideTime);
  assert(Math.hypot(R.craft.vx - v0[0], R.craft.vy - v0[1]) < 20, 'the velocity it had, given back');
  ctl.events.push({ type: 'flick', rel: Math.PI });
  run(R, ctl, Run.STEP);
  assert(R.dash.kind === 'airbrake' && Math.abs(speed(R) - top * Run.DASH.air) < 5 && R.dash.charges === 0, `an airbrake: ${speed(R)}`);
  const before = speed(R);
  ctl.events.push({ type: 'flick' });
  run(R, ctl, Run.STEP);
  assert(R.dash.kind === 'airbrake' && speed(R) > before, 'no charge left: nothing');
  run(R, ctl, Run.DASH.refill);
  assert(R.dash.charges === 1 && R.fx.includes('charge'), 'a charge back');

  [R, ctl] = fresh();
  ctl.events.push({ type: 'tap' });
  run(R, ctl, Run.HOP.time / 2);
  assert(R.air > Run.HOP.h * 0.9 && R.fx.includes('hop'), `up: ${R.air}`);
  R.fx.length = 0; ctl.events.push({ type: 'tap' });
  run(R, ctl, Run.HOP.time / 2 + Run.STEP * 2);
  assert(R.air === 0 && R.fx.includes('land') && !R.fx.includes('hop'), 'down again, no hop in the air');
  ctl.events.push({ type: 'tap' });
  run(R, ctl, Run.STEP);
  assert(R.air === 0, 'a moment on the ground before the next');
  run(R, ctl, Run.HOP.cool);
  ctl.events.push({ type: 'tap' });
  run(R, ctl, 0.1);
  assert(R.air > 0, 'then it hops again');
});

test('race handling: the grip bounds the turn, the engine holds speed, the brake only slows, the slide comes and goes', () => {
  const stats = RaceConfig.STATS, { GRIP, BRAKE, SLIDE } = Handling.config, top = stats.maxSpeed, a = stats.accel, dt = Run.STEP;
  const fresh = (angle = 0) => [{ x: 0, y: 0, vx: top, vy: 0, angle, thrust: 1 }, { slip: 0, sliding: false }];
  const way = (b) => Math.atan2(b.vy, b.vx), speed = (b) => Math.hypot(b.vx, b.vy);
  // Nose held square to the way at full speed: the velocity swings round no faster than the grip lets it.
  let [b, st] = fresh(), slid = false;
  for (let t = 0; t < 0.6; t += dt) {
    const w0 = way(b), v = speed(b);
    Handling.step(b, stats, { targetAngle: Math.PI / 2, targetSpeed: top }, st, dt);
    assert(Math.abs(way(b) - w0) <= (GRIP * a / v) * dt * 1.001 + 1e-9, `turned ${(way(b) - w0) / dt} rad/s at ${v}`);
    slid ||= st.sliding;
  }
  assert(slid, 'the nose swung past SLIDE.on: a slide');
  // Pointed back along the way, the grip comes back only once the slip is under SLIDE.off.
  for (let t = 0; t < 2 && st.sliding; t += dt) {
    Handling.step(b, stats, { targetAngle: way(b), targetSpeed: top }, st, dt);
    if (st.sliding) assert(st.slip > SLIDE.off - 1e-9);
  }
  assert(!st.sliding && st.slip <= SLIDE.off);
  // A nose a little off the way (no slide): the engine holds top speed, steering doesn't brake.
  [b, st] = fresh(0.3);
  for (let t = 0; t < 1; t += dt) Handling.step(b, stats, { targetAngle: 0.3, targetSpeed: top }, st, dt);
  assert(!st.sliding && Math.abs(speed(b) - top) < 1, `held at ${speed(b)}`);
  // Lifting slows at LIFT × the acceleration, braking at BRAKE ×, and the brake turns no tighter.
  [b, st] = fresh();
  Handling.step(b, stats, { targetAngle: 0, targetSpeed: top * 0.35, brake: true }, st, 0.1);
  assert(Math.abs(top - speed(b) - BRAKE * a * 0.1) < 1e-6, `braked by ${top - speed(b)}`);
  [b, st] = fresh();
  for (let t = 0; t < 0.4; t += dt) {
    const w0 = way(b);
    Handling.step(b, stats, { targetAngle: Math.PI / 2, targetSpeed: top * 0.35, brake: true }, st, dt);
    assert(Math.abs(way(b) - w0) <= (GRIP * a / speed(b)) * dt * 1.001 + 1e-9, 'no tighter for braking'); // at the speed it slowed to
  }
});

test('race drift: a slide held at speed charges a level, the grip back gives a boost', () => {
  // Open ground, as if all of it were track (the run-off would lose the charge).
  const { N } = RaceConfig, tr = Track.loop(1, RaceConfig.TRACK), grid = (v) => Array.from({ length: N + 1 }, () => new Array(N + 1).fill(v));
  const G = { W: { w: N, h: N, C: grid(0), G: grid(0.5), G2: grid(0.5), props: {} }, tr };
  const cfg = { stats: RaceConfig.STATS, ship: RaceConfig.SHIP, hull: 100, r: RaceConfig.R_SHIP, laps: 3, mode: 'cruise', steer: 'pad', assist: false, cam: { lead: 0.6, pull: 0, track: 0.6, wide: 1, tight: 1 } };
  const top = cfg.stats.maxSpeed, speed = (R) => Math.hypot(R.craft.vx, R.craft.vy), fx = [];
  const R = Run.create(G, cfg), ctl = { angle: R.craft.angle, speed: 1, brake: false, events: [] };
  const run = (s, aim) => { for (let t = 0; t < s; t += Run.STEP) { ctl.angle = aim(); Run.step(R, G, cfg, ctl); R.off = 0; fx.push(...R.fx); R.fx.length = 0; } };
  run(3 + 1.5, () => R.craft.angle);
  assert(R.phase === 'race' && Math.abs(speed(R) - top) < 1 && !R.grip.sliding);
  // The nose thrown 1.2 rad off the way and held there: a slide, charged to the first level.
  run(Run.DRIFT.at[0] + 0.15, () => Math.atan2(R.craft.vy, R.craft.vx) + 1.2);
  assert(R.grip.sliding && R.drift.level === 1 && fx.includes('slide') && fx.includes('drift1'), `level ${R.drift.level} after ${R.drift.t}s`);
  // Straightened out: the grip back, a boost over top speed, held a moment, then eased back down.
  run(0.6, () => Math.atan2(R.craft.vy, R.craft.vx));
  assert(!R.grip.sliding && fx.includes('driftBoost') && R.drift.level === 0, 'released');
  const i = fx.indexOf('driftBoost');
  assert(i >= 0 && R.drift.k === Run.DRIFT.boost[0]);
  run(1.5, () => Math.atan2(R.craft.vy, R.craft.vx));
  assert(Math.abs(speed(R) - top) < 2, `back to top speed: ${speed(R)}`);
  // A short slide charges nothing and gives nothing.
  fx.length = 0;
  run(0.25, () => Math.atan2(R.craft.vy, R.craft.vx) + 1.2);
  run(0.6, () => Math.atan2(R.craft.vy, R.craft.vx));
  assert(fx.includes('slide') && !fx.includes('driftBoost'));
});

test('race dust: a cloud in the run-off\'s colour off the track, a trail in the track\'s sliding, none at rest; every biome has its colours', () => {
  const top = 500, cols = { off: 'rgb(1,1,1)', track: 'rgb(2,2,2)' }, c = { x: 0, y: 0, vx: top, vy: 0, angle: 0 };
  const run = (D, o, s, craft = c) => { for (let t = 0; t < s; t += 1 / 60) Dust.step(D, craft, { speed: top, ...o }, cols, 1 / 60); };
  let D = Dust.create();
  run(D, { off: 1 }, 0.5);
  assert(D.puffs.length > 10 && D.puffs.every((p) => p.col === cols.off), `${D.puffs.length} puffs, in the run-off's colour`);
  D = Dust.create();
  run(D, { off: 0, slide: true }, 0.5);
  assert(D.puffs.length > 5 && D.puffs.every((p) => p.col === cols.track));
  run(D, { off: 0 }, 1.5);
  assert.strictEqual(D.puffs.length, 0, 'gone once it settles');
  D = Dust.create();
  run(D, { off: 1 }, 1, { ...c, vx: 0 });
  assert.strictEqual(D.puffs.length, 0, 'none at rest');
  for (const [biome, type] of [['desert', 'desert'], ['ice', 'ice'], ['lava', 'lava'], ['terran', 'terran'], ['moon', 'moon-grey'], ['gas', 'gas']]) {
    const k = Dust.colours(type, RaceConfig.KINDS[biome]);
    assert(/^rgb\(\d+,\d+,\d+\)$/.test(k.off) && /^rgb\(\d+,\d+,\d+\)$/.test(k.track), biome);
  }
});

test('race pilot: on regular tracks braking for the tight corners beats flying them flat out', () => {
  let gain = 0, faster = 0, wide = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const flat = Pilot.lap(seed, RaceConfig.TRACK, { brake: false }), brake = Pilot.lap(seed, RaceConfig.TRACK);
    assert(flat.laps.length === 1 && brake.laps.length === 1);
    assert(brake.hits === 0 && brake.brakes >= 1, `seed ${seed}: the braking pilot brakes and stays off the walls`);
    gain += flat.laps[0] - brake.laps[0];
    if (flat.laps[0] - brake.laps[0] > 0.2) faster++;
    if (flat.off > 0.5 || flat.hits) wide++;
  }
  assert(faster >= 3 && gain > 2, `braking faster on ${faster} of 6, ${gain.toFixed(2)} s in all`);
  assert(wide >= 3, `flat out runs wide on ${wide} of 6`);
});

test('race biomes: terran is the standard, every number as it is without a biome', () => {
  for (const style of ['regular', 'advanced', 'expert']) assert.deepStrictEqual(RaceConfig.map(style, 'terran'), RaceConfig.map(style), style);
  assert.deepStrictEqual(RaceConfig.stats(undefined, 'terran'), RaceConfig.STATS);
  const tr = Track.loop(3, RaceConfig.map('regular', 'terran').TRACK), base = Track.loop(3, RaceConfig.TRACK);
  assert.deepStrictEqual(tr.pts, base.pts, 'the same track');
  const G = { W: {}, tr }, cfg = { stats: RaceConfig.STATS, ship: RaceConfig.SHIP, hull: 100, r: RaceConfig.R_SHIP, laps: 1, mode: 'cruise', steer: 'pad', assist: true, cam: {} };
  assert.deepStrictEqual(Run.create(G, { ...cfg, biome: RaceConfig.biome('terran') }).tune, Run.create(G, cfg).tune, 'the same handling, run-off, walls and hop');
  for (const id of Object.keys(RaceConfig.BIOME)) assert(RaceConfig.KINDS[id], `${id} has its ground kinds`);
});

test('race biomes: each its own handling, track and run-off, and every one drivable', () => {
  const G = { W: {}, tr: Track.loop(1, RaceConfig.TRACK) }, base = { ship: RaceConfig.SHIP, hull: 100, r: RaceConfig.R_SHIP, laps: 1, mode: 'cruise', steer: 'pad', assist: true, cam: {} };
  const tune = (id) => Run.create(G, { ...base, stats: RaceConfig.stats(undefined, id), biome: RaceConfig.biome(id) }).tune;
  const T = Object.fromEntries(Object.keys(RaceConfig.BIOME).map((id) => [id, tune(id)]));
  // Ice: the nose held square, the velocity swings round slower than on terran.
  const swing = (id) => {
    const stats = RaceConfig.stats(undefined, id), b = { x: 0, y: 0, vx: stats.maxSpeed, vy: 0, angle: 0, thrust: 1 }, st = { slip: 0, sliding: false };
    for (let t = 0; t < 0.3; t += Run.STEP) Handling.step(b, stats, { targetAngle: Math.PI / 2, targetSpeed: stats.maxSpeed }, st, Run.STEP, T[id].handling);
    return Math.atan2(b.vy, b.vx);
  };
  assert(swing('ice') < 0.8 * swing('terran'), `ice turns ${swing('ice').toFixed(2)} rad to terran's ${swing('terran').toFixed(2)}`);
  assert(T.desert.off.speed > T.terran.off.speed && T.ice.off.speed < T.terran.off.speed, 'deep sand slows more, ice less');
  assert(T.lava.wall.damage > 1 && T.gas.wall.damage < 1 && T.ice.wall.friction < T.terran.wall.friction, 'lava walls hurt, storm fronts are soft, ice walls slip');
  assert(T.moon.hop.time > T.terran.hop.time && T.moon.hop.h > T.terran.hop.h, 'the moon hops long and high');
  // The tracks: lava's narrower and tighter than ice's.
  const tight = { ice: 0, lava: 0 }, hw = {};
  for (const id of ['ice', 'lava']) {
    const o = RaceConfig.map('regular', id).TRACK;
    hw[id] = o.hw;
    for (let seed = 1; seed <= 12; seed++) tight[id] += Track.loop(seed, o).corners.filter((c) => ['square', 'hairpin', 'decreasing', 'chicane'].includes(c.type)).length;
  }
  assert(hw.lava < RaceConfig.HW && hw.ice > RaceConfig.HW, 'lava narrow, ice wide');
  assert(tight.lava > 1.3 * tight.ice, `tight corners: lava ${tight.lava}, ice ${tight.ice}`);
  // Every biome flown round by the braking pilot.
  for (const id of Object.keys(RaceConfig.BIOME)) for (let seed = 1; seed <= 2; seed++) {
    const r = Pilot.lap(seed, RaceConfig.map('regular', id).TRACK, { biome: id });
    assert(r.laps.length === 1 && r.hull < 50, `${id} seed ${seed}: a lap, ${r.hull.toFixed(0)} hull dented`);
  }
});

test('race biomes: desert, moon and gas lay out their own loops, not the terran loop for the same seed', () => {
  const loop = (id, seed, style = 'regular') => Track.loop(seed, RaceConfig.map(style, id).TRACK);
  const box = (tr) => { const xs = tr.pts.map((p) => p.x), ys = tr.pts.map((p) => p.y); return (Math.max(...xs) - Math.min(...xs)) / (Math.max(...ys) - Math.min(...ys)); };
  const corners = (tr) => tr.corners.filter((c) => c.type !== 'chicane' && c.type !== 'esses').length;
  const shape = { desert: { w: 0, k: 0 }, moon: { w: 0, k: 0 }, terran: { w: 0, k: 0 } };
  for (let seed = 1; seed <= 6; seed++) {
    const T = Object.fromEntries(['terran', 'desert', 'moon', 'gas'].map((id) => [id, loop(id, seed)]));
    for (const id of ['desert', 'moon', 'gas']) assert.notDeepStrictEqual(T[id].pts.slice(0, 40).map((p) => Math.round(p.x)), T.terran.pts.slice(0, 40).map((p) => Math.round(p.x)), `${id} seed ${seed}`);
    for (const id of Object.keys(shape)) { shape[id].w += box(T[id]); shape[id].k += corners(T[id]); }
    assert.notDeepStrictEqual(loop('desert', seed, 'advanced').pts.slice(0, 40).map((p) => Math.round(p.x)), loop('terran', seed, 'advanced').pts.slice(0, 40).map((p) => Math.round(p.x)), `advanced desert seed ${seed}`);
  }
  assert(shape.desert.w < shape.terran.w && shape.desert.k < shape.terran.k, `desert stretched with fewer corners: ${shape.desert.w.toFixed(2)}, ${shape.desert.k} to ${shape.terran.w.toFixed(2)}, ${shape.terran.k}`);
  assert(shape.moon.w > shape.terran.w && shape.moon.k > shape.terran.k, `the moon round with more bends: ${shape.moon.w.toFixed(2)}, ${shape.moon.k} to ${shape.terran.w.toFixed(2)}, ${shape.terran.k}`);
});

test("race career: the pilot's seed drawn once and kept, the hulls bought and flown", () => {
  const seeds = [() => 0, () => 0.5, () => 0.999999].map((rnd) => Career.roll(rnd));
  assert(seeds.every((n) => Number.isInteger(n) && n >= 1 && n <= Career.SEEDS), `seeds ${seeds}`);
  assert.strictEqual(Career.empty(7).seed, 7);
  const old = Career.empty(); delete old.seed; delete old.ships; delete old.ship; old.credits = 50;
  const c = Career.from(old);
  assert(Number.isInteger(c.seed) && c.seed >= 1, 'a career from before the seed: a new one');
  assert.strictEqual(c.credits, 50);
  assert.deepStrictEqual([c.ships, c.ship], [[Career.STOCK], Career.STOCK], 'a career from before the hulls: the stock one');
  assert.strictEqual(Career.from(JSON.parse(JSON.stringify(c))).seed, c.seed, 'kept');
  for (const S of Object.values(Career.SHIPS)) {
    const v = Career.value(S.fx);
    assert(v.gain >= Career.RATIO * v.cost, `${S.id}: gains ${v.gain.toFixed(3)} against costs ${v.cost.toFixed(3)}`);
  }
  const k = Career.empty(1);
  assert(!Career.buyShip(k, 'fighter'), 'nothing to pay with');
  k.credits = 1e5; for (const p of Career.PARTS) k.parts[p] = 100;
  assert(!Career.buyShip(k, 'fighter-heavy'), 'the fighter first');
  assert(!Career.fly(k, 'fighter'), 'not bought');
  assert(Career.buyShip(k, 'fighter') && Career.buyShip(k, 'fighter-heavy'));
  assert.strictEqual(k.credits, 1e5 - 1500 - 5000);
  assert(!Career.buyShip(k, 'fighter'), 'once');
  assert(Career.fly(k, 'fighter-heavy') && k.ship === 'fighter-heavy');
  assert(Career.tune([], 'fighter-heavy').hull > Career.tune([]).hull, 'the hull counts in the tune');
});

test('race line: inside the track, on the inside at the apexes, and faster than the centreline', () => {
  for (const style of ['regular', 'expert']) for (let seed = 1; seed <= 3; seed++) {
    const tr = Track.loop(seed, RaceConfig.map(style).TRACK), o = { stats: RaceConfig.STATS, handling: Handling.config, r: RaceConfig.R_SHIP };
    const L = Line.build(tr, o), lim = Line.lim(tr, Line.MARGIN * o.r), centre = Line.ride(tr, new Float64Array(tr.samples), o.stats, o.handling);
    assert(L.off.every((v, n) => Math.abs(v) <= lim[n] + 1e-9), `${style} ${seed}: within the track`);
    assert(L.time < 0.97 * centre.time, `${style} ${seed}: ${L.time.toFixed(2)} s on the line, ${centre.time.toFixed(2)} s on the centreline`);
    const bends = tr.corners.filter((c) => c.r < 2.5 * tr.pts[c.apex].hw), inside = bends.filter((c) => L.off[c.apex] * c.side > 0);
    assert(inside.length >= 0.8 * bends.length, `${style} ${seed}: inside at ${inside.length} of ${bends.length} tight apexes`);
    assert(L.v.every((v) => v > 0 && v <= o.stats.maxSpeed), 'speeds up to top speed');
  }
  const a = Line.build(Track.loop(2, RaceConfig.TRACK), { stats: RaceConfig.STATS, handling: Handling.config, r: RaceConfig.R_SHIP });
  const b = Line.build(Track.loop(2, RaceConfig.TRACK), { stats: RaceConfig.STATS, handling: Handling.config, r: RaceConfig.R_SHIP });
  assert.deepStrictEqual(a.off, b.off, 'the same line every time');
});

test('race rivals: one from each culture but yours, none faster than your craft, the slowest ahead of you on the grid', () => {
  for (const level of Object.keys(Rival.LEVELS)) {
    const F = Rival.field(4, level), L = Rival.LEVELS[level];
    assert.deepStrictEqual(F.map((w) => w.id).sort(), ['alien', 'block', 'drifter', 'shard', 'wedge'], level);
    assert(!F.some((w) => w.id === 'android'), 'android is yours');
    assert(F.every((w) => w.boss || (w.pace >= L.pace[0] && w.pace <= L.pace[1])), `${level}: paces in the band`);
    assert.deepStrictEqual(F.map((w) => w.slot).sort(), [0, 1, 2, 4, 5], 'slot 3 is yours');
    const ahead = F.filter((w) => w.slot < Rival.PLAYER && !w.boss), behind = F.filter((w) => w.slot > Rival.PLAYER);
    assert(ahead.every((a) => behind.every((b) => a.pace <= b.pace)), `${level}: the slower ones start ahead of you`);
  }
  assert.strictEqual(Rival.field(4, 'expert').find((w) => w.slot === 0).id, 'shard', 'the expert boss is on pole');
  assert.deepStrictEqual(Rival.field(9, 'advanced'), Rival.field(9, 'advanced'), 'the same field for the same seed');
  const { G, cfg, run } = Pilot.flat(1, RaceConfig.TRACK, { laps: 1 }), probe = run();
  const P = Rival.pack(G, cfg, Line.build(G.tr, { stats: cfg.stats, handling: probe.tune.handling, r: cfg.r }), 'expert', 1, run);
  for (const X of P.racers) {
    assert(X.cfg.stats.maxSpeed <= cfg.stats.maxSpeed && X.cfg.stats.accel <= cfg.stats.accel, `${X.who.id}: no more top speed or grip than yours`);
    assert(X.R.tune.handling.GRIP <= probe.tune.handling.GRIP, `${X.who.id}: no more grip`);
  }
});

test('race rivals: they race clean, the same race from the same seed, the levels in order, the expert boss ahead', () => {
  const avg = {};
  for (const level of Object.keys(Rival.LEVELS)) for (let seed = 1; seed <= 2; seed++) {
    const res = Rival.race(seed, RaceConfig.TRACK, { level });
    assert(res.every((r) => r.time !== null && r.laps.length === 3), `${level} ${seed}: every rival finishes`);
    assert(res.reduce((n, r) => n + r.hits, 0) <= 3, `${level} ${seed}: ${res.reduce((n, r) => n + r.hits, 0)} hard hits`);
    avg[level] = (avg[level] || 0) + res.reduce((t, r) => t + r.time, 0);
    if (level === 'expert') assert.strictEqual(res.reduce((a, b) => (b.time < a.time ? b : a)).id, 'shard', `seed ${seed}: the boss wins`);
  }
  assert(avg.regular > 1.04 * avg.advanced && avg.advanced > 1.01 * avg.expert, `regular ${avg.regular.toFixed(0)}, advanced ${avg.advanced.toFixed(0)}, expert ${avg.expert.toFixed(0)} s`);
  assert.deepStrictEqual(Rival.race(3, RaceConfig.TRACK, { level: 'regular', laps: 1 }), Rival.race(3, RaceConfig.TRACK, { level: 'regular', laps: 1 }), 'the same race');
});

test('race rivals: the standings, the finished first by time; ships knock apart without damage', () => {
  const { G, cfg, run } = Pilot.flat(1, RaceConfig.TRACK, { laps: 1 }), probe = run();
  const P = Rival.pack(G, cfg, Line.build(G.tr, { stats: cfg.stats, handling: probe.tune.handling, r: cfg.r }), 'regular', 1, run);
  const R = run({ ...cfg, grid: Rival.grid(Rival.PLAYER, G.tr.pts[0].hw) });
  let st = Rival.standings(P, G, R);
  assert.strictEqual(st.of, 6);
  assert.strictEqual(st.place, Rival.PLAYER + 1, 'you start where your slot is');
  P.racers[4].ai.finish = 50; R.phase = 'done'; R.total = 40;
  st = Rival.standings(P, G, R);
  assert.strictEqual(st.rows[0].id, 'you'); assert.strictEqual(st.rows[1].id, P.racers[4].who.id); assert.strictEqual(st.place, 1);
  // Two ships overlapping, closing: pushed apart, the closing speed traded, felt, the hulls whole.
  const A = run(), B = run(), hull = A.hull;
  Object.assign(A.craft, { x: 0, y: 0, vx: 200, vy: 0 }); Object.assign(B.craft, { x: cfg.r, y: 0, vx: 0, vy: 0 });
  Rival.ships([A, B], cfg.r);
  assert(Math.abs(B.craft.x - A.craft.x - 2 * cfg.r) < 1e-6, 'apart');
  assert(B.craft.vx > 0 && A.craft.vx < 200 && A.craft.vx + B.craft.vx === 200, 'the speed traded');
  assert(A.fx.includes('bump') && B.fx.includes('bump'), 'felt');
  B.air = 30; Object.assign(B.craft, { x: A.craft.x });
  Rival.ships([A, B], cfg.r);
  assert.strictEqual(B.craft.x, A.craft.x, 'one in the air passes over');
  assert.strictEqual(A.hull, hull, 'no damage');
});

test('race rivals: risk, how much contact each seeks, by culture and scaled by the level', () => {
  const C = Rival.CULTURES;
  assert(C.shard.risk < C.wedge.risk && C.wedge.risk < C.alien.risk && C.alien.risk < C.block.risk && C.block.risk < C.drifter.risk, 'Shard the cleanest, the Drifters the roughest');
  assert(Rival.LEVELS.regular.risk > Rival.LEVELS.advanced.risk && Rival.LEVELS.advanced.risk > Rival.LEVELS.expert.risk, 'messier at regular, cleaner at expert');
  const struck = {}, level = {};
  for (const lv of ['regular', 'expert']) for (let seed = 1; seed <= 4; seed++) for (const r of Rival.race(seed, RaceConfig.TRACK, { level: lv })) {
    struck[r.id] = (struck[r.id] || 0) + r.struck; level[lv] = (level[lv] || 0) + r.knocks;
  }
  assert(struck.shard + struck.wedge < struck.block + struck.drifter, `careful ${struck.shard} + ${struck.wedge}, bold ${struck.block} + ${struck.drifter} knocks caused`);
  assert(struck.drifter >= Math.max(struck.shard, struck.wedge, struck.alien), `the Drifters knock the most: ${JSON.stringify(struck)}`);
  assert(level.regular > level.expert, `knocks: regular ${level.regular}, expert ${level.expert}`);
});

test('race career: every choice is a trade worth more than it costs, two to a tier, three tiers a tree', () => {
  const P = Object.values(Career.PACKAGES);
  assert.strictEqual(P.length, Career.TREES.length * 3 * 2);
  for (const p of P) {
    const v = Career.value(p.fx);
    assert(v.gain > 0 && v.cost > 0, `${p.id}: a gain and a cost`);
    assert(v.gain >= Career.RATIO * v.cost, `${p.id}: gains ${v.gain.toFixed(3)} against costs ${v.cost.toFixed(3)}`);
    assert(Object.keys(p.fx).every((k) => Career.FX[k]), `${p.id}: known effects`);
    assert.strictEqual(P.filter((q) => q.fork === p.fork).length, 2, `${p.id}: one of two`);
    assert(p.requires.flat().every((r) => Career.PACKAGES[r].tier === p.tier - 1 && Career.PACKAGES[r].cat === p.cat), `${p.id}: needs the tier before, in its tree`);
    const part = Career.TREES.find((t) => t.id === p.cat).part;
    assert(p.cost.credits > 0 && p.cost[part] > 0, `${p.id}: credits and its tree's part`);
  }
  assert.deepStrictEqual([...Career.PARTS].sort(), [...new Set(Career.TREES.map((t) => t.part))].sort(), 'a part a tree');
  const keys = new Set(P.flatMap((p) => Object.keys(p.fx)));
  for (const k of ['hull', 'speed', 'accel', 'turn', 'driftBoost', 'dashTime', 'charges', 'bumpPower', 'bumpRecoil']) assert(keys.has(k), `${k} is in a tree`);
});

test('race career: the tune is stock with nothing done, and every build stays within its clamps', () => {
  const t0 = Career.tune([]);
  const ones = (o) => Object.values(o).every((v) => v === 1);
  assert(ones(t0.stats) && ones(t0.handling) && ones(t0.drift) && ones(t0.wall) && ones(t0.bump) && t0.hull === 1 && t0.dash.charges === 0);
  const paths = (tree) => ['a', 'b'].flatMap((x) => ['a', 'b'].flatMap((y) => ['a', 'b'].map((z) => [`${tree}.1${x}`, `${tree}.2${y}`, `${tree}.3${z}`])));
  const [d, h, s, c] = Career.TREES.map((t) => paths(t.id));
  let n = 0;
  for (const a of d) for (const b of h) for (const e of s) for (const f of c) {
    const t = Career.tune([...a, ...b, ...e, ...f]); n++;
    const all = [...Object.values(t.stats), ...Object.values(t.handling), ...Object.values(t.drift), t.hull, ...Object.values(t.wall), ...Object.values(t.bump), t.dash.refill, t.dash.boostTime, t.dash.boost, t.dash.side];
    assert(all.every((v) => v >= Career.CLAMP[0] && v <= Career.CLAMP[1]), 'within the clamps');
    assert(t.dash.charges >= 0 && t.dash.charges <= 2);
  }
  assert.strictEqual(n, 8 ** 4);
  const st = { ...RaceConfig.STATS }, out = Career.stats(st, Career.tune(['drive.1a']));
  assert(Math.abs(out.maxSpeed / st.maxSpeed - 1.06) < 1e-9 && Math.abs(out.accel / st.accel - 0.98) < 1e-9);
  assert.deepStrictEqual(st, RaceConfig.STATS, 'the stock stats untouched');
});

test('race career: paid when queued, the fork closed, built on the real clock (offline too), stripped back for a fee', () => {
  const c = Career.empty();
  assert(!Career.buy(c, 'drive.1a', 0), 'nothing to pay with');
  c.credits = 5000; c.parts.coil = 20;
  assert(Career.buy(c, 'drive.1a', 0));
  assert.strictEqual(c.credits, 5000 - 300); assert.strictEqual(c.parts.coil, 18);
  assert.strictEqual(Career.status(c, 'drive.1b').state, 'closed');
  assert(Career.buy(c, 'drive.2b', 0), 'the next tier queues behind it');
  // Saved, and loaded an hour later: both built while the game was closed.
  const later = Career.from(JSON.parse(JSON.stringify(c)), Career.lab.timeOf('drive.1a') + Career.lab.timeOf('drive.2b') + 1);
  assert.deepStrictEqual(later.lab.done, ['drive.1a', 'drive.2b']);
  assert.strictEqual(later.lab.active, null);
  const before = later.credits;
  assert(Career.respec(later, 'drive', 0));
  assert.deepStrictEqual(later.lab.done, []);
  assert.strictEqual(later.credits, before - 2 * Career.RESPEC, 'the fee: per tier done');
  assert.strictEqual(later.parts.coil, 13 + 1 + 2, 'half the parts back');
  assert.strictEqual(Career.status(later, 'drive.1b').state, 'available', 'both choices open again');
  // Cancelling: all back while queued, half while building.
  const k = Career.empty(); k.credits = 2000; k.parts.vane = 20;
  Career.buy(k, 'handling.1b', 0); Career.buy(k, 'handling.2a', 0);
  Career.cancel(k, 'handling.1b', 1);
  assert.strictEqual(k.credits, 2000 - 150, 'half of the one building back, all of the one queued on it');
  assert.deepStrictEqual(Career.from(null).lab, Career.lab.empty(), 'no save: a new career');
  assert.deepStrictEqual(Career.from({ credits: 9, lab: { done: ['gone.1a', 'dash.1a'], queue: [], active: null } }).lab.done, ['dash.1a'], 'what a table no longer has is dropped');
});

test('race career: the haul banked at the finish, more for placing, half for a wreck', () => {
  const haul = { credits: 100, parts: { coil: 2, cell: 1 } };
  let c = Career.empty(), b = Career.bank(c, haul, { place: 1, level: 'regular' });
  assert.deepStrictEqual(b, { mult: 1.5, purse: Career.PURSE.regular, credits: 150 + Career.PURSE.regular, parts: { coil: 3, cell: 2 } });
  assert.strictEqual(c.credits, b.credits); assert.strictEqual(c.parts.coil, 3);
  c = Career.empty(); b = Career.bank(c, haul, { place: 3, level: 'expert' });
  assert.strictEqual(b.mult, 1.25); assert.strictEqual(b.purse, Career.PURSE.expert);
  c = Career.empty(); b = Career.bank(c, haul, { place: 5 });
  assert.strictEqual(b.mult, 1);
  c = Career.empty(); b = Career.bank(c, haul, { wreck: true });
  assert.deepStrictEqual(b, { mult: 0.5, purse: 0, credits: 50, parts: { coil: 1, cell: 0 } });
});

test('race pickups: the same for a seed, on the track, chips on the line, crates across from it', () => {
  for (const style of ['regular', 'expert']) for (let seed = 1; seed <= 3; seed++) {
    const tr = Track.loop(seed, RaceConfig.map(style).TRACK), L = Line.build(tr, { stats: RaceConfig.STATS, handling: Handling.config, r: RaceConfig.R_SHIP });
    const P = Pickups.place(tr, L, seed, 'lava');
    assert.deepStrictEqual(P, Pickups.place(tr, L, seed, 'lava'), 'the same every time');
    assert.strictEqual(new Set(P.map((p) => p.id)).size, P.length, 'ids unique');
    for (const p of P) assert(Track.edgeDist(tr, p.x, p.y).d + p.r <= 1e-6, `${style} ${seed} ${p.id}: on the track`);
    const crates = P.filter((p) => p.kind !== 'chip'), chips = P.filter((p) => p.kind === 'chip');
    assert.strictEqual(crates.length, Pickups.CRATES + 1); assert.strictEqual(crates.filter((p) => p.kind === 'rare').length, 1);
    assert(chips.length >= 15, `${chips.length} chips`);
    const fromLine = (p) => Math.hypot(p.x - L.x[p.n], p.y - L.y[p.n]);
    assert(chips.every((p) => fromLine(p) < 1e-6), 'chips on the line');
    assert(crates.every((p) => fromLine(p) > 2 * RaceConfig.R_SHIP), 'crates off it');
    assert(crates.every((p) => Career.PARTS.includes(p.part)));
  }
});

test('race storm: lightning only on the gas giant, called ahead, striking only those under it once it lands', () => {
  assert(RaceConfig.biome('gas').storm && !RaceConfig.biome('terran').storm, 'the gas giant has lightning; terran none');
  const { G, cfg, run } = Pilot.flat(1, RaceConfig.TRACK, { laps: 1 }), cs = RaceConfig.biome('gas').storm;
  const A = run(cfg), B = run(cfg), st = Storm.create(cs, 3);
  for (let t = 0; t < cs.every[1] + 0.1; t += Run.STEP) Storm.step(st, G, [A, B], Run.STEP);
  assert.strictEqual(st.strikes.length, 0, 'none in the countdown');
  A.phase = B.phase = 'race';
  for (let t = 0; t < cs.every[1] + 0.1 && !st.strikes.length; t += Run.STEP) Storm.step(st, G, [A, B], Run.STEP);
  const s = st.strikes[0];
  assert(s && s.t > 0, 'called, with a warning first');
  assert(Track.edgeDist(G.tr, s.x, s.y).d <= 0, 'on the track');
  st.wait = Infinity;
  Object.assign(A.craft, { x: s.x, y: s.y, vx: 300, vy: 0 }); Object.assign(B.craft, { x: s.x + 5 * s.r, y: s.y });
  const hull = [A.hull, B.hull];
  Storm.step(st, G, [A, B], s.t / 2);
  assert.strictEqual(A.hull, hull[0], 'not before it lands');
  Storm.step(st, G, [A, B], s.t);
  assert(A.hull === hull[0] - cs.damage && A.fx.includes('strike') && A.craft.vx < 300, 'struck: hull and speed lost');
  assert.strictEqual(B.hull, hull[1], 'out of reach: untouched');
  Storm.step(st, G, [A, B], Run.STEP);
  assert.strictEqual(A.hull, hull[0] - cs.damage, 'once');
});

test('race pickups: picked up once and only while racing; a lap flown along the line brings some home', () => {
  const { G, cfg, run } = Pilot.flat(1, RaceConfig.TRACK, { laps: 1 }), probe = run();
  const L = Line.build(G.tr, { stats: cfg.stats, handling: probe.tune.handling, r: cfg.r }), P = Pickups.place(G.tr, L, 1, 'terran');
  const c = { ...cfg, pickups: P }, R = run(c), ctl = { angle: 0, speed: 1, brake: false, events: [] };
  Object.assign(R.craft, { x: P[0].x, y: P[0].y });
  Run.step(R, G, c, ctl);
  assert.strictEqual(R.got.size, 0, 'not in the countdown');
  R.phase = 'race'; Object.assign(R.craft, { x: P[0].x, y: P[0].y, vx: 0, vy: 0 });
  Run.step(R, G, c, ctl);
  assert(R.got.has(P[0].id) && R.fx.some((k) => k === 'crate' || k === 'chip'));
  const once = JSON.stringify(R.haul);
  Object.assign(R.craft, { x: P[0].x, y: P[0].y, vx: 0, vy: 0 }); Run.step(R, G, c, ctl);
  assert.strictEqual(JSON.stringify(R.haul), once, 'once a race');
  const F = run(c);
  for (let t = 0; t < 60 && F.phase !== 'done'; t += Run.STEP) { Pilot.fly(G, F, c, {}, ctl); Run.step(F, G, c, ctl); }
  assert(F.haul.credits >= 5 * Pickups.CHIP.credits, `a lap picked up ${F.haul.credits} credits`);
});

test('race spills: knocking a rival may spill its pickups ahead of it; one knocking you, some of your haul', () => {
  const { G, cfg, run } = Pilot.flat(1, RaceConfig.TRACK, { laps: 1 }), probe = run();
  const L = Line.build(G.tr, { stats: cfg.stats, handling: probe.tune.handling, r: cfg.r }), D = Pickups.DROP, odds = D.odds, part = D.part;
  // What spills: a rival's chips or a part; yours out of your haul, nothing made or lost.
  const rng = mulberry32(5);
  for (let i = 0; i < 40; i++) {
    const l = Pickups.loot(rng, 'lava'), ps = Object.values(l.parts);
    assert(l.credits > 0 !== ps.length > 0 && l.credits <= D.chips[1] * Pickups.CHIP.credits && ps.every((n) => n === 1));
    const h = { credits: 37, parts: { coil: 1 } }, s = Pickups.shed(rng, h);
    assert(s.credits > 0 && h.credits + s.credits === 37 && h.parts.coil + (s.parts.coil || 0) === 1);
  }
  assert.deepStrictEqual(Pickups.shed(rng, Pickups.haul()), { credits: 0, parts: {} }, 'nothing held, nothing spilled');
  // Spilled pickups: not before they're armed, not after they're gone.
  const sp = Pickups.spill(G.tr, { x: 0, y: 0, n: 100, ahead: [0, 0] }, { credits: 12, parts: { vane: 1 } }, rng, 10, (() => { let k = 0; return () => `d${k++}`; })());
  assert.deepStrictEqual(sp.map((p) => [p.kind, p.credits, p.part]), [['chip', 5, null], ['chip', 5, null], ['chip', 2, null], ['crate', 0, 'vane']]);
  const at = sp[3], h = Pickups.haul();
  assert.strictEqual(Pickups.collect(sp, new Set(), h, at.x, at.y, cfg.r, 10.1).length, 0, 'not armed yet');
  assert.strictEqual(Pickups.collect(sp, new Set(), h, at.x, at.y, cfg.r, 10 + D.life + 1).length, 0, 'gone');
  assert(Pickups.collect(sp, new Set(), h, at.x, at.y, cfg.r, 10 + D.arm).some((p) => p.part === 'vane') && h.parts.vane === 1);
  // In a race: a ship closing on another along the track knocks it.
  const knock = (you) => {
    const P = Rival.pack(G, cfg, L, 'regular', 1, run), R = run({ ...cfg, pickups: [] }), X = P.racers[0];
    for (const S of [R, X.R]) S.phase = 'race';
    const p = G.tr.pts[X.R.n], [hit, by] = you ? [X.R, R] : [R, X.R];
    Object.assign(by.craft, { x: hit.craft.x - p.tx * cfg.r, y: hit.craft.y - p.ty * cfg.r, vx: p.tx * 400, vy: p.ty * 400 });
    R.haul = { credits: 40, parts: { cell: 2 } };
    Rival.step(P, G, R);
    return { R, P };
  };
  try {
    D.odds = 1; D.part = 0;
    const { R, P } = knock(true);
    assert(R.drops.length >= D.chips[0] && R.drops.every((p) => p.kind === 'chip') && R.fx.includes('loot'), 'the rival spills chips');
    assert.strictEqual(R.haul.credits, 40, 'yours untouched');
    const n = R.drops.length;
    Rival.step(P, G, R);
    assert.strictEqual(R.drops.length, n, 'once for the one knock');
    const { R: Y } = knock(false), lost = Y.drops.reduce((a, p) => a + p.credits, 0);
    assert(Y.fx.includes('spill') && lost > 0 && Y.haul.credits + lost === 40, 'you spill some of your haul');
    assert.strictEqual(Y.haul.parts.cell + Y.drops.filter((p) => p.part === 'cell').length, 2);
    D.odds = 0;
    assert.strictEqual(knock(true).R.drops.length, 0, 'only a chance');
  } finally { D.odds = odds; D.part = part; }
});

test('race career: the build reaches the run (dash, drift, walls, hull), and the side-bump is lopsided', () => {
  const { cfg, run } = Pilot.flat(1, RaceConfig.TRACK, { laps: 1 });
  const t = Career.tune(['dash.1a', 'dash.2a', 'dash.3a', 'handling.1a', 'handling.2a', 'handling.3a', 'chassis.1a', 'chassis.2a', 'chassis.3b']);
  const R = run({ ...cfg, career: t }), S = run();
  assert.strictEqual(R.dash.charges, Run.DASH.charges + 2);
  assert(R.tune.dash.boostTime > Run.DASH.boostTime && R.tune.dash.refill > Run.DASH.refill);
  assert(R.tune.drift.at[0] < Run.DRIFT.at[0] && R.tune.drift.boost[0] > Run.DRIFT.boost[0]);
  assert(R.tune.handling.SLIDE.on < S.tune.handling.SLIDE.on, 'loose tail: slides sooner');
  assert(R.tune.wall.friction < S.tune.wall.friction, 'glancing hull');
  assert(R.bump.power > 1 && S.bump.power === 1);
  // A ram into a stock ship at the same closing speed: the stock ship shoved further, the ram less.
  const knock = (A, B) => {
    Object.assign(A.craft, { x: 0, y: 0, vx: 200, vy: 0 }); Object.assign(B.craft, { x: cfg.r, y: 0, vx: 0, vy: 0 });
    Rival.ships([A, B], cfg.r);
    return [A.craft.vx, B.craft.vx];
  };
  const [, stockB] = knock(run(), run()), [ramA, ramB] = knock(run({ ...cfg, career: t }), run());
  assert(ramB > stockB, `the rival knocked to ${ramB.toFixed(1)}, not ${stockB.toFixed(1)}`);
  const shock = Career.tune(['chassis.1a', 'chassis.2b']), [, mounted] = knock(run(), run({ ...cfg, career: shock }));
  assert(mounted < stockB, 'shock mounts: knocked less');
  assert(ramA > 0);
});

test('race offline: race/sw.js keeps every file the race loads (npm run race:sw), the manifest and its icons among them', () => {
  const files = AppSw.appFiles('race');
  for (const f of ['./', 'manifest.webmanifest', '../src/race/main.js', '../src/ui/kit-lowpoly.css', '../assets/fonts/chakra-petch-latin-500-normal.woff2', '../assets/race-icon-512.png']) assert(files.includes(f), f);
  assert(!files.some((f) => f.includes('/game/') || f.endsWith('sw.js')), 'nothing of the game, and not the worker itself');
  const { current, wanted } = AppSw.check('race');
  assert.strictEqual(current, wanted, 'race/sw.js: the file list is out of date: npm run race:sw');
});

finish('race');
