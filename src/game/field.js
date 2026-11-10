// Consumables in the field (rules/abilities.js FIELD): a button on the HUD for each one in the kit
// (ui/field-bar.js), used on the ship itself whenever it would help, in open flight, mining or not,
// and on a planet's surface: repair nanites and shield cells, as in a fight. (The ones for the
// hazards, coolant, radiation purges and fuel, and seismic charges, aren't used in this game: FIELD
// here leaves them out.) Each has its cooldown, in flight time. Keys 1–6 use them in the bar's order.
// Not while docked, in a gate jump, the descent or climb of a landing, a fight with
// ships (its panel has the fight's abilities) or the wait for a tow.
// Part of the flight view; src/main.js starts it.

import { COLORS } from '../core/theme.js';
import { Abilities } from '../rules/abilities.js';
import { FieldBar } from '../ui/field-bar.js';
import { SystemMap } from '../ui/map.js';
import { addTo, cargo, saveCargo } from './cargo.js';
import { guard, shieldNow } from './combat.js';
import { docked } from './docking.js';
import { landing } from './landing.js';
import { talk } from './missions.js';
import { SHIP, fight, inFight } from './state.js';
import { simTime } from './update.js';
import { warp } from './warp.js';

// The field consumables this game uses: those that mend the ship.
export const FIELD = Abilities.FIELD.filter((a) => a.id === 'repair-nanites' || a.id === 'shield-cell');

// cool: when each consumable can be used again ({ [id]: flight time }).
export const field = { cool: {} };

// Whether the bar is up: out flying or on a surface, with nothing else holding the controls.
export const fieldShown = () => !docked && !warp.on && !talk.lines && !SystemMap.isOpen && !inFight()
  && !fight.wrecked && !(fight.wreckT > 0) && !landing.wrecked && (!landing.on || landing.phase === 'surface');

// The ship's meters, as rules/abilities.js reads them.
function meters() {
  const me = fight.s?.player;
  return { hull: me ? me.hull : cargo.hull, hullMax: SHIP.hull, shield: shieldNow(), shieldMax: SHIP.shield };
}

// The bar's buttons: the field consumables in the kit, in their order.
export function fieldItems() {
  const m = meters();
  return FIELD.filter((a) => cargo.kit[a.id] > 0).map((a, i) => ({
    id: a.id, code: a.code, label: a.name, count: cargo.kit[a.id], key: String(i + 1),
    enabled: (field.cool[a.id] ?? -Infinity) <= simTime && Abilities.fieldReady(a.id, m),
  }));
}

// Use one: a charge from the kit, its effect on the meters (or the rock), and its cooldown.
export function useField(id) {
  const a = Abilities.ABILITIES[id];
  if (!FIELD.includes(a) || !fieldShown() || (cargo.kit[id] || 0) < 1 || (field.cool[id] ?? -Infinity) > simTime) return false;
  const r = Abilities.fieldUse(id, meters());
  if (!r) return false;
  const me = fight.s?.player;
  if ('hull' in r) { if (me) me.hull = r.hull; cargo.hull = r.hull; }
  if ('shield' in r) { if (me) me.shield = r.shield; guard.shield = r.shield; }
  addTo(cargo.kit, id, -1);
  field.cool[id] = simTime + a.cooldown;
  const what = 'hull' in r ? 'hull' : 'shield';
  fight.fx.push({ type: 'number', delay: 0, t: 1.4, max: 1.4, at: 'player', jx: 0, text: `+${Math.round(r.amount)} ${what}`, color: COLORS.good });
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
