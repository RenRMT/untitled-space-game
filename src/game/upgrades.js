// Whether a piece of gear is an upgrade, and for whom: your ship or a squad member's, each against
// what that ship has fitted, by how much stronger it makes the ship in a fight (Combat.rating). Said
// when loot drops (game/cargo.js lootNotice), over a selected drop (game/draw-world.js) and on the
// spare gear (ui/station.js).
//
//   upgradesFor(id) -> [{ member (id, or null: your ship), who ('you' or the member's name), slot,
//                         gain (0.12: 12% stronger), need (the level it asks for, when that's above
//                         the ship's: not fittable yet) }]   fittable first, then the best; upgrades
//                         only, and none for gear fitted already
//   upgradeLine(id) -> text   '▲ +12% for you', '▲ +8% for Vex-4 · +3% for you', or ''
//   isUpgrade(id) -> bool     an upgrade someone can fit now
// Part of the flight view.

import { Combat } from '../combat/combat.js';
import { Loadout } from '../rules/loadout.js';
import { Progress } from '../rules/progress.js';
import { cargo, pilotLevel, shipUpgrades } from './cargo.js';

// Gains smaller than this aren't worth saying.
export const UPGRADE_MIN = 0.01;

// The ships gear can go on: yours, then each squad member's.
function ships() {
  return [
    { member: null, who: 'you', loadout: cargo.loadout, upgrades: shipUpgrades(), level: pilotLevel() },
    ...cargo.squad.map((m) => ({ member: m.id, who: m.name, loadout: m.loadout, upgrades: {}, level: Progress.of(m.xp).level })),
  ];
}

// The best slot on one ship for an item: { slot, gain } (gain against what's fitted there), or null.
function bestSlot(ship, id, item) {
  const before = Combat.rating(Loadout.stats(ship.loadout, ship.upgrades));
  if (!(before > 0)) return null;
  let best = null;
  for (const s of Loadout.slots(ship.loadout, ship.upgrades)) {
    if (s.type !== item.slot) continue;
    const after = Combat.rating(Loadout.stats({ ...ship.loadout, fitted: { ...ship.loadout.fitted, [s.id]: id } }, ship.upgrades));
    const gain = after / before - 1;
    if (!best || gain > best.gain) best = { slot: s.id, gain };
  }
  return best;
}

export function upgradesFor(id) {
  const item = Loadout.EQUIPMENT[id];
  if (!item) return [];
  const all = ships();
  if (all.some((s) => Object.values(s.loadout.fitted).includes(id))) return []; // fitted already: spare gear only
  const need = Progress.gearLevel(item);
  const out = [];
  for (const ship of all) {
    if (item.npc && !ship.member) continue; // android gear: squad ships only
    const b = bestSlot(ship, id, item);
    if (b && b.gain >= UPGRADE_MIN) out.push({ member: ship.member, who: ship.who, slot: b.slot, gain: b.gain, ...(need > ship.level ? { need } : {}) });
  }
  return out.sort((a, b) => (a.need ? 1 : 0) - (b.need ? 1 : 0) || b.gain - a.gain);
}

export const isUpgrade = (id) => upgradesFor(id).some((u) => !u.need);

const pct = (g) => `+${Math.max(1, Math.round(g * 100))}%`;
export function upgradeLine(id) {
  const list = upgradesFor(id);
  if (!list.length) return '';
  const now = list.filter((u) => !u.need);
  if (!now.length) return `▲ ${pct(list[0].gain)} for ${list[0].who} at level ${list[0].need}`;
  return `▲ ${now.slice(0, 2).map((u) => `${pct(u.gain)} for ${u.who}`).join(' · ')}${now.length > 2 ? ` · +${now.length - 2} more` : ''}`;
}
