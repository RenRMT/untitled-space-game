// Rivals: AI ships that race you, one from each culture but yours (Android), flying the same craft
// through the same Run.step as you, with controls shaped like Input.control(). notes/race-rivals.md
// is the design.
//
// Fair: no rival gets more top speed or grip than you (on regular, a little less top speed). How
// fast one is, is how well it flies: its own line (the racing line, Line, pulled toward the
// centreline by `bias`), how much of the grip it dares use in the bends (`pace`: its line's speeds
// are those of GRIP × pace², so bends × pace, straights at top speed), and when it brakes, boosts
// and slips up. The level (LEVELS) sets the band those are drawn from; the culture (CULTURES) how it
// flies within it:
// - bias: how far toward the centreline its line sits (0: the racing line); weave: a wander across
//   the track, × the room there (the Aliens' strange lines)
// - aim: × how far ahead it steers for (turning in early or late); brake: × the room it leaves braking
// - aggression: how readily it pulls out to pass (below 0.5 it waits behind for room); block: how
//   hard it moves to the inside when someone closes from behind; ram: how often it sidesteps into
//   a ship alongside (s⁻¹)
// - boost: when it dashes forward: 'straights' (onto a long straight at speed), 'exits' (out of the
//   bend onto one) or 'random' (whenever there's a charge, now and then)
// - noise: how much its pace wanders from bend to bend; slips: the mistakes it makes, × mistakes how
//   often (SLIP per bend): 'late' (brakes late, runs wide or hits the wall), 'wide' (runs wide
//   through the bend), 'early' (lifts early and crawls round); recover: s it takes to settle after a hit
// - twist: × its craft's turn rate (turnRate; 'random': a little either way), slide: × its grip mid-slide. Never
//   its acceleration: that's the grip too (Handling), and a little more of it wins races.
// Skill banding (LEVELS band: [up, down]): a rival far behind you flies up to `up` better, one far
// ahead up to `down` worse, never past its band's best pace; no speed is added.
// Everything random comes from the race's seed: the same seed, the same race.
//
//   Rival.CULTURES, Rival.LEVELS
//   Rival.field(seed, level) -> [{ id, name, color, art, pace, bias, boss, slot }]   the rivals for a race, and
//     their slots on the grid (0: the front); Rival.PLAYER: your slot
//   Rival.grid(slot, hw) -> { back, side }   a slot's place on the grid (Run's cfg.grid)
//   Rival.pack(G, cfg, L, level, seed, run) -> pack   the rivals' runs: cfg, your run's (theirs are
//     made from it); L: Line.build's racing line; run(cfg) -> R makes a run (Run.create, or Pilot.flat's)
//   Rival.step(pack, G, R?)   one Run.STEP for every rival, then the ships pushed apart (R: yours, or none)
//   Rival.ships(Rs, r)   runs' craft (radius r) that overlap pushed apart
//   Rival.progress(G, R) -> laps   how far round a run is (laps done + the share of this one)
//   Rival.standings(P, G, R) -> { place, of, rows: [{ id, name, color, done, prog, you? }] }   the order now
//     (done: the finish time, or null), yours among them
//   Rival.race(seed, opts, { level, biome, laps }) -> [{ id, time, pace, hits, slips }]   a race of
//     rivals alone, flown headless (Pilot.flat), for the tests and tools
//   pack: { level, racers: [{ who, cfg, R, ai, ctl }] }; ai: { line: { off, v, time }, pace, best,
//     shift, slip, slips, finish (s, once its laps are done), … }
// ES module (`Rival`); also runs in Node.

import { hashInt, mulberry32 } from '../core/rng.js';
import { Line } from './line.js';
import { Pilot } from './pilot.js';
import { Run } from './run.js';
import { Track } from './track.js';

const Rival = (() => {
  const CULTURES = {
    wedge: { name: 'Wedge', color: '#5fa8ff', art: 'fighter', bias: 0, weave: 0, aim: 1, brake: 1, aggression: 0.45, block: 0.2, ram: 0, boost: 'straights', noise: 0.01, mistakes: 0.5, slips: ['wide', 'early'], recover: 0.6, twist: {} },
    block: { name: 'Block', color: '#e0a030', art: 'fighter-heavy', bias: 0.3, weave: 0, aim: 1.1, brake: 1.3, aggression: 0.6, block: 0.9, ram: 0, boost: 'straights', noise: 0.015, mistakes: 0.8, slips: ['early', 'wide'], recover: 0.3, twist: { turnRate: 0.94 } },
    shard: { name: 'Shard', color: '#3fbf6a', art: 'fighter-light', bias: 0, weave: 0, aim: 0.9, brake: 0.8, aggression: 0.3, block: 0, ram: 0, boost: 'exits', noise: 0.01, mistakes: 0.4, slips: ['late'], recover: 1, twist: { turnRate: 1.06 } },
    drifter: { name: 'Drifters', color: '#d8824a', art: 'fighter', bias: 0.2, weave: 0, aim: 1, brake: 1, aggression: 0.9, block: 0.5, ram: 0.6, boost: 'random', noise: 0.04, mistakes: 1.6, slips: ['late', 'wide', 'early'], recover: 0.5, twist: 'random' },
    alien: { name: 'Alien', color: '#c86ad8', art: 'fighter', bias: 0.1, weave: 0.2, aim: 1, brake: 1, aggression: 0.5, block: 0.2, ram: 0, boost: 'exits', noise: 0.02, mistakes: 0.8, slips: ['wide'], recover: 0.6, twist: { slide: 1.1 } },
  };
  // pace, bias: the bands drawn from; mistakes: × each culture's; boost: the odds it takes a chance
  // to; band: [up, down] skill banding at its most; speed: × top speed; boss: [the culture, its pace],
  // the one rival a cut above the rest: on the racing line itself, and half as many mistakes.
  const LEVELS = {
    regular: { pace: [0.86, 0.92], bias: [0.5, 0.8], mistakes: 1.5, boost: 0.3, band: [0.04, 0.04], speed: 0.97 },
    advanced: { pace: [0.92, 0.96], bias: [0.2, 0.5], mistakes: 1, boost: 0.7, band: [0.02, 0.02], speed: 1 },
    expert: { pace: [0.95, 0.98], bias: [0, 0.2], mistakes: 0.5, boost: 1, band: [0.01, 0], speed: 1, boss: ['shard', 1.1] },
  };
  const PLAYER = 3, SLOT = { back: 55, side: 0.42 }; // your slot (0: the front); a slot back, and across × the half-width
  const AIM = { near: 50, lead: 0.25 }, ROOM = 40; // ROOM: the units it leaves itself braking (× brake)
  const SLIP = 0.06, WEAVES = [4, 8], BAND = 1500; // SLIP: a mistake's odds a bend (× mistakes); WEAVES: waves a lap; BAND: units behind or ahead for the full banding
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const wrap = (n, m) => ((n % m) + m) % m;

  // ---------- The field ----------

  function field(seed, level) {
    const L = LEVELS[level], ids = Object.keys(CULTURES);
    const who = ids.map((id, i) => {
      const r = mulberry32(hashInt(seed, i, 0x51a1)), c = CULTURES[id];
      const boss = !!L.boss && L.boss[0] === id, pace = boss ? L.boss[1] : L.pace[0] + (L.pace[1] - L.pace[0]) * r();
      return { id, name: c.name, color: c.color, art: c.art, pace, boss, bias: boss ? 0 : clamp(L.bias[0] + (L.bias[1] - L.bias[0]) * r() + c.bias, 0, 1) };
    });
    // The slowest at the front, you in the middle: there's someone to pass from the first bend. A
    // boss starts on pole: the one to hunt down.
    who.sort((a, b) => b.boss - a.boss || a.pace - b.pace);
    who.forEach((w, i) => { w.slot = i < PLAYER ? i : i + 1; });
    return who;
  }

  const grid = (slot, hw) => ({ back: slot * SLOT.back, side: (slot % 2 ? -1 : 1) * SLOT.side * hw });

  // ---------- A rival ----------

  function pack(G, cfg, L, level, seed, run) {
    const tr = G.tr, S = tr.samples, lim = Line.lim(tr, Line.MARGIN * cfg.r);
    const racers = field(seed, level).map((who, i) => {
      const c = CULTURES[who.id], r = mulberry32(hashInt(seed, i, 0x7a3e)), lv = LEVELS[level];
      const tw = c.twist === 'random' ? { turnRate: 0.95 + 0.1 * r() } : c.twist;
      const stats = { ...cfg.stats, maxSpeed: cfg.stats.maxSpeed * lv.speed, turnRate: cfg.stats.turnRate * (tw.turnRate ?? 1) };
      const rcfg = { ...cfg, stats, race: cfg.laps, laps: Infinity, cam: null, ghostKey: null, assist: false, steer: 'point', grid: grid(who.slot, tr.pts[0].hw) };
      const R = run(rcfg);
      if (tw.slide) { const h = R.tune.handling; R.tune.handling = { ...h, SLIDE: { ...h.SLIDE, grip: h.SLIDE.grip * tw.slide } }; }
      // Its own line: the racing line toward the centreline by its bias, and its weave.
      const phase = r() * TAU, waves = WEAVES[0] + Math.floor(r() * (WEAVES[1] - WEAVES[0] + 1)), off = new Float64Array(S);
      for (let n = 0; n < S; n++) off[n] = clamp(L.off[n] * (1 - who.bias) + c.weave * lim[n] * Math.sin(phase + (TAU * waves * n) / S), -lim[n], lim[n]);
      const H = R.tune.handling, line = { off, ...Line.ride(tr, off, stats, { ...H, GRIP: H.GRIP * who.pace * who.pace }) };
      const ai = {
        line, lim, pace: who.pace, best: Math.max(who.pace, lv.pace[1]), c, lv, rng: mulberry32(hashInt(seed, i, 0x2c9d)),
        bend: nextBend(tr, R.n), k: 1, slip: null, slips: 0, shift: 0, open: false, calm: 0, hits: 0, finish: null,
      };
      return { who, cfg: rcfg, R, ai, ctl: { angle: R.craft.angle, speed: 1, brake: false, keyed: true, events: [] } };
    });
    return { level, racers };
  }

  // The first bend whose entry is ahead of point n.
  function nextBend(tr, n) {
    const cs = tr.corners || [];
    for (let i = 0; i < cs.length; i++) if (cs[i].from >= n) return i;
    return 0;
  }

  // How far round: laps done and the share of this one; before the start line the first time, < 0.
  function progress(G, R) {
    const tr = G.tr, S = tr.samples;
    let f = wrap(R.n - tr.cps[0], S) / S;
    if (R.next === 1 && f > 0.5) f -= 1;
    return R.laps.length + f;
  }

  // The speed it aims to be at, at point i: its line's, × this bend's pace and the banding; on a
  // straight (at top speed) as fast as it goes.
  const target = (ai, i, top, b) => (ai.line.v[i] >= top * 0.98 ? Infinity : ai.line.v[i] * ai.k * b);

  function fly(G, X, others, gap) {
    const { R, ai, ctl, cfg } = X, { c } = ai, tr = G.tr, S = tr.samples, C = R.craft, v = Math.hypot(C.vx, C.vy), top = cfg.stats.maxSpeed, dt = Run.STEP;
    ctl.events.length = 0; ctl.brake = false; ctl.speed = 1;
    if (R.phase !== 'race') return ctl;
    // The bends: entering one, how it'll fly it (its pace this time, a slip or not).
    const B = tr.corners && tr.corners[ai.bend];
    if (B && wrap(B.from - R.n, S) * tr.ds < 60 + v * 0.5 && wrap(B.from - R.n, S) < S / 2) {
      ai.k = 1 + c.noise * (2 * ai.rng() - 1);
      ai.slip = ai.rng() < SLIP * c.mistakes * ai.lv.mistakes * (X.who.boss ? 0.5 : 1) ? { type: c.slips[Math.floor(ai.rng() * c.slips.length)], side: B.side, to: B.to, t: 0.35 } : null;
      if (ai.slip) { ai.slips++; if (ai.slip.type === 'early') ai.k *= 0.88; }
      ai.bend = (ai.bend + 1) % tr.corners.length;
    }
    if (ai.slip && wrap(R.n - ai.slip.to, S) < S / 4) { ai.slip = null; ai.k = 1 + (ai.k - 1) * 0.5; }
    // After a hit it settles for a moment before pushing again.
    if (R.hits > ai.hits) { ai.hits = R.hits; ai.calm = c.recover; }
    ai.calm = Math.max(0, ai.calm - dt);
    // Skill banding: better behind you, worse ahead, never past its band's best.
    const [up, down] = ai.lv.band, g = gap == null ? 0 : clamp(gap / BAND, -1, 1);
    const b = Math.min(1 + g * (g > 0 ? up : down), ai.best / ai.pace);
    // Where across the track it wants to be: its line, moved over to pass, to defend, or by a slip.
    const reach = (AIM.near + v * AIM.lead) * c.aim, j = Track.ahead(tr, R.n, reach), p = tr.pts[j];
    let want = 0, follow = Infinity;
    const me = progress(G, R), mine = ai.line.off[j];
    for (const o of others) {
      const dn = (o.prog - me) * tr.len, oo = lateral(tr, o.R);
      if (dn > -3 * cfg.r && dn < 60 + v * 0.35 && Math.abs(mine - oo) < 2.6 * cfg.r) {
        // Someone ahead on its line (or still alongside, passing them): round them, on the side
        // nearer its own line, if there's room (or it's bold enough to squeeze); else it sits behind.
        const lo = oo - 3 * cfg.r, hi = oo + 3 * cfg.r, room = (x) => Math.abs(x) <= ai.lim[j];
        const side = room(lo) && (!room(hi) || Math.abs(lo - mine) < Math.abs(hi - mine)) ? lo : room(hi) ? hi : null;
        if (side !== null || c.aggression >= 0.5) want = (side ?? (mine > oo ? hi : lo)) - mine;
        else follow = Math.min(follow, Math.hypot(o.R.craft.vx, o.R.craft.vy));
      } else if (dn < 0 && dn > -120 && Math.hypot(o.R.craft.vx, o.R.craft.vy) > v && c.block > 0.3 && tr.pts[R.n].k < 1 / 800) {
        // Someone closing from behind on a straight: it moves toward the inside of the next bend.
        const nb = tr.corners && tr.corners[ai.bend];
        if (nb) want = nb.side * ai.lim[j] * c.block * 0.5 - mine;
      }
      // A ship alongside: the bold sidestep into it.
      if (c.ram && Math.abs(dn) < 2 * cfg.r && Math.abs(oo - lateral(tr, R)) < 4 * cfg.r && R.dash.charges >= 1 && R.dash.t <= 0 && ai.rng() < c.ram * dt) {
        ctl.events.push({ type: 'flick', rel: Math.sign(oo - lateral(tr, R)) * (Math.PI / 2) });
      }
    }
    if (ai.slip && ai.slip.type === 'wide') want += -ai.slip.side * ai.lim[j] * 0.6;
    ai.shift += (want - ai.shift) * Math.min(1, 3 * dt);
    const off = clamp(mine + ai.shift, -ai.lim[j], ai.lim[j]);
    ctl.angle = Math.atan2(p.y + p.tx * off - C.y, p.x - p.ty * off - C.x);
    // The brake: for what's ahead it can't take at this speed, leaving itself ROOM × brake.
    const a = cfg.stats.accel, dec = R.tune.handling.BRAKE * a, room = ROOM * c.brake;
    for (let d = 0; d < (v * v) / (2 * dec) + 80; d += 8) {
      const vt = Math.min(target(ai, Track.ahead(tr, R.n, d), top, b), d < 60 + v * 0.35 ? follow : Infinity);
      if (v > vt && (v * v - vt * vt) / (2 * dec) >= d - room) { ctl.brake = true; break; }
    }
    if (ai.slip && ai.slip.type === 'late' && ctl.brake && ai.slip.t > 0) { ai.slip.t -= dt; ctl.brake = false; }
    if (!ctl.brake && v > target(ai, R.n, top, b) * 1.02) ctl.speed = target(ai, R.n, top, b) / top; // lifting
    if (ai.calm > 0) ctl.speed = Math.min(ctl.speed, 0.85);
    boost(G, X, v, top);
    return ctl;
  }

  // A forward dash: by the culture's habit and the level's odds, but only on its line and where the
  // line ahead holds the boost: straight enough for the burst it can't steer through, and for the
  // speed it sheds after (at the acceleration) within the grip.
  function boost(G, X, v, top) {
    const { R, ai, ctl, cfg } = X, tr = G.tr;
    if (R.dash.charges < 1 || R.dash.t > 0 || ai.calm > 0 || ctl.brake || Math.abs(lateral(tr, R) - ai.line.off[R.n]) > cfg.r) { ai.open = false; return; }
    const a = cfg.stats.accel, grip = R.tune.handling.GRIP * a * 0.9, vb = top * Run.DASH.boost, burst = vb * Run.DASH.boostTime;
    let clear = true;
    for (let d = 0; d < burst + (vb * vb - top * top) / (2 * a) + 60 && clear; d += 12) {
      const u = d < burst ? vb : Math.max(top, Math.sqrt(vb * vb - 2 * a * (d - burst)));
      if (u * u * ai.line.k[Track.ahead(tr, R.n, d)] > (d < burst ? 0.3 : 1) * grip) clear = false;
    }
    const how = ai.c.boost, ready = how === 'random' ? clear && ai.rng() < 0.3 * Run.STEP : clear && v > (how === 'exits' ? 0.7 : 0.85) * top;
    if (ready && !ai.open && ai.rng() < ai.lv.boost) ctl.events.push({ type: 'flick', rel: 0 });
    ai.open = how === 'random' ? false : ready;
  }

  // How far across the track a run's craft is (+: the way −ty, tx).
  function lateral(tr, R) {
    const p = tr.pts[R.n];
    return (R.craft.x - p.x) * -p.ty + (R.craft.y - p.y) * p.tx;
  }

  // ---------- The pack ----------

  const prog = [];
  function step(P, G, R) {
    const all = P.racers.map((X) => ({ R: X.R, prog: progress(G, X.R) }));
    if (R) all.push({ R, prog: progress(G, R) });
    P.racers.forEach((X, i) => {
      prog.length = 0;
      for (const o of all) if (o.R !== X.R) prog.push(o);
      fly(G, X, prog, R ? (all[all.length - 1].prog - all[i].prog) * G.tr.len : null);
      X.R.fx.length = 0;
      Run.step(X.R, G, X.cfg, X.ctl);
      if (X.ai.finish === null && X.R.laps.length >= X.cfg.race) X.ai.finish = X.R.total;
    });
    ships(all.map((o) => o.R), P.racers[0] ? P.racers[0].cfg.r : 0);
  }

  // Ships against ships: circles pushed apart, their speeds toward each other traded (a soft knock,
  // no damage; one harder than BUMP is felt: R.fx 'bump'). A ship in the air passes over.
  const KNOCK = 0.3, BUMP = 40;
  function ships(Rs, r) {
    for (let i = 0; i < Rs.length; i++) for (let j = i + 1; j < Rs.length; j++) {
      const A = Rs[i], B = Rs[j], a = A.craft, b = B.craft;
      if (A.air > 10 || B.air > 10) continue;
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
      if (d >= 2 * r || d === 0) continue;
      const nx = dx / d, ny = dy / d, push = (2 * r - d) / 2;
      a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push;
      const into = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
      if (into <= 0) continue;
      const k = ((1 + KNOCK) * into) / 2;
      a.vx -= nx * k; a.vy -= ny * k; b.vx += nx * k; b.vy += ny * k;
      if (into > BUMP) for (const X of [A, B]) X.fx.push('bump');
    }
  }

  // Where everyone is: those finished first, by their time, then the rest by how far round. Yours
  // (R) is the row with `you`; your time is the run's total once it's done.
  function standings(P, G, R) {
    const rows = P.racers.map((X) => ({ id: X.who.id, name: X.who.name, color: X.who.color, done: X.ai.finish, prog: progress(G, X.R) }));
    rows.push({ id: 'you', name: 'You', color: '#ffffff', you: true, done: R.phase === 'done' ? R.total : null, prog: progress(G, R) });
    rows.sort((a, b) => (a.done === null) - (b.done === null) || (a.done !== null ? a.done - b.done : b.prog - a.prog));
    return { place: rows.findIndex((r) => r.you) + 1, of: rows.length, rows };
  }

  // ---------- Headless ----------

  function race(seed, opts, { level = 'advanced', biome, laps = 3 } = {}) {
    const { G, cfg, run } = Pilot.flat(seed, opts, { laps, biome }), probe = run();
    const L = Line.build(G.tr, { stats: cfg.stats, handling: probe.tune.handling, r: cfg.r });
    const P = pack(G, cfg, L, level, seed, run);
    for (let t = 0; t < 90 * laps && P.racers.some((X) => X.ai.finish === null); t += Run.STEP) step(P, G, null);
    return P.racers.map((X) => ({ id: X.who.id, time: X.ai.finish, pace: X.who.pace, line: X.ai.line.time, hits: X.R.hits, slips: X.ai.slips, laps: X.R.laps.slice(0, laps) }));
  }

  return { CULTURES, LEVELS, PLAYER, field, grid, pack, step, ships, progress, standings, race };
})();

export { Rival };
