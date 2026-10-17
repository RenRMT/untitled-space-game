// The flight view's settings (art style, movement, combat; ui/settings.js shows them), the hull
// art per ship class, the Settings button and the keyboard shortcuts.
// Part of the flight view; src/main.js starts it.

import { ArtBlueprints } from '../art/blueprints.js';
import { ArtCulture } from '../art/culture.js';
import { Art } from '../art/render.js';
import { ArtUtil } from '../art/util.js';
import { RealtimeCombat } from '../combat/combat-realtime.js';
import { Combat } from '../combat/combat.js';
import { Store } from '../core/store.js';
import { SystemMap } from '../ui/map.js';
import { Settings } from '../ui/settings.js';
import { actions, docked } from './docking.js';
import { drag } from './input.js';
import { invalidate } from './loop.js';
import { frameList, select, selected } from './selection.js';
import { autopilot, inFight, intro, notify, setMode, ship } from './state.js';
import { warp } from './warp.js';

// A saved choice among `options` (core/store.js; a URL parameter of the same name overrides the saved
// one); onChange runs after every change.
export function setting(key, options, fallback, onChange) {
  const s = { value: Store.choice(key, options, fallback) };
  s.set = (v) => { if (!options.includes(v)) return; s.value = v; Store.set(key, v); if (onChange) onChange(v); };
  s.cycle = () => s.set(options[(options.indexOf(s.value) + 1) % options.length]);
  return s;
}

export const ART_STYLES = Art.STYLES.map((s) => s.id);
export const artStyle = setting('style', ART_STYLES, 'line');

// Cruise: the ship holds the set speed after you let go (tap to stop).
// Direct: the ship only moves while you drag, with no drift, and stops when you let go.
// Both turn and change speed by the engine's numbers (flight/flight.js).
// Switching stops the ship, so it doesn't carry on under rules it wasn't set with.
export const MOVE_MODES = ['cruise', 'direct'];
export const moveMode = setting('move', MOVE_MODES, 'cruise', () => { ship.targetSpeed = 0; autopilot.key = null; });

// Combat: automatic rounds with the ships stopped (combat/combat.js), or real-time, flying throughout
// (combat/combat-realtime.js). Each fight keeps the mode it started in; the menu is closed during fights.
export const COMBAT = { rounds: Combat.mode, realtime: RealtimeCombat.mode };
export const COMBAT_MODES = Object.keys(COMBAT);
export const combatMode = setting('combat', COMBAT_MODES, 'rounds');

// A conversation's question answered (story/intro.js, story/missions.js: { ask: key, options }):
// the setting it asks about, by its saved key, takes the chosen value.
export const SETTINGS = { style: artStyle, move: moveMode, combat: combatMode };
export function chooseSetting(key, value) {
  if (SETTINGS[key]) SETTINGS[key].set(value);
}

export const ART_HINT = {
  line: 'Neon outlines on the dark.',
  pixel: 'Coarse pixels with dithered shading.',
  flat: 'Solid fills with a simple rim shadow.',
  lowpoly: 'Faceted shapes with flat lighting.',
};

// The menu pauses flight but keeps drawing it, so a new art style shows behind the panel.
export const settingsBtn = document.getElementById('settings-btn');

// How each hull the player can fly is drawn: the Courier is the original ship; the others are
// fixed designs in the same original style.
export const HULL_ART = {
  courier: () => ArtBlueprints.playerShip(ArtCulture.legacy),
  hauler: () => ArtBlueprints.create('freighter', ArtCulture.legacy, 7),
  corvette: () => ArtBlueprints.create('fighter', ArtCulture.legacy, 11),
  gunship: () => ArtBlueprints.create('fighter', ArtCulture.legacy, 29),
  pod: () => escapePod(ArtCulture.legacy),
};

// The introduction's escape pod: a blunt capsule with a porthole and one small thruster, in the
// original ship's colours.
export function escapePod(culture) {
  const b = ArtBlueprints.builder('pod', culture, 1);
  b.poly([[8, 0], [6, 4.6], [1, 6.4], [-5, 5.6], [-7.5, 3], [-7.5, -3], [-5, -5.6], [1, -6.4], [6, -4.6]], 'hull', { lvl: 1, h: 3, bevel: 3 });
  b.poly([[-1, 6.2], [-4.5, 5.6], [-4.5, -5.6], [-1, -6.2]], 'hull2', { lvl: 2, h: 0.5, line: false });
  b.circle(3, 0, 2.3, 'glass', { lvl: 3, h: 1, lineWidth: 0.75 });
  b.poly(ArtUtil.rect(-8.6, 0, 2, 4), 'engine', { lvl: 2, h: 2, line: false });
  b.light(-4, 5.4, 0.8, culture.pal.light, { blink: 1.2 });
  b.engine(-9.5, 0, 2);
  b.bp.glow = true;
  b.bp.line = culture.pal.line;
  b.bp.label = 'Escape pod';
  return ArtBlueprints.finish(b.bp);
}

// Wiring, run once every module has loaded (src/main.js).
export function init() {
  Settings.add({
    id: 'style', label: 'Art style', shortcut: 'V',
    choices: Art.STYLES.map((s) => ({ value: s.id, label: s.label, hint: ART_HINT[s.id] })),
    get: () => artStyle.value, set: (v) => artStyle.set(v),
  });
  Settings.add({
    id: 'move', label: 'Movement', shortcut: 'C',
    choices: [
      { value: 'cruise', label: 'Cruise', hint: 'Keeps your speed after you let go. Tap empty space to stop.' },
      { value: 'direct', label: 'Direct', hint: 'Moves only while you drag, with no drift. Let go to brake to a stop.' },
    ],
    get: () => moveMode.value, set: (v) => moveMode.set(v),
  });
  Settings.add({
    id: 'combat', label: 'Combat',
    choices: [
      { value: 'rounds', label: 'Rounds', hint: 'Ships stop and trade fire in automatic rounds. Pick targets and decide when to flee.' },
      { value: 'realtime', label: 'Real-time', hint: 'Keep flying. Your guns fire on their own while the locked target is in range and ahead of you. Outfly pirates to get away.' },
    ],
    get: () => combatMode.value, set: (v) => combatMode.set(v),
  });
  settingsBtn.addEventListener('click', () => { if (!inFight() && !docked && !intro.on) Settings.open(); });
  Settings.onToggle = (open) => {
    setMode('settings', open); // no map on top of the menu
    invalidate(); // a changed setting shows behind the panel
    settingsBtn.setAttribute('aria-expanded', String(open));
    if (open) drag.active = false;
  };
  // Keyboard shortcuts. An action's key (F to dock, E to mine: see `actions` below) acts on the
  // selected object, or else on the nearest one in reach.
  window.addEventListener('keydown', (e) => {
    if (SystemMap.isOpen || docked || intro.on || warp.on) return;
    // With no buttons showing them any more, the V and C shortcuts say what they switched to.
    if (e.key === 'v' || e.key === 'V') { artStyle.cycle(); notify(`Art style: ${Art.STYLES.find((s) => s.id === artStyle.value).label}`); }
    if (e.key === 'c' || e.key === 'C') { moveMode.cycle(); notify(`Movement: ${moveMode.value === 'cruise' ? 'Cruise' : 'Direct'}`); }
    if (e.key === 'Escape') select(null);
    // Several actions can share a key (E mines an asteroid or collects gas): the first that has a
    // target acts.
    for (const a of actions.forKeys(e.key)) {
      const target = actions.target(a, selected && selected.e, frameList);
      if (target) { a.run(target); break; }
    }
  });
  ship.art = HULL_ART.courier();
}
