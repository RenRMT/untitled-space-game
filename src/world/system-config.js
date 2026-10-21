// Galaxy settings. The galaxy is generated from `seed` (a ?seed= URL parameter overrides it).
//
// params:    generator tuning for the system, merged over SolarSystem.params in world/solar-system.js
//            and the galaxy's own system params (any value there can be set).
// galaxy:    the galaxy's settings, over Galaxy.params in world/galaxy.js: the system's params,
//            the station cultures, the gate's culture and the waystation's name.

const SYSTEM_CONFIG = {
  seed: 1,
  params: {},
  galaxy: {},
};

export { SYSTEM_CONFIG };
