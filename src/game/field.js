// Consumables in the field (rules/abilities.js FIELD): a button on the HUD for each one in the kit
// (ui/field-bar.js), used on the ship itself whenever it would help, in open flight, mining or not,
// and on a planet's surface: repair nanites and shield cells as in a fight, a coolant flush (heat),
// a radiation purge, a fuel canister and a seismic charge (on the rock the tools are locked on). Each
// has its cooldown, in flight time. Keys 1–6 use them in the bar's order.
// Not while docked, in the introduction, a gate jump, the descent or climb of a landing, a fight with
// ships (its panel has the fight's abilities) or the wait for a tow.
// Part of the flight view; src/main.js starts it.

import { COLORS } from '../core/theme.js';
import { Abilities } from '../rules/abilities.js';
import { FieldBar } from '../ui/field-bar.js';
import { SystemMap } from '../ui/map.js';
import { addTo, cargo, saveCargo } from './cargo.js';
import { blastRock, extracting, guard, shieldNow } from './combat.js';
import { docked } from './docking.js';
import { hazard } from './hazards.js';
import { landing } from './landing.js';
import { talk } from './missions.js';
import { SHIP, fight, inShipFight, intro } from './state.js';
import { simTime } from './update.js';
import { warp } from './warp.js';

// cool: when each consumable can be used again ({ [id]: flight time }).
export const field = { cool: {} };

// Whether the bar is up: out flying or on a surface, with nothing else holding the controls.
export const fieldShown = () => !docked && !intro.on && !warp.on && !talk.lines && !SystemMap.isOpen && !inShipFight()
  && !fight.wrecked && !(fight.wreckT > 0) && !landing.wrecked && (!landing.on || landing.phase === 'surface');

// The ship's meters, as rules/abilities.js reads them; rock: the one the tools are locked on, mining.
function meters() {
  const s = fight.s, me = s?.player;
  const t = extracting() && s.enemies.find((e) => e.id === s.focus && e.hull > 0);
  return {
    heat: hazard.heat, rad: cargo.rad, fuel: cargo.fuel, fuelMax: SHIP.fuel,
    hull: me ? me.hull : cargo.hull, hullMax: SHIP.hull, shield: shieldNow(), shieldMax: SHIP.shield,
    rock: t ? { hull: t.hull, material: t.material } : null,
  };
}

// The bar's buttons: the field consumables in the kit, in their order.
export function fieldItems() {
  const m = meters();
  return Abilities.FIELD.filter((a) => cargo.kit[a.id] > 0).map((a, i) => ({
    id: a.id, code: a.code, label: a.name, count: cargo.kit[a.id], key: String(i + 1),
    enabled: (field.cool[a.id] ?? -Infinity) <= simTime && Abilities.fieldReady(a.id, m),
  }));
}

// Use one: a charge from the kit, its effect on the meters (or the rock), and its cooldown.
export function useField(id) {
  const a = Abilities.ABILITIES[id];
  if (!a?.field || !fieldShown() || (cargo.kit[id] || 0) < 1 || (field.cool[id] ?? -Infinity) > simTime) return false;
  const r = Abilities.fieldUse(id, meters());
  if (!r) return false;
  if (r.rockDamage && !blastRock(r.rockDamage)) return false;
  const me = fight.s?.player;
  if ('hull' in r) { if (me) me.hull = r.hull; cargo.hull = r.hull; }
  if ('shield' in r) { if (me) me.shield = r.shield; guard.shield = r.shield; }
  if ('heat' in r) hazard.heat = r.heat;
  if ('rad' in r) cargo.rad = r.rad;
  if ('fuel' in r) cargo.fuel = r.fuel;
  addTo(cargo.kit, id, -1);
  field.cool[id] = simTime + a.cooldown;
  if (!r.rockDamage) { // a seismic charge shows as a hit on the rock (game/combat.js blastRock)
    const what = { hull: 'hull', shield: 'shield', heat: 'heat', rad: 'rad', fuel: 'fuel' }[Object.keys(r).find((k) => k !== 'amount')];
    const gain = what === 'heat' || what === 'rad' ? '−' : '+';
    fight.fx.push({ type: 'number', delay: 0, t: 1.4, max: 1.4, at: 'player', jx: 0, text: `${gain}${Math.round(r.amount)} ${what}`, color: COLORS.good });
  }
  saveCargo();
  return true;
}

// Every frame: the bar, as it should look now.
export function updateFieldBar() {
  if (!fieldShown()) { FieldBar.hide(); return; }
  FieldBar.show(fieldItems());
}

// Wiring, run once every module has loaded (src/main.js).
export function init() {
  FieldBar.onUse = useField;
  window.addEventListener('keydown', (e) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || !/^[1-6]$/.test(e.key) || !fieldShown()) return;
    const it = fieldItems()[Number(e.key) - 1];
    if (it) useField(it.id);
  });
}
