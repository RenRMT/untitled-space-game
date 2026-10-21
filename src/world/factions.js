// The factions of known space and how they regard each other at the start of the game: one per
// culture (art/culture.js), pared back from the fuller cast of notes/factions.md so the core
// gameplay can be worked on first. Every faction starts neutral toward every other and toward the
// player, except the aliens, who are hostile to everyone. The galaxy (world/galaxy.js) gives each
// station the faction of the culture it's built in.
//   Factions.LIST: [{ id, name, abbr, kind, culture, color, lawful, hidden, known, start, parts,
//     working, law, territory, ideals, drive, concern }]
//     kind: 'culture' (every faction is one now)
//     culture: the art culture (art/culture.js lineage; 'kitbash' for the Drifters)
//     hidden: its places are never on a chart
//     known: whether humans know it exists at the start
//     start: how it regards the player at the start (rules/reputation.js regard, -100..100)
//   Factions.get(id) -> the faction, or undefined
//   Factions.ofCulture(lineage) -> the faction of an art culture (a station's), or undefined
//   Factions.standing(a, b) -> how a regards b, -5..+5, or null if a doesn't know b exists
//   Factions.hostile(a, b) -> whether they attack each other on sight (-4 or lower, either way)
//   Factions.HOSTILE: the standing at or below which factions are hostile (-4)
//   Factions.PIRATES: the faction pirate packs count as (rules/reputation.js passage)
//   Factions.WAYSTATION: the faction that runs the waystations, whose doors are always open
// ES module (`Factions`); also runs in Node (the tests).

const Factions = (() => {
  const LIST = [
    {
      id: 'wedge', name: 'Wedge', abbr: 'Wdg', kind: 'culture', culture: 'wedge', color: '#5fa8ff', lawful: true,
      ideals: 'Order and reach: angular ships, spoked wheel stations on a solar spine.',
    },
    {
      id: 'block', name: 'Block', abbr: 'Blk', kind: 'culture', culture: 'block', color: '#e0a030', lawful: true,
      ideals: 'Industry first: modular slabs, lattice stations of stacked modules.',
    },
    {
      id: 'shard', name: 'Shard', abbr: 'Shd', kind: 'culture', culture: 'shard', color: '#3fbf6a', lawful: true,
      ideals: 'Precision and stillness: needle prows, radial crystal stations.',
    },
    {
      id: 'drifter', name: 'Drifters', abbr: 'Dft', kind: 'culture', culture: 'kitbash', color: '#d8824a', lawful: false,
      ideals: 'Freelancers, salvagers, explorers and outlaws on the periphery, flying whatever they can patch together. The pirate packs are theirs.',
    },
    {
      id: 'alien', name: 'Aliens', abbr: 'Aln', kind: 'culture', culture: 'alien', color: '#c86ad8', lawful: null, start: -80,
      ideals: 'Grown, not built. They answer no hail.',
    },
    {
      id: 'android', name: 'Androids', abbr: 'And', kind: 'culture', culture: 'android', color: '#4fd8ff', lawful: true, working: true,
      ideals: 'Preserve life. Never use violence. Serve without profit. Settle every account. They run the waystations.',
    },
  ];
  for (const f of LIST) {
    Object.assign(f, { hidden: !!f.hidden, known: f.known !== false, start: f.start || 0, parts: f.parts || [], working: !!f.working });
  }

  // How each faction (row) regards each other (column), -5..+5; null: it doesn't know they exist.
  // Everyone is neutral toward everyone, except the aliens and everyone else.
  const MATRIX = [
    // Wdg Blk Shd Dft Aln And
    [0, 0, 0, 0, -5, 0], // Wedge
    [0, 0, 0, 0, -5, 0], // Block
    [0, 0, 0, 0, -5, 0], // Shard
    [0, 0, 0, 0, -5, 0], // Drifters
    [-5, -5, -5, -5, 0, -5], // Aliens
    [0, 0, 0, 0, -5, 0], // Androids
  ];
  const HOSTILE = -4;
  const PIRATES = 'drifter';
  const WAYSTATION = 'android';
  const index = new Map(LIST.map((f, i) => [f.id, i]));
  const get = (id) => LIST[index.get(id)];
  const ofCulture = (lineage) => LIST.find((f) => f.culture === lineage);
  const standing = (a, b) => MATRIX[index.get(a)][index.get(b)];
  const hostile = (a, b) => a !== b && [standing(a, b), standing(b, a)].some((v) => v !== null && v <= HOSTILE);

  return { LIST, MATRIX, HOSTILE, PIRATES, WAYSTATION, get, ofCulture, standing, hostile };
})();

export { Factions };
