// Redshift's people: one of a culture's people from a seed, named in that culture's sound and given
// a title. Their faces are drawn by faces.js (art/crew.js); this part runs in Node too, so the
// events (events.js) can say who's asking.
//
//   SimPeople.person(culture, seed) -> { culture, seed, name, title }
// ES module (`SimPeople`); also runs in Node (the tests).

import { hashInt, mulberry32 } from '../core/rng.js';

const SimPeople = (() => {
  const NAMES = {
    android: [['Unit', 'Index', 'Vector', 'Relay', 'Caliper', 'Lumen'], ['Seven', 'Nine', 'Twelve', 'Prime', 'Null', 'Four']],
    wedge: [['Ilsa', 'Corin', 'Marek', 'Tova', 'Dace', 'Renn'], ['Vasq', 'Halloran', 'Strand', 'Okoro', 'Kade', 'Brandt']],
    block: [['Hollis', 'Mabry', 'Ott', 'Senna', 'Grue', 'Pella'], ['Quarry', 'Lindqvist', 'Mott', 'Ferro', 'Dunmore', 'Oakes']],
    shard: [['Ysolde', 'Ithiel', 'Saar', 'Venn', 'Aurel', 'Myrrh'], ['of the Ninth Facet', 'Glasswright', 'Lumine', 'Seren', 'the Clear', 'Prism']],
    drifters: [['Jinx', 'Rook', 'Sable', 'Tamsin', 'Bolt', 'Wren'], ['Nobody', 'Halfmoon', 'Rustwater', 'Kett', 'Freeman', 'Scrap']],
    alien: [['∴', 'The Many', 'Seventeen Lights', 'Hollow Choir', 'Bloom', 'Tide'], ['', '', '', '', '', '']],
  };
  const TITLES = {
    android: ['Advisor', 'Ark steward', 'Gate engineer', 'Rig foreman'],
    wedge: ['Commander', 'Marshal', 'Captain', 'Sentinel'],
    block: ['Trade factor', 'Foreman', 'Broker', 'Guild master'],
    shard: ['Seer', 'Archivist', 'Lens-keeper', 'Facet'],
    drifters: ['Free captain', 'Smuggler', 'Agitator', 'Salvager'],
    alien: ['Envoy', 'Voice', 'Witness', 'Emissary'],
  };

  function person(culture, seed) {
    const r = mulberry32(hashInt(seed >>> 0, culture.length, 0xface));
    const [first, last] = NAMES[culture] || NAMES.android;
    const name = `${first[Math.floor(r() * first.length)]} ${last[Math.floor(r() * last.length)]}`.trim();
    const title = (TITLES[culture] || TITLES.android)[Math.floor(r() * 4)];
    return { culture, seed: seed >>> 0, name, title };
  }

  return { person, NAMES, TITLES };
})();

export { SimPeople };
