// A run on a track: the countdown, flying it a fixed step at a time, what it hits, laps by
// checkpoints passed in order, the best lap's ghost, and the camera following.
//
//   const R = Run.create(G, cfg)    G: the track and its surface ({ W, tr }); cfg: below
//   Run.step(R, G, cfg, control, dt)   one fixed step (control: Input.control())
//   Run.STEP                        the step (s)
//   R: { phase: 'count' | 'race' | 'done' | 'wreck', t, total, lapT, laps, next, n, hull, hits,
//        wrong, slow, burn, flash, craft, prev, cam: { lx, ly, zf }, pcam, ghost, newBest }
//     prev, pcam: the craft's { x, y, angle } and the camera a step before, to draw both between steps
//   cfg: { stats, ship, hull, r, laps, mode, steer, assist, cam, ghostKey }
//
// Flying is Flight.step (Cruise, or Direct with ?mode=direct) on the race's stats. Steering:
// - point: the heading the drag (or keys) set; within ASSIST.arc of the track's way it's pulled
//   toward it (cfg.assist), so a heading roughly along the track flies along it.
// - sides: full speed; the turn held turns it at its turn rate; held straight, it eases round to
//   the track's way when close to it.
// Collisions are Contact.step: walls you slide along, rocks as circles; a hard hit dents the hull.
// In a hole (craters, vents, lava lakes): top speed × SLOW; glowing ones burn.
// The camera leads the ship by cam.lead seconds of speed, the lead blended (cam.track) from its
// velocity toward the track's way that far ahead; it pushes in a little at speed (cam.pull), and
// out on straights, in for bends (cam.wide, cam.tight) by the tightest bend in sight ahead.
// ES module (`Run`); needs a browser (ArtSurface).

import { ArtSurface } from '../art/surface.js';
import { Collide } from '../flight/collide.js';
import { Flight } from '../flight/flight.js';
import { Contact } from './contact.js';
import { Ghost } from './ghost.js';
import { Track } from './track.js';

const Run = (() => {
  const STEP = 1 / 120, COUNT = 3;
  const SLOW = 0.5, BURN = 12; // in a hole: top speed ×; glowing ones: hull a second
  const ASSIST = { arc: 0.35, pull: 0.6, ease: 2 }; // within arc (rad) of the track's way: point pulls the heading pull of the way; sides eases round at ease a second
  const WALL = { restitution: 0.2, friction: 0.04, reach: 2.5 * ArtSurface.T }; // a graze keeps 96% of its speed along the wall
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const angleDiff = (a, b) => ((a - b + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;

  function create(G, cfg) {
    const n = G.tr.samples - 8, p = G.tr.pts[n]; // a little behind the start line
    const craft = { x: p.x, y: p.y, vx: 0, vy: 0, angle: Math.atan2(p.ty, p.tx), thrust: 0 };
    const R = {
      phase: 'count', t: 0, total: 0, lapT: 0, laps: [], next: 1, n, hull: cfg.hull, hits: 0, wrong: 0, slow: false, burn: false, flash: 0,
      craft, prev: { x: craft.x, y: craft.y, angle: craft.angle }, cam: { lx: 0, ly: 0, zf: 1 }, pcam: { lx: 0, ly: 0, zf: 1 },
      rec: Ghost.recorder(), ghost: Ghost.load(cfg.ghostKey), newBest: false,
    };
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

  // What the controls fly: a heading and a speed (world units a second).
  function steer(R, G, cfg, ctl, stats, racing) {
    const C = R.craft, pt = G.tr.pts[Track.ahead(G.tr, R.n, 60)], way = Math.atan2(pt.ty, pt.tx);
    if (!racing) return { angle: C.angle, speed: 0 };
    if (cfg.steer === 'sides') {
      if (ctl.turn) return { angle: C.angle + ctl.turn, speed: stats.maxSpeed * (ctl.brake ? 0.3 : 1) };
      const off = angleDiff(C.angle, way), ease = cfg.assist && Math.abs(off) < ASSIST.arc ? off * ASSIST.ease * STEP : 0;
      return { angle: C.angle - ease, speed: stats.maxSpeed * (ctl.brake ? 0.3 : 1) };
    }
    let angle = ctl.angle;
    const off = angleDiff(angle, way);
    if (cfg.assist && !ctl.keyed && Math.abs(off) < ASSIST.arc) angle -= off * ASSIST.pull * (1 - Math.abs(off) / ASSIST.arc);
    return { angle, speed: ctl.speed * stats.maxSpeed };
  }

  function step(R, G, cfg, ctl, dt = STEP) {
    R.t += dt;
    if (R.phase === 'count' && R.t >= COUNT) { R.phase = 'race'; R.t = 0; }
    const tr = G.tr, C = R.craft, racing = R.phase === 'race', STATS = cfg.stats;
    R.prev.x = C.x; R.prev.y = C.y; R.prev.angle = C.angle;
    const stats = R.slow ? (R.slowStats ||= { ...STATS, maxSpeed: STATS.maxSpeed * SLOW }) : STATS;
    const go = steer(R, G, cfg, ctl, stats, racing), from = { x: C.x, y: C.y };
    Flight.step(C, stats, { targetAngle: go.speed > 0 ? go.angle : C.angle, targetSpeed: go.speed, mode: cfg.mode }, dt);
    // As hard as the same share of top speed at the game's surface speed (game/landing.js).
    const hit = Contact.step(C, cfg.r, R.world, WALL, from) / (STATS.maxSpeed / (cfg.ship.maxSpeed * 0.5));
    if (hit > Collide.config.surfaceSafe * 0.5) { R.hits++; R.flash = Math.min(0.4, hit / 600); }
    R.hull -= Collide.damage(hit, Collide.config.surfaceSafe);
    R.slow = R.burn = false;
    for (const p of R.world.holes(C.x, C.y)) if (Math.hypot(C.x - p.x, C.y - p.y) < p.r) { R.slow = true; if (p.emit) R.burn = true; }
    if (R.burn && racing) R.hull -= BURN * dt;
    R.flash = Math.max(0, R.flash - dt);
    if (R.hull <= 0 && racing) { R.hull = 0; R.phase = 'wreck'; }
    R.n = Track.edgeDist(tr, C.x, C.y, R.n, 40).n;
    camera(R, G, cfg, dt);
    if (!racing) return;
    R.total += dt; R.lapT += dt;
    R.rec.add(R.lapT, C);
    const pt = tr.pts[R.n];
    R.wrong = C.vx * pt.tx + C.vy * pt.ty < -60 ? R.wrong + dt : 0;
    if ((R.n - tr.cps[R.next] + tr.samples) % tr.samples < tr.samples / 8) {
      if (R.next === 0) lap(R, cfg);
      R.next = (R.next + 1) % tr.cps.length;
    }
  }

  function lap(R, cfg) {
    const g = R.rec.lap(R.lapT);
    R.laps.push(R.lapT); R.lapT = 0;
    if (!R.ghost || g.time < R.ghost.time) { R.ghost = g; R.newBest = true; Ghost.save(cfg.ghostKey, g); }
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

  return { create, step, STEP };
})();

export { Run };
