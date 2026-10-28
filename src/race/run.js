// A run on a track: the countdown, flying it a fixed step at a time, what it hits, laps by
// checkpoints passed in order, and the camera following.
//
//   const R = Run.create(G, cfg)    G: the track and its surface ({ W, tr }); cfg: below
//   Run.step(R, G, cfg, control, dt)   one fixed step (control: Input.control())
//   Run.STEP                        the step (s)
//   Run.tune(biome?, career?)       a run's R.tune, without making one
//   R: { phase: 'count' | 'race' | 'done' | 'wreck', t, total, lapT, laps, next, n, hull, hits,
//        wrong, off (0 on the track .. 1 off it), slow, burn, flash, craft, prev, cam: { lx, ly, zf }, pcam,
//        dash: { charges, refill, t, v, kind }, hop: { t, cool }, air, pair, grip, drift, fx }
//     prev, pcam, pair: the craft's { x, y, angle }, the camera and the craft's height a step before, to draw them between steps
//     dash: charges (DASH.charges at most, one back every DASH.refill s), t: s of the burst left,
//       v: the velocity a sidestep gives back when it ends; hop: t s into it (−1: on the ground),
//       cool: s until the next; air: the craft's height over its flying height
//     grip: { slip, sliding } (Handling); drift: { t: s charged, level (0, 1, 2), boost: s of its boost
//       left, k: the boost's top speed ×, on: sliding }
//     fx: what happened this step for the page to answer (haptics): 'boost', 'side', 'airbrake',
//       'hop', 'land', 'charge', 'slide', 'drift1', 'drift2', 'driftBoost', 'chip', 'crate', and 'bump' (another ship: Rival.step); the page empties it
//     haul, got: what's been picked up this race (Pickups.collect: cfg.pickups) and their ids
//   cfg: { stats, ship, hull, r, laps, mode, steer, assist, cam, biome?, grid?, career?, pickups? }
//     cam: null for none (a rival's run); grid: { back, side }, where
//     on the grid it starts: units further back from the start, and across (+: the way −ty, tx)
//     biome: Config.biome(id), its character: the handling (Handling.tune), the run-off (OFF), the
//     walls (WALL, and × the hull a hit dents) and the hop (HOP) × its numbers; none, as they are
//     career: Career.tune's, the hangar's build: × the handling, the walls, the dash and the drift (its
//     stats are already in cfg.stats, its hull in cfg.hull); bump: its side-bump (Rival.step); none, stock
//     pickups: Pickups.place's, picked up while racing
//   R.tune: { handling, off, wall, hop, dash, drift } those numbers for this run; R.bump: { power, recoil }
//
// Flying is Handling.step (the race's grip, slide and brake; Flight.step's Direct with ?mode=direct)
// on the race's stats. Steering:
// - point: the heading the drag (or keys) set; within ASSIST.arc of the track's way it's pulled
//   toward it (cfg.assist), so a heading roughly along the track flies along it.
// - sides: full speed; the turn held turns it at its turn rate; held straight, it eases round to
//   the track's way when close to it.
// The controls' events (Input.control().events, emptied by the first step that sees them), while racing:
// - a flick dashes, read against the craft's way (its velocity, or its heading when slow): within
//   DASH.fwd a boost (DASH.boost × top speed its way, eased back down after); up to DASH.back a
//   sidestep (DASH.side × top speed square to the way, the velocity it had given back after); beyond,
//   an airbrake (the velocity × DASH.air). Each costs a charge. Mid-burst the craft only coasts; a hit
//   ends the burst.
// - a tap hops: HOP.time s off the ground, up to HOP.h: no slowing off the track or in holes, and
//   only HOP.grip of the grip (it can't turn hard in the air); walls still stop it.
// The brake (held): top speed eased to BRAKE.speed of it, at Handling's BRAKE × the acceleration, the
// grip no more than it was (Direct: BRAKE.accel × the acceleration).
// The drift (DRIFT): a slide held at speed charges a level, then two; when the grip comes back the
// craft gets a short boost, more for the second level. A hit or the run-off loses it.
// Collisions are Contact.step: walls you slide along, rocks as circles; a hard hit dents the hull.
// Off the track (past its edge, on the run-off before the wall): top speed and acceleration eased down
// (OFF), back up on it. In a hole (craters, vents, lava lakes): top speed × SLOW; glowing ones burn.
// The camera leads the ship by cam.lead seconds of speed, the lead blended (cam.track) from its
// velocity toward the track's way that far ahead; it pushes in a little at speed (cam.pull), and
// out on straights, in for bends (cam.wide, cam.tight) by the tightest bend in sight ahead.
// ES module (`Run`); needs a browser (ArtSurface).

import { ArtSurface } from '../art/surface.js';
import { Collide } from '../flight/collide.js';
import { Flight } from '../flight/flight.js';
import { Contact } from './contact.js';
import { Handling } from './handling.js';
import { Pickups } from './pickups.js';
import { Track } from './track.js';

const Run = (() => {
  const STEP = 1 / 120, COUNT = 3;
  const SLOW = 0.5, BURN = 12; // in a hole: top speed ×; glowing ones: hull a second
  const BRAKE = { speed: 0.35, accel: 2.5 };
  const DASH = { charges: 2, refill: 2.5, fwd: 0.87, back: 2.27, boost: 2, boostTime: 0.18, side: 1.6, sideTime: 0.14, air: 0.5 }; // fwd, back: rad from the way
  const HOP = { time: 0.55, h: 40, grip: 0.4, cool: 0.3 };
  const OFF = { speed: 0.4, grip: 0.3, ease: 0.2 }; // off the track: top speed and acceleration less by these at the most, reached over ease s
  const ASSIST = { arc: 0.35, pull: 0.6, ease: 2 }; // within arc (rad) of the track's way: point pulls the heading pull of the way; sides eases round at ease a second
  const WALL = { restitution: 0.2, friction: 0.12, reach: 2.5 * ArtSurface.T }; // a graze keeps 88% of its speed along the wall: braking beats scraping
  // The drift: a slide faster than min of top speed, on the track and the ground, charges levels at
  // `at` s; grip back, it gives a boost of `boost` × top speed held for `time` s (per level). A hit or
  // the run-off loses the charge.
  const DRIFT = { min: 0.5, at: [0.5, 1.1], boost: [1.2, 1.35], time: [0.3, 0.5] };
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const angleDiff = (a, b) => ((a - b + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;

  function create(G, cfg) {
    // A little behind the start line; on a grid (cfg.grid), back and across from there.
    const g = cfg.grid || { back: 0, side: 0 }, n = Track.ahead(G.tr, G.tr.samples - 8, -g.back), p = G.tr.pts[n];
    const craft = { x: p.x - p.ty * g.side, y: p.y + p.tx * g.side, vx: 0, vy: 0, angle: Math.atan2(p.ty, p.tx), thrust: 0 };
    const R = {
      phase: 'count', t: 0, total: 0, lapT: 0, laps: [], next: 1, n, hull: cfg.hull, hits: 0, wrong: 0, slow: false, burn: false, flash: 0, off: 0, stats: { ...cfg.stats },
      craft, prev: { x: craft.x, y: craft.y, angle: craft.angle }, cam: { lx: 0, ly: 0, zf: 1 }, pcam: { lx: 0, ly: 0, zf: 1 },
      grip: { slip: 0, sliding: false }, drift: { t: 0, level: 0, boost: 0, k: 1, on: false },
      hop: { t: -1, cool: 0 }, air: 0, pair: 0, fx: [],
      tune: tune(cfg.biome, cfg.career), bump: cfg.career ? cfg.career.bump : BUMP, haul: Pickups.haul(), got: new Set(),
    };
    R.dash = { charges: R.tune.dash.charges, refill: 0, t: 0, v: null, kind: null };
    // What the craft can hit (Contact): the way out of a wall is toward the nearest centreline point.
    // The props round a tile (ArtSurface.propsNear: they depend only on the tile) are found once
    // and kept, rocks and holes apart, so the steps make no garbage for the collector.
    const T = ArtSurface.T, memo = new Map();
    const near = (x, y) => {
      const k = Math.floor(x / T) * 1000 + Math.floor(y / T);
      let m = memo.get(k);
      if (!m) {
        const ps = ArtSurface.propsNear(G.W, x, y);
        m = { rocks: ps.filter((q) => q.type === 'tall').map((q) => ({ x: q.x, y: q.y, r: q.r + 0.5 })), holes: ps.filter((q) => q.type === 'hole') }; // rocks a hair wider than blocked() sees them
        memo.set(k, m);
      }
      return m;
    };
    R.world = {
      rocks: (x, y) => near(x, y).rocks,
      holes: (x, y) => near(x, y).holes,
      blocked: (x, y, r) => ArtSurface.blocked(G.W, x, y, r),
      normal: (x, y) => { const e = Track.edgeDist(G.tr, x, y, R.n, 40); return [-e.nx, -e.ny]; },
    };
    return R;
  }

  // A run's numbers on a biome (Config.biome): × its character, as they are without one; and × the
  // hangar's build (Career.tune), the dash's charges added.
  const BUMP = { power: 1, recoil: 1 };
  function tune(b, c) {
    const k = (o, f = {}) => Object.fromEntries(Object.entries(o).map(([key, v]) => [key, v * (f[key] ?? 1)]));
    const t = b
      ? { handling: b.handling, off: k(OFF, b.off), wall: { ...WALL, restitution: WALL.restitution * (b.wall.restitution ?? 1), friction: WALL.friction * (b.wall.friction ?? 1), damage: b.wall.damage ?? 1 }, hop: { ...HOP, time: HOP.time * (b.hop.time ?? 1), h: HOP.h * (b.hop.h ?? 1) } }
      : { handling: {}, off: OFF, wall: { ...WALL, damage: 1 }, hop: HOP };
    t.dash = DASH; t.drift = DRIFT;
    if (c) {
      t.handling = k({ GRIP: 1, BRAKE: 1, on: 1, ...t.handling }, c.handling);
      t.wall = { ...t.wall, friction: t.wall.friction * c.wall.friction, damage: t.wall.damage * c.wall.damage };
      const d = c.dash;
      t.dash = { ...DASH, charges: DASH.charges + d.charges, refill: DASH.refill * d.refill, boostTime: DASH.boostTime * d.boostTime, sideTime: DASH.sideTime * d.boostTime, boost: DASH.boost * d.boost, side: DASH.side * d.side };
      t.drift = { ...DRIFT, at: DRIFT.at.map((x) => x * c.drift.at), boost: DRIFT.boost.map((x) => 1 + (x - 1) * c.drift.boost) };
    }
    t.handling = b || c ? Handling.tune(t.handling) : Handling.config;
    return t;
  }

  // What the controls fly: a heading and a speed (world units a second).
  function steer(R, G, cfg, ctl, stats, racing) {
    const C = R.craft, pt = G.tr.pts[Track.ahead(G.tr, R.n, 60)], way = Math.atan2(pt.ty, pt.tx);
    if (!racing) return { angle: C.angle, speed: 0 };
    const top = stats.maxSpeed * (ctl.brake ? BRAKE.speed : 1);
    if (cfg.steer === 'sides') {
      if (ctl.turn) return { angle: C.angle + ctl.turn, speed: top };
      const off = angleDiff(C.angle, way), ease = cfg.assist && Math.abs(off) < ASSIST.arc ? off * ASSIST.ease * STEP : 0;
      return { angle: C.angle - ease, speed: top };
    }
    let angle = ctl.angle;
    const off = angleDiff(angle, way);
    if (cfg.assist && !ctl.keyed && Math.abs(off) < ASSIST.arc) angle -= off * ASSIST.pull * (1 - Math.abs(off) / ASSIST.arc);
    return { angle, speed: Math.min(ctl.speed * stats.maxSpeed, top) };
  }

  // A flick or a tap (Input.control().events).
  function act(R, cfg, ev) {
    const C = R.craft, D = R.dash, DA = R.tune.dash;
    if (ev.type === 'tap') {
      if (R.hop.t < 0 && R.hop.cool <= 0) { R.hop.t = 0; R.fx.push('hop'); }
      return;
    }
    if (ev.type !== 'flick' || D.charges < 1 || D.t > 0) return;
    const v = Math.hypot(C.vx, C.vy), way = v > 40 ? Math.atan2(C.vy, C.vx) : C.angle, top = cfg.stats.maxSpeed;
    const angle = ev.rel !== undefined ? way + ev.rel : ev.angle ?? way, rel = angleDiff(angle, way);
    D.charges--; D.v = null;
    if (Math.abs(rel) <= DA.fwd) {
      D.kind = 'boost'; D.t = DA.boostTime;
      C.vx = Math.cos(angle) * top * DA.boost; C.vy = Math.sin(angle) * top * DA.boost; C.angle = angle; C.thrust = 1;
    } else if (Math.abs(rel) < DA.back) {
      const side = way + Math.sign(rel) * Math.PI / 2;
      D.kind = 'side'; D.t = DA.sideTime; D.v = [C.vx, C.vy];
      C.vx += Math.cos(side) * top * DA.side; C.vy += Math.sin(side) * top * DA.side;
    } else {
      D.kind = 'airbrake';
      C.vx *= DA.air; C.vy *= DA.air;
    }
    R.fx.push(D.kind);
  }

  function step(R, G, cfg, ctl, dt = STEP) {
    R.t += dt;
    if (R.phase === 'count' && R.t >= COUNT) { R.phase = 'race'; R.t = 0; }
    const tr = G.tr, C = R.craft, racing = R.phase === 'race', STATS = cfg.stats, D = R.dash, H = R.hop, { off, wall, hop } = R.tune;
    R.prev.x = C.x; R.prev.y = C.y; R.prev.angle = C.angle; R.pair = R.air;
    if (ctl.events && ctl.events.length) { if (racing) for (const ev of ctl.events) act(R, cfg, ev); ctl.events.length = 0; }
    const air = H.t >= 0;
    const stats = R.stats; // the race's stats as the ground here leaves them
    stats.maxSpeed = STATS.maxSpeed * (1 - off.speed * R.off) * (R.slow ? SLOW : 1) * (R.drift.boost > 0 ? R.drift.k : 1);
    const direct = cfg.mode === 'direct';
    stats.accel = STATS.accel * (1 - off.grip * R.off) * (direct && ctl.brake ? BRAKE.accel : 1) * (air ? hop.grip : 1);
    const go = steer(R, G, cfg, ctl, stats, racing), from = { x: C.x, y: C.y };
    const fly = { targetAngle: go.speed > 0 ? go.angle : C.angle, targetSpeed: go.speed, mode: cfg.mode, brake: racing && ctl.brake, coast: D.t > 0 };
    if (direct) Flight.step(C, stats, fly, dt);
    else Handling.step(C, stats, fly, R.grip, dt, R.tune.handling);
    // As hard as the same share of top speed at the game's surface speed (game/landing.js).
    const hit = Contact.step(C, cfg.r, R.world, wall, from) / (STATS.maxSpeed / (cfg.ship.maxSpeed * 0.5));
    if (hit > Collide.config.surfaceSafe * 0.5) { R.hits++; R.flash = Math.min(0.4, hit / 600); }
    R.hull -= Collide.damage(hit, Collide.config.surfaceSafe) * wall.damage;
    // The dash's burst: a hit ends it, the bounce kept; a sidestep gives back the velocity it had.
    if (D.t > 0) {
      D.t -= dt;
      if (hit > 0) { D.t = 0; D.v = null; } else if (D.t <= 0 && D.v) { C.vx = D.v[0]; C.vy = D.v[1]; D.v = null; }
    }
    if (racing && !direct) drift(R, cfg, hit, air, dt);
    if (racing && D.charges < R.tune.dash.charges && (D.refill += dt) >= R.tune.dash.refill) { D.charges++; D.refill = 0; R.fx.push('charge'); }
    if (racing && cfg.pickups) for (const p of Pickups.collect(cfg.pickups, R.got, R.haul, C.x, C.y, cfg.r)) R.fx.push(p.kind === 'chip' ? 'chip' : 'crate');
    // The hop: up and down again.
    H.cool = Math.max(0, H.cool - dt);
    if (air && (H.t += dt) >= hop.time) { H.t = -1; H.cool = hop.cool; R.fx.push('land'); }
    R.air = H.t >= 0 ? hop.h * Math.sin((Math.PI * H.t) / hop.time) : 0;
    R.slow = R.burn = false;
    if (!air) for (const p of R.world.holes(C.x, C.y)) if (Math.hypot(C.x - p.x, C.y - p.y) < p.r) { R.slow = true; if (p.emit) R.burn = true; }
    if (R.burn && racing) R.hull -= BURN * dt;
    R.flash = Math.max(0, R.flash - dt);
    if (R.hull <= 0 && racing) { R.hull = 0; R.phase = 'wreck'; }
    const e = Track.edgeDist(tr, C.x, C.y, R.n, 40);
    R.n = e.n;
    R.off = clamp(R.off + (e.d > 0 && !air ? dt : -dt) / off.ease, 0, 1);
    if (cfg.cam) camera(R, G, cfg, dt);
    if (!racing) return;
    R.total += dt; R.lapT += dt;
    const pt = tr.pts[R.n];
    R.wrong = C.vx * pt.tx + C.vy * pt.ty < -60 ? R.wrong + dt : 0;
    if ((R.n - tr.cps[R.next] + tr.samples) % tr.samples < tr.samples / 8) {
      if (R.next === 0) lap(R, cfg);
      R.next = (R.next + 1) % tr.cps.length;
    }
  }

  // The drift's charge, and its boost when the grip comes back.
  function drift(R, cfg, hit, air, dt) {
    const DR = R.tune.drift, C = R.craft, F = R.drift, v = Math.hypot(C.vx, C.vy), top = cfg.stats.maxSpeed, sliding = R.grip.sliding && !air;
    F.boost = Math.max(0, F.boost - dt);
    if (sliding && !F.on) R.fx.push('slide');
    F.on = sliding;
    if (hit > 0 || R.off > 0.5) { F.t = 0; F.level = 0; } else if (sliding && v > DR.min * top) {
      F.t += dt;
      const level = F.t >= DR.at[1] ? 2 : F.t >= DR.at[0] ? 1 : 0;
      if (level > F.level) { F.level = level; R.fx.push(`drift${level}`); }
    } else if (!sliding) {
      if (F.level > 0) {
        const L = F.level - 1, to = DR.boost[L] * top;
        F.k = DR.boost[L]; F.boost = DR.time[L];
        if (v < to && v > 0) { C.vx *= to / v; C.vy *= to / v; }
        C.thrust = 1; R.fx.push('driftBoost');
      }
      F.t = 0; F.level = 0;
    }
  }

  function lap(R, cfg) {
    R.laps.push(R.lapT); R.lapT = 0;
    if (R.laps.length >= cfg.laps) R.phase = 'done';
  }

  function camera(R, G, cfg, dt) {
    const C = R.craft, tr = G.tr, cam = cfg.cam, k = 1 - Math.exp(-3 * dt);
    Object.assign(R.pcam, R.cam);
    const v = Math.hypot(C.vx, C.vy), sp = v / cfg.stats.maxSpeed, p = tr.pts[R.n];
    const fwd = C.vx * p.tx + C.vy * p.ty >= 0 ? 1 : -1, reach = v * cam.lead;
    const a = tr.pts[Track.ahead(tr, R.n, fwd * reach)];
    const lx = C.vx * cam.lead + (a.tx * fwd * reach - C.vx * cam.lead) * cam.track, ly = C.vy * cam.lead + (a.ty * fwd * reach - C.vy * cam.lead) * cam.track;
    // The tightest bend from here to a little past the lead: its radius sets the zoom.
    let kmax = 0;
    for (let d = 0; d < reach + 400; d += tr.ds * 4) kmax = Math.max(kmax, tr.pts[Track.ahead(tr, R.n, fwd * d)].k);
    const bend = clamp((1500 - 1 / Math.max(kmax, 1e-4)) / 1000, 0, 1);
    R.cam.lx += (lx - R.cam.lx) * k; R.cam.ly += (ly - R.cam.ly) * k;
    R.cam.zf += ((1 + cam.pull * sp) * (cam.wide + (cam.tight - cam.wide) * bend) - R.cam.zf) * k * 0.6;
  }

  return { create, step, tune, STEP, BRAKE, DASH, HOP, DRIFT, WALL };
})();

export { Run };
