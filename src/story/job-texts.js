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
//   { name, from?, briefing, steps, debrief, escort?, deliver?, provided?, report? }
// or null where the system doesn't have what it needs. Steps are made with go(), fight(),
// take(), bring(), mine() and gas() below; deliver: handed in at the station the last step docks
// at; escort: { name, culture, from?, until? } (it joins once step `from` is done, if given, and
// stays behind once step `until` is, if given).
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
    ['convoy', (c) => {
      // A freighter to see to another station of the system; raiders come for it on the way.
      const to = c.pick(c.stations((s) => s.key !== c.st.key) || []);
      const mid = to && c.space({ x: (c.st.x + to.x) / 2, y: (c.st.y + to.y) / 2 }, 1500, 5000);
      return mid && {
        name: `Convoy to ${to.name}`, difficulty: 'normal', deliver: true,
        escort: { name: `${c.owner?.name || 'Station'} freighter`, culture: c.st.culture },
        briefing: [`A freighter leaves **${c.st.name}** for **${to.name}** and raiders have been watching the lane.`, 'Fly with it, keep it in one piece, and the cargo masters pay at the other end.'],
        steps: [go([mid], 'Escort the freighter along the lane'), fight(mid, c.n(2, 3), 'Fight off the ambush', { rush: true, twist: true, say: ['Contacts on the lane! They\'re going for the freighter.'] }), go([to], `See the freighter to ${to.name}`)],
        debrief: ['Cargo delivered, crew alive. The lane owes you one.'],
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

  // ---------- The main story ----------
  // Chapters in order, each opening once the one before is done and the pilot has reached its
  // `level` (game/jobs.js), offered at every station. Each happens in a system of `sysLevel` (the
  // first such system that has what it needs), further out as it goes, and ends at the galactic core.
  // giver: the faction that asks (world/factions.js), from: who says it. The factions as they are:
  // Wedge, security and order, and the rules that come with it; Block, industry and progress, with
  // little care for who gets hurt; Shard, research held as a faith; the Drifters, freedom at any
  // price; the Androids, neutral to the point of not caring; the aliens, past understanding.
  //   STORY: [{ id, level, sysLevel, giver, from, write(c) }]
  const STORY = [
    {
      id: 'papers', level: 1, sysLevel: 1, giver: 'wedge', from: 'Wedge Security Directorate',
      write: (c) => {
        const at = c.space(c.home, 5000, 11000);
        return at && {
          name: 'Papers in order', difficulty: 'normal',
          briefing: ['Every ship in Wedge space flies a registered route. Three contacts out there do not.', `They're ${where(at)}. Find out what they are, and if they won't answer, make sure they never fly unregistered again.`, 'Order is not a favour, pilot. It is the only thing between us and the dark.'],
          steps: [go([at], 'Inspect the unregistered contacts'), fight(at, 3, 'Destroy the raiders', { say: ['They\'re armed, and they\'re not stopping. Weapons free.'], twist: true })],
          debrief: ['Raiders, carrying cargo stolen from the inner lanes. Filed, closed.', 'They came from further out than they should have been able to. Something is pushing them in. Block\'s yards have noticed it too.'],
        };
      },
    },
    {
      id: 'overtime', level: 4, sysLevel: 1, giver: 'block', from: 'Block yard supervisor',
      write: (c) => {
        const st = c.stations()[0];
        return st && {
          name: 'Overtime', difficulty: 'normal',
          briefing: [`The raiders Wedge keeps chasing have found **${st.name}**. The crews want to evacuate.`, 'They will not. Quotas do not stop for weather, and they do not stop for pirates. Hold the station until the shift ends.', 'Losses are budgeted for. The output is not.'],
          steps: [defend({ ...st, key: st.key }, `Hold off the attack on ${st.name}`, { waves: 3, size: 2 })],
          debrief: ['Output held. Three crew injured, within tolerance.', 'Our survey drones logged where the raiders ran from: ships out past the frontier, flying in formations no pirate uses. Shard has been asking about them.'],
        };
      },
    },
    {
      id: 'readings', level: 8, sysLevel: 2, giver: 'shard', from: 'Shard observatory',
      write: (c) => {
        const a = c.space(c.home, 6000, 12000), b = a && c.space(a, 4000, 9000);
        return b && {
          name: 'Readings', difficulty: 'normal',
          briefing: ['Two sources in this system are emitting on a band nothing human uses. The pattern repeats every eleven minutes, and it has never once repeated exactly.', 'Take readings at both. Knowledge is the only true devotion, and this is a chance to be devout.'],
          steps: [go([a, b], 'Take readings at both sources'), fight(b, 3, 'Drive off the scavengers', { rush: true, say: ['Drifters, here for the same thing. They\'ll sell it to whoever pays.'], twist: true })],
          debrief: ['The readings are extraordinary. Whatever made them does not think in numbers the way we do.', 'The signal points out past the frontier. A Drifter captain there claims to know more. Freedom costs, she says.'],
        };
      },
    },
    {
      id: 'no-masters', level: 12, sysLevel: 3, giver: 'drifter', from: 'A Drifter captain',
      write: (c) => {
        const at = c.space(c.home, 7000, 15000);
        return at && {
          name: 'No masters', difficulty: 'hard',
          briefing: ['You want to know where the strange ships come from. I know. I\'ll tell you, too, once you\'ve done something for me.', `There's an outpost ${where(at)}. A crew that sells other crews to the Block yards. Burn it. Nobody owns anybody out here.`],
          steps: [assault(at, 'Destroy the slavers\' outpost', { outpost: true, turrets: 3, guards: 3 })],
          debrief: ['Good. Those crews are free now, and free to starve if they like. That\'s the deal out here.', 'Your ships: they come from the deep systems, past the androids\' stations. The androids have watched them pass for years. Ask them why they never said.'],
        };
      },
    },
    {
      id: 'logged', level: 16, sysLevel: 4, giver: 'android', from: 'Android station custodian',
      write: (c) => {
        const at = c.space(c.home, 6000, 14000);
        return at && {
          name: 'Logged, not reported', difficulty: 'hard',
          briefing: ['Correct. The vessels have passed this system four hundred and twelve times. Each passage is logged.', 'No one asked for the logs. Reporting is not our function. Neither is preventing.', `You may take the logs from the relay ${where(at)}. Whether you are able to is not our concern.`],
          steps: [go([at], 'Recover the logs from the relay'), fight(at, 3, 'Survive the scouts', { crew: 'aliens', say: ['The relay is being watched. Contacts closing, and they don\'t answer on any band.'], twist: true })],
          debrief: ['The logs are yours. The vessels\' passages have grown more frequent. We note this. We do not assess it.', 'The logs all point the same way: inward, toward the galactic core.'],
        };
      },
    },
    {
      id: 'contact', level: 20, sysLevel: 4, giver: 'shard', from: 'Shard observatory',
      write: (c) => {
        const at = c.space(c.home, 8000, 16000);
        return at && {
          name: 'Contact', difficulty: 'elite',
          briefing: ['The logs confirm it. They are not raiders. They are not anything we have a word for.', `One of their ships holds still ${where(at)}, as if waiting. Go to it. Record everything. If it speaks, listen. If it fires, survive.`, 'We would give anything to understand them. Do not make us give you.'],
          steps: [go([at], 'Approach the waiting ship'), fight(at, 4, 'Survive the encounter', { crew: 'aliens', up: 1, say: ['It answered. Not with words. Every gun it has.'], twist: true })],
          debrief: ['We have the recording. It is not a language. It may be a measurement. Of you.', 'Wedge wants to end this at the source, at the core. For once, Block agrees, and Shard will not be left out.'],
        };
      },
    },
    {
      id: 'the-core', level: 24, sysLevel: 5, giver: 'wedge', from: 'Wedge Security Directorate',
      write: (c) => {
        const at = c.space(c.sys.origin, 8000, 20000);
        return at && {
          name: 'The core', difficulty: 'elite',
          briefing: ['Every faction has signed off on this, which has never happened before. Do not mistake that for agreement.', `The aliens' station ${where(at)}, at the heart of the galaxy, is where every one of their ships comes from. Break its guard, then break it.`, 'Bring a squad. Bring everything.'],
          steps: [fight(at, 4, 'Break the outer guard', { crew: 'aliens', up: 1 }), assault(at, 'Destroy the alien station', { outpost: true, turrets: 3, guards: 3, crew: 'aliens', up: 1 })],
          debrief: ['It is done, or it is paused. With them, we may never know which.', 'Wedge calls it security. Block calls it opportunity. Shard calls it a lesson. The Drifters call it none of their business, and the androids have logged it.', 'You flew all of it. Whatever comes next, the galaxy knows your name.'],
        };
      },
    },
  ];

  return { STATION, SITUATION, FACTION, CONTRACTS, STORY, forStation, forHook, forFaction, go, fight, take, bring, mine, gas, assault, defend };
})();

export { JobTexts };
