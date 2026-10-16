'use strict';

// The comms box: a message from someone in space, at the foot of the screen, with their portrait
// beside it. A line waits for a tap (or Enter / Space) to go on; a question shows its answers as
// buttons (or keys 1–4), each with a portrait of its own if it has one. A hint is a message that
// doesn't wait: flight goes on under it and taps pass through to space.
//
//   Comms.show({ from, text, face?, choices?: [{ label, face? }], onNext?, onChoose?(i) })
//     text: plain and **bold** runs (Intro.runs); face(ctx, size): draws a portrait in a
//     size × size CSS-pixel square
//   Comms.hint({ from, text, face? })
//   Comms.hide(), Comms.isOpen (a line or question showing, not a hint)
//   Comms.top             the box's top edge on screen (px), or null while hidden
//   Comms.onSkip = fn    shows a Skip button that calls it (null hides it)
// Browser script (global `Comms`). Load after ui/ui.js and story/intro.js.

const Comms = (() => {
  const { h } = UI;
  const root = document.getElementById('comms');
  const faceEl = h('canvas', { class: 'cm-face', 'aria-hidden': 'true' });
  const fromEl = h('span', { class: 'cm-from' });
  const skipEl = h('button', { class: 'cm-skip', type: 'button', hidden: true }, 'Skip intro');
  const textEl = h('p', { class: 'cm-text' });
  const choicesEl = h('div', { class: 'cm-choices', role: 'group', 'aria-label': 'Answers', hidden: true });
  const moreEl = h('div', { class: 'cm-more', 'aria-hidden': 'true' }, 'Tap to continue ▸');
  root.replaceChildren(h('div', { class: 'cm-box' }, faceEl,
    h('div', { class: 'cm-main' }, h('div', { class: 'cm-head' }, fromEl, skipEl), textEl, choicesEl, moreEl)));
  const edge = UI.topEdge(root);
  const FACE = 72, CHOICE_FACE = 64; // portrait sizes, CSS px
  let current = null; // what's showing: the options given to show() or hint()
  let skip = null;

  // A portrait into a canvas, sharp at the screen's pixel density.
  function paint(canvas, face, size) {
    const dpr = Display.uiDpr();
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    face(ctx, size);
  }

  function render(o, waits) {
    current = { ...o, waits };
    root.hidden = false;
    root.classList.toggle('hint', !waits);
    root.classList.toggle('ask', !!(o.choices && o.choices.length));
    fromEl.textContent = o.from || '';
    textEl.replaceChildren(...Intro.runs(o.text).map((r) => (r.bold ? h('strong', {}, r.text) : r.text)));
    faceEl.hidden = !o.face;
    if (o.face) paint(faceEl, o.face, FACE);
    const choices = (o.choices || []).map((c, i) => {
      const face = c.face ? h('canvas', { class: 'cm-choice-face', 'aria-hidden': 'true' }) : null;
      if (face) paint(face, c.face, CHOICE_FACE);
      return h('button', { class: `btn cm-choice${face ? ' with-face' : ''}`, type: 'button', onclick: (e) => { e.stopPropagation(); choose(i); } },
        face, h('span', {}, c.label));
    });
    choicesEl.replaceChildren(...choices);
    choicesEl.hidden = !choices.length;
    moreEl.hidden = !waits || !!choices.length;
    skipEl.hidden = !skip;
    const first = choices[0];
    if (first && first.focus) first.focus({ preventScroll: true });
  }

  function next() {
    if (!current || !current.waits || (current.choices && current.choices.length)) return;
    const fn = current.onNext;
    if (fn) fn();
  }
  function choose(i) {
    if (!current || !current.choices || !current.choices[i]) return;
    const fn = current.onChoose;
    if (fn) fn(i);
  }
  function hide() {
    current = null;
    root.hidden = true;
    choicesEl.replaceChildren();
  }

  // A tap anywhere on a line's box goes on (buttons handle their own).
  root.addEventListener('click', (e) => { if (!e.target || !e.target.closest || !e.target.closest('button')) next(); });
  skipEl.addEventListener('click', (e) => { e.stopPropagation(); if (skip) skip(); });
  window.addEventListener('keydown', (e) => {
    if (!current || !current.waits) return;
    if (e.key === 'Enter' || e.key === ' ') {
      if (e.target && e.target.closest && e.target.closest('.cm-choice')) return; // the focused answer's own click
      e.preventDefault();
      next();
    } else if (/^[1-9]$/.test(e.key)) choose(Number(e.key) - 1);
  });

  return {
    show: (o) => render(o, true),
    hint: (o) => render({ ...o, choices: null }, false),
    hide,
    get isOpen() { return !!current && current.waits; },
    get top() { return edge.top; },
    set onSkip(fn) { skip = fn; skipEl.hidden = !fn || !current; },
    // For tests: what the buttons and keys do.
    next, choose,
  };
})();
