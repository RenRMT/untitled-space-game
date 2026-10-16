// Colours and type shared by everything drawn on canvas (flight view, system map). The DOM panels
// use the same values as CSS variables in the UI kit (src/ui/kit.css; named in the comments); keep
// the two in step. Colours only one view uses stay with that view.
//
//   Theme.color.cyan, ...         hex strings
//   Theme.font(13)                "13px 'IBM Plex Mono', ui-monospace, Menlo, Consolas, monospace"
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
  const mono = "'IBM Plex Mono', ui-monospace, Menlo, Consolas, monospace"; // --mono
  const font = (px) => `${px}px ${mono}`;
  return { color, mono, font };
})();
const COLORS = Theme.color; // the flight view's name for them

export { Theme, COLORS };
