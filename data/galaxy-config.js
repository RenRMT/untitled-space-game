// Galaxy settings. The map is generated from `seed` (a ?seed= URL parameter overrides it).
//
// factions:  overrides for major factions by id (0 = main faction; the others are numbered
//            clockwise starting from the west and depend on the seed). Only the fields given are replaced.
// networks:  overrides for factions without territory, by key (freeports, pirates, smugglers, guild).
// storyPois: handcrafted points of interest at fixed sectors, usually in the frontier.

const GALAXY_CONFIG = {
  seed: 1,
  factions: [
    // { name: 'Faction 1', color: '#ed2939' },
  ],
  networks: {
    // freeports: { name: 'Freeports' },
  },
  storyPois: [
    { x: 3, y: 5, name: 'Unidentified signal' },
  ],
};
