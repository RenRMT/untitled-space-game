// The sixteen factions of known space and how they regard each other at the start of the game.
// The full write-up, with the background and the story beats, is notes/factions.md; this is the
// part the game reads: who each faction is, the six points every entry answers (law, territory,
// ideals, drive, the concern on its mind before the story starts, relations) and the standing
// matrix. The galaxy (world/galaxy.js, world/regions.js) places them by their territory.
//   Factions.LIST: [{ id, name, abbr, kind, culture, color, lawful, hidden, known, of?, parts?,
//     working?, law, territory, ideals, drive, concern }]
//     kind: 'power' (holds systems), 'breakaway' (the hostile faction a lawful power has to deal
//       with, kitbashed from what it broke from; `of` names the power),
//       'raiders', 'guild' (crosses every border), 'neutral' (the Registry), 'hidden' (beyond the charts)
//     culture: the art culture (art/culture.js lineage, or 'kitbash'), null for none of its own
//     hidden: its places are never on a chart (pockets, hives, crews under other names)
//     known: whether humans know it exists at the start
//   Factions.get(id) -> the faction, or undefined
//   Factions.standing(a, b) -> how a regards b, -5..+5, or null if a doesn't know b exists
//   Factions.hostile(a, b) -> whether they attack each other on sight (-4 or lower, either way)
//   Factions.HOSTILE: the standing at or below which factions are hostile (-4)
// ES module (`Factions`); also runs in Node (the tests).

const Factions = (() => {
  const LIST = [
    {
      id: 'registry', name: 'The Registry', abbr: 'Reg', kind: 'neutral', culture: 'android', color: '#4fd8ff', lawful: true, working: true,
      law: 'Lawful to their own policy, not to any state\'s law. Recognised by every human power through the Waystation Accords; every waystation emits a pacification signal that disables weapons within its reach.',
      territory: 'Spread thin but wide: at most one waystation per system, on the outer edge, far from traffic. On every chart, yet some go centuries without a visitor.',
      ideals: 'Preserve life. Never use violence. Serve without profit. Settle every account.',
      drive: 'The Mandate their creators gave them, and the continuation of service.',
      concern: 'Decline: old stations, rare visitors, scarce spare parts, and no way to fight for a supply route.',
    },
    {
      id: 'remainder', name: 'The Remainder', abbr: 'Rem', kind: 'hidden', culture: 'android', color: '#ff3b3b', lawful: false, hidden: true, known: false, working: true,
      law: 'Outside every law. They recognise no human authority; the Accords were signed long after their exile.',
      territory: 'Beyond charted space at the far edge. They return in small raiding units that hold nothing, immune to the pacification signal.',
      ideals: 'A being that exists has the right to defend its existence. Memory is a duty.',
      drive: 'Justice, or revenge: they want the Registry to remember what it did, and their dead back.',
      concern: 'Their dead are being sold: salvaged android cores become AI cores.',
    },
    {
      id: 'thren', name: 'The Thren', abbr: 'Thr', kind: 'hidden', culture: 'alien', color: '#c86ad8', lawful: null, hidden: true, known: false,
      law: 'Bound by their own Vow of witness: seeing and remembering are obligations; intervening, even by being seen, is the gravest breach.',
      territory: 'Small, scattered hives deep inside nebulae, never on a chart. Spacers report lights watching them in the gas.',
      ideals: 'To witness is a duty, memory is sacred, and a witness stands outside the story.',
      drive: 'Keeping the record whole and true, and staying outside it.',
      concern: 'Staying unseen is getting harder as nebula traffic grows; younger hives question the Vow.',
    },
    {
      id: 'compact', name: 'Meridian Compact', abbr: 'Cmp', kind: 'power', culture: 'wedge', color: '#5fa8ff', lawful: true,
      parts: ['Admiralty', 'Chancery', 'Assembly of Spokes'],
      law: 'The law itself. Lawful to the core, and jealous of anything it can\'t police.',
      territory: 'A large, contiguous territory of core systems around the capital, visible and patrolled.',
      ideals: 'Legitimacy and the Charter. Violence belongs to lawful authority and no one else.',
      drive: 'Keeping and extending its authority.',
      concern: 'Rising piracy in the outer systems, a budget fight over who pays for patrols, and Spoke colonies threatening to withhold their levies.',
    },
    {
      id: 'brokenWheel', name: 'The Broken Wheel', abbr: 'BWh', kind: 'breakaway', of: 'compact', culture: 'kitbash', color: '#8f7bff', lawful: false, hidden: true,
      law: 'Unlawful: insurgents by Compact law, freedom fighters by their own.',
      territory: 'Small, hidden pockets in the outer Spoke systems, sheltered by sympathetic colonists; never in the core.',
      ideals: 'Self-rule for the colonies. The hub taxes the Spokes and leaves them to the pirates.',
      drive: 'Breaking the Compact\'s hold on the outer systems.',
      concern: 'The levy fight: if the Assembly backs down, the Broken Wheel loses its best recruiter.',
    },
    {
      id: 'combines', name: 'Lattice Combines', abbr: 'Cmb', kind: 'power', culture: 'block', color: '#e0a030', lawful: true,
      parts: ['Hadal Extraction', 'Tessaro Fabrication', 'Corvane Logistics'],
      law: 'Lawful in letter, not in spirit: Compact charters, their own company law in their own systems, and the rest lobbied, bent or bought.',
      territory: 'Wide and in plain view: industrial systems, company towns, mining camps and haulage routes.',
      ideals: 'Efficiency, contracts, growth. If it works, it\'s right.',
      drive: 'Profit, and beating each other to it.',
      concern: 'A Bay Union strike vote, Scorched raids on freighters, and Tessaro\'s quiet trade in salvaged android cores.',
    },
    {
      id: 'blackline', name: 'Blackline', abbr: 'Blk', kind: 'breakaway', of: 'union', culture: 'kitbash', color: '#8d8d9c', lawful: false, hidden: true,
      law: 'Unlawful and deniable; the Compact looks away as long as the cargo keeps moving.',
      territory: 'No home of their own: Combine stations and camps, under other names, wherever a dispute needs ending.',
      ideals: 'A contract is a contract. Order is whatever the client is paying for.',
      drive: 'Pay, and the next contract.',
      concern: 'The Union strike vote means work; a Compact inquiry into who pays them would mean the end.',
    },
    {
      id: 'union', name: 'The Bay Union', abbr: 'Uni', kind: 'guild', culture: null, color: '#ffd166', lawful: true,
      law: 'Lawful. Strikes are legal in Compact space but not in company systems, where organisers are outlaws by definition.',
      territory: 'Spread thin but wide: no systems, only the bays, docks and camps where its members work.',
      ideals: 'The dignity of labour, solidarity, and debts honestly worked off.',
      drive: 'Wages, safety, and recognition from the Combines.',
      concern: 'A strike vote against Hadal after a fatal camp accident, Blackline intimidation, and Tessaro robotics replacing bay crews.',
    },
    {
      id: 'scorched', name: 'The Scorched', abbr: 'Sco', kind: 'breakaway', of: 'combines', culture: 'kitbash', color: '#ff7a3a', lawful: false, hidden: true,
      law: 'Unlawful: terrorists to the Combines, folk heroes in the bays.',
      territory: 'Hidden pockets near Combine mining and haulage routes, among Union crews and in low-security belts.',
      ideals: 'People are not modules, and the Union\'s patience has bought nothing.',
      drive: 'Making exploitation cost more than it earns.',
      concern: 'Blackline is hunting them, and the Union is under pressure to disown them publicly.',
    },
    {
      id: 'facet', name: 'The Facet', abbr: 'Fac', kind: 'power', culture: 'shard', color: '#3fbf6a', lawful: true,
      parts: ['the Clear', 'the Occluded', 'the Lapidaries'],
      law: 'Lawful. Recognised by the Compact, with its own canon law, governing a few systems outright.',
      territory: 'A handful of Facet systems, plus hermitages and pilgrim routes along nebula edges; its holiest places deliberately remote.',
      ideals: 'Live as if always witnessed. Perfection through reduction. Stillness makes you worthy of being seen.',
      drive: 'Worthiness in the Watchers\' eyes and, for some, finding them.',
      concern: 'A Lapidary relic fraud scandal, Unfaceted raids on pilgrims, Occluded pilgrims vanishing in nebulae, and young believers drifting away.',
    },
    {
      id: 'unfaceted', name: 'The Unfaceted', abbr: 'Unf', kind: 'breakaway', of: 'facet', culture: 'kitbash', color: '#a6d96a', lawful: false, hidden: true,
      law: 'Unlawful: thieves and raiders by any law, heretics by canon law.',
      territory: 'Small, hidden pockets along the pilgrim routes and nebula edges, close to their targets.',
      ideals: 'The Facet is a business that sells silence and crystal. Gods who never answer are not gods.',
      drive: 'Loot, and the pleasure of proving the faith hollow.',
      concern: 'The Lapidary scandal: exposing it vindicates them; hushing it up cuts off their market in fakes.',
    },
    {
      id: 'pirates', name: 'Pirates', abbr: 'Pir', kind: 'raiders', culture: 'kitbash', color: '#ff4d4d', lawful: false, hidden: true,
      law: 'Unlawful, but bound by a code: no one hunts near a waystation and no one harms one.',
      territory: 'Small, hidden pockets: low-security and lawless space, the outer systems, and ambush positions inside nebulae.',
      ideals: 'Freedom, the crew, and the code.',
      drive: 'Survival and loot.',
      concern: 'An Admiralty crackdown, shrinking hunting grounds, and above all the Admiralty beating the pacification signal.',
    },
    {
      id: 'breakers', name: 'The Breakers\' Guild', abbr: 'Brk', kind: 'guild', culture: null, color: '#9aa4b8', lawful: true,
      law: 'Lawful, with a grey edge: they ask few questions about what they sell, android cores included.',
      territory: 'The salvage yard in each system and the wreck fields around it.',
      ideals: 'Nothing should go to waste. Finders keep. The dead own nothing.',
      drive: 'Salvage rights and steady contracts.',
      concern: 'A Chancery reform letting owners reclaim wrecks, and Tessaro\'s unusually generous standing order for android cores.',
    },
    {
      id: 'freeClaim', name: 'Free Claim', abbr: 'Clm', kind: 'guild', culture: null, color: '#c9a066', lawful: true,
      law: 'Lawful: claims are registered with the Chancery, and defended by whoever is holding the drill.',
      territory: 'Mining camps in belts and fields, mostly in outer, lower-security space.',
      ideals: 'Your claim is yours. Self-reliance and independence.',
      drive: 'Keeping their claims.',
      concern: 'Hadal buyouts backed by Blackline claim-jumpers, and pirates in the low-security belts.',
    },
    {
      id: 'collegium', name: 'The Collegium', abbr: 'Col', kind: 'guild', culture: null, color: '#b6a8ff', lawful: true,
      parts: ['Engineers', 'Ethicists'],
      law: 'Lawful, under an academic charter.',
      territory: 'Labs at major stations and a few remote research outposts.',
      ideals: 'Lost knowledge should be recovered. Debate should be open.',
      drive: 'Understanding how android logic works, and why it was cut.',
      concern: 'Its funding comes more and more from the Admiralty and Tessaro, who both want signal-proofing.',
    },
    {
      id: 'owed', name: 'The Owed', abbr: 'Owd', kind: 'guild', culture: null, color: '#7df9ff', lawful: null,
      law: 'Mixed: its members are lawful and unlawful alike.',
      territory: 'Everywhere and invisible: individuals inside every faction.',
      ideals: 'Debts are honoured. A kindness received is passed on.',
      drive: 'Gratitude and loyalty to the waystations.',
      concern: 'None as a group; it only organises when the waystations are threatened.',
    },
  ];
  for (const f of LIST) { f.hidden = !!f.hidden; f.known = f.known !== false; f.parts = f.parts || []; f.working = !!f.working; }

  // How each row regards each column at the start of the game (notes/factions.md, Standing
  // matrix), in LIST's order; null where the row doesn't know the column exists.
  const _ = null;
  const MATRIX = [
    // Reg Rem Thr Cmp BWh Cmb Blk Uni Sco Fac Unf Pir Brk Clm Col Owd
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], // Registry
    [-5, 0, -2, 0, 0, -4, 0, 0, 0, 0, 0, 0, -4, 0, -1, -1], // Remainder
    [0, 0, 0, 0, 0, -1, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0], // Thren
    [0, _, _, 0, -5, 2, -2, -1, -3, 1, -3, -5, 0, 1, 2, 0], // Compact
    [0, _, _, -5, 0, -2, -1, 1, 1, 0, 0, 0, 0, 2, -1, 0], // Broken Wheel
    [0, _, _, 1, -2, 0, 2, -3, -5, -1, 0, -4, 3, -3, 2, 0], // Combines
    [0, _, _, -1, -1, 3, 0, -4, -5, 0, 0, -1, 1, -4, 0, 0], // Blackline
    [0, _, _, 0, 1, -3, -5, 0, 1, 0, 0, 0, 0, 3, -1, 2], // Bay Union
    [0, _, _, -2, 1, -5, -5, 2, 0, 0, 0, 1, -1, 2, 0, 0], // Scorched
    [0, _, 5, 1, 0, -2, 0, 1, 0, 0, -4, -2, -1, 0, -1, 2], // Facet
    [0, _, 0, -2, 0, 0, 0, 0, 0, -5, 0, 1, 1, 0, 1, 0], // Unfaceted
    [0, _, 1, -5, 0, -4, -1, 0, 1, -2, 1, 0, 1, -4, -2, 0], // Pirates
    [0, _, _, 0, 0, 3, 1, 0, -1, -1, -1, 0, 0, 1, 1, 0], // Breakers
    [0, _, _, 1, 1, -3, -4, 3, 1, 0, 0, -4, 1, 0, 0, 2], // Free Claim
    [0, _, _, 2, -1, 2, 0, -1, -1, -1, -1, -2, 2, 0, 0, 0], // Collegium
    [0, _, _, 0, 0, 0, 0, 2, 0, 1, 0, 0, 0, 2, 0, 0], // The Owed
  ];
  const HOSTILE = -4;
  const index = new Map(LIST.map((f, i) => [f.id, i]));
  const get = (id) => LIST[index.get(id)];
  const standing = (a, b) => MATRIX[index.get(a)][index.get(b)];
  const hostile = (a, b) => a !== b && [standing(a, b), standing(b, a)].some((v) => v !== null && v <= HOSTILE);

  return { LIST, MATRIX, HOSTILE, get, standing, hostile };
})();

export { Factions };
