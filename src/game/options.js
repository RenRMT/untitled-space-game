// The flight view's settings (art style, movement, combat; ui/settings.js shows them), the hull
// art per ship class, the Settings button and the keyboard shortcuts.
// Part of the flight view; src/main.js starts it.

import { ArtBlueprints } from '../art/blueprints.js';
import { ArtCulture } from '../art/culture.js';
import { Art } from '../art/render.js';
import { ArtUtil } from '../art/util.js';
import { RealtimeCombat } from '../combat/combat-realtime.js';
import { Combat } from '../combat/combat.js';
import { Feedback } from '../core/feedback.js';
import { Store } from '../core/store.js';
import { Theme } from '../core/theme.js';
import { SystemMap } from '../ui/map.js';
import { Settings } from '../ui/settings.js';
import { Security } from '../world/security.js';
import { actions, docked } from './docking.js';
import { drag, showHints } from './input.js';
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

// Accessibility (Settings' Accessibility group): text size, palette, flashes and motion, haptics.
// Each is applied at once and on load (applyAccess).
export const TEXT_SIZES = ['100', '115', '130'];
export const textSize = setting('textsize', TEXT_SIZES, '100', () => applyAccess());
export const PALETTES = ['standard', 'safe'];
export const palette = setting('palette', PALETTES, 'standard', () => applyAccess());
const prefersReduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
export const MOTIONS = ['full', 'reduce'];
export const motion = setting('motion', MOTIONS, prefersReduced ? 'reduce' : 'full', () => applyAccess());
export const HAPTICS = ['on', 'off'];
export const haptics = setting('haptics', HAPTICS, 'on');
// The security levels' colours in each palette (world/security.js), lawless to high.
const SECURITY_COLORS = {
  standard: ['#ff5a6e', '#ffcf5a', '#b6ff8a'],
  safe: ['#ff4fd8', '#ffd84a', '#7fd0ff'],
};
export function applyAccess() {
  const k = Number(textSize.value) / 100;
  Theme.setScale(k);
  Theme.setPalette(palette.value);
  Security.LEVELS.forEach((l, i) => { l.color = SECURITY_COLORS[palette.value][i]; });
  const root = document.documentElement;
  root.style.setProperty('--ui-scale', String(k));
  root.setAttribute('data-palette', palette.value);
  root.setAttribute('data-textsize', textSize.value);
  root.setAttribute('data-motion', motion.value);
  Art.clearCache(); // sprites drawn in the old colours
  invalidate();
}
export const reducedMotion = () => motion.value === 'reduce';

// What a vibration says, per game event (core/feedback.js): short for small things, longer and
// broken up for warnings. Hits are kept to one buzz in HIT_GAP seconds, so a burst of fire isn't
// one long rattle.
export const BUZZ = {
  hit: [12], 'hit-hull': [30], 'shields-down': [30, 40, 30], 'low-hull': [70, 50, 70], locked: [8], targeted: [15, 35, 15],
  destroyed: [180], won: [15, 40, 15], mined: [12], docked: [10], launched: [10],
};
const HIT_GAP = 0.15;
let lastHit = 0;
function buzz(event, detail) {
  if (haptics.value !== 'on') return;
  if (event === 'hit') {
    const now = performance.now() / 1000;
    if (now - lastHit < HIT_GAP) return;
    lastHit = now;
    Feedback.vibrate(BUZZ[detail.hull ? 'hit-hull' : 'hit']);
  } else if (BUZZ[event]) Feedback.vibrate(BUZZ[event]);
}

export const ART_HINT = {
  line: 'Neon outlines on the dark.',
  pixel: 'Coarse pixels with dithered shading.',
  flat: 'Solid fills with a simple rim shadow.',
  lowpoly: 'Faceted shapes with flat lighting.',
};

// The controls, as the Controls section of Settings lists them (and the flight hints show them).
export const CONTROLS = {
  cruise: ['Drag to fly; drag length sets speed.', 'Double-tap empty space to stop.', 'Tap a station, asteroid or ship for options.'],
  direct: ['Hold and drag to fly; drag length sets speed.', 'Let go to stop.', 'Tap a station, asteroid or ship for options.'],
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
      { value: 'cruise', label: 'Cruise', hint: 'Keeps your speed after you let go. Double-tap empty space to stop.' },
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
  Settings.add({
    id: 'controls', label: 'Controls', group: 'Help',
    note: () => CONTROLS[moveMode.value].join(' '),
    action: { label: 'Show hints in flight', run: showHints },
  });
  Settings.add({
    id: 'textsize', label: 'Text size', group: 'Accessibility',
    choices: TEXT_SIZES.map((v) => ({ value: v, label: `${v}%`, hint: v === '100' ? 'The standard size.' : 'Text, buttons and panels are drawn larger.' })),
    get: () => textSize.value, set: (v) => textSize.set(v),
  });
  Settings.add({
    id: 'palette', label: 'Colours', group: 'Accessibility',
    choices: [
      { value: 'standard', label: 'Standard', hint: 'Red for hostile, green for good.' },
      { value: 'safe', label: 'Colour-safe', hint: 'Magenta for hostile, pale yellow for good, blue for high security: told apart without red and green.' },
    ],
    get: () => palette.value, set: (v) => palette.set(v),
  });
  Settings.add({
    id: 'motion', label: 'Flashes and motion', group: 'Accessibility',
    choices: [
      { value: 'full', label: 'Full', hint: 'Gate jumps and a lost ship white out the screen; panels slide in.' },
      { value: 'reduce', label: 'Reduced', hint: 'A soft fade instead of white-outs, and no sliding panels.' },
    ],
    get: () => motion.value, set: (v) => motion.set(v),
  });
  if (Feedback.canVibrate) {
    Settings.add({
      id: 'haptics', label: 'Vibration', group: 'Accessibility',
      choices: [
        { value: 'on', label: 'On', hint: 'A short buzz when you are hit, locked on or low on hull.' },
        { value: 'off', label: 'Off', hint: 'No vibration.' },
      ],
      get: () => haptics.value, set: (v) => { haptics.set(v); if (v === 'on') Feedback.vibrate(BUZZ.locked); },
    });
  }
  Feedback.on(buzz);
  applyAccess();
  // The map and settings buttons stay above both (index.html): a second tap closes what the first
  // opened, and either one swaps the other's menu for its own.
  settingsBtn.addEventListener('click', () => {
    if (Settings.isOpen) { Settings.close(); return; }
    if (inFight() || docked || intro.on) return;
    SystemMap.close();
    Settings.open();
  });
  // The map's own handler (ui/map.js) toggles it; the settings menu blocks the map, so a tap on the
  // map button there closes the menu and then opens the map.
  document.getElementById('map-btn').addEventListener('click', () => {
    if (Settings.isOpen) { Settings.close(); SystemMap.open(); }
  });
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
