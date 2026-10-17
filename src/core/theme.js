// Colours and type shared by everything drawn on canvas (flight view, system map). The DOM panels
// use the same values as CSS variables in the UI kit (src/ui/kit.css; named in the comments); keep
// the two in step. Colours only one view uses stay with that view.
//
//   Theme.color.cyan, ...         hex strings (the current palette's)
//   Theme.font(13)                "13px 'IBM Plex Mono', ui-monospace, Menlo, Consolas, monospace",
//                                 scaled by the text size setting
//   Theme.scale                   the text size setting as a factor (1, 1.15, 1.3)
//   Theme.setScale(k)
//   Theme.setPalette(id)          'standard' | 'safe': colours told apart without red–green (the
//                                 colour-safe palette swaps hostile, good and the security levels'
//                                 colours; kit.css does the same under html[data-palette="safe"])
//   Theme.onPalette(fn)           called after the palette changes (things that copied a colour)
// ES module (`Theme`).

const Theme = (() => {
  const color = {
    bg: '#05060a', // --bg
    line: '#26304a', // --line
    hud: '#cfd8ff', // --hud: readouts
    dim: '#7d88a8', // --dim: secondary text, misses, wrecks
    bright: '#eef1ff', // titles and names
    cyan: '#7df9ff', // --cyan: the player's ship, selection, shields
    neutral: '#9aa4b8', // independents and unaligned things
    hostile: '#ff5a6e', // --hostile: pirates, critical hull
    flame: '#ffb347', // engine flames, hull damage (--wanted)
    good: '#b6ff8a', // --good: stations, a healthy hull
    amber: '#ffcf5a', // --salvage: floating items
    busy: '#ff9d5c', // --busy: mining
    flash: '#fff1d0', // explosions, sparks, the mining beam's tip
    star: '#ffd27a',
    marker: '#d49bff', // the player's own marker (set on the map)
    planet: '#8ab4ff',
  };
  // The colour-safe palette: hostile and good differ in hue and lightness for every common kind of
  // colour blindness (magenta against yellow-white), the amber warning stays orange.
  const PALETTES = {
    standard: { hostile: '#ff5a6e', good: '#b6ff8a', flame: '#ffb347' },
    safe: { hostile: '#ff4fd8', good: '#f4f0a0', flame: '#ff9a3d' },
  };
  const listeners = [];
  let palette = 'standard';
  function setPalette(id) {
    if (!PALETTES[id] || id === palette) return;
    palette = id;
    Object.assign(color, PALETTES[id]);
    for (const fn of listeners) fn(id);
  }
  const mono = "'IBM Plex Mono', ui-monospace, Menlo, Consolas, monospace"; // --mono
  const theme = {
    color, mono, PALETTES, setPalette,
    get palette() { return palette; },
    onPalette: (fn) => listeners.push(fn),
    scale: 1,
    setScale(k) { theme.scale = k; },
    font: (px) => `${Math.round(px * theme.scale * 10) / 10}px ${mono}`,
  };
  return theme;
})();
const COLORS = Theme.color; // the flight view's name for them

export { Theme, COLORS };
