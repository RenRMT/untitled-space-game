// Frame-cost benchmark in a real browser: `node tests/perf.js` (needs Playwright and a Chromium;
// not part of `npm test`). Serves the repository, opens the game as a phone would (390×844 CSS
// pixels at DPR 3, touch, CPU slowed 4×) and flies through the scenes that cost most: the tutorial
// system's nebula, a station and the second system's asteroid belt, in several art styles. For each it prints
// frames per second (which includes the browser's own raster work, mostly fill rate), the script
// work per frame (update + render, ms: median, 95th percentile, worst) and the sprite caches' size
// and build rate. Absolute numbers depend on the machine; compare runs on the same one.
//
//   node tests/perf.js            all scenarios
//   node tests/perf.js nebula     only those whose name contains "nebula"

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
function playwright() {
  try { return require('playwright'); } catch (e) { /* fall back to a global install */ }
  return require(path.join(execSync('npm root -g').toString().trim(), 'playwright'));
}

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const SECONDS = 6;

// Where each scenario puts the ship and how it flies: run in the page with the game's names (G,
// src/main.js) in scope.
const SCENARIOS = [
  { name: 'nebula (line)', style: 'line', place: 'nebula' },
  { name: 'nebula (lowpoly)', style: 'lowpoly', place: 'nebula' },
  { name: 'station (line)', style: 'line', place: 'station' },
  { name: 'station (lowpoly)', style: 'lowpoly', place: 'station' },
  { name: 'station (pixel)', style: 'pixel', place: 'station' },
  { name: 'belt (line)', style: 'line', place: 'belt' },
];
const PLACE = {
  // The tutorial system's nebula: across its middle, slowly.
  nebula: `(() => {
    const n = world.galaxy.nebulae.find((o) => o.system === 0);
    placeShip(n.x - n.r * 0.5, n.y, 0);
    ship.targetSpeed = SHIP.maxSpeed * 0.5;
  })()`,
  // Beside the second system's first station, drifting past it.
  station: `(() => {
    const st = world.scene.entities.find((e) => e.kind === 'station' && e.station.id === world.galaxy.stations.find((o) => o.system === 1).id);
    placeBeside(st);
    ship.targetSpeed = SHIP.maxSpeed * 0.15;
  })()`,
  // The second system's busiest asteroid: through the belt at full speed.
  belt: `(() => {
    const rocks = world.galaxy.asteroids.filter((a) => a.system === 1);
    const crowd = (a) => rocks.reduce((n, b) => n + (Math.hypot(a.x - b.x, a.y - b.y) < 1500), 0);
    const a = rocks.reduce((best, r) => (crowd(r) > crowd(best) ? r : best));
    const star = world.galaxy.systems[1].star;
    const out = Math.atan2(a.y - star.y, a.x - star.x);
    placeShip(a.x, a.y, out + Math.PI / 2);
    ship.targetSpeed = SHIP.maxSpeed;
  })()`,
};

function serve() {
  const server = http.createServer((req, res) => {
    const file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      const index = path.join(file, 'index.html');
      if (!fs.existsSync(index)) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'content-type': TYPES['.html'] });
      res.end(fs.readFileSync(index));
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  });
  return new Promise((resolve) => server.listen(0, () => resolve(server)));
}

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];

async function run(browser, base, sc) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const cdp = await context.newCDPSession(page);
  await page.goto(`${base}/?seed=1&fresh&skipintro&style=${sc.style}`);
  // The game's names in the page (the module the page loaded, imported again), and a way to run a
  // snippet with them in scope, as tests/smoke.js does.
  await page.evaluate(async () => {
    window.__G = (await import('/src/main.js')).G;
    window.__inGame = new Function('__scope', '__src', 'with (__scope) return eval(__src);');
  });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.evaluate((src) => __inGame(__G, src), PLACE[sc.place]);
  // Record each frame's work from here on.
  await page.evaluate(() => {
    window.__work = [];
    __G.perfStats.onFrame = (work) => window.__work.push(work);
  });
  const before = await page.evaluate(() => __G.Art.stats());
  await page.waitForTimeout(SECONDS * 1000);
  const out = await page.evaluate(() => ({ work: window.__work, art: __G.Art.stats(), bodies: __G.ArtBodies.stats(), posed: __G.perfStats.posed, drawn: __G.perfStats.drawn }));
  await context.close();
  if (errors.length) throw new Error(`${sc.name}: ${errors.join('; ')}`);
  const w = out.work.slice(10).sort((a, b) => a - b); // the first frames build the scene's sprites
  const mb = (px) => Math.round((px * 4) / 1e6);
  return {
    scenario: sc.name,
    fps: Math.round(out.work.length / SECONDS),
    'p50 ms': +pct(w, 0.5).toFixed(1),
    'p95 ms': +pct(w, 0.95).toFixed(1),
    'worst ms': +w[w.length - 1].toFixed(1),
    'posed/drawn': `${out.posed}/${out.drawn}`,
    'sprite MB': mb(out.art.spritePixels) + mb(out.art.asteroidPixels) + mb(out.bodies.pixels),
    'builds/s': Math.round((out.art.builds - before.builds) / SECONDS),
  };
}

(async () => {
  const only = process.argv[2];
  const server = await serve();
  const base = `http://localhost:${server.address().port}`;
  const browser = await playwright().chromium.launch();
  const rows = [];
  try {
    for (const sc of SCENARIOS) {
      if (only && !sc.name.includes(only)) continue;
      rows.push(await run(browser, base, sc));
      console.log(`done ${sc.name}`);
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.table(rows);
})().catch((e) => { console.error(e); process.exit(1); });
