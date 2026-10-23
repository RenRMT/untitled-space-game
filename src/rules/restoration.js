// Restoring stations (notes/hazards.md phase 6): at the start only the waystation and the ore works
// (the mining camp) are online; the rest are restored one after another at the waystation, each
// project paid with goods from the waystation's stock and credits. The goods come from the places
// the stations before it opened up, so restoring is what draws the player further out. A restored
// station takes production orders and brings a shuttle (its output sent on: rules/industry.js
// routes); the first project is the ore works' shuttle alone.
// Pure: what's done is a list of project ids (cargo.restored).
//
//   Restoration.ONLINE                       station types online from the start
//   Restoration.PROJECTS[id] / LIST          { id, name, type (the station type it restores) | null,
//                                              shuttle (the station type it gives a shuttle) | null,
//                                              goods: { [kind]: n }, credits, requires: [id], note }
//   Restoration.online(type, done) -> bool   whether stations of that type are online
//   Restoration.shuttle(type, done) -> bool  whether stations of that type have a shuttle
//   Restoration.status(id, done, stock, credits) -> { id: 'done' | 'locked' | 'short' | 'ready', short: [{ kind, need, have }], credits }
//   Restoration.restore(id, done, stock, credits) -> { take: { [kind]: n }, credits } | null   (what it costs, if it can be paid)
// ES module (`Restoration`); also runs in Node.

const Restoration = (() => {
  const ONLINE = ['waystation', 'mining camp'];
  const LIST = [
    {
      id: 'shuttle.ore', name: 'Ore works shuttle', type: null, shuttle: 'mining camp',
      goods: { 'steel-pipe': 6, 'carbon-fibre': 2 }, credits: 400, requires: [],
      note: 'A shuttle that carries what the ore works makes wherever you send it.',
    },
    {
      id: 'restore.volatiles', name: 'Volatiles works', type: 'minor', shuttle: 'minor',
      goods: { 'steel-pipe': 10, 'carbon-fibre': 4, deuterium: 6 }, credits: 1500, requires: ['shuttle.ore'],
      note: 'Refines deuterium into hydrazine: fuel, and an input of much of the gear.',
    },
    {
      id: 'restore.transport', name: 'Transport hub', type: 'transport hub', shuttle: null,
      goods: { 'steel-pipe': 14, 'carbon-fibre': 6, hydrazine: 6 }, credits: 3000, requires: ['restore.volatiles'],
      note: 'Sets up routes between stations, with haulers that load and unload at each stop.',
    },
    {
      id: 'restore.salvage', name: 'Salvage yard', type: 'salvage yard', shuttle: 'salvage yard',
      goods: { 'steel-pipe': 12, hydrazine: 8, 'titanium-ore': 4 }, credits: 4000, requires: ['restore.transport'],
      note: 'Recycles salvaged components into refined goods and electronics.',
    },
    {
      id: 'restore.fabricator', name: 'Fabricator', type: 'major', shuttle: 'major',
      goods: { 'steel-pipe': 12, 'carbon-fibre': 10, hydrazine: 6, 'rare-earths': 4 }, credits: 6000, requires: ['restore.salvage'],
      note: 'Makes electronics, which gear from Mk II up needs.',
    },
    {
      id: 'restore.shipyard', name: 'Shipyard', type: 'capital', shuttle: 'capital',
      goods: { electronics: 10, 'steel-pipe': 16, tungsten: 6, 'titanium-ore': 6 }, credits: 10000, requires: ['restore.fabricator'],
      note: 'Assembles gear from Mk II, mods and, one day, the gate. Sells hulls.',
    },
  ];
  const PROJECTS = Object.fromEntries(LIST.map((p) => [p.id, p]));

  const online = (type, done) => ONLINE.includes(type) || LIST.some((p) => p.type === type && done.includes(p.id));
  const shuttle = (type, done) => LIST.some((p) => p.shuttle === type && done.includes(p.id));

  function status(id, done, stock, credits) {
    const p = PROJECTS[id];
    const short = Object.entries(p.goods).map(([kind, need]) => ({ kind, need, have: stock[kind] || 0 })).filter((x) => x.have < x.need);
    if (done.includes(id)) return { id: 'done', short: [], credits: false };
    if (!p.requires.every((r) => done.includes(r))) return { id: 'locked', short, credits: credits < p.credits };
    return { id: short.length || credits < p.credits ? 'short' : 'ready', short, credits: credits < p.credits };
  }
  function restore(id, done, stock, credits) {
    return status(id, done, stock, credits).id === 'ready' ? { take: { ...PROJECTS[id].goods }, credits: PROJECTS[id].credits } : null;
  }

  return { ONLINE, LIST, PROJECTS, online, shuttle, status, restore };
})();

export { Restoration };
