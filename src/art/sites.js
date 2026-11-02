// Deep-space sites (world/deep-space.js) in the line and low-poly styles: the flight art for what
// lies between the systems. Most kinds are drawn with the existing painters (stars by class,
// planets by type, asteroids, nebulae and gas pockets); four new shapes cover the rest:
//   collapsed – a dead core (neutron star or black hole) with any of: accretion disc, jets,
//               sweeping beams, magnetic field loops. Pulsar, magnetar, black hole, microquasar,
//               Core A*.
//   shell     – an expanding ring of gas, broken and filamented. Supernova remnant, planetary
//               nebula, Wolf–Rayet wind bubble.
//   swarm     – a cloud of stars by a density profile. Open and globular clusters, and the crowd
//               behind Core A*.
//   disc      – shared by collapsed objects and protoplanetary discs: a tilted annulus drawn in
//               two halves so the core sits between them; gaps hold forming planets.
// Each site is drawn about (0, 0) within its art radius `r` (drawing units). The flight view
// (flight/deep-sites.js) does not draw most of them as one picture: a site there is a body, a
// place of several things, an area flown through, or sky. So a drawing can be split:
//   o.part   'core': only the central body (a Wolf–Rayet star and its wind, a planetary nebula's
//            dwarf); 'area': only what spans the site (a bubble, a shell, a disc, the core's disc
//            and jets), leaving out what the game supplies itself (the H II glow round a Bok
//            globule, a remnant's heart, the crowd round Core A*). Omitted: the whole picture.
//   o.phase  DeepSpace.phase(site, t): the beam's and jet's angles, a Cepheid's brightness, a
//            recurrent nova's burst. Omitted: still.
//   o.reach  beams and jets this many times their usual length (a pulsar's beam sweeps tens of
//            thousands of units from a core a few hundred across).
//
//   ArtSites.KINDS                         kinds this module draws, with labels
//   ArtSites.sample(kind, seed, variant?)  a site of that kind with seeded data, for previews
//   ArtSites.draw(ctx, site, style, o?)    o: { texel, force, part, phase, reach }
//   ArtSites.discOf(site, R)               a disc's shape at art radius R (protoplanetary and
//                                          debris discs): { rIn, rOut, q, roll, gaps, embryos },
//                                          and at(rho, phi) -> [x, y], so rocks can lie in it
// ES module (`ArtSites`); drawing needs a browser, discOf runs in Node too.

import { Art } from './render.js';
import { ArtBodies } from './bodies.js';
import { ArtUtil as U } from './util.js';
import { hashInt, mulberry32, seedToInt, weightedPick } from '../core/rng.js';

const ArtSites = (() => {
  const TAU = Math.PI * 2;
  // Star classes for the dead cores, drawn by Art.drawStar like any star (kept out of STAR_CLASSES,
  // so they are not offered as system stars).
  Object.assign(Art.STAR_PAL, {
    N: ['#ffffff', '#ecfaff', '#c4f2ff', '#7ad8f4', '#3290c8', '#163e74'], // neutron star
    X: ['#ffffff', '#f6eaff', '#e0bcff', '#b67af2', '#6e34b4', '#361862'], // magnetar
  });
  const STAR = Art.STAR_PAL;
  const LIGHT2 = (() => { const [x, y] = Art.kit.LIGHT, l = Math.hypot(x, y); return [x / l, y / l]; })();

  const KINDS = {
    'white-dwarf': 'White dwarf', 'wolf-rayet': 'Wolf–Rayet star', 'variable-star': 'Cepheid variable',
    pulsar: 'Pulsar', magnetar: 'Magnetar', 'stellar-black-hole': 'Black hole', microquasar: 'Microquasar', smbh: 'Core A*',
    'hii-region': 'H II region', 'bok-globule': 'Bok globule', 'molecular-cloud': 'Giant molecular cloud',
    'protoplanetary-disc': 'Protoplanetary disc', 'supernova-remnant': 'Supernova remnant',
    'open-cluster': 'Open cluster', 'globular-cluster': 'Globular cluster',
    'brown-dwarf': 'Brown dwarf', 'rogue-planet': 'Rogue planet', 'interstellar-object': 'Interstellar object',
    'neutron-star': 'Neutron star', 'recurrent-nova': 'Recurrent nova', 'kilonova-remnant': 'Kilonova remnant',
    'hypervelocity-star': 'Hypervelocity star',
  };

  // Line colour (one per asset) and low-poly palette (bright to dark) for the new shapes.
  const LOOK = {
    smbh: { line: '#ffb35c', disc: ['#fff6e0', '#ffd27a', '#ff8a3a', '#c0401e'], jet: ['#fff2d8', '#ffc98a', '#d8884a'] },
    microquasar: { line: '#ff8ae0', disc: ['#fff0fa', '#ffb0e8', '#e860c0', '#8a2a78'], jet: ['#fff0fa', '#ff9ae4', '#c04aa0'] },
    'stellar-black-hole': { line: '#c08aff', ring: ['#f0e4ff', '#c08aff', '#7a4ac8'] },
    pulsar: { line: '#b8f0ff', beam: ['#e8fbff', '#b8f0ff', '#5ab8e0'] },
    magnetar: { line: '#d07aff', field: ['#f0d8ff', '#d07aff', '#8a3ac8'] },
    'supernova-remnant': { line: '#7ad8ff', shell: ['#e8fbff', '#7ad8ff', '#3a8ac8', '#1e3e78'], alt: '#ff7a6a' },
    'white-dwarf': { line: '#8affd8', shell: ['#e8fff4', '#6affd0', '#2aa0b0', '#e8607e'], alt: '#ff8aa0', debris: ['#c8c0b4', '#9a9084', '#6a6258'] },
    'wolf-rayet': { line: '#8affff', shell: ['#e8ffff', '#8affff', '#3ab0d0', '#1a5080'], alt: '#c8ffff' },
    'protoplanetary-disc': { line: '#e8b98a', disc: ['#f6dcb8', '#d8a878', '#a06a44', '#5a3a26'] },
    'open-cluster': { line: '#9cc8ff' },
    'globular-cluster': { line: '#ffd9a0' },
    'variable-star': { line: '#fff2b0' },
    'interstellar-object': { line: '#cfd8e8', tail: ['#e8f6ff', '#9cc8e8', '#5a88b0'] },
    'neutron-star': { line: '#a8c4e0', field: ['#e4f0ff', '#a8c4e0', '#5a7aa0'] },
    'recurrent-nova': { line: '#ffeb8a', disc: ['#fffbe0', '#ffeb8a', '#e0a040', '#8a5a20'], burst: ['#fffef0', '#ffeb8a', '#ffb84a'] },
    'kilonova-remnant': { line: '#ffc94a', shell: ['#fff4d0', '#ffc94a', '#c08a2a', '#5a3a12'], alt: '#ffe08a' },
    'hypervelocity-star': { line: '#fff6d8', tail: ['#ffffff', '#d8e8ff', '#8aaee8'] },
  };

  const kindInt = (k) => seedToInt(String(k));
  const rngOf = (site, salt) => mulberry32(hashInt(site.seed >>> 0, kindInt(site.kind), salt));
  const scaleOf = (ctx) => { const m = ctx.getTransform(); return Math.hypot(m.a, m.b) || 1; };
  const BG = () => Art.config.bg;
  const poly = (pts, close = true) => { const p = new Path2D(); pts.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y))); if (close) p.closePath(); return p; };
  const rot = ([x, y], a) => { const c = Math.cos(a), s = Math.sin(a); return [x * c - y * s, x * s + y * c]; };
  // Low-poly: a flat face, edges in the face colour (opaque) or none (translucent bands).
  const face = (ctx, pts, col, ew, alpha = 1) => {
    const p = poly(pts);
    if (alpha < 1) { ctx.fillStyle = U.rgba(col, alpha); ctx.fill(p); return; }
    ctx.fillStyle = ctx.strokeStyle = col; ctx.lineWidth = ew; ctx.lineJoin = 'round'; ctx.fill(p); ctx.stroke(p);
  };
  // Emissive faces keep 85%+, turned a little by the key light so facets read.
  const lit = (col, nx, ny, k = 0.12) => U.shade(col, 0.9 + k * (nx * LIGHT2[0] + ny * LIGHT2[1]));
  const ngon = (cx, cy, r, n, a0 = 0, q = 1) => Array.from({ length: n }, (_, i) => { const a = a0 + (i / n) * TAU; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r * q]; });
  const dashes = (r, n, lo, hi, gap) => Array.from({ length: n }, (_, i) => (i % 2 ? gap : lo + r() * (hi - lo)));

  // ---------- Painters reused ----------
  const star = (ctx, st, style, o, x = 0, y = 0) => { ctx.save(); ctx.translate(x, y); Art.drawStar(ctx, st, style, { t: 0, texel: st.r / 20, force: o.force }); ctx.restore(); };
  const planet = (ctx, pl, style, o, x = 0, y = 0) => { ctx.save(); ctx.translate(x, y); Art.drawPlanet(ctx, pl, style, { texel: (pl.r * 2) / 64, force: o.force }); ctx.restore(); };
  const moon = (ctx, m, style, o, x, y) => { ctx.save(); ctx.translate(x, y); ArtBodies.drawMoon(ctx, m, style, { texel: (m.r * 2) / 56, force: o.force }); ctx.restore(); };
  // Nebula tiles are built at a fixed scale (60 units across half the cloud) and scaled to R, as the
  // low-poly tile lattice misreads at small absolute scales.
  const nebula = (ctx, type, seed, R, style) => { ctx.save(); ctx.scale(R / 60, R / 60); ArtBodies.drawNebula(ctx, { type, seed, x: -60, y: -60, w: 120, h: 120, scale: 60 }, style, { texel: 2, force: true }); ctx.restore(); };

  // ---------- Disc ----------
  // d: { rIn, rOut, q (minor/major), roll, line, pal (4, inner to outer), gaps: [[r, halfWidth]],
  // rim: low-poly thickness }. half: -1 the far half (up the screen), 1 the near half, 0 both.
  const discAt = (d, rho, phi) => rot([Math.cos(phi) * rho, Math.sin(phi) * rho * d.q], d.roll);
  const inGap = (d, rho) => (d.gaps || []).some(([g, w]) => Math.abs(rho - g) < w);
  function discLine(ctx, d, half, px, rnd) {
    const [a0, a1] = half < 0 ? [Math.PI, TAU] : half > 0 ? [0, Math.PI] : [0, TAU];
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(0, 0, d.rOut, d.rOut * d.q, d.roll, a0, a1);
    ctx.ellipse(0, 0, d.rIn, d.rIn * d.q, d.roll, a1, a0, true);
    ctx.closePath();
    ctx.fillStyle = BG(); ctx.fill();
    const n = d.rings || 11;
    for (let i = 0; i <= n; i++) {
      const u = i / n, rho = d.rIn + (d.rOut - d.rIn) * Math.pow(u, 1.35);
      if (i && i < n && inGap(d, rho)) continue;
      ctx.strokeStyle = U.rgba(d.line, i === n ? 0.7 : Math.max(0.2, 0.95 - 0.75 * u));
      ctx.lineWidth = px * (i === 0 ? 1.6 : i === n ? 1.1 : 1 - 0.35 * u);
      ctx.setLineDash(u > 0.5 && i < n ? dashes(rnd, 8, d.rOut * 0.08, d.rOut * 0.3, d.rOut * 0.03 * (1 + u * 2)) : []);
      ctx.beginPath(); ctx.ellipse(0, 0, rho, rho * d.q, d.roll, a0, a1); ctx.stroke();
    }
    // Gap edges: a firm line either side, so the lanes read.
    ctx.setLineDash([]);
    for (const [g, w] of d.gaps || []) for (const rr of [g - w, g + w]) {
      ctx.strokeStyle = U.rgba(d.line, 0.85); ctx.lineWidth = px;
      ctx.beginPath(); ctx.ellipse(0, 0, rr, rr * d.q, d.roll, a0, a1); ctx.stroke();
    }
    ctx.restore();
  }
  function discLow(ctx, d, half, ew) {
    const N = 36, B = d.pal.length, radii = Array.from({ length: B + 1 }, (_, i) => d.rIn + (d.rOut - d.rIn) * Math.pow(i / B, 1.2));
    const keep = (m) => (half < 0 ? Math.sin(m) < 0 : half > 0 ? Math.sin(m) >= 0 : true);
    for (let i = 0; i < N; i++) {
      const p0 = (i / N) * TAU, p1 = ((i + 1) / N) * TAU, m = (p0 + p1) / 2;
      if (!keep(m)) continue;
      const [nx, ny] = rot([Math.cos(m), Math.sin(m)], d.roll);
      for (let b = 0; b < B; b++) {
        const r0 = radii[b], r1 = radii[b + 1], rm = (r0 + r1) / 2;
        if (inGap(d, rm)) continue;
        const col = lit(d.pal[b], -nx, -ny, 0.1) , c2 = U.shade(col, i % 2 ? 0.94 : 1);
        face(ctx, [discAt(d, r0, p0), discAt(d, r1, p0), discAt(d, r1, p1), discAt(d, r0, p1)], c2, ew);
      }
      // The near rim: the disc's edge, extruded down the screen.
      if (half > 0 && d.rim) {
        const a = discAt(d, d.rOut, p0), b = discAt(d, d.rOut, p1);
        face(ctx, [a, b, [b[0], b[1] + d.rim], [a[0], a[1] + d.rim]], U.shade(d.pal[B - 1], 0.55 + 0.25 * Math.sin(m)), ew);
      }
    }
  }
  const disc = (ctx, d, half, style, px, ew, rnd) => (style === 'lowpoly' ? discLow(ctx, d, half, ew) : discLine(ctx, d, half, px, rnd));

  // ---------- Black hole core ----------
  // The horizon, its photon ring, and (with a disc) the far side of the disc lensed up over it.
  function hole(ctx, h, look, style, px, ew, lens) {
    if (style === 'lowpoly') {
      const P = look.disc || look.ring;
      if (lens) for (const [k, col] of [[1.42, P[2]], [1.22, P[1]]]) {
        const pts = [];
        for (let i = 0; i <= 10; i++) { const a = Math.PI + (i / 10) * Math.PI; pts.push([Math.cos(a) * lens * k, Math.sin(a) * lens * k * 0.9]); }
        for (let i = 10; i >= 0; i--) { const a = Math.PI + (i / 10) * Math.PI; pts.push([Math.cos(a) * lens * (k - 0.2), Math.sin(a) * lens * (k - 0.2) * 0.9]); }
        face(ctx, pts, col, ew);
      }
      face(ctx, ngon(0, 0, h * 1.2, 16, 0.1), P[0], ew);
      face(ctx, ngon(0, 0, h, 16, 0.3), '#000000', ew);
      return;
    }
    ctx.save();
    if (lens) {
      for (const [k, a] of [[1.15, 0.9], [1.3, 0.6], [1.48, 0.35]]) {
        ctx.strokeStyle = U.rgba(look.line, a); ctx.lineWidth = px;
        ctx.beginPath(); ctx.ellipse(0, 0, lens * k, lens * k * 0.88, 0, Math.PI * 1.04, Math.PI * 1.96); ctx.stroke();
      }
      ctx.strokeStyle = U.rgba(look.line, 0.5);
      ctx.beginPath(); ctx.ellipse(0, 0, lens * 0.95, lens * 0.5, 0, Math.PI * 0.15, Math.PI * 0.85); ctx.stroke();
    }
    ctx.fillStyle = BG(); ctx.beginPath(); ctx.arc(0, 0, h * 1.12, 0, TAU); ctx.fill();
    ctx.strokeStyle = look.line; ctx.lineWidth = px * 1.8;
    ctx.beginPath(); ctx.arc(0, 0, h * 1.12, 0, TAU); ctx.stroke();
    ctx.strokeStyle = U.rgba(look.line, 0.45); ctx.lineWidth = px * 0.8;
    ctx.beginPath(); ctx.arc(0, 0, h * 1.3, 0, TAU); ctx.stroke();
    ctx.restore();
  }

  // ---------- Jets ----------
  // Two opposed jets along `ang`, from `base` out to `len`, widening to `w`; `wob` bends them
  // into a slow corkscrew (a precessing microquasar). which: -1 the far jet, 1 the near one.
  function jetPts(j, sgn) {
    const n = 14, left = [], right = [], axis = [];
    for (let i = 0; i <= n; i++) {
      const u = i / n, s = j.base + (j.len - j.base) * u, hw = j.w * (0.15 + 0.85 * Math.pow(u, 0.8));
      const off = (j.wob || 0) * j.len * Math.sin(u * TAU * 1.25) * u;
      const c = [s * sgn, off * sgn];
      axis.push(rot(c, j.ang)); left.push(rot([c[0], c[1] + hw], j.ang)); right.push(rot([c[0], c[1] - hw], j.ang));
    }
    return { left, right, axis };
  }
  function jets(ctx, j, which, style, px, ew) {
    const sgn = (Math.sin(j.ang) >= 0 ? 1 : -1) * which;
    const { left, right, axis } = jetPts(j, sgn);
    if (style === 'lowpoly') {
      const P = j.pal, n = axis.length - 1;
      // Two faces either side of the axis, the one turned to the light brighter.
      const [nx, ny] = rot([0, 1], j.ang);
      const lightLeft = nx * LIGHT2[0] + ny * LIGHT2[1] > 0;
      face(ctx, [...left, ...axis.slice().reverse()], lightLeft ? P[1] : P[2], ew);
      face(ctx, [...right, ...axis.slice().reverse()], lightLeft ? P[2] : P[1], ew);
      for (const k of [0.3, 0.52, 0.72, 0.9]) {
        const i = Math.round(k * n), [x, y] = axis[i], w = j.w * 0.35 * (0.4 + k);
        face(ctx, ngon(x, y, w, 4, j.ang), P[0], ew);
      }
      if (j.lobe) face(ctx, ngon(...axis[n], j.w * 1.25, 7, j.ang), P[2], ew);
      return;
    }
    ctx.save();
    ctx.strokeStyle = U.rgba(j.line, 0.85); ctx.lineWidth = px;
    ctx.stroke(poly(left, false)); ctx.stroke(poly(right, false));
    ctx.strokeStyle = U.rgba(j.line, 0.4); ctx.setLineDash([j.len * 0.04, j.len * 0.05]);
    ctx.stroke(poly(axis, false));
    ctx.setLineDash([]); ctx.strokeStyle = j.line; ctx.lineWidth = px * 1.2;
    const n = axis.length - 1;
    for (const k of [0.3, 0.52, 0.72, 0.9]) {
      const i = Math.round(k * n); ctx.beginPath(); ctx.moveTo(...left[i]); ctx.lineTo(...right[i]); ctx.stroke();
    }
    if (j.lobe) { ctx.lineWidth = px; ctx.beginPath(); ctx.arc(...axis[n], j.w * 1.2, 0, TAU); ctx.stroke(); }
    ctx.restore();
  }

  // ---------- Pulsar beams ----------
  function beams(ctx, b, style, px, ew) {
    for (const a of [b.ang, b.ang + Math.PI]) {
      if (style === 'lowpoly') {
        for (const [k, al, col] of [[1, 0.16, b.pal[2]], [0.62, 0.3, b.pal[1]], [0.26, 0.6, b.pal[0]]]) {
          const pts = []; pts.push(rot([b.r0, 0], a));
          for (let i = 0; i <= 4; i++) pts.push(rot([b.len * (0.75 + 0.25 * k), 0], a - b.w * k + (i / 4) * b.w * k * 2));
          face(ctx, pts, col, ew, al);
        }
        continue;
      }
      ctx.save();
      ctx.lineWidth = px;
      ctx.strokeStyle = U.rgba(b.line, 0.85);
      for (const s of [-1, 1]) {
        ctx.setLineDash([]); ctx.beginPath(); ctx.moveTo(...rot([b.r0, 0], a)); ctx.lineTo(...rot([b.len * 0.6, 0], a + s * b.w * 0.6)); ctx.stroke();
        ctx.setLineDash([b.len * 0.05, b.len * 0.04]); ctx.beginPath(); ctx.moveTo(...rot([b.len * 0.6, 0], a + s * b.w * 0.6)); ctx.lineTo(...rot([b.len, 0], a + s * b.w)); ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.strokeStyle = U.rgba(b.line, 0.55); ctx.beginPath(); ctx.moveTo(...rot([b.r0, 0], a)); ctx.lineTo(...rot([b.len * 0.92, 0], a)); ctx.stroke();
      // Wavefronts across the beam.
      [0.38, 0.62, 0.84].forEach((k, i) => {
        const rr = b.len * k, w = b.w * (0.6 + 0.4 * k);
        ctx.strokeStyle = U.rgba(b.line, 0.8 - i * 0.22);
        ctx.beginPath(); ctx.arc(0, 0, rr, a - w, a + w); ctx.stroke();
      });
      ctx.restore();
    }
  }

  // ---------- Magnetic field loops (dipole: r = L sin²θ) ----------
  function field(ctx, f, style, px, ew) {
    f.Ls.forEach((L, li) => {
      for (const side of [-1, 1]) {
        const pts = [], n = style === 'lowpoly' ? 10 : 40;
        for (let i = 0; i <= n; i++) {
          const th = 0.2 + (i / n) * (Math.PI - 0.4), r = L * Math.sin(th) ** 2;
          pts.push(rot([r * Math.cos(th), side * r * Math.sin(th)], f.ang));
        }
        ctx.save();
        if (style === 'lowpoly') {
          ctx.strokeStyle = li % 2 ? f.pal[2] : f.pal[1]; ctx.lineWidth = f.core * 0.16; ctx.lineJoin = 'miter';
          ctx.stroke(poly(pts, false));
        } else {
          const u = li / (f.Ls.length - 1);
          ctx.strokeStyle = U.rgba(f.line, 0.9 - 0.55 * u); ctx.lineWidth = px * (1 - 0.3 * u);
          if (u > 0.4) ctx.setLineDash([L * 0.08, L * 0.05]);
          ctx.stroke(poly(pts, false));
        }
        ctx.restore();
      }
    });
  }

  // ---------- Swarm ----------
  // stars: [{ x, y, s (0..1 brightness), cls }]
  function swarm(ctx, stars, look, style, px, ew) {
    ctx.save();
    for (const st of stars) {
      if (style === 'lowpoly') {
        const P = STAR[st.cls] || STAR.G, rr = st.size;
        if (st.s > 0.6) face(ctx, ngon(st.x, st.y, rr * 2.1, 14, st.x), P[2], ew, 0.22);
        face(ctx, ngon(st.x, st.y, rr, st.s > 0.6 ? 6 : 4, st.y), st.s > 0.6 ? P[1] : P[2], ew);
        continue;
      }
      if (st.s > 0.6) {
        const rr = st.size;
        ctx.fillStyle = U.rgba(U.mix(look.line, '#ffffff', 0.6), 0.9); ctx.strokeStyle = look.line; ctx.lineWidth = px;
        ctx.beginPath(); ctx.arc(st.x, st.y, rr, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = U.rgba(look.line, 0.7); ctx.beginPath();
        for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) { ctx.moveTo(st.x + dx * rr * 1.6, st.y + dy * rr * 1.6); ctx.lineTo(st.x + dx * rr * 3.4, st.y + dy * rr * 3.4); }
        ctx.stroke();
      } else {
        const d = Math.max(px * 1.6, st.size * 1.4);
        ctx.fillStyle = U.rgba(look.line, 0.35 + 0.6 * st.s);
        ctx.fillRect(st.x - d / 2, st.y - d / 2, d, d);
      }
    }
    ctx.restore();
  }
  function swarmStars(r, R, kind, n) {
    const out = [];
    if (kind === 'open') {
      for (let i = 0; i < n; i++) { const a = r() * TAU, d = R * Math.sqrt(r()) * 0.85; out.push({ x: Math.cos(a) * d, y: Math.sin(a) * d, s: 0.7 + r() * 0.3, size: R * (0.035 + r() * 0.03), cls: weightedPick([['B', 2], ['A', 3], ['F', 2], ['G', 1]], r()) }); }
      for (let i = 0; i < n * 2; i++) { const a = r() * TAU, d = R * Math.sqrt(r()) * 0.95; out.push({ x: Math.cos(a) * d, y: Math.sin(a) * d, s: r() * 0.5, size: R * 0.012, cls: 'A' }); }
    } else {
      // Plummer profile: crowded core, thin halo.
      const a0 = R * (kind === 'core' ? 0.3 : 0.17);
      for (let i = 0; i < n; i++) {
        const u = 0.02 + r() * 0.96, d = Math.min(R * 0.97, a0 / Math.sqrt(Math.pow(u, -2 / 3) - 1)), a = r() * TAU;
        const bright = r() < (kind === 'core' ? 0.03 : 0.05);
        out.push({ x: Math.cos(a) * d, y: Math.sin(a) * d, s: bright ? 0.7 + r() * 0.3 : r() * 0.55, size: bright ? R * 0.028 : R * (0.008 + r() * 0.008), cls: weightedPick([['K', 3], ['M', 2], ['G', 2]], r()) });
      }
    }
    return out.sort((p, q) => p.s - q.s);
  }

  // ---------- Shell ----------
  // sh: { R, th (thickness, fraction of R), q, roll, type: 'snr' | 'pn' | 'bubble', axis }
  function shellGeo(sh, r) {
    const H = Array.from({ length: 4 }, (_, k) => ({ k: k + 2, a: (sh.type === 'pn' ? 0.012 : sh.type === 'bubble' ? 0.03 : 0.06) / (k + 1), p: r() * TAU }));
    const N = Array.from({ length: 5 }, () => ({ k: 2 + Math.floor(r() * 7), p: r() * TAU }));
    const radius = (phi) => sh.R * (1 + H.reduce((t, h) => t + h.a * Math.sin(h.k * phi + h.p), 0));
    const noise = (phi) => N.reduce((t, n) => t + Math.sin(n.k * phi + n.p), 0) / N.length;
    const bright = (phi) => {
      if (sh.type === 'snr') return 0.3 + 0.75 * Math.abs(Math.cos(phi - sh.axis)) ** 1.4 + 0.35 * noise(phi);
      if (sh.type === 'pn') return 0.85 + 0.15 * Math.cos(2 * (phi - sh.axis));
      return 0.55 + 0.5 * noise(phi);
    };
    const at = (phi, f) => rot([Math.cos(phi) * radius(phi) * f, Math.sin(phi) * radius(phi) * f * sh.q], sh.roll);
    return { radius, bright, at };
  }
  function shell(ctx, sh, look, style, px, ew, rnd) {
    const G = shellGeo(sh, rnd);
    ctx.save();
    if (style === 'lowpoly') {
      const N = 40, P = look.shell;
      // Outer haze, body, inner rim: translucent bands stepped by brightness.
      const bands = [[1 + sh.th * 0.35, 1, P[3], 0.5], [1, 1 - sh.th * 0.45, P[2], 0.75], [1 - sh.th * 0.45, 1 - sh.th, P[1], 1]];
      if (sh.type === 'pn') bands.push([1 - sh.th, 1 - sh.th * 1.25, P[0], 1]);
      for (const [f0, f1, col, k] of bands) for (let i = 0; i < N; i++) {
        const p0 = (i / N) * TAU, p1 = ((i + 1) / N) * TAU, b = G.bright((p0 + p1) / 2) * k, lv = b > 0.8 ? 0.6 : b > 0.5 ? 0.38 : b > 0.3 ? 0.2 : 0;
        if (lv) face(ctx, [G.at(p0, f0), G.at(p1, f0), G.at(p1, f1), G.at(p0, f1)], col, ew, lv);
      }
    } else {
      const N = 120, layers = 4;
      ctx.lineWidth = px;
      for (let j = 0; j < layers; j++) {
        const f = 1 - (j / (layers - 1)) * sh.th;
        for (let i = 0; i < N; i++) {
          const p0 = (i / N) * TAU, p1 = ((i + 1) / N) * TAU, b = G.bright((p0 + p1) / 2) - (sh.type === 'pn' ? 0 : Math.abs(j - 1) * 0.18);
          if (b < 0.32) continue;
          ctx.strokeStyle = U.rgba(look.line, Math.min(0.95, 0.2 + 0.65 * b));
          ctx.beginPath(); ctx.moveTo(...G.at(p0, f)); ctx.lineTo(...G.at(p1, f)); ctx.stroke();
        }
      }
    }
    // Filaments (supernova remnants): strands running along the shell, a few curling inward.
    if (sh.type === 'snr') {
      for (let i = 0; i < 16; i++) {
        const p0 = rnd() * TAU, span = 0.25 + rnd() * 0.45, inward = rnd() < 0.3, f0 = 1 - rnd() * sh.th, pts = [];
        for (let k = 0; k <= 8; k++) { const u = k / 8; pts.push(G.at(p0 + (inward ? span * 0.2 : span) * u, f0 - (inward ? u * 0.25 : 0) + Math.sin(u * 7 + i) * sh.th * 0.12)); }
        if (style === 'lowpoly') { ctx.strokeStyle = U.rgba(look.alt, 0.85); ctx.lineWidth = sh.R * 0.018; ctx.lineJoin = 'miter'; }
        else { ctx.strokeStyle = U.rgba(look.line, 0.75); ctx.lineWidth = px * 0.8; }
        ctx.stroke(poly(pts, false));
      }
    }
    // Knots (wind bubbles): clumps strung along the shell.
    if (sh.type === 'bubble') {
      for (let i = 0; i < 26; i++) {
        const p = rnd() * TAU, [x, y] = G.at(p, 1 - rnd() * sh.th), kr = sh.R * (0.02 + rnd() * 0.025);
        if (style === 'lowpoly') face(ctx, ngon(x, y, kr, 5, p), look.alt, ew);
        else { ctx.strokeStyle = U.rgba(look.line, 0.85); ctx.lineWidth = px; ctx.beginPath(); ctx.arc(x, y, kr, 0, TAU); ctx.stroke(); }
      }
    }
    // Bipolar lobes (planetary nebulae): two faint loops out along the long axis.
    if (sh.type === 'pn') {
      for (const s of [-1, 1]) {
        const pts = [];
        for (let k = 0; k <= 16; k++) { const a = -1.1 + (k / 16) * 2.2; pts.push(rot([s * (sh.R * 0.7 + Math.cos(a) * sh.R * 0.55), Math.sin(a) * sh.R * 0.42], sh.roll)); }
        if (style === 'lowpoly') face(ctx, pts, look.alt, ew, 0.22);
        else { ctx.strokeStyle = U.rgba(look.line, 0.45); ctx.lineWidth = px * 0.8; ctx.setLineDash([sh.R * 0.06, sh.R * 0.04]); ctx.stroke(poly(pts, false)); ctx.setLineDash([]); }
      }
    }
    ctx.restore();
  }

  // ---------- Small extras ----------
  // Pulse rings (Cepheids) and lensing rings (quiet black holes): concentric, fading outward.
  function rings(ctx, radii, col, style, px, ew, dashed) {
    radii.forEach((rr, i) => {
      const a = 0.75 - (i / radii.length) * 0.5;
      if (style === 'lowpoly') {
        const o = ngon(0, 0, rr, 14, i * 0.3), n = ngon(0, 0, rr * 0.955, 14, i * 0.3);
        face(ctx, [...o, o[0], n[0], ...n.reverse()], col, ew, a * 0.8);
      } else {
        ctx.save(); ctx.strokeStyle = U.rgba(col, a); ctx.lineWidth = px;
        if (dashed) ctx.setLineDash([rr * 0.2, rr * 0.08]);
        ctx.beginPath(); ctx.arc(0, 0, rr, 0, TAU); ctx.stroke(); ctx.restore();
      }
    });
  }
  // Short tangential streaks: background stars smeared by lensing round a black hole.
  function lensedStars(ctx, R, h, col, style, px, ew, rnd) {
    for (let i = 0; i < 9; i++) {
      const d = h * 2 + rnd() * (R * 0.9 - h * 2), a = rnd() * TAU, span = (0.6 * h) / d + 0.05;
      if (style === 'lowpoly') {
        const pts = [];
        for (let k = 0; k <= 4; k++) pts.push(rot([d, 0], a - span + (k / 4) * span * 2));
        for (let k = 4; k >= 0; k--) pts.push(rot([d - R * 0.02, 0], a - span + (k / 4) * span * 2));
        face(ctx, pts, col, ew);
      } else {
        ctx.strokeStyle = U.rgba(col, 0.75); ctx.lineWidth = px * 1.1;
        ctx.beginPath(); ctx.arc(0, 0, d, a - span, a + span); ctx.stroke();
      }
    }
  }
  // An interstellar object's tail (comet) or speed streaks, away from the light.
  function tail(ctx, x, y, len, w, comet, look, style, px, ew, rnd) {
    const a = Math.atan2(-LIGHT2[1], -LIGHT2[0]);
    if (style === 'lowpoly') {
      if (comet) for (const [k, al] of [[1, 0.18], [0.7, 0.32], [0.42, 0.55]]) face(ctx, [rot([0, -w * 0.4], a), rot([len * k, -w * k], a + 0.04), rot([len * k, w * k], a + 0.04), rot([0, w * 0.4], a)].map(([px2, py]) => [x + px2, y + py]), look.tail[k > 0.8 ? 2 : k > 0.5 ? 1 : 0], ew, al);
      else for (const o of [-0.35, 0, 0.35]) face(ctx, [rot([w * 0.9, o * w - w * 0.05], a), rot([len * 0.55, o * w * 1.6], a), rot([w * 0.9, o * w + w * 0.05], a)].map(([px2, py]) => [x + px2, y + py]), look.tail[1], ew, 0.5);
      return;
    }
    ctx.save();
    ctx.lineWidth = px;
    const n = comet ? 6 : 3;
    for (let i = 0; i < n; i++) {
      const o = (i / (n - 1) - 0.5) * 2, spread = comet ? 0.22 : 0.06, L = comet ? len * (0.7 + rnd() * 0.3) : len * (0.35 + rnd() * 0.2);
      const p0 = rot([w * 0.8, o * w * 0.5], a), p1 = rot([L, o * L * spread], a);
      ctx.strokeStyle = U.rgba(look.line, comet ? 0.8 - Math.abs(o) * 0.35 : 0.6);
      ctx.setLineDash(comet ? [L * 0.25, L * 0.04, L * 0.1, L * 0.05] : [L * 0.12, L * 0.08]);
      ctx.beginPath(); ctx.moveTo(x + p0[0], y + p0[1]); ctx.lineTo(x + p1[0], y + p1[1]); ctx.stroke();
    }
    ctx.restore();
  }

  // Streaks behind something moving fast along `ang` (a hypervelocity star): a bow and lines trailing.
  function streaks(ctx, ang, r, len, look, style, px, ew, rnd) {
    const back = ang + Math.PI;
    if (style === 'lowpoly') {
      face(ctx, [rot([r * 1.25, -r * 1.1], ang), rot([r * 1.6, 0], ang), rot([r * 1.25, r * 1.1], ang), rot([r * 1.35, 0], ang)], look.tail[1], ew, 0.5);
      for (const o of [-0.6, -0.2, 0.2, 0.6]) face(ctx, [rot([r * 0.9, o * r - r * 0.06], back), rot([len * (0.55 + 0.4 * (1 - Math.abs(o))), o * r * 1.3], back), rot([r * 0.9, o * r + r * 0.06], back)], look.tail[2], ew, 0.45);
      return;
    }
    ctx.save();
    ctx.lineWidth = px;
    ctx.strokeStyle = U.rgba(look.line, 0.7);
    ctx.beginPath(); ctx.arc(0, 0, r * 1.45, ang - 0.9, ang + 0.9); ctx.stroke();
    for (let i = 0; i < 5; i++) {
      const o = (i / 4 - 0.5) * 2, L = len * (0.5 + 0.45 * (1 - Math.abs(o)) + rnd() * 0.1);
      ctx.strokeStyle = U.rgba(look.line, 0.75 - Math.abs(o) * 0.35);
      ctx.setLineDash([L * 0.18, L * 0.07]);
      ctx.beginPath(); ctx.moveTo(...rot([r * 1.1, o * r * 0.7], back)); ctx.lineTo(...rot([L, o * r * 1.2], back)); ctx.stroke();
    }
    ctx.restore();
  }

  // ---------- Disc shapes ----------
  // A protoplanetary or debris disc at art radius R, from its own stream (so drawing it and
  // filling it with rocks agree): the shape, its gaps and their embryos, and where a point in it is.
  function discOf(site, R) {
    const r = rngOf(site, 0xd15c);
    let d;
    if (site.kind === 'protoplanetary-disc') {
      const n = Math.min(3, (site.proplyds || 3) - 1), rIn = R * 0.2, rOut = R * 0.96;
      const gaps = Array.from({ length: n }, (_, i) => [rIn + (rOut - rIn) * (0.28 + i * 0.24 + r() * 0.06), R * 0.028]);
      d = { rIn, rOut, q: 0.4, roll: -0.18, gaps, rings: 14, rim: R * 0.04 };
      d.embryos = gaps.map(([g]) => ({ g, phi: r() * TAU }));
    } else d = { rIn: R * 0.5, rOut: R * 0.78, q: 0.34, roll: -0.25, gaps: [], embryos: [], rings: 6, rim: R * 0.025 };
    d.at = (rho, phi) => discAt(d, rho, phi);
    d.inGap = (rho) => inGap(d, rho);
    return d;
  }

  // ---------- Sample data ----------
  // Fields match world/deep-space.js, plus art-only ones (axis angles in screen space).
  function sample(kind, seed = 1, variant) {
    const r = mulberry32(hashInt(seed >>> 0, kindInt(kind), kindInt(variant || '')));
    const s = { kind, seed: seed >>> 0, r: 40, variant };
    const up = -Math.PI / 2 + (r() - 0.5) * 0.7;
    switch (kind) {
      case 'smbh': return { ...s, name: 'Core A*', jet: up, jetWidth: 0.16 };
      case 'pulsar': { const ms = variant === 'millisecond'; return { ...s, millisecond: ms, beam: -0.6 + (r() - 0.5) * 0.8, beamWidth: ms ? 0.1 : 0.14 + r() * 0.06 }; }
      case 'magnetar': return { ...s, field: 1, axis: up + 0.4 };
      case 'stellar-black-hole': return { ...s, mass: variant || weightedPick([['light', 3], ['heavy', 2]], r()) };
      case 'microquasar': return { ...s, companion: weightedPick([['B', 2], ['O', 1]], r()), jet: up, wobble: 0.35 + r() * 0.3 };
      case 'white-dwarf': return { ...s, planetaryNebula: variant === 'nebula', debris: variant !== 'nebula' };
      case 'wolf-rayet': return { ...s, wind: 40 + Math.round(r() * 40) };
      case 'variable-star': return { ...s, amplitude: 0.4 + r() * 0.4 };
      case 'brown-dwarf': return { ...s, cls: variant || weightedPick([['L', 2], ['T', 3], ['Y', 1]], r()), moons: Math.floor(r() * 3) };
      case 'rogue-planet': return { ...s, type: variant || weightedPick([['ice', 3], ['dark', 2]], r()), moon: r() < 0.5 };
      case 'interstellar-object': return { ...s, form: variant || weightedPick([['cigar', 1], ['comet', 2], ['shard', 1]], r()) };
      case 'protoplanetary-disc': return { ...s, star: weightedPick([['K', 1], ['G', 2], ['A', 1]], r()), proplyds: 2 + Math.floor(r() * 4) };
      case 'supernova-remnant': return { ...s, age: Math.round(2000 + r() * 18000), heart: r() < 0.65 ? 'pulsar' : 'neutron-star' };
      case 'open-cluster': return { ...s, members: 5 + Math.floor(r() * 8) };
      case 'globular-cluster': return { ...s, stars: 200 + Math.floor(r() * 600) };
      case 'neutron-star': return { ...s, field: 0.3 + r() * 0.3, axis: up + 0.4 };
      case 'recurrent-nova': return { ...s, companion: 'M', burst: 90, burstNow: variant === 'burst' };
      case 'kilonova-remnant': return { ...s, age: Math.round(5000 + r() * 40000) };
      case 'hypervelocity-star': return { ...s, cls: 'B', heading: -0.4 + (r() - 0.5) * 0.6 };
      default: return s;
    }
  }

  // ---------- Draw ----------
  function draw(ctx, site, requested, o = {}) {
    const style = requested === 'lowpoly' ? 'lowpoly' : 'line';
    const R = site.r, k = scaleOf(ctx), px = 0.9 / k * 1.25, ew = 0.6 / k;
    const rnd = rngOf(site, 0x5173), look = LOOK[site.kind] || {};
    const seed = site.seed >>> 0;
    // Which parts to draw (o.part), what the site is doing (o.phase), how far beams and jets reach.
    const core = o.part !== 'area', area = o.part !== 'core', whole = !o.part;
    const ph = o.phase || {}, reach = o.reach || 1;
    ctx.save();
    switch (site.kind) {
      case 'white-dwarf': {
        if (site.planetaryNebula) {
          if (area) shell(ctx, { R: R * 0.62, th: 0.32, q: 0.72, roll: rnd() * Math.PI, type: 'pn', axis: 0 }, look, style, px, ew, rnd);
          if (core) star(ctx, { cls: 'D', r: R * 0.1, seed }, style, o);
        } else if (site.debris === false) {
          if (core) star(ctx, { cls: 'D', r: R * 0.22, seed }, style, o);
        } else {
          const d = { ...discOf(site, R), line: look.line, pal: look.debris };
          if (area) disc(ctx, d, -1, style, px, ew, rnd);
          if (core) star(ctx, { cls: 'D', r: R * 0.22, seed }, style, o);
          if (area) disc(ctx, d, 1, style, px, ew, rnd);
        }
        break;
      }
      case 'wolf-rayet': {
        if (area) shell(ctx, { R: R * 0.8, th: 0.22, q: 0.92, roll: rnd() * TAU, type: 'bubble', axis: 0 }, look, style, px, ew, rnd);
        if (!core) break;
        // The wind: radial streaks between star and bubble.
        for (let i = 0; i < 18; i++) {
          const a = (i / 18) * TAU + rnd() * 0.2, r0 = R * (0.4 + rnd() * 0.12), r1 = r0 + R * (0.12 + rnd() * 0.1);
          if (style === 'lowpoly') face(ctx, [rot([r0, -R * 0.012], a), rot([r1, 0], a), rot([r0, R * 0.012], a)], look.shell[1], ew, 0.6);
          else { ctx.strokeStyle = U.rgba(look.line, 0.5); ctx.lineWidth = px * 0.8; ctx.beginPath(); ctx.moveTo(...rot([r0, 0], a)); ctx.lineTo(...rot([r1, 0], a)); ctx.stroke(); }
        }
        star(ctx, { cls: 'W', r: R * 0.17, seed }, style, o);
        break;
      }
      case 'variable-star': {
        // The rings swell with the star's brightness.
        const b = ph.brightness ?? 0.5, swell = 0.88 + 0.24 * b;
        rings(ctx, [0.66, 0.8, 0.94].map((f) => R * f * swell), style === 'lowpoly' ? STAR.F[2] : look.line, style, px, ew);
        star(ctx, { cls: 'F', r: R * 0.26, seed }, style, o);
        break;
      }
      case 'pulsar': {
        const ms = site.millisecond;
        beams(ctx, { ang: ph.beam ?? site.beam, w: site.beamWidth, r0: R * 0.12, len: R * 0.98 * reach, line: look.line, pal: look.beam }, style, px, ew);
        star(ctx, { cls: 'N', r: R * (ms ? 0.08 : 0.11), seed }, style, o);
        break;
      }
      case 'neutron-star': {
        // A quiet one: a weak field, faint loops round a bare core.
        const c = R * 0.11, f = site.field ?? 0.4;
        field(ctx, { ang: site.axis ?? -1.2, Ls: [0.3, 0.45, 0.6].map((x) => R * x * (0.6 + f)), core: c * 0.6, line: look.line, pal: look.field }, style, px, ew);
        star(ctx, { cls: 'N', r: c, seed }, style, o);
        break;
      }
      case 'magnetar': {
        const c = R * 0.11;
        field(ctx, { ang: site.axis ?? 0.6, Ls: [0.34, 0.5, 0.68, 0.9].map((f) => R * f), core: c, line: look.line, pal: look.field }, style, px, ew);
        star(ctx, { cls: 'X', r: c, seed }, style, o);
        break;
      }
      case 'stellar-black-hole': {
        const h = R * (site.mass === 'heavy' ? 0.2 : 0.14);
        rings(ctx, [1.7, 2.4, 3.3].map((f) => h * f), style === 'lowpoly' ? look.ring[2] : look.line, style, px, ew, true);
        lensedStars(ctx, R, h, style === 'lowpoly' ? look.ring[1] : look.line, style, px, ew, rnd);
        hole(ctx, h, look, style, px, ew, 0);
        break;
      }
      case 'microquasar': {
        const cx = -R * 0.18, cy = R * 0.05, h = R * 0.06, cs = R * 0.16, sx = R * 0.56, sy = R * 0.38, jet = ph.jet ?? site.jet;
        const d = { rIn: h * 1.6, rOut: R * 0.28, q: 0.3, roll: jet + Math.PI / 2, line: look.line, pal: look.disc, rings: 7, rim: R * 0.02 };
        const j = { ang: jet, base: h, len: R * 0.82 * reach, w: R * 0.035 * Math.min(4, Math.sqrt(reach)), wob: site.wobble * 0.12, line: look.line, pal: look.jet };
        star(ctx, { cls: site.companion, r: cs, seed }, style, o, sx, sy);
        // The stream: gas pulled off the companion, curling into the disc.
        ctx.save(); ctx.translate(cx, cy);
        const s0 = [sx - cx - cs * 0.9, sy - cy - cs * 0.3], s1 = discAt(d, d.rOut * 0.95, 0.5);
        const ctrl = [(s0[0] + s1[0]) / 2, Math.min(s0[1], s1[1]) - R * 0.12];
        if (style === 'lowpoly') {
          const pts = [];
          for (let i = 0; i <= 8; i++) { const u = i / 8, x = (1 - u) ** 2 * s0[0] + 2 * (1 - u) * u * ctrl[0] + u * u * s1[0], y = (1 - u) ** 2 * s0[1] + 2 * (1 - u) * u * ctrl[1] + u * u * s1[1]; pts.push([x, y - R * 0.02 * (1 - u * 0.6)]); }
          for (let i = 8; i >= 0; i--) { const u = i / 8, x = (1 - u) ** 2 * s0[0] + 2 * (1 - u) * u * ctrl[0] + u * u * s1[0], y = (1 - u) ** 2 * s0[1] + 2 * (1 - u) * u * ctrl[1] + u * u * s1[1]; pts.push([x, y + R * 0.02 * (1 - u * 0.6)]); }
          face(ctx, pts, look.disc[2], ew);
        } else {
          ctx.strokeStyle = U.rgba(look.line, 0.8); ctx.lineWidth = px;
          for (const o2 of [-1, 1]) { ctx.beginPath(); ctx.moveTo(s0[0], s0[1] + o2 * R * 0.015); ctx.quadraticCurveTo(ctrl[0], ctrl[1] + o2 * R * 0.012, s1[0], s1[1]); ctx.stroke(); }
        }
        jets(ctx, j, -1, style, px, ew);
        disc(ctx, d, -1, style, px, ew, rnd);
        hole(ctx, h, look, style, px, ew, h * 1.7);
        disc(ctx, d, 1, style, px, ew, rnd);
        jets(ctx, j, 1, style, px, ew);
        ctx.restore();
        break;
      }
      case 'smbh': {
        // The crowd round it is sky in flight (game/starfield.js), so only the whole picture has it.
        if (whole) swarm(ctx, swarmStars(rngOf(site, 0xc1), R, 'core', 220), { line: '#ffe2a8' }, style, px, ew);
        const h = R * 0.12;
        const d = { rIn: h * 1.5, rOut: R * 0.66, q: 0.28, roll: site.jet + Math.PI / 2, line: look.line, pal: look.disc, rings: 13, rim: R * 0.025 };
        const j = { ang: site.jet, base: h, len: R * 1.02 * reach, w: R * site.jetWidth * 0.5 * Math.min(4, Math.sqrt(reach)), lobe: true, line: look.line, pal: look.jet };
        jets(ctx, j, -1, style, px, ew);
        disc(ctx, d, -1, style, px, ew, rnd);
        hole(ctx, h, look, style, px, ew, h * 1.55);
        disc(ctx, d, 1, style, px, ew, rnd);
        jets(ctx, j, 1, style, px, ew);
        break;
      }
      case 'protoplanetary-disc': {
        const d = { ...discOf(site, R), line: look.line, pal: look.disc };
        const embryo = (e) => {
          const [x, y] = discAt(d, e.g, e.phi), rr = R * 0.035;
          if (style === 'lowpoly') { face(ctx, ngon(x, y, rr, 6, e.phi), U.shade(look.disc[1], 0.8), ew); face(ctx, ngon(x - rr * 0.25, y - rr * 0.25, rr * 0.5, 5, e.phi), look.disc[0], ew); }
          else { const p = new Path2D(); p.arc(x, y, rr, 0, TAU); ctx.fillStyle = BG(); ctx.fill(p); ctx.strokeStyle = look.line; ctx.lineWidth = px; ctx.stroke(p); Art.hatch(ctx, p, x, y, rr, LIGHT2[0], LIGHT2[1], look.line, px * 0.6); }
        };
        disc(ctx, d, -1, style, px, ew, rnd);
        d.embryos.filter((e) => Math.sin(e.phi) < 0).forEach(embryo);
        star(ctx, { cls: site.star, r: R * 0.1, seed }, style, o);
        disc(ctx, d, 1, style, px, ew, rnd);
        d.embryos.filter((e) => Math.sin(e.phi) >= 0).forEach(embryo);
        break;
      }
      case 'supernova-remnant': {
        const young = site.age < 8000;
        shell(ctx, { R: R * (young ? 0.72 : 0.86), th: young ? 0.18 : 0.3, q: 0.9 + rnd() * 0.08, roll: rnd() * TAU, type: 'snr', axis: rnd() * TAU }, look, style, px, ew, rnd);
        // Its heart is a site of its own in the game (a pulsar or neutron star).
        if (whole) star(ctx, { cls: 'N', r: R * 0.04, seed }, style, o, (rnd() - 0.5) * R * 0.2, (rnd() - 0.5) * R * 0.2);
        break;
      }
      case 'kilonova-remnant': {
        // Older and fainter than a supernova's: a thick, broken shell of heavy-element debris.
        shell(ctx, { R: R * 0.8, th: 0.38, q: 0.86 + rnd() * 0.1, roll: rnd() * TAU, type: 'snr', axis: rnd() * TAU }, look, style, px, ew, rnd);
        if (whole) for (let i = 0; i < 14; i++) {
          const a = rnd() * TAU, d = R * (0.45 + rnd() * 0.45), rr = R * (0.012 + rnd() * 0.014), x = Math.cos(a) * d, y = Math.sin(a) * d;
          if (style === 'lowpoly') face(ctx, ngon(x, y, rr, 5, a), look.shell[2], ew);
          else { ctx.strokeStyle = U.rgba(look.line, 0.85); ctx.lineWidth = px; ctx.beginPath(); ctx.arc(x, y, rr, 0, TAU); ctx.stroke(); }
        }
        break;
      }
      case 'recurrent-nova': {
        // A white dwarf feeding on a red dwarf, its stolen gas in a little disc until it ignites.
        const wx = -R * 0.22, wy = R * 0.04, wr = R * 0.07, mx = R * 0.36, my = -R * 0.12, mr = R * 0.17;
        const d = { rIn: wr * 1.4, rOut: R * 0.2, q: 0.35, roll: 0.2, line: look.line, pal: look.disc, rings: 5, rim: R * 0.015 };
        star(ctx, { cls: site.companion || 'M', r: mr, seed: seed + 1 }, style, o, mx, my);
        ctx.save(); ctx.translate(wx, wy);
        const s0 = [mx - wx - mr * 0.95, my - wy + mr * 0.15], s1 = discAt(d, d.rOut * 0.95, -0.4), ctrl = [(s0[0] + s1[0]) / 2, Math.max(s0[1], s1[1]) + R * 0.06];
        if (style === 'lowpoly') {
          const pts = [];
          for (let i = 0; i <= 6; i++) { const u = i / 6; pts.push([(1 - u) ** 2 * s0[0] + 2 * (1 - u) * u * ctrl[0] + u * u * s1[0], (1 - u) ** 2 * s0[1] + 2 * (1 - u) * u * ctrl[1] + u * u * s1[1] - R * 0.012 * (1 - u)]); }
          for (let i = 6; i >= 0; i--) { const u = i / 6; pts.push([(1 - u) ** 2 * s0[0] + 2 * (1 - u) * u * ctrl[0] + u * u * s1[0], (1 - u) ** 2 * s0[1] + 2 * (1 - u) * u * ctrl[1] + u * u * s1[1] + R * 0.012 * (1 - u)]); }
          face(ctx, pts, look.disc[2], ew);
        } else {
          ctx.strokeStyle = U.rgba(look.line, 0.75); ctx.lineWidth = px;
          ctx.beginPath(); ctx.moveTo(...s0); ctx.quadraticCurveTo(...ctrl, ...s1); ctx.stroke();
        }
        disc(ctx, d, -1, style, px, ew, rnd);
        star(ctx, { cls: 'D', r: wr, seed }, style, o);
        disc(ctx, d, 1, style, px, ew, rnd);
        // The burst: a bright shell racing out from the dwarf.
        const bursting = ph.burst ?? site.burstNow;
        if (bursting) {
          const u = ph.left !== undefined && site.burst ? 1 - ph.left / site.burst : 0.5, rr = R * (0.25 + 0.75 * u);
          rings(ctx, [rr * 0.7, rr * 0.85, rr], style === 'lowpoly' ? look.burst[1] : look.line, style, px * 1.6, ew);
          if (style === 'lowpoly') face(ctx, ngon(0, 0, wr * (2.6 - u), 12, u), look.burst[0], ew, 0.7 * (1 - u) + 0.2);
          else { ctx.fillStyle = U.rgba(look.burst[0], 0.6 * (1 - u) + 0.2); ctx.beginPath(); ctx.arc(0, 0, wr * (2.6 - u), 0, TAU); ctx.fill(); }
        }
        ctx.restore();
        break;
      }
      case 'hypervelocity-star': {
        const sr = R * 0.3;
        streaks(ctx, site.heading ?? 0, sr, R, look, style, px, ew, rnd);
        star(ctx, { cls: site.cls || 'B', r: sr, seed }, style, o);
        break;
      }
      case 'open-cluster': swarm(ctx, swarmStars(rnd, R, 'open', site.members), look, style, px, ew); break;
      case 'globular-cluster': swarm(ctx, swarmStars(rnd, R, 'globular', Math.min(340, Math.round(site.stars * 0.5))), look, style, px, ew); break;
      case 'hii-region': {
        nebula(ctx, 'emission', seed, R, style, o);
        for (let i = 0, n = 2 + Math.floor(rnd() * 2); i < n; i++) { const a = rnd() * TAU, d = R * (0.1 + rnd() * 0.3); star(ctx, { cls: i ? 'B' : 'O', r: R * (i ? 0.045 : 0.07), seed: seed + i }, style, o, Math.cos(a) * d, Math.sin(a) * d); }
        break;
      }
      case 'bok-globule': {
        // In flight it sits in its H II region's own glow, so only the whole picture draws one.
        if (whole) nebula(ctx, 'emission', seed, R, style, o);
        // The globule's silhouette: a lumpy patch of sky blotting out the glow behind it.
        const gr = mulberry32(seed ^ 0xb0c), pts = Array.from({ length: 14 }, (_, i) => { const a = (i / 14) * TAU, rr = R * 0.34 * (0.8 + gr() * 0.35); return [Math.cos(a) * rr, Math.sin(a) * rr * 0.85]; });
        ctx.fillStyle = BG(); ctx.fill(poly(pts));
        // Nested contours inward: a dense dark core.
        [0.72, 0.45].forEach((f, i) => {
          const inner = pts.map(([x, y], j) => [x * f + R * 0.03 * Math.sin(j * 2 + i), y * f]);
          if (style === 'lowpoly') face(ctx, inner, i ? '#141012' : '#0c0a0b', ew);
          else { ctx.strokeStyle = U.rgba('#a08870', 0.7 - i * 0.2); ctx.lineWidth = px * 0.8; ctx.stroke(poly(inner)); }
        });
        if (style === 'lowpoly') { ctx.strokeStyle = U.shade('#e0507a', 0.9); ctx.lineWidth = ew * 2; ctx.stroke(poly(pts)); }
        else { ctx.strokeStyle = U.rgba('#ff6ab0', 0.85); ctx.lineWidth = px; ctx.stroke(poly(pts)); }
        break;
      }
      case 'molecular-cloud': nebula(ctx, 'dust', seed, R, style, o); break;
      case 'brown-dwarf': {
        planet(ctx, { type: 'dwarf-' + site.cls, r: R * 0.5, seed, ring: false }, style, o);
        for (let i = 0; i < site.moons; i++) { const a = -2.4 + i * 1.9 + rnd() * 0.4; moon(ctx, { type: rnd() < 0.5 ? 'ice' : 'dark', r: R * 0.075, seed: seed + i }, style, o, Math.cos(a) * R * 0.8, Math.sin(a) * R * 0.8); }
        break;
      }
      case 'rogue-planet': {
        planet(ctx, { type: 'rogue-' + site.type, r: R * 0.55, seed, ring: false }, style, o);
        if (site.moon) moon(ctx, { type: site.type === 'ice' ? 'ice' : 'dark', r: R * 0.1, seed: seed + 1 }, style, o, R * 0.72, -R * 0.5);
        break;
      }
      case 'interstellar-object': {
        const comet = site.form === 'comet', ar = R * (comet ? 0.26 : 0.4), x = -LIGHT2[0] * R * -0.4, y = -LIGHT2[1] * R * -0.4;
        tail(ctx, x, y, R * (comet ? 1.25 : 0.9), ar, comet, look, style, px, ew, rnd);
        ctx.save(); ctx.translate(x, y);
        Art.drawAsteroid(ctx, { type: comet ? 'ice' : site.form === 'cigar' ? 'stony' : 'metal', r: ar, seed, elong: site.form === 'cigar' ? 1.25 : site.form === 'shard' ? 0.7 : 0.15, lump: site.form === 'shard' ? 0.42 : undefined }, requested, { spin: 0.6, texel: (ar * 2) / 48, force: o.force });
        ctx.restore();
        break;
      }
      default: break;
    }
    ctx.restore();
  }

  return { KINDS, LOOK, sample, draw, discOf };
})();

export { ArtSites };
