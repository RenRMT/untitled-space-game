// Messages: the one place short notices appear, in flight and docked ("Victory", "Recovered: ...",
// "Hull repaired"). At most two show at once, newest last; the rest wait their turn, the most
// important first, so a burst of notices (three research packages done at once) is read one by one
// instead of each replacing the last. A notice already showing or waiting isn't added again.
// What the player just did (a button's result) shows at once, in place of the oldest notice.
// Screen readers hear each one (a polite live region).
// In flight they aren't toasts but lines of an event log, plain text in the top-left corner that
// the HUD draws (game/hud.js): the last LOG_LINES, newest at the bottom, each gone after LOG_TIME s;
// the same line again counts up (×2) instead of taking another line.
//
//   Messages.push(text, { time = 2.5 (s), tone = 'info' | 'good' | 'warn' | 'hostile', priority = 0, now = false })
//     priority: 0 information, 1 a mission's progress, 2 combat (jumps the queue)
//     now: the answer to the player's own action: shown straight away
//   Messages.tick(dt)          the frame loop's clock (game/loop.js): notices go when their time is up
//   Messages.clear()
//   Messages.shown -> [text]   the toasts on screen now (the tests read it)
//   Messages.toLog = () => bool  set by the flight view: whether notices go to the log now (in
//                              flight) instead of showing as toasts (docked, the introduction)
//   Messages.log -> [{ text, tone, n, age }]   the event log, oldest first
// Where they show is set in CSS (ui/kit.css): high in the middle of the screen in flight, above the
// tab bar when docked (body.docked).
// ES module (`Messages`); needs a browser.

import { UI } from './ui.js';

const Messages = (() => {
  const { h } = UI;
  const MAX_SHOWN = 2, MAX_WAITING = 6;
  const LOG_LINES = 5, LOG_TIME = 10; // lines, seconds
  let root = null;
  const shown = []; // { text, el, left (s), priority }
  let waiting = []; // { text, time, tone, priority }
  const log = []; // { text, tone, n, age (s) }
  let toLog = () => false;

  // A line in the event log; screen readers hear it from the same live region as the toasts.
  function logLine(text, tone) {
    const last = log[log.length - 1];
    if (last && last.text === text) { last.n++; last.age = 0; } else log.push({ text, tone, n: 1, age: 0 });
    if (log.length > LOG_LINES) log.splice(0, log.length - LOG_LINES);
    const said = h('div', { class: 'ui-said' }, text);
    el().appendChild(said);
    setTimeout(() => said.remove(), 1000);
  }

  function el() {
    root ||= document.body.appendChild(h('div', { class: 'ui-messages ui', role: 'status', 'aria-live': 'polite' }));
    return root;
  }

  function show(m) {
    const node = h('div', { class: 'ui-toast', style: { '--tone': m.tone === 'info' ? 'var(--cyan)' : `var(--${m.tone})` } }, m.text);
    el().appendChild(node);
    shown.push({ text: m.text, el: node, left: m.time, priority: m.priority });
  }

  function dismiss(entry) {
    const i = shown.indexOf(entry);
    if (i < 0) return;
    shown.splice(i, 1);
    entry.el.remove();
  }

  function next() {
    while (shown.length < MAX_SHOWN && waiting.length) show(waiting.shift());
  }

  function push(text, { time = 2.5, tone = 'info', priority = 0, now = false } = {}) {
    if (!text) return;
    if (toLog()) { logLine(text, tone); return; }
    const same = shown.find((s) => s.text === text);
    if (same) { same.left = Math.max(same.left, time); return; }
    if (waiting.some((w) => w.text === text)) return;
    const m = { text, time: Math.max(1.2, time), tone, priority: now ? Math.max(priority, 3) : priority };
    // The player's own action, or combat news, doesn't wait behind loot notices: it takes the
    // place of the oldest less important one on screen.
    if (shown.length >= MAX_SHOWN && (now || priority >= 2)) {
      const bump = shown.find((s) => (now ? s.priority <= m.priority : s.priority < m.priority));
      if (bump) dismiss(bump);
    }
    waiting.push(m);
    waiting.sort((a, b) => b.priority - a.priority); // stable: same priority keeps arrival order
    if (waiting.length > MAX_WAITING) waiting = waiting.slice(0, MAX_WAITING);
    next();
  }

  function tick(dt) {
    for (const l of log) l.age += dt;
    while (log.length && log[0].age >= LOG_TIME) log.shift();
    if (!shown.length) return;
    for (const s of [...shown]) {
      s.left -= dt;
      if (s.left <= 0) dismiss(s);
    }
    next();
  }

  function clear() {
    waiting = [];
    log.length = 0;
    for (const s of [...shown]) dismiss(s);
  }

  return {
    push, tick, clear, LOG_LINES, LOG_TIME,
    get shown() { return shown.map((s) => s.text); },
    get log() { return log; },
    set toLog(fn) { toLog = fn; },
  };
})();

export { Messages };
