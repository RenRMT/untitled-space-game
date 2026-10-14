// Galaxy settings. The map is generated from `seed` (a ?seed= URL parameter overrides it).
//
// factions:  overrides for major factions by id (0 = main faction; the others are numbered
//            clockwise starting from the west and depend on the seed). Only the fields given are replaced.
// networks:  overrides for factions without territory, by key (waystations, pirates, smugglers, guild).
// storyPois: handcrafted points of interest at fixed sectors, usually in the frontier.
// params:    generator tuning, merged over Galaxy.params in galaxy.js (any value there can be set).

const GALAXY_CONFIG = {
  seed: 1,
  factions: [
    // { name: 'Faction 1', color: '#ed2939' },
  ],
  networks: {
    // waystations: { name: 'Waystations' },
  },
  storyPois: [
    { x: 3, y: 5, name: 'Unidentified signal' },
  ],
  params: {
    sectorUnits: 12000, // world units per sector in the flight view
    systems: { spacing: 3 }, // minimum distance between systems, in sectors
    outposts: { spacing: 2.5 }, // minimum distance from an outpost to any other settlement
    // Wider faction borders, so claimed (but uncharted) space stretches between the charted pockets.
    main: { sigma: 2.2 },
    majors: { sigma: 2.0 },
    minors: { sigma: 1.5 },
  },
};
