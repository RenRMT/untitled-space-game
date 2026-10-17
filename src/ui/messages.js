// Messages: the event log, the one place notices appear ("Launched from ...", "Recovered: ...",
// "Victory"). Plain text in the flight view's top-left corner, drawn by the HUD (game/hud.js): the
// last LOG_LINES, newest at the bottom, each gone LOG_TIME seconds after it was logged; the same
// line again counts up (×2) instead of taking another line. The log keeps its clock while docked
// or on the map, so only what happened in the last few seconds is there when flight comes back.
// Screen readers hear each line (a polite live region).
//
//   Messages.push(text, { tone = 'info' | 'good' | 'warn' | 'hostile' })
//   Messages.tick(dt)          the frame loop's clock (game/loop.js): lines go when their time is up
//   Messages.clear()
//   Messages.log -> [{ text, tone, n, age }]   the lines, oldest first
//   Messages.version           counts every change to the log, for a paused frame to redraw it
// ES module (`Messages`); needs a browser.

import { UI } from './ui.js';

const Messages = (() => {
  const { h } = UI;
  const LOG_LINES = 5, LOG_TIME = 10; // lines, seconds
  const log = []; // { text, tone, n, age (s) }
  let root = null, version = 0;

  function el() {
    root ||= document.body.appendChild(h('div', { class: 'ui-said', role: 'status', 'aria-live': 'polite' }));
    return root;
  }

  function push(text, { tone = 'info' } = {}) {
    if (!text) return;
    const last = log[log.length - 1];
    if (last && last.text === text) { last.n++; last.age = 0; } else log.push({ text, tone, n: 1, age: 0 });
    if (log.length > LOG_LINES) log.splice(0, log.length - LOG_LINES);
    version++;
    el().replaceChildren(h('div', {}, text));
  }

  function tick(dt) {
    for (const l of log) l.age += dt;
    // A line fades over its last second (game/hud.js), so the log changes while one is going.
    if (log.some((l) => l.age > LOG_TIME - 1)) version++;
    while (log.length && log[0].age >= LOG_TIME) log.shift();
  }

  function clear() {
    log.length = 0;
    version++;
  }

  return { push, tick, clear, LOG_LINES, LOG_TIME, get log() { return log; }, get version() { return version; } };
})();

export { Messages };
