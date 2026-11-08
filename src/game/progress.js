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
// Part of the flight view; src/main.js starts it.

import { Feedback } from '../core/feedback.js';
import { Progress } from '../rules/progress.js';
import { applyShip, cargo, pilotLevel, saveCargo } from './cargo.js';
import { memberOf, refreshWing } from './squad.js';
import { fight, notify } from './state.js';

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

export function gainXP(n, why = '') {
  n = Math.round(n);
  if (n <= 0) return;
  const before = pilotLevel();
  cargo.pilot.xp += n;
  const after = pilotLevel();
  if (after > before) {
    applyShip(); // stronger at once (a higher maximum raises the hull points with it)
    const pts = Progress.points(after) - Progress.points(before);
    notify(`Level ${after}${pts > 0 ? ' · a talent point to spend (Ship tab, docked)' : ''}`, 4, { tone: 'good', priority: 2 });
    Feedback.emit('won');
  } else if (why) notify(`+${n} XP · ${why}`, 1.5);
  // The squad learns alongside: those in the fight (or, outside one, everyone flying).
  const ids = fight.s ? new Set((fight.s.allies || []).map((a) => a.id)) : null;
  for (const m of cargo.squad) if (!m.disabled && (!ids || ids.has(m.id))) memberXP(m, n);
  saveCargo();
}

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
