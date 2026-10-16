// The opening missions in flight (their data: story/missions.js): building each one's sites and
// ships, the comms lines, each one's checks every frame, and the objective the HUD and map show.
// A new mission: its data and lines in story/missions.js; here, its things in space (as the
// build* functions make them), the progress rules its tick passes to progress(), and whatever it
// does beyond those (a call on the comms, an escort, waves).
// Part of the flight view; src/main.js starts it.

import { ArtAndroids } from '../art/androids.js';
import { ArtBlueprints } from '../art/blueprints.js';
import { COLORS } from '../core/theme.js';
import { Entities } from '../flight/entities.js';
import { Squad } from '../rules/squad.js';
import { Missions } from '../story/missions.js';
import { Comms } from '../ui/comms.js';
import { SystemMap } from '../ui/map.js';
import { CHAIN, GATE_JOB, OPENING, SALVAGE, applyShip, cargo, gatesOnline, opening, repairs, saveCargo, validLoadout } from './cargo.js';
import { engage } from './combat.js';
import { docked } from './docking.js';
import { rx, ry } from './draw-world.js';
import { faceOf, waystation } from './intro.js';
import { burst } from './mining.js';
import { chooseSetting } from './options.js';
import { frameList } from './selection.js';
import { WING_SNAP, activeSquad, buildWings } from './squad.js';
import { NEAR, SHIP, TAU, cam, ctx, fight, inFight, intro, notify, setMode, ship, view, wings } from './state.js';
import { world } from './world.js';

//
// After the introduction the player is docked at the waystation with an escape pod and a debt.
// Until the first mission (story/missions.js) is handed in, every station screen offers only the
// Missions tab, and Launch waits for the mission to be accepted. Accepting provides a Courier with
// two salvaged pulse lasers. In a small asteroid field near the waystation (Missions.site) two
// pirates circle a captured android ship, with the coolant regulator it was sent for drifting
// beside it. Once the pirates are gone the android calls on the comms and follows the player home
// like a wingman; docking with it at the waystation and handing the mission in there settles the
// debt, and the android joins the squad. Progress is read every frame from what has happened
// (destroyed pirates and the collected regulator are in cargo.removed), so a save can't fall out
// of step with it. ?skipintro skips the missions as well: done, with the android in the squad.
//
// The second mission (Missions.salvageSite) is offered on handing in the first: mine three
// asteroids (the first mission's field has plenty) and collect three gas pockets in the nebula
// nearest the waystation, counted as they're done (missionCollected). After the third pocket the
// squad member picks up an android signal deeper in the nebula; there a hostile android fighter
// attacks. Destroyed, it leaves an AI logic module; the squad member is puzzled and asks to bring
// it home. Docking at the waystation with it makes the mission ready; handing it in settles the
// debt and opens the station screens.

// site: Missions.site(); rocks, pirates, android, cargo: its things in space; face: the android's
// portrait; vars: the names its lines use; hailT: seconds the android has waited to call; told:
// the waystation has said where to go (this session).
// salvage: Missions.salvageSite(), with hostile and module: its things in space; callT: seconds
// the squad member has waited to call; told: the mission ids the waystation has seen off.
export const mission = {
  site: null, rocks: [], pirates: [], android: null, cargo: null, face: null, vars: {}, hailT: 0, told: new Set(),
  salvage: null, hostile: null, module: null, callT: 0,
  gate: null, waves: [], work: 0, said: new Set(), waveT: 0,
};
// A conversation on the comms box: lines from someone, one after another, then `then`. A line may
// be a question (story/missions.js) whose answer sets a setting.
export const talk = { lines: null, i: 0, from: '', face: null, then: null };
export const MISSION_LOCKED = ['trade', 'ship', 'research', 'squad'];
export const SIGNAL_REACHED = 2200; // the android signal counts as investigated this close
export const HAIL = { range: 4000, wait: 1.2 }; // the android calls within this range, this long after the fight
export const FIELD_REACHED = 1500; // the field counts as reached this far beyond its spread

// A mission's pirate fighter ({ key, seed, orbit, speed, a0 }, story/missions.js), circling (x, y),
// built in the pirates' culture or another.
const pirate = (p, x, y, tier, culture = world.cultures.pirates) => Entities.fighter({
  key: p.key, art: ArtBlueprints.create('fighter', culture, p.seed), x, y, orbit: p.orbit, speed: p.speed, a0: p.a0, tier,
});

export function buildMission() {
  const site = Missions.site(world.galaxy);
  Object.assign(mission, {
    site, rocks: [], pirates: [], android: null, cargo: null, face: null, vars: {}, hailT: 0, told: new Set(), salvage: null, hostile: null, module: null, callT: 0,
    gate: null, waves: [], work: 0, said: new Set(), waveT: 0,
  });
  if (!site) return;
  mission.rocks = site.rocks.map(Entities.asteroid);
  mission.pirates = site.pirates.map((p) => pirate(p, site.x, site.y, site.tier));
  const a = site.android, art = ArtBlueprints.create('fighter', world.android, a.seed), name = Squad.designation(a.seed);
  mission.android = {
    kind: 'ship', android: true, key: a.key, art, name, note: '', color: world.android.color, stats: Squad.stats(Squad.member(a.seed)),
    radius: art.radius, x: site.x, y: site.y, vx: 0, vy: 0, angle: a.angle, a: a.angle, thrust: 0,
  };
  const c = site.cargo;
  mission.cargo = { ...Entities.item({ key: c.key, kind: c.kind, seed: c.seed, angle: a.angle, tumble: 0.2, x: c.x, y: c.y }), label: 'Coolant regulator', mission: OPENING };
  mission.face = ArtAndroids.create(a.seed, world.android);
  mission.vars = { ship: name, station: world.galaxy.stations[world.galaxy.waystation].name };
  buildSalvage();
  buildGate();
}

// The third mission's pirates, in their waves, circling where they arrive until the fight.
export function buildGate() {
  const G = Missions.gateSite(world.galaxy);
  mission.gate = G;
  if (!G) return;
  mission.waves = G.waves.map((wave) => wave.map((p) => pirate(p, p.cx, p.cy, G.tier)));
  mission.vars.next = world.galaxy.systems[world.galaxy.gates[G.gate].to].name;
}

// The second mission's hostile android (a pirate, as far as fights go, in android colours) and
// the AI logic module it leaves.
export function buildSalvage() {
  const S = Missions.salvageSite(world.galaxy, mission.site);
  mission.salvage = S;
  if (!S) return;
  const h = S.hostile, name = Squad.designation(h.seed);
  mission.hostile = { ...pirate(h, S.x, S.y, S.tier, world.android), android: true, name, color: world.android.color };
  const m = S.module;
  mission.module = { ...Entities.item({ key: m.key, kind: m.kind, seed: m.seed, angle: 0, tumble: 0.25, x: m.x, y: m.y }), label: 'AI logic module', mission: SALVAGE };
  Object.assign(mission.vars, { nebula: world.galaxy.nebulae[S.nebula].name, hostile: name });
}

export const fillIn = (text) => Missions.fill(text, mission.vars);
export const missionActive = () => !!mission.site && cargo.missions.status(OPENING) === 'active';
export const objectiveDone = (o) => cargo.missions.done(OPENING, o);
export const salvageActive = () => !!mission.salvage && cargo.missions.status(SALVAGE) === 'active';
export const salvageDone = (o) => cargo.missions.done(SALVAGE, o);
export const gateActive = () => !!mission.gate && cargo.missions.status(GATE_JOB) === 'active';
export const gateDone = (o) => cargo.missions.done(GATE_JOB, o);
// The gate mission's waves that have arrived: the first once the work is under way, the second
// once the first is gone and its fight is over (and a moment has passed).
export function wavesIn() {
  if (!gateActive() || !gateDone('ambush')) return [];
  const gone = (wave) => wave.every((e) => cargo.removed.has(e.key));
  return mission.waves.filter((wave, i) => i === 0 || (gone(mission.waves[i - 1]) && (mission.waveT >= GATE_WORK.pause || mission.waves[i].some((e) => fight.ships.has(e.key)))));
}
// The squad member is at the gate working on its blocks: there, the work under way, the ship
// close by, nothing else going on.
export function gateWorking() {
  const m = firstMember(), G = mission.gate;
  return gateActive() && gateDone('reach') && !gateDone('work') && !!m && !m.disabled && !inFight()
    && Math.hypot(ship.x - G.x, ship.y - G.y) < Missions.GATE.range;
}
// The squad member the first mission brought (its portrait and name are mission.face and .vars.ship).
export const firstMember = () => (mission.site ? cargo.squad.find((m) => m.seed === mission.site.android.seed) : null);
// The android follows the ship home once it has called, until it docks with it.
export const escorting = () => missionActive() && objectiveDone('hail') && !objectiveDone('escort');

// What's in space for the opening missions now, near the camera: the first mission's field
// always; while the first is under way its pirates, the regulator and the android (until it
// docks); while the second is, once the signal is found, the hostile android, then its module.
export function missionThings() {
  const site = mission.site;
  if (!site) return [];
  const near = Math.hypot(site.x - cam.x, site.y - cam.y) < NEAR + site.spread;
  const out = near ? [...mission.rocks] : [];
  if (missionActive()) {
    if (near) out.push(...mission.pirates, mission.cargo);
    if (!objectiveDone('escort') && (near || escorting())) out.push(mission.android);
  }
  // The hostile android once the signal is found, then the module it leaves.
  const S = mission.salvage;
  if (S && salvageActive() && salvageDone('signal') && Math.hypot(S.x - cam.x, S.y - cam.y) < NEAR + 1000) {
    out.push(mission.hostile);
    if (cargo.removed.has(S.hostile.key)) out.push(mission.module);
  }
  // The pirates at the gate, once their wave has come.
  if (gateActive()) out.push(...wavesIn().flat());
  return out;
}

// Lines on the comms box while flight goes on: each waits for a tap, then the next.
export function say(lines, { from, face = null, then = null }) {
  Object.assign(talk, { lines, i: 0, from, face, then });
  setMode('talking', true);
  showTalk();
}
export function showTalk() {
  if (!talk.lines) return;
  if (talk.i >= talk.lines.length) { endTalk(); return; }
  const line = talk.lines[talk.i];
  if (typeof line === 'string') {
    Comms.show({ from: talk.from, text: line, face: talk.face, onNext: () => { talk.i++; showTalk(); } });
    return;
  }
  Comms.show({
    from: talk.from, text: line.text, face: talk.face, choices: line.options.map((o) => ({ label: o.label })),
    onChoose: (k) => {
      const o = line.options[k];
      if (line.ask) chooseSetting(line.ask, o.value);
      talk.lines = [...talk.lines.slice(0, talk.i + 1), ...(o.reply ? [o.reply] : []), ...talk.lines.slice(talk.i + 1)];
      talk.i++;
      showTalk();
    },
  });
}
// The conversation over (or cut short by docking): its `then` still happens, unless it's
// dropped (another galaxy loading).
export function endTalk(keep = true) {
  if (!talk.lines) return;
  const then = keep ? talk.then : null;
  Object.assign(talk, { lines: null, i: 0, then: null });
  setMode('talking', false);
  Comms.hide();
  if (then) then();
}

// Nothing else going on (no fight or its outcome, no conversation, not docked): when a mission's
// comms calls come.
const calm = () => !inFight() && !fight.result && !talk.lines && !Comms.isOpen && !docked;

// The objectives that follow from where things are, as rules per mission, in order:
//   { o, reach: [x, y, r], after?, notice?, then? }  done once the ship is within r of (x, y) (and
//                                                    objective `after` is done): a notice, then `then`
//   { o, gone: [keys] }                              counts those of these keys gone from the world
//                                                    (destroyed or collected: cargo.removed)
// Whether the log changed.
function progress(id, rules) {
  const log = cargo.missions;
  let changed = false;
  for (const r of rules) {
    if (r.gone) {
      changed = log.set(id, r.o, r.gone.filter((k) => cargo.removed.has(k)).length) || changed;
      continue;
    }
    const [x, y, range] = r.reach;
    if (log.done(id, r.o) || (r.after && !log.done(id, r.after)) || Math.hypot(ship.x - x, ship.y - y) >= range) continue;
    if (!log.set(id, r.o, 1)) continue;
    changed = true;
    if (r.notice) notify(r.notice, 3);
    if (r.then) r.then();
  }
  return changed;
}

// The first mission: the field reached, the pirates and the regulator; the android calls once the
// pirates are gone and the fight is over.
export function tickMission(dt) {
  tickSalvage(dt);
  tickGate(dt);
  if (!missionActive() || intro.on) return;
  const site = mission.site, w = mission.android;
  const changed = progress(OPENING, [
    { o: 'field', reach: [site.x, site.y, site.spread + FIELD_REACHED], notice: `${mission.vars.ship} found · pirates guarding it` },
    { o: 'pirates', gone: site.pirates.map((p) => p.key) },
    { o: 'regulator', gone: [site.cargo.key] },
  ]);
  if (objectiveDone('pirates') && !objectiveDone('hail') && calm() && Math.hypot(ship.x - w.x, ship.y - w.y) < HAIL.range) {
    mission.hailT += dt;
    if (mission.hailT >= HAIL.wait) hail();
  } else mission.hailT = 0;
  w.note = escorting() ? 'Android · following you home' : objectiveDone('pirates') ? 'Android · free' : 'Android · held by pirates';
  if (changed) saveCargo();
}

export function hail() {
  mission.hailT = 0;
  const lines = Missions.lines(Missions.LIST[OPENING].hail, cargo.missions, OPENING).map(fillIn);
  say(lines, {
    from: mission.vars.ship, face: faceOf(mission.face),
    then: () => { if (cargo.missions.set(OPENING, 'hail', 1)) { snapEscortIfFar(); saveCargo(); } },
  });
}
// The second mission's objectives, from what has happened: the signal reached, the hostile
// android destroyed, its module collected (mining and gas are counted as they happen:
// missionCollected). The squad member calls about the signal after the third pocket, and again
// once the hostile android is gone, each time when nothing else is going on.
export function tickSalvage(dt) {
  if (!salvageActive() || intro.on) return;
  const log = cargo.missions, S = mission.salvage;
  const call = (o, lines) => {
    if (!calm() || !log.open(SALVAGE, o) || salvageDone(o)) return false;
    mission.callT += dt;
    if (mission.callT < HAIL.wait) return true;
    mission.callT = 0;
    say(Missions.lines(lines, log, SALVAGE).map(fillIn), {
      from: mission.vars.ship, face: firstMember() ? faceOf(mission.face) : null,
      then: () => { if (log.set(SALVAGE, o, 1)) saveCargo(); },
    });
    return true;
  };
  const def = Missions.LIST[SALVAGE];
  if (!call('signal', def.signal) && !call('puzzle', def.puzzle)) mission.callT = 0;
  const changed = progress(SALVAGE, [
    { o: 'investigate', after: 'signal', reach: [S.x, S.y, SIGNAL_REACHED], notice: `Android vessel ${mission.vars.hostile} · weapons hot` },
    { o: 'hostile', gone: [S.hostile.key] },
    { o: 'module', gone: [S.module.key] },
  ]);
  if (changed) saveCargo();
}

// The third mission: reaching the gate, the squad member's work on the blocks (paused while
// fighting or with the ship too far off), the pirates (the first when the work is a third done,
// the next two when that fight is over), and the squad member's report once both are through.
// The work is saved in whole percent (mission.work keeps the fraction this session).
export const GATE_WORK = { seconds: 30, reach: 1600, pause: 2.5 };
export function tickGate(dt) {
  if (!gateActive() || intro.on) return;
  const log = cargo.missions, G = mission.gate, m = firstMember();
  const tell = (key, lines, then) => {
    if (!calm() || mission.said.has(key)) return;
    mission.said.add(key);
    say(Missions.lines(lines, log, GATE_JOB).map(fillIn), { from: mission.vars.ship, face: m ? faceOf(mission.face) : null, then });
  };
  let changed = progress(GATE_JOB, [
    { o: 'reach', reach: [G.x, G.y, GATE_WORK.reach], then: () => { mission.work = log.count(GATE_JOB, 'work'); } },
    { o: 'pirates', gone: mission.waves.flat().map((e) => e.key) },
  ]);
  if (gateDone('reach') && !gateDone('work')) tell('arrive', Missions.LIST[GATE_JOB].arrive);
  if (gateWorking() && !talk.lines) {
    mission.work = Math.max(mission.work, log.count(GATE_JOB, 'work')) + (dt * 100) / GATE_WORK.seconds;
    // Each wave stops the work until it's dealt with.
    const cap = gateDone('ambush') && !gateDone('pirates') ? 99 : 100;
    mission.work = Math.min(cap, mission.work);
    // Progress is kept every percent but saved every tenth: it's redone from the last save at worst.
    const saved = log.count(GATE_JOB, 'work');
    if (log.set(GATE_JOB, 'work', Math.floor(mission.work)) && Math.floor(mission.work / 10) !== Math.floor(saved / 10)) changed = true;
    if (!gateDone('ambush') && mission.work >= Missions.GATE.workAt) {
      changed = log.set(GATE_JOB, 'ambush', 1) || changed;
      notify('Contacts incoming · pirates', 2.5);
    }
  } else if (gateActive() && gateDone('reach') && !gateDone('work') && m && m.disabled) {
    notify(`${m.name} disabled · it needs repairs at a station`, 2.5, { once: true });
  }
  // The pirates (counted as they go, above): the next wave after a pause; each fight started as it comes.
  mission.waveT = mission.waves[0].every((e) => cargo.removed.has(e.key)) && !inFight() && !fight.result ? mission.waveT + dt : mission.waveT;
  const due = wavesIn().flat().find((e) => !cargo.removed.has(e.key));
  if (due && !inFight() && fight.grace <= 0 && !docked) {
    const e = frameList.find((x) => x.key === due.key);
    if (e) engage(e, true);
  }
  if (gateDone('work') && gateDone('pirates') && !gateDone('unlocked')) {
    tell('unlocked', Missions.LIST[GATE_JOB].unlocked, () => { if (log.set(GATE_JOB, 'unlocked', 1)) saveCargo(); });
  }
  if (changed) saveCargo();
}

// The squad member's place while it works: beside the gate, facing it.
export function workSpot(w) {
  if (!gateWorking() || !w.member || w.member !== firstMember()) return null;
  const G = mission.gate;
  return { x: G.work.x, y: G.work.y, face: Math.atan2(G.y - G.work.y, G.x - G.work.x) };
}

// Its cutting beam on the gate while it works: the mining beam's look, in the android colour.
export function drawGateWork(t) {
  const w = firstMember() && wings.get(firstMember().id);
  if (!w || !workSpot(w) || Math.hypot(w.x - mission.gate.work.x, w.y - mission.gate.work.y) > 60) return;
  const G = mission.gate, gate = world.scene.gates[G.gate], ang = Math.atan2(G.y - w.y, G.x - w.x);
  const x0 = rx(w.x) + Math.cos(ang) * w.radius * 0.7, y0 = ry(w.y) + Math.sin(ang) * w.radius * 0.7;
  const reach = Math.hypot(G.x - w.x, G.y - w.y) - gate.radius * 0.35, wob = Math.sin(t * 2.3) * gate.radius * 0.25;
  const x1 = rx(w.x) + Math.cos(ang) * reach - Math.sin(ang) * wob, y1 = ry(w.y) + Math.sin(ang) * reach + Math.cos(ang) * wob;
  const flicker = 0.75 + 0.25 * Math.sin(t * 53);
  ctx.save();
  ctx.strokeStyle = w.color;
  ctx.lineCap = 'round';
  ctx.globalAlpha = 0.25 * flicker;
  ctx.lineWidth = 7 / view.zoom;
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  ctx.globalAlpha = 0.9 * flicker;
  ctx.lineWidth = 2 / view.zoom;
  ctx.stroke();
  ctx.fillStyle = COLORS.flash;
  ctx.beginPath(); ctx.arc(x1, y1, (3 + 2 * flicker) / view.zoom, 0, TAU); ctx.fill();
  ctx.restore();
  if (Math.random() < 0.3) burst(G.x - Math.cos(ang) * gate.radius * 0.35 + Math.cos(ang + Math.PI / 2) * wob, G.y - Math.sin(ang) * gate.radius * 0.35 + Math.sin(ang + Math.PI / 2) * wob, 1, { speed: [30, 90], life: [0.3, 0.7], size: [1.5, 2.5], colors: [COLORS.flash, w.color] });
}

// An asteroid mined or a gas pocket collected: counted toward the second mission.
export function missionCollected(kind) {
  if (!salvageActive()) return;
  const o = kind === 'gas' ? 'gas' : 'mine';
  if (cargo.missions.set(SALVAGE, o, cargo.missions.count(SALVAGE, o) + 1)) saveCargo();
}

// Starting to follow from wherever it is (only a teleport snaps it into place: snapWings).
export function snapEscortIfFar() {
  const w = mission.android, st = Squad.formation(ship, activeSquad().length);
  if (Math.hypot(st.x - w.x, st.y - w.y) > WING_SNAP) Object.assign(w, st, { vx: 0, vy: 0, angle: ship.angle, a: ship.angle });
}

// Docking with the android at the waystation brings it home; with the AI logic module, it brings
// the second mission home (with what the squad member had to say taken as said).
export function missionDocked(station) {
  if (talk.lines) endTalk();
  if (escorting() && station.station.waystation && cargo.missions.set(OPENING, 'escort', 1)) saveCargo();
  if (salvageActive() && station.station.waystation && salvageDone('module')) {
    cargo.missions.set(SALVAGE, 'puzzle', 1);
    cargo.missions.set(SALVAGE, 'return', 1);
    saveCargo();
  }
  if (gateActive() && station.station.waystation && gateDone('work') && gateDone('pirates')) {
    cargo.missions.set(GATE_JOB, 'unlocked', 1);
    cargo.missions.set(GATE_JOB, 'return', 1);
    saveCargo();
  }
}

// On the first launch with an opening mission under way, the waystation sees the player off:
// for the first, where to go and calibrating the ship's combat systems (the player picks the
// combat mode); for the others, where to go.
export function missionLaunched() {
  const id = missionActive() && !objectiveDone('field') ? OPENING
    : salvageActive() && !cargo.missions.count(SALVAGE, 'mine') && !cargo.missions.count(SALVAGE, 'gas') ? SALVAGE
      : gateActive() && !gateDone('reach') ? GATE_JOB : null;
  if (!id || mission.told.has(id)) return;
  mission.told.add(id);
  const lines = Missions.lines(Missions.LIST[id].launch, cargo.missions, id)
    .map((l) => (typeof l === 'string' ? fillIn(l) : l));
  say(lines, { from: mission.vars.station, face: faceOf(world.wayFace) });
}

// The station screen's view of the missions (ui/station.js). At the waystation: each mission in
// the chain once the one before it is done, until the next is accepted (so a debrief leads to
// the next offer), and the last once done. Elsewhere: whichever is under way.
export const MISSION_NOTE = {
  repayment: { active: 'The asteroid field is marked on your map.' },
  salvage: { active: 'The asteroid field and the {nebula} are marked on your map.' },
  gate: { active: 'The jump gate is marked on your map.', offered: 'Optional. Your account is settled either way.' },
};
export const inChain = () => CHAIN.filter((id) => (id === OPENING ? mission.site : id === SALVAGE ? mission.salvage : mission.gate));
export function missionViews(station) {
  if (!mission.site) return [];
  const log = cargo.missions, atWaystation = !!station.station.waystation, chain = inChain();
  const ids = chain.filter((id, i) => {
    const status = log.status(id), next = chain[i + 1];
    if (!atWaystation) return status === 'active' || status === 'ready';
    if (i > 0 && log.status(chain[i - 1]) !== 'done') return false;
    return status !== 'done' || !next || log.status(next) === 'offered';
  });
  return ids.map((id) => {
    const def = Missions.LIST[id], status = log.status(id);
    const said = !atWaystation ? [] : status === 'done' ? def.debrief : status === 'ready' ? def.report : def.briefing;
    const note = !atWaystation ? null : status === 'done' ? def.joined : (MISSION_NOTE[id] || {})[status];
    return {
      id, title: def.title, from: mission.vars.station, face: atWaystation ? faceOf(world.wayFace) : null, status, here: atWaystation,
      lines: Missions.lines(said, log, id).map(fillIn),
      objectives: log.objectives(id).map((o) => ({ ...o, label: fillIn(o.label) })),
      provided: status !== 'done' ? def.provided : null,
      reward: fillIn(def.reward),
      note: note ? fillIn(note) : null,
      accept: () => acceptMission(id), complete: () => completeMission(id),
    };
  });
}

// Accepting: for the first mission, the waystation provides the ship.
export function acceptMission(id = OPENING) {
  if (!cargo.missions.accept(id)) return;
  const gives = Missions.LIST[id].provides;
  if (gives && gives.loadout) {
    cargo.loadout = validLoadout(gives.loadout) || cargo.loadout;
    applyShip();
    cargo.hull = SHIP.hull;
  }
  saveCargo();
}
// Handing in: the first brings the android into the squad; the second settles the debt (the AI
// logic module stays with the station; it was never in the hold); the third installs the squad
// member's first combat logic module and brings the gates online.
export const FIRST_MODULE = 'assist-leader';
export function completeMission(id = OPENING) {
  if (!cargo.missions.complete(id)) return;
  if (id === OPENING) joinAndroid();
  if (id === GATE_JOB) {
    const m = firstMember();
    if (m && !m.modules.includes(FIRST_MODULE)) Squad.install(m, FIRST_MODULE, Math.max(0, m.modules.indexOf(null)));
    cargo.story.add('gates');
    showGates();
  }
  saveCargo();
}
export function joinAndroid() {
  const seed = mission.site.android.seed;
  // It joins with empty logic slots: its first modules are for a later mission.
  if (!cargo.squad.some((m) => m.seed === seed)) cargo.squad.push(Squad.member(seed));
  buildWings();
}
// ?skipintro: the introduction and the opening missions as if played.
export function skipOpening() {
  cargo.story.add('intro');
  cargo.missions.finish(OPENING);
  cargo.missions.finish(SALVAGE);
  if (mission.site) joinAndroid();
  saveCargo();
}

// What the station screen can't do yet: until the debt is settled only Missions, and Squad
// once the first mission has brought a squad member; no Launch while the next opening mission
// waits to be accepted.
export function stationLocks() {
  if (!opening()) return { tabs: [], reason: '', launch: null };
  const first = cargo.missions.status(OPENING) !== 'done', next = first ? OPENING : SALVAGE;
  return {
    tabs: first ? MISSION_LOCKED : MISSION_LOCKED.filter((t) => t !== 'squad'),
    reason: fillIn('Station services are suspended until your account with {station} is settled.'),
    launch: cargo.missions.status(next) === 'offered' ? 'Accept the mission to launch' : null,
  };
}

// Where the mission goes next, for the HUD, an edge marker and the map: { text, x, y, station }
// (station: the scene's station when it's the waystation), or null.
// The second mission's gas objective points at the nearest pocket of its nebula still to collect,
// of those well away from the pirates while any are left.
export function objective() {
  if (!mission.site || intro.on) return null;
  const W = waystation(), id = inChain().find((x) => ['active', 'ready'].includes(cargo.missions.status(x)));
  if (!id) return null;
  const status = cargo.missions.status(id);
  if (status === 'ready') return { text: `Report to ${W.name}`, x: W.x, y: W.y, station: W };
  if (status !== 'active') return null;
  const o = cargo.missions.current(id);
  if (!o) return null;
  const text = `${fillIn(o.label)}${o.percent ? ` · ${o.count}%` : o.need > 1 ? ` · ${o.count}/${o.need}` : ''}`;
  if (o.id === 'escort' || o.id === 'return') return { text, x: W.x, y: W.y, station: W };
  if (id === GATE_JOB) return { text, x: mission.gate.x, y: mission.gate.y, station: null };
  if (o.id === 'gas') {
    const left = (keys) => keys.map((k) => world.scene.get(k)).filter((e) => e && !cargo.removed.has(e.key));
    const pool = left(mission.salvage.safe).length ? left(mission.salvage.safe) : left(mission.salvage.pockets);
    const q = pool.sort((a, b) => Math.hypot(a.x - ship.x, a.y - ship.y) - Math.hypot(b.x - ship.x, b.y - ship.y))[0];
    const n = world.galaxy.nebulae[mission.salvage.nebula];
    return q ? { text, x: q.x, y: q.y, station: null } : { text, x: n.x, y: n.y, station: null };
  }
  if (id === SALVAGE && o.id !== 'mine') return { text, x: mission.salvage.x, y: mission.salvage.y, station: null };
  return { text, x: mission.site.x, y: mission.site.y, station: null };
}

// Jump gates offline (gatesOnline): they keep their destination to themselves, and the map
// doesn't show the systems beyond them.
export function showGates() {
  for (const g of world.scene.gates) {
    g.offline = !gatesOnline();
    g.name = g.offline ? 'Jump gate' : g.gate.name;
  }
  SystemMap.access = { system: (s) => gatesOnline() || world.knowledge.visited(s.index), gate: () => gatesOnline() };
}
