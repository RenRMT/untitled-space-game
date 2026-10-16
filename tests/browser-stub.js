'use strict';

// A stand-in for the browser, just enough to run the game's own scripts in Node: DOM elements
// that accept whatever the game does to them, a 2D canvas context that tracks its transform but
// draws nothing, localStorage, URL parameters, window events and a requestAnimationFrame that
// the test drives frame by frame. No dependencies.
//
//   const browser = install({ width, height, dpr, search })   // puts it all on globalThis
//   browser.frames(n)                 run n frames at 60 fps (every queued animation callback)
//   browser.key(key)                  a keydown on the window
//   browser.badDraws                  draw calls that got a non-finite number (NaN, Infinity)

const IDENTITY = [1, 0, 0, 1, 0, 0];
const multiply = (m, [a, b, c, d, e, f]) => [
  m[0] * a + m[2] * b, m[1] * a + m[3] * b,
  m[0] * c + m[2] * d, m[1] * c + m[3] * d,
  m[0] * e + m[2] * f + m[4], m[1] * e + m[3] * f + m[5],
];

// Drawing calls whose numeric arguments must be finite; a browser silently ignores the call
// otherwise, so a NaN here is a bug that never shows as an error.
const CHECKED = ['arc', 'arcTo', 'bezierCurveTo', 'clearRect', 'drawImage', 'ellipse', 'fillRect', 'fillText',
  'lineTo', 'moveTo', 'quadraticCurveTo', 'rect', 'roundRect', 'rotate', 'scale', 'strokeRect', 'strokeText',
  'transform', 'translate', 'setTransform', 'createRadialGradient', 'createLinearGradient'];

function createRuntime({ width = 1280, height = 800, dpr = 2, search = '' } = {}) {
  const rt = { badDraws: [], draws: 0 };

  class Path2D {
    constructor() { this.ops = 0; }
  }
  for (const m of ['addPath', 'arc', 'arcTo', 'bezierCurveTo', 'closePath', 'ellipse', 'lineTo', 'moveTo',
    'quadraticCurveTo', 'rect', 'roundRect']) Path2D.prototype[m] = function () { this.ops++; };

  class Ctx2D {
    constructor(canvas) {
      this.canvas = canvas;
      this.m = IDENTITY.slice();
      this.stack = [];
      this.dash = [];
      Object.assign(this, {
        fillStyle: '#000000', strokeStyle: '#000000', globalAlpha: 1, lineWidth: 1, lineCap: 'butt',
        lineJoin: 'miter', miterLimit: 10, lineDashOffset: 0, font: '10px sans-serif', textAlign: 'start',
        textBaseline: 'alphabetic', globalCompositeOperation: 'source-over', imageSmoothingEnabled: true,
        shadowBlur: 0, shadowColor: 'rgba(0, 0, 0, 0)', shadowOffsetX: 0, shadowOffsetY: 0, filter: 'none',
      });
    }
    save() { this.stack.push({ m: this.m, dash: this.dash }); }
    restore() { const s = this.stack.pop(); if (s) { this.m = s.m; this.dash = s.dash; } }
    setTransform(a, b, c, d, e, f) {
      if (a === undefined) this.m = IDENTITY.slice();
      else if (typeof a === 'object') this.m = [a.a, a.b, a.c, a.d, a.e, a.f];
      else this.m = [a, b, c, d, e, f];
    }
    resetTransform() { this.m = IDENTITY.slice(); }
    transform(a, b, c, d, e, f) { this.m = multiply(this.m, [a, b, c, d, e, f]); }
    translate(x, y) { this.transform(1, 0, 0, 1, x, y); }
    scale(x, y) { this.transform(x, 0, 0, y, 0, 0); }
    rotate(t) { const c = Math.cos(t), s = Math.sin(t); this.transform(c, s, -s, c, 0, 0); }
    getTransform() { const [a, b, c, d, e, f] = this.m; return { a, b, c, d, e, f, is2D: true }; }
    setLineDash(d) { this.dash = [...d]; }
    getLineDash() { return [...this.dash]; }
    measureText(text) {
      const px = parseFloat(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] || '10');
      return { width: String(text).length * px * 0.6 };
    }
    createImageData(w, h) {
      if (typeof w === 'object') ({ width: w, height: h } = w);
      return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
    }
    getImageData(x, y, w, h) { return this.createImageData(w, h); }
    createLinearGradient() { return { addColorStop() {} }; }
    createRadialGradient() { return { addColorStop() {} }; }
    createConicGradient() { return { addColorStop() {} }; }
    createPattern() { return {}; }
    isPointInPath() { return false; }
    isPointInStroke() { return false; }
  }
  for (const m of ['arc', 'arcTo', 'beginPath', 'bezierCurveTo', 'clearRect', 'clip', 'closePath', 'drawImage',
    'ellipse', 'fill', 'fillRect', 'fillText', 'lineTo', 'moveTo', 'putImageData', 'quadraticCurveTo', 'rect',
    'roundRect', 'stroke', 'strokeRect', 'strokeText', 'drawFocusIfNeeded']) {
    Ctx2D.prototype[m] = function () { rt.draws++; };
  }
  // Wrap the checked calls: record any non-finite number they get.
  for (const m of CHECKED) {
    const inner = Ctx2D.prototype[m];
    Ctx2D.prototype[m] = function (...args) {
      if (args.some((v) => typeof v === 'number' && !Number.isFinite(v)) && rt.badDraws.length < 50) {
        rt.badDraws.push(`${m}(${args.map((v) => (typeof v === 'number' ? v : typeof v)).join(', ')})`);
      }
      return inner.apply(this, args);
    };
  }

  class Element {
    constructor(tag = 'div', id = '') {
      this.tagName = tag.toUpperCase();
      this.id = id;
      this.nodeType = 1;
      this.children = [];
      this.attributes = {};
      this.dataset = {};
      this.listeners = {};
      this.style = { setProperty() {}, removeProperty() {}, getPropertyValue: () => '' };
      const classes = new Set();
      this.classList = {
        add: (...c) => c.forEach((x) => classes.add(x)),
        remove: (...c) => c.forEach((x) => classes.delete(x)),
        toggle: (c, on = !classes.has(c)) => { if (on) classes.add(c); else classes.delete(c); return on; },
        contains: (c) => classes.has(c),
      };
      Object.assign(this, { hidden: false, textContent: '', innerHTML: '', className: '', disabled: false, title: '', type: '', tabIndex: 0, scrollTop: 0 });
      this.parts = new Map(); // querySelector results, made on first use
    }
    // As in a browser, setting the text replaces the element's children.
    get textContent() { return this.text; }
    set textContent(v) { this.text = String(v); this.children = []; }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn); }
    dispatch(type, props = {}) {
      const e = { type, target: this, currentTarget: this, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {}, ...props };
      for (const fn of [...(this.listeners[type] || [])]) fn(e);
      return e;
    }
    setAttribute(k, v) { this.attributes[k] = String(v); }
    getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; }
    hasAttribute(k) { return k in this.attributes; }
    removeAttribute(k) { delete this.attributes[k]; }
    append(...nodes) { this.children.push(...nodes); }
    appendChild(n) { this.children.push(n); return n; }
    replaceChildren(...nodes) { this.children = nodes; }
    remove() {}
    querySelector(sel) {
      if (!this.parts.has(sel)) this.parts.set(sel, new Element('div'));
      return this.parts.get(sel);
    }
    querySelectorAll() { return []; }
    closest() { return null; }
    contains() { return false; }
    // Panels sit near the bottom of the window, as the CSS places them.
    getBoundingClientRect() { return { x: 0, y: height - 160, left: 0, top: height - 160, right: 360, bottom: height - 60, width: 360, height: 100 }; }
    focus() {}
    blur() {}
    setPointerCapture() {}
    releasePointerCapture() {}
  }

  class Canvas extends Element {
    constructor(id = '') {
      super('canvas', id);
      this.width = 300;
      this.height = 150;
      this.ctx = null;
    }
    getContext(type) { return type === '2d' ? (this.ctx ||= new Ctx2D(this)) : null; }
    toDataURL() { return 'data:image/png;base64,'; }
    getBoundingClientRect() { return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height }; }
  }

  const byId = new Map();
  const document = {
    body: new Element('body'),
    documentElement: new Element('html'),
    activeElement: null,
    visibilityState: 'visible',
    listeners: {},
    getElementById(id) {
      if (!byId.has(id)) byId.set(id, id === 'game' || id === 'map-canvas' ? new Canvas(id) : new Element('div', id));
      return byId.get(id);
    },
    createElement: (tag) => (tag === 'canvas' ? new Canvas() : new Element(tag)),
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
    removeEventListener() {},
  };

  const storage = new Map();
  const localStorage = {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => { storage.set(k, String(v)); },
    removeItem: (k) => { storage.delete(k); },
    clear: () => storage.clear(),
    key: (i) => [...storage.keys()][i] ?? null,
    get length() { return storage.size; },
  };

  const windowListeners = {};
  let queue = [];
  let clock = 0;
  const href = `http://localhost/index.html${search}`;
  const globals = {
    document, localStorage, Path2D,
    innerWidth: width, innerHeight: height, devicePixelRatio: dpr,
    location: { search, href, pathname: '/index.html' },
    history: { replaceState() {} },
    requestAnimationFrame: (fn) => { queue.push(fn); return queue.length; },
    cancelAnimationFrame: () => {},
    addEventListener: (type, fn) => { (windowListeners[type] ||= []).push(fn); },
    removeEventListener: () => {},
  };

  Object.assign(rt, {
    globals, document, storage, Element, Canvas, Ctx2D,
    // Run n frames: every animation callback queued so far, at 60 fps.
    frames(n = 1, stepMs = 1000 / 60) {
      if (!clock) clock = performance.now();
      for (let i = 0; i < n; i++) {
        clock += stepMs;
        const run = queue;
        queue = [];
        for (const fn of run) fn(clock);
      }
    },
    // A window event, delivered as the browser would (a listener may stop the rest).
    emit(type, props = {}) {
      let stopped = false;
      const e = { type, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() { stopped = true; }, ...props };
      for (const fn of [...(windowListeners[type] || [])]) { fn(e); if (stopped) break; }
      return e;
    },
    key(key) { return rt.emit('keydown', { key }); },
  });
  return rt;
}

// Install the runtime on globalThis (once per process: the game's scripts are global).
function install(options) {
  const rt = createRuntime(options);
  Object.assign(globalThis, rt.globals);
  globalThis.window = globalThis;
  return rt;
}

module.exports = { install };
