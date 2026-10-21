// The galaxy's jobs in flight (story/jobs.js; the opening missions are game/missions.js's): their
// things in space (hostile waves, items to collect, gas pockets, the ship being escorted), their
// progress each frame, the lines said on the comms as a step opens, where the HUD and map point,
// and the station screen's view of them: accepting, handing in, abandoning and tracking one, and
// what handing it in pays (credits, components, loyalty at stations).
// Progress is read from what has happened where it can be (a wave's ships and a job's items are
// gone from the world: cargo.removed; goods are in the hold), so a save can't fall out of step
// with it; points reached, stations docked at and rocks mined are counted as they happen. Things
// in space are keyed by the job and how many times it has been accepted, so a job abandoned and
// taken again starts over.
// Part of the flight view; src/main.js starts it.

import { ArtBlueprints } from '../art/blueprints.js';
import { ArtCrew } from '../art/crew.js';
import { ArtCulture } from '../art/culture.js';
import { hashInt, seedToInt } from '../core/rng.js';
import { Entities } from '../flight/entities.js';
import { Goods } from '../rules/goods.js';
import { Industry } from '../rules/industry.js';
import { Loadout } from '../rules/loadout.js';
import { Reputation } from '../rules/reputation.js';
import { Jobs } from '../story/jobs.js';
import { Missions } from '../story/missions.js';
import { Factions } from '../world/factions.js';
import { addTo, cargo, devUnlock, gatesOnline, hold, opening, saveCargo } from './cargo.js';
import { engage } from './combat.js';
import { docked } from './docking.js';
import { faceOf } from './intro.js';
import { calm, say } from './missions.js';
import { frameList } from './selection.js';
import { NEAR, SHIP, TAU, cam, fight, inFight, intro, notify, ship } from './state.js';
import { world } from './world.js';

// built: per job id, its things in space for the attempt under way ({ n, steps: [[entity]] per
// step (made when first needed), escort }); centre: where a rushing wave came in (by `${id}:${i}`),
// this session only; callT: seconds the next comms call has waited for calm.
export const jobRun = { built: new Map(), centre: new Map(), callT: 0 };
// A rushing wave comes in this far from the ship, once the ship is out in open space (this far
// from every station, and out of a waystation's signal) or near the step's own place.
export const RUSH = { arrive: 1500, open: 5000, signal: 7500, near: 5000 };
export const JOB_REACH = Jobs.REACH;

const log = () => cargo.missions;
export const jobOf = (id) => (cargo.board ? cargo.board.byId[id] || null : null);
export const isJob = (id) => !!jobOf(id);
const live = (id) => ['active', 'ready'].includes(log().status(id));
// The jobs under way, in the order they were first taken.
export const activeJobs = () => (cargo.board ? log().ids().filter((id) => jobOf(id) && live(id)) : []);
const keyOf = (id, i, k) => `j:${id}:${log().attempt(id)}:${i}.${k}`;
const stepId = (i) => `s${i}`;
// Where a job is handed in: the station its last step delivers to, or where it was accepted.
export const handInKey = (J) => J.handIn || log().at(J.id);
const stationByKey = (key) => world.scene.stations.find((s) => s.key === key) || null;

// A job's hostile ship, circling (cx, cy).
function hostile(J, i, k, p, cx, cy) {
  const w = J.steps[i].wave, crew = Jobs.CREWS[w.crew] || Jobs.CREWS.pirates;
  const culture = crew.culture === 'pirates' ? world.cultures.pirates : world.cultures.of(crew.culture);
  return {
    ...Entities.fighter({ key: keyOf(J.id, i, k), art: ArtBlueprints.create(Entities.fighterClass(w.tier, p.seed), culture, p.seed), x: cx, y: cy, orbit: p.orbit, speed: p.speed, a0: p.a0, tier: w.tier }),
    crew: crew.label,
  };
}

// Whether a rushing wave can come in now: the ship out in the open, or near the step's place.
function rushReady(s) {
  const away = (st) => Math.hypot(st.x - ship.x, st.y - ship.y) - st.radius;
  if (world.scene.stations.some((st) => st.station.waystation && away(st) < RUSH.signal)) return false;
  return Math.hypot(s.wave.x - ship.x, s.wave.y - ship.y) < RUSH.near || world.scene.stations.every((st) => away(st) >= RUSH.open);
}
// Where a rushing wave came in, once it has (or null).
const rushCentre = (J, i) => jobRun.centre.get(`${J.id}:${i}`) || null;

// The things of one step: a wave (a rushing one where it came in), its items or its gas pockets.
function stepThings(J, i) {
  const s = J.steps[i];
  if (s.type === 'fight') {
    const at = s.wave.rush ? rushCentre(J, i) : s.wave;
    return s.wave.ships.map((p, k) => hostile(J, i, k, p, at.x, at.y));
  }
  if (s.type === 'take') {
    return s.items.map((it, k) => ({ ...Entities.item({ key: keyOf(J.id, i, k), kind: it.kind, seed: it.seed, angle: it.seed % 6, tumble: 0.2, x: it.x, y: it.y }), label: it.label, mission: J.id }));
  }
  if (s.type === 'gas') {
    const n = world.galaxy.nebulae[s.nebula];
    return s.pockets.map((q, k) => ({ kind: 'gas', gas: { type: q.type, seed: q.seed, r: q.r }, key: keyOf(J.id, i, k), pocket: { type: q.type, r: q.r }, color: n.color, radius: q.r, x: q.x, y: q.y }));
  }
  return [];
}

// A job's things for the attempt under way, made as they're first needed.
function built(J) {
  const n = log().attempt(J.id);
  let b = jobRun.built.get(J.id);
  if (!b || b.n !== n) {
    b = { n, steps: J.steps.map(() => null), escort: null };
    jobRun.built.set(J.id, b);
    for (const k of [...jobRun.centre.keys()]) if (k.startsWith(`${J.id}:`)) jobRun.centre.delete(k);
  }
  return b;
}
const things = (J, i) => {
  const b = built(J);
  if (!b.steps[i]) b.steps[i] = stepThings(J, i);
  return b.steps[i];
};
// The keys a step's things go by (without making them).
const stepKeys = (J, i) => {
  const s = J.steps[i], n = s.type === 'fight' ? s.wave.ships.length : s.type === 'take' ? s.items.length : s.type === 'gas' ? s.pockets.length : 0;
  return Array.from({ length: n }, (_, k) => keyOf(J.id, i, k));
};

// The ship being escorted: with you once its job is under way (or once step `from` is done),
// until the job is handed in (or step `until` is done, where it stays behind).
export function escortOf(J) {
  if (!J.escort || log().status(J.id) !== 'active') return null;
  const e = J.escort, L = log();
  if (e.from !== undefined && !L.done(J.id, stepId(e.from))) return null;
  if (e.until !== undefined && L.done(J.id, stepId(e.until))) return null;
  const b = built(J);
  if (!b.escort) {
    const art = ArtBlueprints.create('freighter', world.cultures.of(e.culture), e.seed);
    // As quick as your ship, so it keeps up.
    const stats = { ...Loadout.stats(Loadout.npc('freighter', 1)), maxSpeed: SHIP.maxSpeed, accel: SHIP.accel, turnRate: SHIP.turnRate };
    b.escort = {
      kind: 'ship', key: `j:${J.id}:${b.n}:escort`, escort: J.id, art, name: e.name, note: 'Escort · following you', color: world.cultures.of(e.culture).color,
      stats, radius: art.radius, x: ship.x - Math.cos(ship.angle) * 200, y: ship.y - Math.sin(ship.angle) * 200, vx: ship.vx, vy: ship.vy, angle: ship.angle, a: ship.angle, thrust: 0,
    };
  }
  return b.escort;
}
export const escorts = () => activeJobs().map(jobOf).map(escortOf).filter(Boolean);

// What's in space for the jobs now, near the camera: each fight's wave (a rushing one only once
// it has come in), items and gas pockets of steps not yet done, and every escort.
export function jobThings() {
  const out = [], L = log();
  for (const id of activeJobs()) {
    const J = jobOf(id);
    J.steps.forEach((s, i) => {
      if (!['fight', 'take', 'gas'].includes(s.type) || L.done(id, stepId(i))) return;
      if (s.type === 'fight' && s.wave.rush && !rushCentre(J, i)) return;
      const list = things(J, i);
      const c = list[0];
      if (c && Math.hypot((c.motion ? c.motion.cx : c.x) - cam.x, (c.motion ? c.motion.cy : c.y) - cam.y) > NEAR + 2000) return;
      out.push(...list);
    });
    const e = escortOf(J);
    if (e) out.push(e);
  }
  return out;
}

// The objectives that follow from where things are: points reached (with the escort along),
// waves and items gone, pockets collected, goods in the hold; and a rushing wave sent at the ship
// once its step opens. Each step's lines are said, when nothing else is going on, as it opens.
export function tickJobs(dt) {
  if (!cargo.board || intro.on) return;
  const L = log();
  let changed = false, calling = false;
  for (const id of activeJobs()) {
    const J = jobOf(id);
    J.steps.forEach((s, i) => {
      const o = stepId(i), open = L.open(id, o);
      if (s.say && i && open === false && L.open(id, `m${i}`) && !L.done(id, `m${i}`) && !calling) {
        calling = true;
        if (calm()) {
          jobRun.callT += dt;
          if (jobRun.callT >= 1.2) {
            jobRun.callT = 0;
            say(s.say, { from: J.from, face: giverFace(J), then: () => { if (L.set(id, `m${i}`, 1)) saveCargo(); } });
          }
        } else jobRun.callT = 0;
      }
      if (s.type === 'go' && open) {
        s.points.forEach((p, k) => {
          if (p.station || Math.hypot(ship.x - p.x, ship.y - p.y) >= Jobs.REACH) return;
          if (reachPoint(J, i, k)) { changed = true; notify(`Reached · ${p.name}`, 2.5, { priority: 1 }); }
        });
      } else if (s.type === 'fight' || s.type === 'take' || s.type === 'gas') {
        changed = L.set(id, o, stepKeys(J, i).filter((k) => cargo.removed.has(k)).length) || changed;
        if (s.type === 'fight' && s.wave.rush && open && !L.done(id, o)) rushIn(J, i);
      }
    });
  }
  changed = countGoods() || changed;
  if (!calling) jobRun.callT = 0;
  if (changed) saveCargo();
}

// The goods each open bring step has aboard, from the hold (also while docked, where flight
// doesn't run: buying them there counts at once). Whether the log changed.
export function countGoods() {
  let changed = false;
  for (const id of activeJobs()) {
    jobOf(id).steps.forEach((s, i) => {
      if (s.type === 'bring') changed = log().set(id, stepId(i), log().open(id, stepId(i)) ? Math.min(s.n, hold.count(s.kind)) : 0) || changed;
    });
  }
  return changed;
}

// A point of a go step reached (k, or the step's only one): whether the log changed.
function reachPoint(J, i, k) {
  const L = log(), s = J.steps[i], o = stepId(i);
  if (s.points.length === 1) return L.set(J.id, o, 1);
  if (!L.set(J.id, `${o}p${k}`, 1)) return false;
  L.set(J.id, o, s.points.filter((_, j) => L.done(J.id, `${o}p${j}`)).length);
  return true;
}

// A rushing wave comes in near the ship once its step is open and the ship is somewhere it can
// (rushReady), and each of its fights starts as it comes, like an ambush.
function rushIn(J, i) {
  if (inFight() || fight.grace > 0 || docked || fight.result) return;
  const k = `${J.id}:${i}`;
  if (!jobRun.centre.has(k)) {
    if (!rushReady(J.steps[i])) return;
    const a = Math.random() * TAU;
    jobRun.centre.set(k, { x: ship.x + Math.cos(a) * RUSH.arrive, y: ship.y + Math.sin(a) * RUSH.arrive });
    notify(`Contacts inbound · ${(Jobs.CREWS[J.steps[i].wave.crew] || Jobs.CREWS.pirates).label.toLowerCase()}`, 2.5, { priority: 2, tone: 'hostile' });
  }
  const list = things(J, i), due = list.find((e) => !cargo.removed.has(e.key) && !fight.dying.has(e.key));
  if (!due) return;
  const e = frameList.find((x) => x.key === due.key);
  if (e) engage(e, true);
}

// Docking at a station: the go steps that stop there count it.
export function jobsDocked(station) {
  let changed = false;
  for (const id of activeJobs()) {
    const J = jobOf(id), L = log();
    J.steps.forEach((s, i) => {
      if (s.type !== 'go' || !L.open(id, stepId(i))) return;
      s.points.forEach((p, k) => { if (p.station === station.key && reachPoint(J, i, k)) changed = true; });
    });
  }
  if (changed) saveCargo();
}

// An asteroid broken up: counted toward each open mine step for its kind of rock.
export function jobsMined(a) {
  let changed = false;
  for (const id of activeJobs()) {
    const J = jobOf(id), L = log();
    J.steps.forEach((s, i) => {
      if (s.type !== 'mine' || !L.open(id, stepId(i)) || (s.rock && a.ast.type !== s.rock)) return;
      changed = L.set(id, stepId(i), L.count(id, stepId(i)) + 1) || changed;
    });
  }
  if (changed) saveCargo();
}

// Where a job goes next, for the HUD, an edge marker and the map: { text, x, y, station, r }, or null.
export function jobObjective(id) {
  const J = jobOf(id), L = log();
  if (!J || !live(id)) return null;
  if (L.status(id) === 'ready') {
    const st = stationByKey(handInKey(J));
    return st && { text: `Report to ${st.name}`, x: st.x, y: st.y, station: st, r: st.radius };
  }
  const o = L.current(id);
  if (!o) return null;
  const i = Number(o.id.slice(1)), s = J.steps[i];
  const text = `${o.label}${o.need > 1 ? ` · ${o.count}/${o.need}` : ''}`;
  const near = (list) => list.sort((a, b) => Math.hypot(a.x - ship.x, a.y - ship.y) - Math.hypot(b.x - ship.x, b.y - ship.y))[0] || null;
  const at = (p, r = 600) => p && (p.station ? { text, x: p.x, y: p.y, station: stationByKey(p.station), r: stationByKey(p.station)?.radius || r } : { text, x: p.x, y: p.y, station: null, r });
  if (s.type === 'go') return at(near(s.points.filter((_, k) => (s.points.length === 1 ? true : !L.done(id, `${o.id}p${k}`)))));
  if (s.type === 'fight') return at((s.wave.rush && rushCentre(J, i)) || s.wave, 700);
  if (s.type === 'take' || s.type === 'gas') {
    const keys = stepKeys(J, i), list = (s.items || s.pockets).filter((_, k) => !cargo.removed.has(keys[k]));
    return at(near(list.map((p) => ({ x: p.x, y: p.y }))), 300);
  }
  if (s.type === 'mine') return at(s.at, 1200);
  if (s.type === 'bring') {
    const st = stationByKey(handInKey(J));
    return st && { text, x: st.x, y: st.y, station: st, r: st.radius };
  }
  return null;
}
// The job the HUD and map follow: the one tracked, else the first under way.
export function trackedJob() {
  const list = activeJobs();
  return list.includes(cargo.track) ? cargo.track : list[0] || null;
}

// ---------- On the station screen ----------

// Whether a job can be taken: station services open (the opening missions done), every system it
// goes to reachable (the gates online, outside the first system), and not withdrawn: a situation's
// jobs from a faction are, once a job in that situation has been done against it.
export function available(J) {
  if (opening() && !devUnlock) return false;
  if (!gatesOnline() && J.systems.some((s) => s !== 0)) return false;
  return !withdrawn(J);
}
export function withdrawn(J) {
  if (!J.situation || log().status(J.id) !== 'offered') return false;
  return cargo.board.list.some((o) => o.situation === J.situation && o.system === J.system && o.against === J.faction && log().status(o.id) === 'done');
}

// The face of whoever gives a job (art/crew.js): for a station's own jobs, someone of the culture
// the station is built in (a waystation's android); for a system's or a faction's, someone of the
// giving faction's culture (world/factions.js), or a human of one of the three settled cultures
// for a faction without one. A faction the player hasn't heard of sends a Drifter go-between, so
// its face gives nothing away. Each giver keeps one face.
const faces = new Map();
function cultureOf(lineage, seed) {
  if (lineage === 'android') return world.android;
  if (lineage === 'alien') return ArtCulture.xeno(world.galaxy.seed).alien;
  if (lineage === 'kitbash') return world.cultures.pirates;
  const human = world.cultures.cultures.filter((c) => c.kind === 'settled' && c.lineage !== 'android');
  return human.find((c) => c.lineage === lineage) || human[seed % human.length];
}
function giverFace(J) {
  const key = `${world.galaxy.seed}|${J.from}|${J.tier}|${J.scope}`;
  if (!faces.has(key)) {
    const st = J.tier === 'station' ? world.galaxy.stations.find((x) => x.key === J.scope) : null;
    const seed = st ? st.seed : hashInt(seedToInt(J.from), seedToInt(String(J.scope)), 0xface);
    let culture;
    if (st) culture = world.cultures.of(st.culture);
    else {
      const f = Factions.get(J.faction);
      culture = cultureOf(f && f.hidden && !f.known ? 'kitbash' : f && f.culture, seed);
    }
    faces.set(key, ArtCrew.create(seed, culture));
  }
  return faceOf(faces.get(key));
}

// The station screen's view of the jobs here: those offered here, every one under way (wherever
// it was taken) and those done that this station offered or took in.
export function jobViews(station) {
  if (!cargo.board) return [];
  if (countGoods()) saveCargo();
  const L = log(), st = station.station, out = [];
  for (const J of cargo.board.list) {
    const status = L.status(J.id), offered = Jobs.offeredAt(J, st), handIn = handInKey(J);
    if (status === 'offered' && !(offered && available(J))) continue;
    if (status === 'done' && !offered && handIn !== st.key) continue;
    const here = status === 'ready' ? handIn === st.key : offered;
    const lines = status === 'done' ? J.debrief : status === 'ready' ? J.report : J.briefing;
    const where = handIn && stationByKey(handIn);
    out.push({
      id: J.id, title: J.title, from: J.from, face: giverFace(J), status, here, tier: Jobs.TIERS[J.tier].label,
      lines: Missions.lines(lines, L, J.id),
      objectives: L.objectives(J.id),
      provided: status !== 'done' ? J.provided : null,
      reward: J.rewardText,
      pays: { credits: J.reward.credits, items: Object.entries(J.reward.components).map(([kind, n]) => ({ kind, n })), also: [...J.reward.loyalty.map((l) => l.text), ...J.reward.regard] },
      note: status === 'done' ? doneNote(J) : status === 'offered' && J.handIn ? `Handed in at ${stationByKey(J.handIn)?.name || 'its destination'}.` : null,
      handIn: where ? where.name : null,
      tracked: trackedJob() === J.id,
      accept: () => acceptJob(J.id, st.key), complete: () => completeJob(J.id),
      abandon: live(J.id) ? () => abandonJob(J.id) : null,
      track: live(J.id) ? () => { cargo.track = J.id; saveCargo(); } : null,
    });
  }
  return out;
}
// What a job done opened up: production at the stations it made trust you.
function doneNote(J) {
  const keys = J.reward.loyalty.filter((l) => l.n > 0).flatMap((l) => l.keys)
    .filter((k) => Industry.trusted(cargo.loyalty, k) && Industry.STAGE[stationType(k)]);
  if (!keys.length) return null;
  const st = stationByKey(keys[0]);
  return keys.length === 1 ? `${st.name} now takes your production orders.` : `${keys.length} stations now take your production orders.`;
}
const stationType = (key) => { const s = world.galaxy.stations.find((x) => x.key === key); return s && (s.waystation ? 'waystation' : s.market.type); };

// Accepting: tracked on the map from now on; docked at a station its first step stops at, that
// counts at once.
export function acceptJob(id, at) {
  if (!log().accept(id, at)) return;
  cargo.track = id;
  if (docked) jobsDocked(docked.station);
  saveCargo();
}
// Handing in: the goods a bring step asked for leave the hold; then the pay, the components and
// the loyalty (never below nothing) and the factions' regard (rules/reputation.js).
export function completeJob(id) {
  const J = jobOf(id);
  if (!J || log().status(id) !== 'ready') return;
  for (const s of J.steps) {
    if (s.type !== 'bring') continue;
    for (let n = 0; n < s.n; n++) {
      const i = cargo.items.findIndex((it) => it.kind === s.kind);
      if (i >= 0) cargo.items.splice(i, 1);
    }
  }
  log().complete(id);
  cargo.credits += J.reward.credits;
  for (const [kind, n] of Object.entries(J.reward.components)) if (Goods.isSalvage(kind)) addTo(cargo.components, kind, n);
  for (const l of J.reward.loyalty) for (const key of l.keys) cargo.loyalty[key] = Math.max(0, (cargo.loyalty[key] ?? Industry.LOYALTY.start) + l.n);
  Reputation.earn(cargo.rep, J);
  jobRun.built.delete(id);
  if (cargo.track === id) cargo.track = null;
  saveCargo();
}
export function abandonJob(id) {
  if (!log().abandon(id)) return;
  jobRun.built.delete(id);
  if (cargo.track === id) cargo.track = null;
  notify(`${jobOf(id).title} abandoned`, 2.5);
  saveCargo();
}
