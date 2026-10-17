// The UI kit: builders for the components every DOM panel is made of, on top of UI.h (ui/ui.js).
// Styles are in ui/kit.css. Each builder returns a DOM node, or an array of them, ready for UI.h.
//
//   Kit.ICONS[name] = url                  register icon art (an image), ahead of the line icons
//   Kit.icon(name, size, { code, tier, dot })   an icon slot: the art if registered, else the line
//                                          icon for its code or name (ui/glyphs.js), in the text
//                                          colour (a tier's colour with `tier`), else a dashed box
//                                          with a short code (default: the name's first 3 letters)
//   Kit.button(label, onclick, { kind: 'primary' | 'ghost' | 'warn' | 'good' | 'busy', price, disabled,
//                                aria, title, lg, wide, progress })
//   Kit.pips(tier), Kit.mk(tier)           5 tier pips / 'Mk II', coloured by tier (1–5; rarity alike)
//   Kit.tag(text, color)                   a small caps status word ('New', 'Hand in')
//   Kit.credits(n)                         an amount of credits: the credits diamond, then the number
//   Kit.meter(fraction, { color, thin })   a filled track
//   Kit.segments(states)                   one segment per step: 'done' | 'open' | ''
//   Kit.compare(cur, next, metrics)        -> rows [{ code, label, cur, next, diff, better: 1 | -1 | 0 }]
//     metrics: [{ code, label, get(item), fmt(v), fmtDiff(|d|), dir (1: higher is better, -1: lower), none }]
//   Kit.deltas(rows), Kit.compareTable(rows)  'DPS ▲8  RNG ▲50' / the current → new table
//   Kit.slotNode({ x, y, label, code, item, open, onclick })   a slot button on the ship schematic
//   Kit.techNode({ x, y, w, h, label, code, state, tier, mark, progress, open, aria, onclick })   a package
//     on a research tree; state: 'done' | 'active' | 'queued' | 'available' | 'locked'; mark: a corner
//     note ('✓', 'Q2'); progress (0..1): a meter for the one building; tier: Mk pips
//   Kit.statChips(stats, openId, onToggle) -> [grid, detail?]   stats: [{ id, code, label, value, detail, from }]
//   Kit.itemTiles(items, openId, onToggle) -> [grid, detail?]   items: [{ id, icon, name, count, tier, rarity, units }]
//   Kit.optionRow({ code, icon, name, tier, tag, tagTone, sub, rows, vals, extra, note, open, onToggle,
//                   action, locked, lockLabel, current })   a row with an icon, a name, a line of numbers
//                   (rows: deltas; vals: [[code, value]]) and one action; with onToggle it expands to
//                   the full comparison and the note; locked: dimmed, with a lockLabel badge
//                   ('Locked'; null for none) in place of the action
//   Kit.head(label, aside...)              a section heading, then a count, a meter, ...
//   Kit.check(state, small)                a check box: 'done' | 'open' | 'later'
//   Kit.infoTile({ code, label, text, tone }), Kit.callout(text, tone)
//   Kit.quote({ from, kind, face, lines, color, more })   a message: portrait, sender, lines
//   Kit.disclosure({ label, open, onToggle })   a heading that folds what follows away
//   Kit.sheet({ title, sub, kicker, kickerColor, code, body, foot, tall, host, onClose })
//     -> { close(), update(sameOptions), isOpen }: a bottom sheet over a scrim; Esc, × and the scrim
//     close it, Tab stays inside. One at a time. host: the element it is put in (default: a layer
//     of its own at the end of <body>).
//   Kit.button(label, onclick, { ..., repeat: true })   held down, it repeats (onclick returning false stops it)
//   Kit.code(lines, { label })             a block of code: Kit.codeLine rows (and anything else)
//   Kit.codeLine({ n, tokens, off, dim, active, err, note, onclick, aria })   one numbered line;
//     tokens: [{ t, text }] (t: kw | subj | prop | op | num | fn | punc | ws | err | cmt) coloured by
//     kind; off: struck through; dim: greyed (not run); active: just ran; err / note: a comment under it;
//     with onclick it is a button
//   Kit.instruction({ n, rows, kind, off, dim, active, err, note, onclick, aria })   one squad instruction as a
//     card: a keyword badge per row (IF / AND / OR / NOT / THEN / ELSE) and plain-word chips coloured by
//     kind (rows: Logic.rows); kind: 'add' | 'else' (dashed); states as for codeLine; with onclick a button
//   Kit.choices(items, onPick, { label })   a row of mono choice buttons, one of them on;
//     items: [{ id, label, on, locked, title }]; locked ones are dashed and can't be picked
// ES module (`Kit`); needs a browser.

import { Glyphs } from './glyphs.js';
import { UI } from './ui.js';

const Kit = (() => {
  const { h } = UI;
  const TIER = [null, 'var(--t1)', 'var(--t2)', 'var(--t3)', 'var(--t4)', 'var(--t5)'];
  const MK = [null, 'Mk I', 'Mk II', 'Mk III', 'Mk IV', 'Mk V'];
  const ICONS = {};
  const tierVar = (t) => (t ? { '--tier': TIER[t] } : {});
  const nodes = (x) => [x].flat(Infinity).filter((n) => n !== null && n !== undefined && n !== false);

  function icon(name, size = 24, { code, tier, dot } = {}) {
    const src = ICONS[name];
    const style = { width: `${size}px`, height: `${size}px`, ...tierVar(tier) };
    const badge = dot === undefined ? null : h('span', { class: 'dot', hidden: !dot });
    if (src) return h('span', { class: 'ui-icon', style, 'aria-hidden': 'true' }, h('img', { src, alt: '', width: size, height: size, draggable: 'false' }), badge);
    const glyph = [code, name].find((n) => n != null && Glyphs.has(n));
    if (glyph !== undefined) {
      const el = h('span', { class: 'ui-icon gl', style, 'aria-hidden': 'true' });
      el.innerHTML = Glyphs.svg(glyph, size);
      if (badge) el.append(badge);
      return el;
    }
    return h('span', { class: 'ui-icon ph', style: { ...style, fontSize: `${Math.max(7, Math.round(size / 4))}px` }, 'aria-hidden': 'true' },
      code ?? String(name).slice(0, 3).toUpperCase(), badge);
  }

  function button(label, onclick, { kind = '', price, disabled = false, aria, title, lg = false, wide = false, progress, repeat = false } = {}) {
    return h('button', {
      class: ['ui-btn', kind, lg && 'lg', wide && 'wide'].filter(Boolean).join(' '), type: 'button', disabled, 'aria-label': aria, title,
      style: progress !== undefined ? { '--progress': `${Math.round(progress * 100)}%` } : undefined,
      ...(repeat ? holdable(onclick) : { onclick }),
    }, h('span', {}, label), price !== undefined ? h('span', { class: 'price' }, credits(price)) : null);
  }

  // Credits as the station header shows them: a small diamond before the number. Screen readers
  // hear the word.
  const credits = (n) => h('span', { class: 'ui-cr', 'aria-label': `${n.toLocaleString('en-US')} credits` },
    h('i', { 'aria-hidden': 'true' }), h('span', { 'aria-hidden': 'true' }, n.toLocaleString('en-US')));

  // Press and hold to repeat (Buy, Sell): a tap does it once; held past HOLD_DELAY ms it goes again
  // every HOLD_EVERY ms until let go, or until fn returns false (nothing more to do). The panel may
  // be redrawn between repeats, so letting go is heard on the window, not the button.
  const HOLD_DELAY = 420, HOLD_EVERY = 110;
  let holdTimer = null, held = false;
  const stopHold = () => { clearTimeout(holdTimer); holdTimer = null; };
  function holdable(fn) {
    return {
      onpointerdown: (e) => {
        if (e.button) return;
        held = false;
        stopHold();
        const again = () => { held = true; if (fn() === false) { stopHold(); return; } holdTimer = setTimeout(again, HOLD_EVERY); };
        holdTimer = setTimeout(again, HOLD_DELAY);
        window.addEventListener('pointerup', stopHold, { once: true });
        window.addEventListener('pointercancel', stopHold, { once: true });
      },
      onclick: () => { if (held) { held = false; return; } fn(); },
    };
  }

  const pips = (tier) => h('span', { class: 'ui-pips', style: tierVar(tier), 'aria-hidden': 'true' },
    [1, 2, 3, 4, 5].map((i) => h('i', { class: i <= tier ? 'on' : '' })));
  const mk = (tier) => h('span', { class: 'ui-mk', style: tierVar(tier) }, MK[tier]);
  const tag = (text, color) => h('span', { class: 'ui-tag', style: color ? { '--tone': color } : undefined }, text);

  const meter = (k, { color, thin } = {}) => h('span', { class: `ui-meter${thin ? ' thin' : ''}`, 'aria-hidden': 'true' },
    h('span', { style: { '--pct': `${Math.max(0, Math.min(1, k || 0)) * 100}%`, ...(color ? { '--meter': color } : {}) } }));
  const segments = (states) => h('span', { class: 'ui-segs', 'aria-hidden': 'true' }, states.map((s) => h('i', { class: s })));

  function compare(cur, next, metrics) {
    return metrics.map((m) => {
      const a = cur ? m.get(cur) : (m.none ?? 0), b = m.get(next), d = b - a;
      return { code: m.code, label: m.label, cur: cur ? m.fmt(a) : '—', next: m.fmt(b), diff: d ? m.fmtDiff(Math.abs(d)) : '', better: Math.sign(d) * (m.dir || 1) };
    });
  }
  const arrow = (r) => (r.better > 0 ? ['up', `▲${r.diff}`] : r.better < 0 ? ['down', `▼${r.diff}`] : ['', '=']);
  const deltas = (rows) => h('span', { class: 'ui-deltas' }, rows.map((r) => {
    const [cls, txt] = arrow(r);
    return h('span', { class: 'ui-delta' }, `${r.code} `, h('span', { class: cls }, txt));
  }));
  const compareTable = (rows) => rows.map((r) => {
    const [cls, txt] = arrow(r);
    return h('div', { class: 'ui-cmp' }, h('span', {}, r.label), h('span', { class: 'cur' }, r.cur), h('span', { class: 'to', 'aria-hidden': 'true' }, '→'),
      h('span', { class: 'next' }, r.next), h('span', { class: 'ui-delta' }, h('span', { class: cls }, txt)));
  });
  // Values on their own ('DPS 24/s  RNG 700'), for what's fitted now.
  const values = (vals) => h('span', { class: 'ui-deltas ui-vals' }, vals.map(([code, v]) => h('span', { class: 'ui-delta' }, h('span', { class: 'k' }, code), ` ${v}`)));

  function slotNode({ x, y, label, code, item, open, onclick }) {
    return h('button', {
      class: `ui-slot${item ? '' : ' empty'}`, type: 'button', 'aria-expanded': String(!!open), 'aria-haspopup': 'dialog',
      'aria-label': `${label}: ${item ? item.name : 'empty'}`, style: { left: `${x}px`, top: `${y}px`, ...tierVar(item?.tier) }, onclick,
    }, icon(code, 32, { code: item ? code : '+', tier: item?.tier }), h('span', { class: 'lbl' }, label), pips(item ? item.tier : 0));
  }

  function techNode({ x, y, w, h: ht, label, code, state, tier, mark, progress, open, aria, onclick }) {
    return h('button', {
      class: `ui-tnode ${state}`, type: 'button', 'aria-expanded': String(!!open), 'aria-haspopup': 'dialog', 'aria-label': aria,
      style: { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${ht}px`, ...tierVar(tier) }, onclick,
    }, h('span', { class: 'top' }, icon(code, 20, { code, tier }), mark ? h('span', { class: 'mark' }, mark) : null),
    h('span', { class: 'lbl' }, label),
    progress !== null && progress !== undefined ? meter(progress, { thin: true, color: 'var(--good)' }) : tier ? pips(tier) : null);
  }

  function statChips(stats, openId, onToggle) {
    const open = stats.find((s) => s.id === openId);
    return [
      h('div', { class: 'ui-chips' }, stats.map((s) => h('button', {
        class: 'ui-chip', type: 'button', 'aria-expanded': String(s.id === openId), 'aria-label': `${s.label}: ${s.value}`,
        onclick: () => onToggle(s.id === openId ? null : s.id),
      }, icon(s.code, 20, { code: s.code }), h('span', {}, h('span', { class: 'v' }, s.value), h('span', { class: 'l' }, s.label))))),
      open ? h('div', { class: 'ui-detail', role: 'region', 'aria-label': open.label, 'aria-live': 'polite' },
        h('div', { class: 'head' }, h('span', {}, open.label), h('span', { class: 'num' }, open.value)),
        h('span', {}, open.detail), open.from ? h('span', { class: 'src' }, open.from) : null) : null,
    ];
  }

  function itemTiles(items, openId, onToggle) {
    const open = items.find((i) => i.id === openId);
    return [
      h('div', { class: 'ui-tiles' }, items.map((it) => h('button', {
        class: 'ui-tile', type: 'button', 'aria-expanded': String(it.id === openId), 'aria-label': `${it.name}, ${it.count}`,
        style: tierVar(it.tier), onclick: () => onToggle(it.id === openId ? null : it.id),
      }, it.icon || icon(it.id, 32), h('span', { class: 'n' }, `×${it.count}`)))),
      open ? h('div', { class: 'ui-detail', style: { '--accent': TIER[open.tier] || 'var(--line)' }, 'aria-live': 'polite' },
        h('div', { class: 'head' }, h('span', {}, open.name), h('span', { class: 'num', style: { color: 'var(--dim)', fontSize: '12px' } }, open.units || `${open.count} in hold`)),
        open.rarity ? h('span', { class: 'ui-label', style: { color: TIER[open.tier] } }, open.rarity) : null) : null,
    ];
  }

  function optionRow({ code, icon: art, name, tier, tag: label, tagTone, sub, rows, vals, extra, note, open, onToggle, action, locked, lockLabel, current }) {
    const expandable = !!onToggle && !!(rows?.length || note);
    const main = [
      art || icon(code, 40, { code, tier }),
      h('span', { class: 'main' },
        h('span', { class: 'line' }, h('span', { class: 'name' }, name), tier ? mk(tier) : null,
          label ? tag(label, tagTone ? `var(--${tagTone})` : null) : null),
        rows?.length ? deltas(rows) : vals?.length ? values(vals) : null,
        sub ? h('span', { class: 'sub' }, sub) : null,
        extra || null),
      expandable ? h('span', { class: 'chev', 'aria-hidden': 'true' }, open ? '▴' : '▾') : null,
    ];
    return h('div', { class: `ui-opt${locked ? ' locked' : ''}${current ? ' current' : ''}` },
      h('div', { class: 'row' },
        expandable ? h('button', { class: 'what', type: 'button', 'aria-expanded': String(!!open), onclick: onToggle }, main) : h('div', { class: 'what' }, main),
        action || (locked && lockLabel !== null ? h('span', { class: 'lock' }, lockLabel || 'Locked') : null)),
      expandable ? h('div', { class: 'more', hidden: !open }, rows?.length ? compareTable(rows) : null, note ? h('p', { class: 'ui-note' }, note) : null) : null);
  }

  const head = (label, ...aside) => h('div', { class: 'ui-head' }, h('h2', { class: 'ui-label' }, label), aside);
  const check = (state, small) => h('span', { class: `ui-check ${state}${small ? ' sm' : ''}`, 'aria-hidden': 'true' }, state === 'done' && !small ? '✓' : '');
  const infoTile = ({ code, label, text, tone }) => h('div', { class: 'ui-info', style: tone ? { '--tone': tone } : undefined },
    icon(code, 32, { code }), h('span', { class: 'main' }, h('span', { class: 'ui-label' }, label), h('span', { class: 'txt' }, text)));
  const callout = (text, tone) => h('p', { class: 'ui-callout', role: 'status', style: tone ? { '--tone': tone } : undefined }, text);

  function quote({ from, kind, face, lines, color, more }) {
    return h('div', { class: 'ui-quote', style: color ? { '--from': color } : undefined },
      face || icon('face', 56, { code: 'FACE' }),
      h('div', { class: 'main' },
        h('span', { class: 'ui-label' }, kind ? `${from} · ${kind}` : from),
        lines.map((text) => h('p', {}, UI.rich(text))),
        more || null));
  }

  const disclosure = ({ label, open, onToggle }) => h('button', { class: 'ui-disclosure', type: 'button', 'aria-expanded': String(!!open), onclick: onToggle },
    h('span', {}, label), h('span', { 'aria-hidden': 'true' }, open ? '▴' : '▾'));

  // ---------- Bottom sheet ----------
  let current = null;
  let ownLayer = null;
  const DISMISS = 90; // px a sheet is dragged down to close it
  // Wide enough for the sheet to sit beside the list instead of over it (index.html's media query).
  const wide = () => typeof matchMedia === 'function' && matchMedia('(min-width: 960px)').matches;
  // Listening for the system's close request (Android's back) while a sheet is open: CloseWatcher
  // where there is one; else one history entry, kept while one sheet replaces another, that the
  // back gesture takes away. stop(replacing) when the sheet closes some other way; the entry goes
  // with it unless another sheet is taking its place.
  let historyEntry = false, onHistoryBack = null;
  function closeRequests(onClose) {
    if (typeof window === 'undefined') return { stop() {} };
    if (typeof window.CloseWatcher === 'function') {
      try {
        const w = new window.CloseWatcher();
        w.onclose = onClose;
        return { stop() { w.onclose = null; w.destroy(); } };
      } catch (e) { /* not allowed now: fall back to history */ }
    }
    if (!window.history || !window.history.pushState) return { stop() {} };
    if (!onHistoryBack) {
      onHistoryBack = { fn: null };
      window.addEventListener('popstate', () => {
        if (!historyEntry) return;
        historyEntry = false;
        const fn = onHistoryBack.fn;
        onHistoryBack.fn = null;
        if (fn) fn();
      });
    }
    onHistoryBack.fn = onClose;
    if (!historyEntry) { window.history.pushState({ sheet: true }, ''); historyEntry = true; }
    return {
      stop(replacing) {
        if (onHistoryBack.fn === onClose) onHistoryBack.fn = null;
        if (!replacing && historyEntry) { historyEntry = false; window.history.back(); }
      },
    };
  }
  function sheet(opts) {
    if (current) current.close(true, true);
    const host = opts.host || (ownLayer ||= document.body.appendChild(h('div', { class: 'ui-layer', hidden: true })));
    const returnFocus = document.activeElement;
    const kickerEl = h('span', { class: 'ui-tag' }), titleEl = h('span', { class: 't' }), subEl = h('span', { class: 's' });
    const iconEl = h('span', {});
    const closeBtn = h('button', { class: 'ui-iconbtn', type: 'button', 'aria-label': 'Close', title: 'Close (Esc)', onclick: () => close() }, '×');
    const bodyEl = h('div', { class: 'body' }), footEl = h('div', { class: 'foot' });
    const panel = h('div', { class: 'ui-sheet ui', role: 'dialog', 'aria-modal': 'true' },
      h('div', { class: 'grab', 'aria-hidden': 'true' }),
      h('div', { class: 'head' }, iconEl, h('div', { class: 'titles' }, kickerEl, titleEl, subEl), closeBtn),
      bodyEl, footEl);
    // On click, not pointer down: closing on the down would hand the click to whatever is under it.
    const scrim = h('div', { class: 'ui-scrim', onclick: () => close() });

    function fill(o) {
      panel.className = `ui-sheet ui${o.tall ? ' tall' : ''}`;
      panel.setAttribute('aria-label', o.title);
      iconEl.replaceChildren(...(o.code ? [icon(o.code, 32, { code: o.code })] : []));
      iconEl.hidden = !o.code;
      kickerEl.textContent = o.kicker || '';
      kickerEl.hidden = !o.kicker;
      kickerEl.style.setProperty('--tone', o.kickerColor || '');
      titleEl.textContent = o.title;
      subEl.textContent = o.sub || '';
      subEl.hidden = !o.sub;
      const scroll = bodyEl.scrollTop;
      bodyEl.replaceChildren(...nodes(o.body));
      bodyEl.scrollTop = scroll;
      footEl.replaceChildren(...nodes(o.foot));
      footEl.hidden = !nodes(o.foot).length;
    }

    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopImmediatePropagation(); close(); return; }
      if (e.key !== 'Tab' || wide()) return;
      const items = [...panel.querySelectorAll('button:not([disabled])')];
      const i = items.indexOf(document.activeElement);
      if (items.length && (i < 0 || (e.shiftKey && i === 0) || (!e.shiftKey && i === items.length - 1))) {
        e.preventDefault();
        items[e.shiftKey ? items.length - 1 : 0].focus();
      }
    };
    let open = true;
    function close(silent, replacing = false) {
      if (!open) return;
      open = false;
      host.replaceChildren();
      host.hidden = true;
      document.body.classList.remove('sheet-open');
      window.removeEventListener('keydown', onKey, true);
      back.stop(replacing);
      if (current === handle) current = null;
      if (!silent && opts.onClose) opts.onClose();
      if (!silent && returnFocus && returnFocus.isConnected) returnFocus.focus({ preventScroll: true });
    }

    // Dragged down by its handle or its header, past DISMISS px, it closes; less, it springs back.
    const grab = panel.querySelector('.grab'), headEl = panel.querySelector('.head');
    let drag = null;
    const onMove = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      drag.dy = Math.max(0, e.clientY - drag.y0);
      panel.style.transform = `translate(-50%, ${drag.dy}px)`;
    };
    const onUp = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const far = drag.dy > DISMISS;
      drag = null;
      panel.style.transform = '';
      panel.classList.remove('dragging');
      if (far) close();
    };
    for (const el of [grab, headEl]) {
      el.addEventListener('pointerdown', (e) => {
        if (e.button || e.target.closest('button') || wide()) return;
        drag = { id: e.pointerId, y0: e.clientY, dy: 0 };
        panel.classList.add('dragging');
        el.setPointerCapture(e.pointerId);
      });
      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', onUp);
      el.addEventListener('pointercancel', onUp);
    }
    // The system's back (Android's back gesture, Escape) closes the sheet rather than the game.
    const back = closeRequests(() => close());

    fill(opts);
    host.replaceChildren(scrim, panel);
    host.hidden = false;
    document.body.classList.add('sheet-open');
    // On a wide screen the sheet sits beside the list (index.html), which stays usable: no trap.
    panel.setAttribute('aria-modal', String(!wide()));
    window.addEventListener('keydown', onKey, true);
    (bodyEl.querySelector('button:not([disabled])') || closeBtn).focus({ preventScroll: true });
    const handle = {
      close,
      // New contents for the same sheet (after something in it changed); keeps the scroll position,
      // and moves focus to × if the focused button went away.
      update(o) {
        if (!open) return;
        fill(o);
        const f = document.activeElement;
        if (!f || !f.isConnected || f === document.body) closeBtn.focus({ preventScroll: true });
      },
      get isOpen() { return open; },
    };
    current = handle;
    return handle;
  }

  // ---------- Code ----------
  const code = (lines, { label } = {}) => h('div', { class: 'ui-code', role: 'list', 'aria-label': label }, lines);
  function codeLine({ n, tokens, off, dim, active, err, note, onclick, aria }) {
    const src = h('span', { class: 'src' }, tokens.map((x) => (x.t === 'ws' ? x.text : h('span', { class: `tk-${x.t}` }, x.text))),
      err ? h('span', { class: 'msg err' }, `// error: ${err}`) : null, note ? h('span', { class: 'msg' }, note) : null);
    const cls = ['ui-code-line', off && 'off', dim && 'dim', active && 'active', err && 'bad'].filter(Boolean).join(' ');
    const ln = h('span', { class: 'ln', 'aria-hidden': 'true' }, n === undefined ? '' : String(n).padStart(2, '0'));
    return onclick
      ? h('button', { class: cls, type: 'button', role: 'listitem', onclick, 'aria-label': aria }, ln, src)
      : h('div', { class: cls, role: 'listitem' }, ln, src);
  }
  function instruction({ n, rows, kind, off, dim, active, err, note, onclick, aria }) {
    const body = h('span', { class: 'rows' }, rows.map((r) => h('span', { class: 'ir' },
      h('span', { class: `kw kw-${r.kw.toLowerCase()}` }, r.kw === 'THEN' || r.kw === 'ELSE' ? `${r.kw} ▶` : r.kw),
      h('span', { class: 'chips' }, r.not ? h('span', { class: 'kw-not' }, 'NOT') : null,
        r.chips.map((c) => h('span', { class: `ic ic-${c.kind}` }, c.text))))),
    err ? h('span', { class: 'msg err' }, err) : null, note ? h('span', { class: 'msg' }, note) : null);
    const cls = ['ui-instr', kind, off && 'off', dim && 'dim', active && 'active', err && 'bad'].filter(Boolean).join(' ');
    const num = h('span', { class: 'n', 'aria-hidden': 'true' }, n === undefined ? '' : String(n).padStart(2, '0'));
    return onclick
      ? h('button', { class: cls, type: 'button', role: 'listitem', onclick, 'aria-label': aria }, num, body)
      : h('div', { class: cls, role: 'listitem', 'aria-label': aria }, num, body);
  }
  const choices = (items, onPick, { label } = {}) => h('div', { class: 'ui-choices', role: 'group', 'aria-label': label },
    items.map((it) => h('button', {
      class: ['ui-choice', it.on && 'on', it.locked && 'locked'].filter(Boolean).join(' '), type: 'button',
      'aria-pressed': String(!!it.on), disabled: !!it.locked, title: it.title, onclick: () => onPick(it.id),
    }, it.label)));

  return {
    TIER, MK, ICONS, icon, button, pips, mk, tag, meter, segments, compare, deltas, compareTable, values,
    credits, slotNode, techNode, statChips, itemTiles, optionRow, head, check, infoTile, callout, quote, disclosure, sheet,
    code, codeLine, choices, instruction,
  };
})();

export { Kit };
