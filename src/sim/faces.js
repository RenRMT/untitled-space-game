// Redshift's portraits and art thumbnails as images for the DOM: the people of every culture
// (art/crew.js: humans for the Wedge, Block, Shard and Drifters, aliens, androids), and any
// blueprint, planet, moon, star or deep-space site drawn small for a card. Each is drawn once per
// art style and size and kept as a data URL.
//
//   SimFaces.person(culture, seed) -> { culture, seed, name, title }   one of a culture's people, named
//   SimFaces.face(person, style, size = 96) -> data URL                their portrait
//   SimFaces.img(person, style, size, cls?) -> <img>
//   SimFaces.thumb(id, draw, style, size = 96) -> data URL   draw(ctx, size) draws centred on 0, 0 in px
//   SimFaces.bp(bp, style, size) / planet(art, style, size) / moon(art, …) / star(star, …) / site(site, …) -> data URL
// ES module (`SimFaces`); needs a browser.

import { ArtBodies } from '../art/bodies.js';
import { ArtCrew } from '../art/crew.js';
import { ArtPortraits } from '../art/portraits.js';
import { Art } from '../art/render.js';
import { ArtSites } from '../art/sites.js';
import { hashInt, mulberry32 } from '../core/rng.js';
import { SimConfig } from './config.js';
import { SimMap } from './map.js';

const SimFaces = (() => {
  // Names by culture: given names and family names in each culture's sound.
  const NAMES = {
    android: [['Unit', 'Index', 'Vector', 'Relay', 'Caliper', 'Lumen'], ['Seven', 'Nine', 'Twelve', 'Prime', 'Null', 'Four']],
    wedge: [['Ilsa', 'Corin', 'Marek', 'Tova', 'Dace', 'Renn'], ['Vasq', 'Halloran', 'Strand', 'Okoro', 'Kade', 'Brandt']],
    block: [['Hollis', 'Mabry', 'Ott', 'Senna', 'Grue', 'Pella'], ['Quarry', 'Lindqvist', 'Mott', 'Ferro', 'Dunmore', 'Oakes']],
    shard: [['Ysolde', 'Ithiel', 'Saar', 'Venn', 'Aurel', 'Myrrh'], ['of the Ninth Facet', 'Glasswright', 'Lumine', 'Seren', 'the Clear', 'Prism']],
    drifters: [['Jinx', 'Rook', 'Sable', 'Tamsin', 'Bolt', 'Wren'], ['Nobody', 'Halfmoon', 'Rustwater', 'Kett', 'Freeman', 'Scrap']],
    alien: [['∴', 'The Many', 'Seventeen Lights', 'Hollow Choir', 'Bloom', 'Tide'], ['', '', '', '', '', '']],
  };
  const TITLES = {
    android: ['Advisor', 'Ark steward', 'Gate engineer', 'Rig foreman'],
    wedge: ['Commander', 'Marshal', 'Captain', 'Sentinel'],
    block: ['Trade factor', 'Foreman', 'Broker', 'Guild master'],
    shard: ['Seer', 'Archivist', 'Lens-keeper', 'Facet'],
    drifters: ['Free captain', 'Smuggler', 'Agitator', 'Salvager'],
    alien: ['Envoy', 'Voice', 'Witness', 'Emissary'],
  };

  function person(culture, seed) {
    const r = mulberry32(hashInt(seed >>> 0, culture.length, 0xface));
    const [first, last] = NAMES[culture] || NAMES.android;
    const name = `${first[Math.floor(r() * first.length)]} ${last[Math.floor(r() * last.length)]}`.trim();
    const title = (TITLES[culture] || TITLES.android)[Math.floor(r() * 4)];
    return { culture, seed: seed >>> 0, name, title };
  }

  const urls = new Map();
  function canvasURL(key, size, draw) {
    if (urls.has(key)) return urls.get(key);
    const px = Math.round(size * Math.min(2, window.devicePixelRatio || 1));
    const c = document.createElement('canvas');
    c.width = c.height = px;
    const g = c.getContext('2d');
    g.scale(px / size, px / size);
    draw(g, size);
    const url = c.toDataURL();
    urls.set(key, url);
    return url;
  }

  function face(p, style, size = 96) {
    return canvasURL(`face:${p.culture}:${p.seed}:${style}:${size}`, size, (g, s) => {
      g.fillStyle = '#0b0e14'; g.fillRect(0, 0, s, s);
      g.translate(s / 2, s / 2); g.scale(s / 100, s / 100);
      const art = SimMap.cultureArt(p.culture, p.seed % 7 + 11);
      ArtPortraits.draw(g, ArtCrew.create(p.seed, art), style, { texel: 2 });
    });
  }
  const img = (p, style, size = 48, cls = 'sim-face') => {
    const el = document.createElement('img');
    el.className = cls; el.src = face(p, style, Math.max(64, size * 2)); el.alt = ''; el.width = el.height = size;
    el.setAttribute('aria-hidden', 'true'); el.draggable = false;
    return el;
  };

  const thumb = (id, draw, style, size = 96) => canvasURL(`th:${id}:${style}:${size}`, size, (g, s) => { g.translate(s / 2, s / 2); draw(g, s); });
  const bp = (b, style, size = 96, id = b.id) => thumb(`bp:${id}`, (g, s) => {
    const k = (s * 0.48) / (b.radius || 100);
    g.scale(k, k);
    Art.drawAsset(g, b, style, { angle: -Math.PI / 2, t: 0 });
  }, style, size);
  const planet = (a, style, size = 96) => thumb(`pl:${a.type}:${a.seed}:${a.ring}`, (g, s) => {
    const k = (s * (a.ring ? 0.24 : 0.42)) / a.r;
    g.scale(k, k);
    Art.drawPlanet(g, { ...a, x: 0, y: 0 }, style, { force: true });
  }, style, size);
  const moon = (a, style, size = 96) => thumb(`mo:${a.type}:${a.seed}`, (g, s) => {
    const k = (s * 0.42) / a.r;
    g.scale(k, k);
    ArtBodies.drawMoon(g, { ...a, x: 0, y: 0 }, style, { force: true });
  }, style, size);
  const star = (st, style, size = 96) => thumb(`st:${st.cls}:${st.seed}`, (g, s) => {
    Art.drawStar(g, { ...st, r: s * 0.22, x: 0, y: 0 }, style, { t: 0 });
  }, style, size);
  const site = (si, style, size = 96) => thumb(`si:${si.kind}:${si.seed}`, (g, s) => {
    const k = (s * 0.45) / si.r;
    g.scale(k, k);
    ArtSites.draw(g, si, style, { force: true });
  }, style, size);

  const cultureColor = (c) => SimConfig.CULTURES[c]?.color || '#7df9ff';

  return { person, face, img, thumb, bp, planet, moon, star, site, cultureColor };
})();

export { SimFaces };
