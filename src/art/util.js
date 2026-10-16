// Shared helpers for the procedural art: colours and 2D polygon geometry (TAU, clamp and lerp
// come from core/math.js and are passed on).
// ES module (`ArtUtil`); also runs in Node (the tests).

import { MathUtil } from '../core/math.js';

const ArtUtil = (() => {
  const { TAU, clamp, lerp } = MathUtil;

  // ---------- Colours (hex strings in, hex strings out) ----------

  const rgbCache = new Map();
  function hexToRgb(hex) {
    let c = rgbCache.get(hex);
    if (!c) {
      const n = parseInt(hex.slice(1), 16);
      c = [n >> 16, (n >> 8) & 255, n & 255];
      rgbCache.set(hex, c);
    }
    return c;
  }
  const rgbToHex = (c) => '#' + c.map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
  const mix = (a, b, t) => { const A = hexToRgb(a), B = hexToRgb(b); return rgbToHex(A.map((v, i) => lerp(v, B[i], t))); };
  const shade = (hex, k) => rgbToHex(hexToRgb(hex).map((v) => v * k));
  const rgba = (hex, a) => `rgba(${hexToRgb(hex).join(', ')}, ${a})`;

  function toHsl(hex) {
    const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h * 60, s, l];
  }
  function fromHsl(h, s, l) {
    const f = (n) => {
      const k = (n + h / 30) % 12;
      return 255 * (l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
    };
    return rgbToHex([f(0), f(8), f(4)]);
  }
  // Clamp saturation and lightness into a range, keeping the hue.
  function tune(hex, { s = [0, 1], l = [0, 1] } = {}) {
    const [h, s0, l0] = toHsl(hex);
    return fromHsl(h, clamp(s0, s[0], s[1]), clamp(l0, l[0], l[1]));
  }
  const desaturate = (hex, t) => { const [h, s, l] = toHsl(hex); return fromHsl(h, s * (1 - t), l); };

  // ---------- Geometry ([x, y] arrays) ----------

  const rot = ([x, y], a) => { const c = Math.cos(a), s = Math.sin(a); return [x * c - y * s, x * s + y * c]; };
  const add = (p, q) => [p[0] + q[0], p[1] + q[1]];

  function area(pts) {
    let a = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
    return a / 2;
  }
  function centroid(pts) {
    let x = 0, y = 0, a = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const f = pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
      x += (pts[j][0] + pts[i][0]) * f;
      y += (pts[j][1] + pts[i][1]) * f;
      a += f;
    }
    if (Math.abs(a) < 1e-9) {
      const n = pts.length;
      return [pts.reduce((s, p) => s + p[0], 0) / n, pts.reduce((s, p) => s + p[1], 0) / n];
    }
    return [x / (3 * a), y / (3 * a)];
  }
  function bbox(pts) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    return [x0, y0, x1, y1];
  }
  function inPoly(x, y, P) {
    let ins = false;
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
      const [xi, yi] = P[i], [xj, yj] = P[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins;
    }
    return ins;
  }
  function distSeg(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1), 0, 1);
    return Math.hypot(px - ax - dx * t, py - ay - dy * t);
  }

  // Corner rounding by Chaikin subdivision.
  function chaikin(pts, iterations, closed = true) {
    let P = pts;
    for (let k = 0; k < iterations; k++) {
      const out = [];
      const n = P.length;
      for (let i = 0; i < (closed ? n : n - 1); i++) {
        const a = P[i], b = P[(i + 1) % n];
        if (!closed && i === 0) out.push(a);
        out.push([lerp(a[0], b[0], 0.25), lerp(a[1], b[1], 0.25)], [lerp(a[0], b[0], 0.75), lerp(a[1], b[1], 0.75)]);
        if (!closed && i === n - 2) out.push(b);
      }
      P = out;
    }
    return P;
  }

  // A bilateral outline from its upper half, listed nose to tail with y >= 0.
  function mirror(half) {
    const out = half.slice();
    for (let i = half.length - 1; i >= 0; i--) {
      const [x, y] = half[i];
      if (Math.abs(y) > 1e-6) out.push([x, -y]);
    }
    return out;
  }

  const rect = (cx, cy, w, h, a = 0) => [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]]
    .map((p) => add(rot(p, a), [cx, cy]));
  const circle = (cx, cy, r, n = 24, a0 = 0) => Array.from({ length: n }, (_, i) => {
    const a = a0 + (i / n) * TAU;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  });
  const ellipse = (cx, cy, rx, ry, a = 0, n = 24) => circle(0, 0, 1, n).map(([x, y]) => add(rot([x * rx, y * ry], a), [cx, cy]));
  // Annular sector: ring of radius r (centre line) and width w between angles a0 and a1.
  function sector(cx, cy, r, w, a0, a1, n = 6) {
    const out = [];
    for (let i = 0; i <= n; i++) { const a = lerp(a0, a1, i / n); out.push([cx + Math.cos(a) * (r + w / 2), cy + Math.sin(a) * (r + w / 2)]); }
    for (let i = n; i >= 0; i--) { const a = lerp(a0, a1, i / n); out.push([cx + Math.cos(a) * (r - w / 2), cy + Math.sin(a) * (r - w / 2)]); }
    return out;
  }
  // Irregular rounded blob.
  function blob(cx, cy, rx, ry, rnd, irregular = 0.3, n = 9, a = 0) {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const t = (i / n) * TAU;
      const k = 1 - irregular / 2 + rnd() * irregular;
      pts.push(add(rot([Math.cos(t) * rx * k, Math.sin(t) * ry * k], a), [cx, cy]));
    }
    return chaikin(pts, 2);
  }
  // Thick polyline as a closed polygon (for struts and tendrils).
  function strip(line, w) {
    const left = [], right = [];
    for (let i = 0; i < line.length; i++) {
      const a = line[Math.max(0, i - 1)], b = line[Math.min(line.length - 1, i + 1)];
      const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
      const ww = typeof w === 'function' ? w(i / (line.length - 1)) : w;
      const nx = (-dy / l) * ww / 2, ny = (dx / l) * ww / 2;
      left.push([line[i][0] + nx, line[i][1] + ny]);
      right.push([line[i][0] - nx, line[i][1] - ny]);
    }
    return left.concat(right.reverse());
  }

  // Keep the part of a polygon where nx*x + ny*y >= d (Sutherland–Hodgman, one plane).
  function clipPoly(pts, nx, ny, d) {
    const out = [];
    const side = (p) => nx * p[0] + ny * p[1] - d;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const sa = side(a), sb = side(b);
      if (sa >= 0) out.push(a);
      if ((sa >= 0) !== (sb >= 0)) {
        const t = sa / (sa - sb);
        out.push([lerp(a[0], b[0], t), lerp(a[1], b[1], t)]);
      }
    }
    return out.length >= 3 ? out : null;
  }
  // Clip a segment [x1, y1, x2, y2] to the same half-plane.
  function clipSeg(s, nx, ny, d) {
    const sa = nx * s[0] + ny * s[1] - d, sb = nx * s[2] + ny * s[3] - d;
    if (sa < 0 && sb < 0) return null;
    if (sa >= 0 && sb >= 0) return s;
    const t = sa / (sa - sb);
    const m = [lerp(s[0], s[2], t), lerp(s[1], s[3], t)];
    return sa >= 0 ? [s[0], s[1], m[0], m[1]] : [m[0], m[1], s[2], s[3]];
  }
  // y-extent of a polygon along the vertical line at x, or null.
  function spanAt(pts, x) {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xa, ya] = pts[j], [xb, yb] = pts[i];
      if ((xa <= x) !== (xb <= x)) {
        const y = ya + ((x - xa) / (xb - xa)) * (yb - ya);
        lo = Math.min(lo, y);
        hi = Math.max(hi, y);
      }
    }
    return lo <= hi ? [lo, hi] : null;
  }

  return {
    TAU, clamp, lerp,
    hexToRgb, rgbToHex, mix, shade, rgba, toHsl, fromHsl, tune, desaturate,
    rot, add, area, centroid, bbox, inPoly, distSeg, chaikin, mirror,
    rect, circle, ellipse, sector, blob, strip, clipPoly, clipSeg, spanAt,
  };
})();

export { ArtUtil };
