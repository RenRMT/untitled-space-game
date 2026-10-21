// How each faction regards the player: one number per faction, from -100 (hostile) to +100
// (devoted), starting where world/factions.js says (`start`: neutral, 0, for all but the aliens).
// Jobs move it (game/jobs.js): the faction a job is done for gains, the one it works against
// loses. Every change ripples (notes/factions.md, Ripple rule): when the player's regard with
// faction A changes by d, every other faction B's changes by d × (how B regards A, world/factions.js
// standing) / RIPPLE. A faction that doesn't know A exists doesn't react.
// Only factions humans know of are listed.
//
// What regard does, by the tier of the faction that owns a station (or flies the ship):
// - prices: a faction that likes you trades a little cheaper, one that doesn't charges more
//   (PRICE: a share added to the station's spread, both ways),
// - docking: a faction that counts you Hostile refuses it, except the androids, whose
//   waystations turn no one away (Factions.WAYSTATION),
// - pirates: once the Drifters (Factions.PIRATES) count you Friendly, their packs leave you be
//   (no attack on sight, no ambush on a trip); you can still attack them,
// - and the other way: every pirate you destroy costs a point with the Drifters (KILL), which
//   ripples like any other change.
//
//   Reputation.empty() -> rep                  { [faction id]: regard }; missing is the faction's start
//   Reputation.regard(rep, id) -> -100..100
//   Reputation.change(rep, id, d) -> { [id]: delta }   what moved, the ripple included
//   Reputation.tier(regard) -> { id, label, min }    Hostile, Unfriendly, Neutral, Friendly, Devoted
//   Reputation.visible() -> [faction]          the factions the player knows of, in Factions.LIST order
//   Reputation.ranked(rep) -> [faction]        those, highest regard first (ties by name)
//   Reputation.allies(id), hostiles(id) -> [faction]   among the visible ones, from the standing matrix
//   Reputation.JOB[tier] -> d                  regard a job of that tier (story/jobs.js) gives
//   Reputation.earn(rep, job) -> { [id]: delta }   a job handed in: JOB[tier] for its faction, the
//                                              same taken from the one it works against
//   Reputation.read(d) -> rep                  a saved one, checked
//   Reputation.priceShift(rep, id) -> share    added to the spread at a station of faction id
//   Reputation.refuses(rep, id) -> bool        whether faction id's stations refuse docking
//   Reputation.passage(rep) -> bool            whether pirate packs leave the player be
//   Reputation.effects(rep, id, stations) -> [text]   what the faction's regard means now, in words;
//                                              stations: whether it owns any (else no word on prices or docking)
//   Reputation.KILL                            regard lost with the Drifters per pirate destroyed
// ES module (`Reputation`); also runs in Node (the tests).

import { clamp } from '../core/math.js';
import { Factions } from '../world/factions.js';

const Reputation = (() => {
  const MAX = 100;
  const RIPPLE = 10; // a standing of +5 passes on half the change, -5 half of it reversed
  const ALLY = 2; // a standing at or above this toward another faction makes it an ally
  const JOB = { station: 4, system: 6, faction: 10 };
  const KILL = 1;
  const PRICE = { devoted: -0.04, friendly: -0.02, neutral: 0, unfriendly: 0.06, hostile: 0.12 };
  const OPEN_DOORS = [Factions.WAYSTATION]; // never refuse docking
  // Tiers by regard, highest first: the first whose `min` the regard reaches.
  const TIERS = [
    { id: 'devoted', label: 'Devoted', min: 60 },
    { id: 'friendly', label: 'Friendly', min: 15 },
    { id: 'neutral', label: 'Neutral', min: -15 },
    { id: 'unfriendly', label: 'Unfriendly', min: -60 },
    { id: 'hostile', label: 'Hostile', min: -Infinity },
  ];

  const startOf = (id) => (Factions.get(id) ? Factions.get(id).start : 0);
  const empty = () => ({});
  const regard = (rep, id) => (id in rep ? rep[id] : startOf(id));
  const tier = (v) => TIERS.find((t) => v >= t.min);
  const visible = () => Factions.LIST.filter((f) => f.known);
  const round = (v) => Math.round(v * 10) / 10;

  function change(rep, id, d) {
    const moved = {};
    if (!Factions.get(id) || !d) return moved;
    const move = (to, n) => {
      const before = regard(rep, to), after = round(clamp(before + n, -MAX, MAX));
      if (after === before) return;
      if (after === startOf(to)) delete rep[to]; else rep[to] = after;
      moved[to] = round(after - before);
    };
    move(id, d);
    for (const f of Factions.LIST) {
      if (f.id === id) continue;
      const s = Factions.standing(f.id, id);
      if (s) move(f.id, (d * s) / RIPPLE);
    }
    return moved;
  }

  function earn(rep, job) {
    const d = JOB[job.tier] || 0, moved = {};
    const add = (m) => { for (const [id, n] of Object.entries(m)) moved[id] = round((moved[id] || 0) + n); };
    add(change(rep, job.faction, d));
    if (job.against) add(change(rep, job.against, -d));
    return moved;
  }

  function ranked(rep) {
    return visible().sort((a, b) => regard(rep, b.id) - regard(rep, a.id) || a.name.localeCompare(b.name));
  }

  const others = (id) => visible().filter((f) => f.id !== id && Factions.standing(id, f.id) !== null);
  const allies = (id) => others(id).filter((f) => Factions.standing(id, f.id) >= ALLY && !Factions.hostile(id, f.id));
  const hostiles = (id) => others(id).filter((f) => Factions.hostile(id, f.id));

  const tierOf = (rep, id) => tier(regard(rep, id)).id;
  const priceShift = (rep, id) => (Factions.get(id) ? PRICE[tierOf(rep, id)] : 0);
  const refuses = (rep, id) => !!Factions.get(id) && !OPEN_DOORS.includes(id) && tierOf(rep, id) === 'hostile';
  const passage = (rep) => regard(rep, Factions.PIRATES) >= TIERS.find((t) => t.id === 'friendly').min;

  function effects(rep, id, stations = true) {
    const out = [];
    const shift = priceShift(rep, id);
    if (stations && refuses(rep, id)) out.push('Their stations refuse you docking.');
    else if (stations && shift) out.push(`Their stations give you ${Math.round(Math.abs(shift) * 100)}% ${shift < 0 ? 'better' : 'worse'} prices, buying and selling.`);
    if (id === Factions.PIRATES) out.push(passage(rep) ? 'Their packs leave you be.' : 'Their packs attack you on sight.');
    return out;
  }

  function read(d) {
    const out = {};
    if (d && typeof d === 'object') {
      for (const [id, v] of Object.entries(d)) if (Factions.get(id) && Number.isFinite(v) && v !== startOf(id)) out[id] = round(clamp(v, -MAX, MAX));
    }
    return out;
  }

  return { MAX, RIPPLE, JOB, KILL, PRICE, TIERS, empty, regard, change, earn, tier, visible, ranked, allies, hostiles, read, priceShift, refuses, passage, effects };
})();

export { Reputation };
