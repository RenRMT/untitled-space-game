'use strict';

// Small DOM helpers for the panels (station menu, settings, context card, combat panel).
//
//   UI.h('li', { class: 'good', onclick: fn, style: { left: '40%' }, disabled: true }, child, 'text', [more])
//     makes an element. Attributes that are false, null or undefined are left out (true sets an
//     empty attribute), on* attributes add listeners, style takes an object. Children may be
//     nodes, text (always set as text, never parsed as HTML) or arrays of them; null, undefined
//     and false are skipped.
//   UI.keyed() -> { changed(parts), reset(), shown }
//     remembers what a panel last showed (parts, compared as JSON), so it is rebuilt only when
//     something visible changes. changed() records the new parts and says whether they differ.
// Browser script (global `UI`).

const UI = (() => {
  function h(tag, attrs = {}, ...children) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === false || v === null || v === undefined) continue;
      if (k === 'class') n.className = v;
      else if (k === 'style') Object.assign(n.style, v);
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) n.append(c.nodeType ? c : String(c));
    return n;
  }

  function keyed() {
    let last = '';
    return {
      changed(parts) {
        const key = JSON.stringify(parts);
        if (key === last) return false;
        last = key;
        return true;
      },
      reset() { last = ''; },
      get shown() { return last !== ''; },
    };
  }

  return { h, keyed };
})();
