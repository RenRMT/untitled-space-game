// Missions in flight: the galaxy's jobs (game/jobs.js, their data story/jobs.js) joined to the rest
// of the flight view (their things in space, ticks, docking, the station screen's views and the
// objective the HUD and map follow), and conversations on the comms box while flight goes on.
// Part of the flight view; src/main.js starts it.

import { Comms } from '../ui/comms.js';
import { SystemMap } from '../ui/map.js';
import { docked } from './docking.js';
import { jobObjective, jobThings, jobViews, jobsDocked, jobsMined, tickJobs, trackedJob } from './jobs.js';
import { chooseSetting } from './options.js';
import { fight, inFight, setMode } from './state.js';
import { world } from './world.js';

// A conversation on the comms box: lines from someone, one after another, then `then`. A line may
// be a question ({ text, ask, options }) whose answer sets a setting.
export const talk = { lines: null, i: 0, from: '', face: null, then: null };

// What's in space for the missions now, near the camera.
export const missionThings = () => jobThings();

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

// Nothing else going on (no fight or its outcome, no conversation, not docked): when comms calls come.
export const calm = () => !inFight() && !fight.result && !talk.lines && !Comms.isOpen && !docked;

// Each step: the jobs under way.
export const tickMission = (dt) => tickJobs(dt);
// An asteroid mined (a) or a gas pocket collected: a rock counted toward the jobs that want it.
export function missionCollected(kind, a) {
  if (kind === 'mine' && a) jobsMined(a);
}
// Docked at a station: a conversation ends, and the jobs see where the ship is.
export function missionDocked(station) {
  if (talk.lines) endTalk();
  jobsDocked(station);
}
// The station screen's view of the missions (ui/station.js): the jobs.
export const missionViews = (station) => jobViews(station);

// Where the tracked job goes next, for the HUD, an edge marker and the map: { text, x, y, station, r? }, or null.
export function objective() {
  const job = trackedJob();
  return job ? jobObjective(job) : null;
}

// The jump gates: their destinations named, and the map shows every system (wormholes too).
export function showGates() {
  for (const g of world.scene.gates) {
    g.offline = false;
    g.name = g.gate.name;
  }
  SystemMap.access = { system: () => true, gate: () => true };
}
