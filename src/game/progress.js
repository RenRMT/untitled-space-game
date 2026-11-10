// Experience and levels in play (rules/progress.js): the pilot's and the squad's, earned from what's
// destroyed (game/combat.js, game/dungeon.js, game/structures.js), contracts handed in (game/jobs.js)
// and Wardens. A level up says so, makes the ship (or the wingman) a little stronger at once, and
// every third level gives a talent point, spent on the Ship tab (ui/station.js, `pilot` below).
//
//   gainXP(n, why?)                   the pilot's, and the squad's flying beside it (fight: the allies
//                                     of the fight under way; else every member not disabled)
//   memberXP(member, n)               one squad member's
//   pilotView                         the station menu's view: { level, xp, into, need, max, points, left,
//                                     talents (taken), list() -> [{ ...talent, taken, ok, why }], take(id),
//                                     respec() (credits), respecPrice }
//   levelFor(id | null) -> level      the pilot's (null) or a squad member's (its id)
//   record(count, n?)                 the pilot's log (rules/log.js): a kill, a Warden, a contract ... counted,
//                                     and any milestone that reaches paid (checkMilestones)
//   logView                           the station menu's view of the log: { title, rows, milestones }
// Part of the flight view; src/main.js starts it.

import { Feedback } from '../core/feedback.js';
import { Abilities } from '../rules/abilities.js';
import { Classes } from '../rules/classes.js';
import { Loadout } from '../rules/loadout.js';
import { Survey } from '../rules/survey.js';
import { PilotLog } from '../rules/log.js';
import { Progress } from '../rules/progress.js';
import { addNews, applyShip, cargo, pilotLevel, saveCargo } from './cargo.js';
import { world } from './world.js';
import { memberOf, refreshWing } from './squad.js';
import { fight, notify, showBanner } from './state.js';

export const levelFor = (id) => (id ? Progress.of(memberOf(id)?.xp || 0).level : pilotLevel());

export function memberXP(m, n) {
  if (!m || n <= 0) return;
  const before = Progress.of(m.xp).level;
  m.xp = (m.xp || 0) + Math.round(n);
  const after = Progress.of(m.xp).level;
  if (after > before) {
    refreshWing(m); // its stats follow its level
    notify(`${m.name} reached level ${after}`, 3, { tone: 'good' });
  }
}

// What the levels from `before` up to `after` gave, a few words each: a class skill, a talent point,
// program memory, a hull now in reach.
export function gains(before, after, cls) {
  const out = [];
  for (const id of Classes.skills(cls)) { const a = Abilities.ABILITIES[id]; if (a.level > before && a.level <= after) out.push(`New skill: ${a.name}`); }
  const pts = Progress.points(after) - Progress.points(before);
  if (pts > 0) out.push(pts > 1 ? `${pts} talent points` : 'Talent point');
  if (Progress.lineBonus(after) > Progress.lineBonus(before)) out.push('Program memory +1');
  for (const [hull, lv] of Object.entries(Progress.HULL_LEVEL)) if (lv > before && lv <= after && Loadout.HULLS[hull]) out.push(`${Loadout.HULLS[hull].name} hull`);
  if (!out.length) out.push('Hull, shields and guns up');
  return out;
}

export function gainXP(n, why = '') {
  n = Math.round(n);
  if (n <= 0) return;
  const before = pilotLevel();
  cargo.pilot.xp += n;
  const after = pilotLevel();
  if (after > before) {
    applyShip(); // stronger at once (a higher maximum raises the hull points with it)
    const pts = Progress.points(after) - Progress.points(before);
    showBanner(`LEVEL ${after}`, gains(before, after, cargo.cls).join(' · '), 'good', 4);
    notify(`Level ${after}${pts > 0 ? ' · talent point (Ship tab)' : ''}`, 4, { tone: 'good' });
    Feedback.emit('won');
    checkMilestones(); // those a level reaches
  } else if (why) notify(`+${n} XP · ${why}`, 1.5);
  // The squad learns alongside: those in the fight (or, outside one, everyone flying).
  const ids = fight.s ? new Set((fight.s.allies || []).map((a) => a.id)) : null;
  for (const m of cargo.squad) if (!m.disabled && (!ids || ids.has(m.id))) memberXP(m, n);
  saveCargo();
}

// ---------- The pilot's log (rules/log.js) ----------

// What the log reads from the rest of the game rather than counts itself.
export function logContext() {
  const G = world.galaxy, K = world.knowledge, story = cargo.board ? cargo.board.list.filter((J) => J.chapter) : []; // (not the job after the story, which repeats)
  return {
    level: pilotLevel(),
    systems: G && K ? G.systems.filter((_, i) => K.visited(i)).length : 0, allSystems: G ? G.systems.length : 0,
    surveyed: cargo.world.surveyed.length, allSites: G ? (G.sites || []).filter((s) => Survey.has(s)).length : 0,
    elites: Object.values(cargo.world.elites).reduce((n, e) => n + (e.n || 0), 0),
    chapters: story.filter((J) => cargo.missions.status(J.id) === 'done').length, allChapters: story.length,
  };
}
// Milestones met and not yet paid: paid now, said, and on the next dock's news.
export function checkMilestones() {
  const due = PilotLog.due(cargo.stats, logContext());
  for (const M of due) {
    cargo.stats.done.push(M.id);
    cargo.credits += M.credits;
    notify(`Milestone: ${M.name} · +${M.credits.toLocaleString('en-US')} credits`, 4, { tone: 'good' });
    addNews(`Milestone · ${M.name}`, 'ship');
  }
  if (due.length) { Feedback.emit('won'); saveCargo(); }
  return due.length;
}
export function record(count, n = 1) {
  if (!PilotLog.COUNTS.includes(count)) return;
  cargo.stats[count] += n;
  checkMilestones();
  saveCargo();
}
export const logView = {
  get title() { return PilotLog.title(cargo.stats); },
  // The counts, as [label, value] rows.
  rows() {
    const s = cargo.stats, c = logContext(), n = (v) => v.toLocaleString('en-US');
    return [
      ['Time flown', PilotLog.time(s.seconds)],
      ['Hostiles destroyed', n(s.kills)],
      ['Named elites brought down', n(c.elites)],
      ['Wardens destroyed', n(s.wardens)],
      ['Raids beaten off', n(s.raids)],
      ['Contracts handed in', n(s.contracts)],
      ['Story chapters', `${c.chapters} of ${c.allChapters}`],
      ['Systems visited', `${c.systems} of ${c.allSystems}`],
      ['Sites surveyed', `${c.surveyed} of ${c.allSites}`],
      ['Ships lost', n(s.losses)],
    ];
  },
  milestones: () => PilotLog.MILESTONES.map((M) => ({ id: M.id, name: M.name, what: M.what, credits: M.credits, done: cargo.stats.done.includes(M.id) })),
};

export const pilotView = {
  get level() { return pilotLevel(); },
  get xp() { return cargo.pilot.xp; },
  get into() { return Progress.of(cargo.pilot.xp).into; },
  get need() { return Progress.of(cargo.pilot.xp).need; },
  get max() { return Progress.of(cargo.pilot.xp).max; },
  get points() { return Progress.points(pilotLevel()); },
  get left() { return Progress.points(pilotLevel()) - cargo.pilot.talents.length; },
  get talents() { return cargo.pilot.talents; },
  get respecPrice() { return Progress.RESPEC(pilotLevel()); },
  log: logView,
  list() {
    const o = { level: pilotLevel(), cls: cargo.cls, talents: cargo.pilot.talents };
    return Progress.talentsFor(cargo.cls).map((t) => ({ ...t, taken: o.talents.includes(t.id), ...Progress.canTake(t.id, o) }));
  },
  take(id) {
    if (!Progress.canTake(id, { level: pilotLevel(), cls: cargo.cls, talents: cargo.pilot.talents }).ok) return false;
    cargo.pilot.talents.push(id);
    applyShip();
    saveCargo();
    return true;
  },
  // Forget every talent, for credits: the points come back to spend again.
  respec() {
    if (!cargo.pilot.talents.length || cargo.credits < pilotView.respecPrice) return false;
    cargo.credits -= pilotView.respecPrice;
    cargo.pilot.talents = [];
    applyShip();
    saveCargo();
    return true;
  },
};
