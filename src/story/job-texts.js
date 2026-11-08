// What the galaxy's jobs say and ask (story/jobs.js places them and works out what they pay): the
// briefing that opens one, its steps (with any lines said on the comms as a step opens), and the
// debrief that closes it, with what came of it. Three kinds, by tier:
//   STATION[type]       a station's own concerns, by its type: local trouble, local stakes. Each
//                       station gets one or two of its type's.
//   SITUATION[id][i]    the job for hook i of a system's local situation, in the hooks' order: a
//                       system's politics, with sides to take.
//   FACTION[id]         a faction's concern across known space: long, far and well paid.
// For now every station posts combat contracts (CONTRACTS, the same for every type of station):
// hunting raiders, destroying a turret battery or a pirate outpost (in the station's system or a
// nearby one), holding off waves attacking the station, and an elite strike further out. Each has
// a difficulty (story/jobs.js DIFFICULTY) that sets how tough its hostiles are, what it pays and
// the gear it rewards (rules/loot.js). The system and faction tables are empty for now.
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
  // o: { outpost (a pirate station, else a turret battery), turrets, guards (ships), crew, up, say, twist }
  const assault = (at, label, o = {}) => ({ type: 'assault', at, label, ...o });
  // at: the station attacked; o: { waves, size (ships in the first wave; every second wave one more), crew, up }
  const defend = (at, label, o = {}) => ({ type: 'defend', at, label, ...o });

  // ---------- Combat contracts, at every station ----------
  // c: the station's places (story/jobs.js places()), c.st the station, c.owner its faction.
  const where = (p) => (p ? p.name : 'out there');
  const CONTRACTS = [
    ['patrol', (c) => {
      const at = c.space(c.st, 4000, 9000);
      const n = c.n(2, 3);
      return at && {
        name: 'Raider patrol', difficulty: 'easy',
        briefing: [`Raiders have been seen ${where(at)}, picking off traffic bound for **${c.st.name}**.`, `${n} ships. Drive them off for good and the station pays.`],
        steps: [fight(at, n, 'Destroy the raiders')],
        debrief: ['The lanes are quiet again. Good flying.'],
      };
    }],
    ['battery', (c) => {
      const at = c.space(c.st, 5000, 12000);
      return at && {
        name: 'Silence the battery', difficulty: 'normal',
        briefing: [`Pirates have set up a turret battery ${where(at)}, covering the approach to **${c.st.name}**.`, 'Take out every turret. Expect a few ships guarding it.'],
        steps: [assault(at, 'Destroy the turret battery', { turrets: c.n(2, 3), guards: c.n(1, 2) })],
        debrief: ['Battery down. Traffic is moving again.'],
      };
    }],
    ['siege', (c) => {
      const waves = c.n(3, 4);
      return {
        name: 'Hold the line', difficulty: waves > 3 ? 'hard' : 'normal',
        briefing: [`Raiders are massing to hit **${c.st.name}** in waves.`, `Hold off ${waves} waves. The station's own turrets will fire with you.`],
        steps: [defend({ ...c.st, key: c.st.key }, 'Hold off the attack', { waves, size: 2 })],
        debrief: ['They broke off. The station owes you.'],
      };
    }],
    ['outpost', (c) => {
      // Half the time in a nearby system, where the pirates feel safe.
      const far = c.r() < 0.5 ? c.nearby() : null, P = far || c;
      const at = P.space(far ? P.sys.origin : c.st, far ? 6000 : 7000, far ? 18000 : 14000);
      return at && {
        name: far ? `Raid on ${P.sys.name}` : 'Burn the outpost', difficulty: 'hard',
        briefing: [`A pirate outpost ${where(at)}${far ? ` in the **${P.sys.name}** system` : ''} is where the raids on **${c.st.name}** come from.`, 'Destroy the outpost and its turrets. It will be guarded.'],
        steps: [assault(at, 'Destroy the outpost and its turrets', { outpost: true, turrets: c.n(2, 3), guards: c.n(2, 3) })],
        debrief: ['The outpost is a cloud of scrap. That will set them back months.'],
      };
    }],
    ['strike', (c) => {
      const P = c.nearby();
      const at = P && P.space(P.sys.origin, 8000, 20000);
      return at && {
        name: `Strike on ${P.sys.name}`, difficulty: 'elite',
        briefing: [`Our scouts found a fortified pirate outpost ${where(at)} in the **${P.sys.name}** system.`, 'Heavy turrets and a strong guard. Only take this with a squad and good gear.'],
        steps: [fight(at, c.n(2, 3), 'Break the outer patrol', { up: 0 }), assault(at, 'Destroy the fortified outpost', { outpost: true, turrets: 3, guards: c.n(2, 3) })],
        debrief: ['Clean work. Word of this will reach every pirate in the sector.'],
      };
    }],
  ];
  const STATION_TYPES = ['capital', 'major', 'minor', 'mining camp', 'salvage yard', 'transport hub', 'waystation'];

  // ---------- Stations ----------
  const STATION = Object.fromEntries(STATION_TYPES.map((t) => [t, CONTRACTS]));
  // The templates a station draws from: its type's (every one with an id and a writer), else the contracts.
  function forStation(st) {
    const type = st.waystation ? 'waystation' : st.market.type;
    return (STATION[type] || CONTRACTS).map(([id, write]) => ({ id, write }));
  }

  // ---------- Systems: one job per situation hook ----------
  const SITUATION = {};
  const forHook = (situation, i) => (SITUATION[situation] || [])[i] || null;

  // ---------- Factions ----------
  const FACTION = {};
  const forFaction = (id) => FACTION[id] || [];

  return { STATION, SITUATION, FACTION, CONTRACTS, forStation, forHook, forFaction, go, fight, take, bring, mine, gas, assault, defend };
})();

export { JobTexts };
