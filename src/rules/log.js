// The pilot's log: what a game has done so far, counted, and the milestones those counts reach.
// Each milestone pays credits once and gives the pilot a name to fly under (the grandest one
// reached). Some counts are kept here (kills, Wardens, raids, contracts, losses, time flown); the
// rest are read from what the game already keeps (level, systems visited, sites surveyed, elites
// brought down, story chapters done) and passed in as `c`, so a game begun before the log still
// has them.
//
//   PilotLog.empty() -> stats        { kills, wardens, raids, contracts, losses, seconds, done: [milestone id] }
//   PilotLog.read(d) -> stats        a saved one, checked
//   PilotLog.COUNTS                  the counts kept in stats
//   PilotLog.MILESTONES              [{ id, name, what, credits, met(s, c) }], lesser to grander
//     c: { level, systems, allSystems, surveyed, allSites, elites, chapters, allChapters }
//   PilotLog.due(stats, c) -> [milestone]   met and not yet paid
//   PilotLog.title(stats) -> name | null    the grandest milestone reached
//   PilotLog.time(seconds) -> '3 h 12 min'
// ES module (`PilotLog`); also runs in Node (the tests).

const PilotLog = (() => {
  const COUNTS = ['kills', 'wardens', 'raids', 'contracts', 'losses', 'seconds'];
  const empty = () => ({ kills: 0, wardens: 0, raids: 0, contracts: 0, losses: 0, seconds: 0, done: [] });

  const MILESTONES = [
    { id: 'first-blood', name: 'Blooded', what: 'Destroy a hostile', credits: 200, met: (s) => s.kills >= 1 },
    { id: 'contractor', name: 'Contractor', what: 'Hand in 10 contracts', credits: 2000, met: (s) => s.contracts >= 10 },
    { id: 'delver', name: 'Delver', what: 'Destroy a Warden', credits: 1000, met: (s) => s.wardens >= 1 },
    { id: 'defender', name: 'Defender', what: 'Beat off a raid on a station', credits: 1500, met: (s) => s.raids >= 1 },
    { id: 'bounty', name: 'Bounty hunter', what: 'Bring down a named elite', credits: 1500, met: (s, c) => c.elites >= 1 },
    { id: 'traveller', name: 'Traveller', what: 'Visit 10 systems', credits: 2500, met: (s, c) => c.systems >= Math.min(10, c.allSystems) && c.allSystems > 1 },
    { id: 'surveyor', name: 'Surveyor', what: 'Survey 5 deep-space sites', credits: 2500, met: (s, c) => c.surveyed >= 5 },
    { id: 'hunter', name: 'Hunter', what: 'Destroy 100 hostiles', credits: 3000, met: (s) => s.kills >= 100 },
    { id: 'veteran', name: 'Veteran', what: 'Reach level 15', credits: 5000, met: (s, c) => c.level >= 15 },
    { id: 'wardens-bane', name: 'Warden\'s bane', what: 'Destroy 10 Wardens', credits: 8000, met: (s) => s.wardens >= 10 },
    { id: 'fixer', name: 'Fixer', what: 'Hand in 50 contracts', credits: 10000, met: (s) => s.contracts >= 50 },
    { id: 'headhunter', name: 'Headhunter', what: 'Bring down 10 named elites', credits: 10000, met: (s, c) => c.elites >= 10 },
    { id: 'ace', name: 'Ace', what: 'Destroy 500 hostiles', credits: 12000, met: (s) => s.kills >= 500 },
    { id: 'core-breaker', name: 'Core breaker', what: 'Finish the story', credits: 15000, met: (s, c) => c.allChapters > 0 && c.chapters >= c.allChapters },
    { id: 'explorer', name: 'Explorer', what: 'Visit every system', credits: 20000, met: (s, c) => c.allSystems > 1 && c.systems >= c.allSystems },
    { id: 'cartographer', name: 'Cartographer', what: 'Survey every deep-space site', credits: 20000, met: (s, c) => c.allSites > 0 && c.surveyed >= c.allSites },
    { id: 'legend', name: 'Legend', what: 'Reach level 30', credits: 25000, met: (s, c) => c.level >= 30 },
  ];
  const BY_ID = Object.fromEntries(MILESTONES.map((M) => [M.id, M]));

  function read(d) {
    const s = empty();
    if (!d || typeof d !== 'object') return s;
    for (const k of COUNTS) if (Number.isFinite(d[k]) && d[k] > 0) s[k] = k === 'seconds' ? d[k] : Math.floor(d[k]);
    if (Array.isArray(d.done)) s.done = [...new Set(d.done.filter((id) => BY_ID[id]))];
    return s;
  }
  const due = (s, c) => MILESTONES.filter((M) => !s.done.includes(M.id) && M.met(s, c));
  function title(s) {
    for (let i = MILESTONES.length - 1; i >= 0; i--) if (s.done.includes(MILESTONES[i].id)) return MILESTONES[i].name;
    return null;
  }
  function time(seconds) {
    const m = Math.floor(Math.max(0, seconds) / 60), h = Math.floor(m / 60);
    return h ? `${h} h ${m % 60} min` : `${m} min`;
  }

  return { COUNTS, MILESTONES, empty, read, due, title, time };
})();

export { PilotLog };
