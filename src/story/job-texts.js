// What the galaxy's jobs say and ask (story/jobs.js places them and works out what they pay): the
// briefing that opens one, its steps (with any lines said on the comms as a step opens), and the
// debrief that closes it, with what came of it. Three kinds, by tier:
//   STATION[type]       a station's own concerns, by its type: local trouble, local stakes. Each
//                       station gets one or two of its type's.
//   SITUATION[id][i]    the job for hook i of a system's local situation, in the hooks' order: a
//                       system's politics, with sides to take.
//   FACTION[id]         a faction's concern across known space: long, far and well paid.
// The tables are empty for now: the generated jobs were cleared out while the core gameplay is
// reworked, and the board posts nothing until new ones are written here.
// A job is written by a function of its context (story/jobs.js places(): the system, the
// station or situation, helpers that find points, rocks, derelicts and stations), returning
//   { name, from?, briefing, steps, debrief, escort?, deliver?, provided?, components?, report? }
// or null where the system doesn't have what it needs. Steps are made with go(), fight(),
// take(), bring(), mine() and gas() below; deliver: handed in at the station the last step docks
// at; escort: { name, culture, from?, until? } (it joins once step `from` is done, if given, and
// stays behind once step `until` is, if given); components: [[category, n]] paid besides credits.
//   STATION[type]: [[id, write(c)]] (c.st is the station, c.owner its faction)
//   SITUATION[id]: [write(c)] (c.main: the system's main station; c.vars: its places by name; c.sit, c.hook)
//   FACTION[id]: [{ id, where(ctx), write(c) }]: where picks the system it happens in and the
//     station it starts from ({ system, from }), or null; write is given c.plan and c.home
// Lines may use **bold**. ES module (`JobTexts`); also runs in Node (the tests).

const JobTexts = (() => {
  // ---------- Steps ----------
  // points: stations (docking counts) or points in space; at: a point; o: { say, twist, ... }.
  const go = (points, label, o = {}) => ({ type: 'go', points, label, ...o });
  // o: { crew (Jobs.CREWS), rush (they come for the ship once the step opens), up, tier, say, twist }
  const fight = (at, n, label, o = {}) => ({ type: 'fight', at, n, label, ...o });
  const take = (at, item, kind, label, o = {}) => ({ type: 'take', at, item, kind, label, ...o });
  const bring = (kind, n, label, o = {}) => ({ type: 'bring', kind, n, label, ...o });
  const mine = (at, n, label, o = {}) => ({ type: 'mine', at, n, label, ...o });
  const gas = (nebula, n, label, o = {}) => ({ type: 'gas', nebula, n, label, ...o });

  // ---------- Stations ----------
  const STATION = {};
  // The templates a station draws from: its type's, every one with an id and a writer.
  function forStation(st) {
    const type = st.waystation ? 'waystation' : st.market.type;
    return (STATION[type] || []).map(([id, write]) => ({ id, write }));
  }

  // ---------- Systems: one job per situation hook ----------
  const SITUATION = {};
  const forHook = (situation, i) => (SITUATION[situation] || [])[i] || null;

  // ---------- Factions ----------
  const FACTION = {};
  const forFaction = (id) => FACTION[id] || [];

  return { STATION, SITUATION, FACTION, forStation, forHook, forFaction, go, fight, take, bring, mine, gas };
})();

export { JobTexts };
