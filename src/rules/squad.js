// The player's squad: AI-flown ships that fly in formation with the player (their leader) and
// fight beside them. Every squad member is an android ship (art/culture.js xeno().android) with
// an android designation for a name, and a program of logic lines (rules/logic.js): its
// instructions, run top down. How many lines run depends on its memory (research: mem.ext).
// - A member is plain data, saved with the cargo (game/cargo.js): { id, name, seed, hull (a ship class,
//   rules/loadout.js), tier (its gear, Mk I–V), program: [line], hullPoints, disabled }.
// - A member whose hull is shot down is disabled: it drops out of the fight and rejoins, repaired,
//   the next time the player docks.
//
//   Squad.BASE_LINES, Squad.MAX_LINES       lines that run with no memory research, and at most
//   Squad.lineLimit(bonus) -> lines that run, with `bonus` more from research
//   Squad.member(seed, { program, hull, tier }) -> a new member (the first joins at the end of the
//                                           first mission, story/missions.js)
//   Squad.stats(m) -> Loadout.stats()       what it flies with
//   Squad.formation(leader, i) -> { x, y }  its place behind the leader ({ x, y, angle })
//   Squad.setLine(m, i, line)               line i replaced (i = program.length: added at the end)
//   Squad.removeLine(m, i), Squad.moveLine(m, from, to), Squad.toggleLine(m, i)
//   Squad.read(saved, known) -> [members]   a save, checked (lines that don't check are kept, off)
// ES module (`Squad`); also runs in Node (the tests).

import { clamp } from '../core/math.js';
import { mulberry32 } from '../core/rng.js';
import { Loadout } from './loadout.js';
import { Logic } from './logic.js';

const Squad = (() => {
  const L = Logic;
  const Load = Loadout;

  const BASE_LINES = 3, MAX_LINES = 8;
  const lineLimit = (bonus = 0) => Math.min(MAX_LINES, BASE_LINES + bonus);
  // Android designations: a callsign and a two-digit unit number ("Cipher-07").
  const CALLSIGNS = ['Axiom', 'Cipher', 'Vector', 'Relay', 'Sigma', 'Index', 'Kernel', 'Lattice', 'Parse', 'Tensor', 'Quanta', 'Servo', 'Syntax', 'Vertex'];
  // Formation: members take places behind the leader, alternating left and right, a row per pair.
  const FORMATION = { back: 120, side: 95 };

  function designation(seed) {
    const r = mulberry32((seed ^ 0x5a17) >>> 0);
    return `${CALLSIGNS[Math.floor(r() * CALLSIGNS.length)]}-${String(1 + Math.floor(r() * 98)).padStart(2, '0')}`;
  }

  function member(seed, { program = [], hull = 'fighter', tier = 1, id = `sq${seed >>> 0}` } = {}) {
    const m = { id, name: designation(seed), seed: seed >>> 0, hull, tier, program: program.slice(0, MAX_LINES), hullPoints: 0, disabled: false };
    m.hullPoints = stats(m).hull;
    return m;
  }

  const stats = (m) => Load.stats(Load.npc(m.hull, m.tier));

  function formation(leader, i) {
    const row = Math.floor(i / 2) + 1, side = i % 2 ? 1 : -1;
    const bx = -FORMATION.back * row, by = side * FORMATION.side * row;
    const c = Math.cos(leader.angle), s = Math.sin(leader.angle);
    return { x: leader.x + bx * c - by * s, y: leader.y + bx * s + by * c };
  }

  const at = (m, i) => Number.isInteger(i) && i >= 0 && i < m.program.length;
  function setLine(m, i, line) {
    if (!Number.isInteger(i) || i < 0 || i > m.program.length || i >= MAX_LINES || !line) return false;
    m.program[i] = line;
    return true;
  }
  function removeLine(m, i) {
    if (!at(m, i)) return null;
    return m.program.splice(i, 1)[0];
  }
  function moveLine(m, from, to) {
    if (!at(m, from) || !at(m, to)) return false;
    const [line] = m.program.splice(from, 1);
    m.program.splice(to, 0, line);
    return true;
  }
  function toggleLine(m, i) {
    if (!at(m, i) || m.program[i].err) return false;
    m.program[i].on = !m.program[i].on;
    return true;
  }

  function read(saved, known) {
    if (!Array.isArray(saved)) return null;
    return saved.filter((d) => d && Number.isFinite(d.seed) && Load.HULLS[d.hull]?.npc).map((d) => {
      const program = (Array.isArray(d.program) ? d.program : []).map((x) => L.read(x, known));
      const m = member(d.seed, { program, hull: d.hull, tier: Number.isInteger(d.tier) ? d.tier : 1, id: String(d.id) });
      if (Number.isFinite(d.hullPoints)) m.hullPoints = clamp(d.hullPoints, 0, stats(m).hull);
      m.disabled = !!d.disabled;
      return m;
    });
  }

  return { BASE_LINES, MAX_LINES, lineLimit, member, stats, formation, setLine, removeLine, moveLine, toggleLine, read, designation };
})();

export { Squad };
