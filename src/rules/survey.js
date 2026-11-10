// Surveys: what there is to find at each deep-space site (world/deep-space.js), beyond the
// observatory some have. Every site holds one find, made once: fly inside its survey range and hold
// there while the scanner works (TIME), and it pays credits and experience by how far the pilot has
// come; the rarer and harder-to-reach kinds also give gear to choose (rules/loot.js 'mission'
// offers, game/rewards.js). The stellar stream is only an arc on the map: nothing to fly to.
//
//   Survey.FINDS[kind]              { what (a line: what was found), k (worth), gear? ({ floor, luck }) }
//   Survey.TIME                     seconds of scanning
//   Survey.has(site) -> bool        there's something to find there
//   Survey.range(site) -> units     how close to its centre the ship has to be
//   Survey.level(pilotLevel) -> 1..5   the system level its rewards count as
//   Survey.reward(site, pilotLevel) -> { what, credits, xp, gear: { level, floor, luck } | null }
// ES module (`Survey`); also runs in Node (the tests).

const Survey = (() => {
  const G = (floor, luck) => ({ floor, luck });
  const FINDS = {
    smbh: { what: 'A probe from before the gates, still falling, its log intact', k: 5, gear: G('rare', 2.6) },
    'nuclear-cluster': { what: 'Star charts of the core\'s crowd, good enough to sell', k: 3 },
    'open-cluster': { what: 'A cache left by a survey crew among the young stars', k: 1.5, gear: G('uncommon', 1.3) },
    'globular-cluster': { what: 'A dead relay with a hold of old gear, never collected', k: 2.5, gear: G('uncommon', 1.8) },
    'hii-region': { what: 'Spectra of the glowing gas: the refineries pay for these', k: 1.5 },
    'molecular-cloud': { what: 'A smuggler\'s drop hidden in the dust', k: 2, gear: G('uncommon', 1.5) },
    'bok-globule': { what: 'A cold stash in the dark: someone meant to come back', k: 2, gear: G('uncommon', 1.6) },
    'protoplanetary-disc': { what: 'Samples from a world still forming', k: 1.5 },
    'supernova-remnant': { what: 'Heavy elements in the shell, mapped and claimed', k: 2 },
    pulsar: { what: 'Timing data: a navigation fix every pilot wants', k: 2.5 },
    'neutron-star': { what: 'A wreck drawn in close, its guns still mounted', k: 2.5, gear: G('uncommon', 1.8) },
    magnetar: { what: 'A hulk stripped by the field, its shielding untouched', k: 3, gear: G('rare', 2) },
    'stellar-black-hole': { what: 'A ship held in orbit for a century, its fittings like new', k: 3.5, gear: G('rare', 2.2) },
    microquasar: { what: 'Readings of the jet from closer than anyone has flown', k: 3 },
    'white-dwarf': { what: 'What is left of its planets, assayed', k: 1.5 },
    'recurrent-nova': { what: 'A record of the last burst, from an instrument left to watch', k: 2 },
    'kilonova-remnant': { what: 'Gold and platinum in the debris, and a prospector\'s abandoned rig', k: 3, gear: G('uncommon', 2) },
    'wolf-rayet': { what: 'The wind\'s chemistry, sampled inside the bubble', k: 2 },
    'variable-star': { what: 'Its pulse timed: a yardstick for the charts', k: 1.5 },
    'brown-dwarf': { what: 'A fuel cache in its moons\' shadow', k: 1.5, gear: G('uncommon', 1.2) },
    'rogue-planet': { what: 'A lander on the ice, sealed, its stores unopened', k: 2, gear: G('uncommon', 1.5) },
    'interstellar-object': { what: 'A piece of another star\'s system, and it is not all rock', k: 3.5, gear: G('rare', 2.2) },
    'hypervelocity-star': { what: 'Its track back to the core, plotted', k: 3 },
    'satellite-galaxy': { what: 'A beacon no chart lists, and what was left beside it', k: 6, gear: G('rare', 3) },
  };
  const TIME = 4;
  const has = (site) => !!(site && FINDS[site.kind]);
  // Inside half its reach, and never a pinpoint or a day's flying across.
  const range = (site) => Math.max(2500, Math.min(20000, (site.r || 0) * 0.5));
  const level = (pilotLevel) => Math.max(1, Math.min(5, Math.ceil((pilotLevel || 1) / 6)));
  function reward(site, pilotLevel = 1) {
    const F = FINDS[site.kind];
    if (!F) return null;
    const L = level(pilotLevel);
    return {
      what: F.what,
      credits: Math.round((300 * F.k * L ** 1.3) / 50) * 50,
      xp: Math.round(60 * F.k * L ** 1.4),
      gear: F.gear ? { level: L, ...F.gear } : null,
    };
  }
  return { FINDS, TIME, has, range, level, reward };
})();

export { Survey };
