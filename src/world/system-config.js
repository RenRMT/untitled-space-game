// Galaxy settings. The galaxy is generated from `seed` (a ?seed= URL parameter overrides it).
//
// params:    generator tuning for every system, merged over SolarSystem.params in world/solar-system.js
//            (any value there can be set).
// galaxy:    the galaxy's layout, over Galaxy.params in world/galaxy.js: the gap between systems, each
//            system's own params (the second is half the size) and which systems gates link.

const SYSTEM_CONFIG = {
  seed: 1,
  params: {},
  galaxy: {},
};
