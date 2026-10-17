// Messages: the one place short notices appear, in flight and docked ("Victory", "Recovered: ...",
// "Hull repaired"). At most two show at once, newest last; the rest wait their turn, the most
// important first, so a burst of notices (three research packages done at once) is read one by one
// instead of each replacing the last. A notice already showing or waiting isn't added again.
// What the player just did (a button's result) shows at once, in place of the oldest notice.
// Screen readers hear each one (a polite live region).
//
//   Messages.push(text, { time = 2.5 (s), tone = 'info' | 'good' | 'warn' | 'hostile', priority = 0, now = false })
//     priority: 0 information, 1 a mission's progress, 2 combat (jumps the queue)
//     now: the answer to the player's own action: shown straight away
//   Messages.tick(dt)          the frame loop's clock (game/loop.js): notices go when their time is up
//   Messages.clear()
//   Messages.shown -> [text]   what's on screen now (the tests read it)
// Where they show is set in CSS (ui/kit.css): high in the middle of the screen in flight, above the
// tab bar when docked (body.docked).
// ES module (`Messages`); needs a browser.

import { UI } from './ui.js';

const Messages = (() => {
  const { h } = UI;
  const MAX_SHOWN = 2, MAX_WAITING = 6;
  let root = null;
  const shown = []; // { text, el, left (s), priority }
  let waiting = []; // { text, time, tone, priority }

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
    if (!shown.length) return;
    for (const s of [...shown]) {
      s.left -= dt;
      if (s.left <= 0) dismiss(s);
    }
    next();
  }

  function clear() {
    waiting = [];
    for (const s of [...shown]) dismiss(s);
  }

  return { push, tick, clear, get shown() { return shown.map((s) => s.text); } };
})();

export { Messages };
