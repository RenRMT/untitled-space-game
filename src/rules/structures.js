// Structures: the man-made things that don't fly (turrets and stations) as things to fight.
// Every station holds 0–3 turrets in orbit round it (art/turrets.js draws them: a missile turret or
// a gun turret, in the station's culture), more where security is high and in harder systems. A
// station, its turrets and a mission's hostile outposts can all be attacked and destroyed; turrets
// are tougher than ships, stations tougher again. Their gear goes by the system's level (1..5),
// like the hostiles' (world/security.js levelTier).
//
//   Structures.turretCount(rng, { security, level, size }) -> 0..3
//     security: the most security the station's system has (its cap: 2 in a territory's space, 1 in
//     the Drifters' and Androids', 0 the aliens'); level: the system's (1..5); size: the station's
//     ('major' for capitals and hubs)
//   Structures.turretKind(rng) -> 'gun' | 'missile'
//   Structures.turretStats(kind, tier), stationStats(tier, size), outpostStats(tier)
//                               -> combat stats as rules/loadout.js stats() makes them (fixed: they never move)
//   Structures.HEALTH            how much tougher than a fighter of the same tier each is
//   Structures.REGARD            regard lost with the owner for attacking (strike) and for each
//                                turret or station destroyed (rules/reputation.js)
//   Structures.TURRET_SCALE      how much larger than its blueprint a turret is drawn in space
//   Structures.orbit(i, n, stationRadius) -> { orbit, angle, period } where the i-th of n goes round
// ES module (`Structures`); also runs in Node (the tests).

import { clamp } from '../core/math.js';
import { Loadout } from './loadout.js';

const Structures = (() => {
  // Hull and shields as multiples of a fighter's of the same tier; recharge likewise.
  const HEALTH = {
    turret: { hull: 4, shield: 2.2, recharge: 1.5 },
    station: { hull: 14, shield: 6, recharge: 4 },
    capital: { hull: 20, shield: 8, recharge: 5 },
    outpost: { hull: 10, shield: 4, recharge: 3 },
  };
  const REGARD = { strike: 12, turret: 4, station: 25 };
  const TURRET_SCALE = 3;

  // Most turrets where it's safest and round the big stations; harder systems a few more.
  function turretCount(rng, { security = 2, level = 1, size = 'minor' } = {}) {
    let n = clamp(security, 0, 2) + (size === 'major' ? 1 : 0) + (level >= 3 && rng() < 0.5 ? 1 : 0);
    if (rng() < 0.25) n -= 1;
    return clamp(n, 0, 3);
  }
  const turretKind = (rng) => (rng() < 0.45 ? 'missile' : 'gun');

  const fighter = (tier) => Loadout.stats(Loadout.npc('fighter', clamp(tier, 1, 5)));
  const firepower = (weapons) => weapons.reduce((n, w) => n + w.damage * w.fireRate, 0);
  // What every structure shares: it holds still (no engine), turns slowly to aim, never dodges.
  function structure(name, base, k, weapons, extra = {}) {
    return {
      ...base, name, hull: Math.round(base.hull * k.hull), shield: Math.round(base.shield * k.shield), shieldRecharge: Math.round(base.shieldRecharge * k.recharge * 10) / 10,
      maxSpeed: 1, accel: 1, turnRate: 2, evasion: 0, accuracy: Math.min(0.95, base.accuracy + 0.05), lockTime: base.lockTime * 1.2, lockRange: 1800,
      weapons, firepower: firepower(weapons), weaponsFitted: weapons.length, miningRate: 0, structure: true, ...extra,
    };
  }

  // A turret: a gun turret's twin barrels, or a missile turret's slow, heavy salvoes, all round.
  function turretStats(kind, tier) {
    const base = fighter(tier), gun = base.weapons[0];
    const weapons = kind === 'missile'
      ? [{ name: 'Missile pods', damage: Math.round(gun.damage * 4), fireRate: 0.6, range: 1300, arc: 360 }]
      : [{ name: 'Turret guns', damage: Math.round(gun.damage * 1.1 * 10) / 10, fireRate: 3, range: 950, arc: 360 }, { name: 'Turret guns', damage: Math.round(gun.damage * 1.1 * 10) / 10, fireRate: 3, range: 950, arc: 360 }];
    return structure(kind === 'missile' ? 'Missile turret' : 'Gun turret', base, HEALTH.turret, weapons);
  }
  // A station: batteries all round, and a great deal of hull.
  function stationStats(tier, size = 'minor') {
    const base = fighter(tier), gun = base.weapons[0];
    const battery = { name: 'Defence battery', damage: Math.round(gun.damage * 1.6 * 10) / 10, fireRate: 2, range: 1150, arc: 360 };
    return structure('Station', base, size === 'capital' ? HEALTH.capital : HEALTH.station, [battery, { ...battery }]);
  }
  // A mission's hostile outpost: a pirate station, less armoured than a faction's.
  function outpostStats(tier) {
    const base = fighter(tier), gun = base.weapons[0];
    const battery = { name: 'Outpost battery', damage: Math.round(gun.damage * 1.4 * 10) / 10, fireRate: 2, range: 1050, arc: 360 };
    return structure('Outpost', base, HEALTH.outpost, [battery, { ...battery }]);
  }

  // The i-th of n turrets round a station of this radius: evenly spaced, a slow turn round it.
  const orbit = (i, n, R) => ({ orbit: Math.round(R + 220 + (i % 2) * 90), angle: (i / Math.max(1, n)) * Math.PI * 2, period: 240 + i * 30 });

  return { HEALTH, REGARD, TURRET_SCALE, turretCount, turretKind, turretStats, stationStats, outpostStats, orbit };
})();

export { Structures };
