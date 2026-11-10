// An installable page's offline file list: every file <app>/index.html loads (its stylesheets and
// their fonts, its module and everything that imports, the manifest and its icons), written into
// <app>/sw.js between its `precache` markers, so the installed page starts without a network. The
// apps are the main game (the root: `game`, its worker sw.js), the race (race/), the idle game
// (idle/) and Redshift (sim/).
// `npm run sw`, `npm run race:sw`, `npm run idle:sw` or `npm run sim:sw` (node tools/app-sw.js <app>) after adding or removing a file
// that page loads; tests/run.js fails while a list is out of date.
//
//   appFiles(app) -> ['./', '../src/race/main.js', ...]   paths relative to <app>/, sorted
//   precacheBlock(files) -> the text between the markers
//   check(app) -> { text, current, wanted }   the list as <app>/sw.js has it, and as it should be
//   APPS: the apps there are
// Runs in Node.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APPS = ['game', 'race', 'idle', 'sim'];
// Where an app's page and worker are: the main game's at the root, the others' in their folders.
const dirOf = (app) => (app === 'game' ? ROOT : path.join(ROOT, app));
const swName = (app) => (app === 'game' ? 'sw.js' : `${app}/sw.js`);
const MARK = /(\/\/ precache:start\n)[\s\S]*?(\n\/\/ precache:end)/;

// What a file refers to, as paths relative to it: by its kind.
const refs = {
  '.html': (s) => [...s.matchAll(/<(?:link|script)\b[^>]*?\b(?:href|src)="([^"]+)"/g)].map((m) => m[1]),
  '.css': (s) => [...s.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)].map((m) => m[1]),
  '.js': (s) => [...s.matchAll(/^\s*(?:import|export)\b[^'";]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)|^\s*import\s*['"]([^'"]+)['"]/gm)].map((m) => m[1] || m[2] || m[3]),
  '.webmanifest': (s) => (JSON.parse(s).icons || []).map((i) => i.src),
};

function appFiles(app) {
  const DIR = dirOf(app);
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    if (!fs.existsSync(file)) throw new Error(`${swName(app)}: ${path.relative(ROOT, file)} is loaded but missing`);
    seen.add(file);
    const read = refs[path.extname(file)];
    if (!read) return;
    for (const ref of read(fs.readFileSync(file, 'utf8'))) {
      if (/^(?:[a-z]+:|\/\/|#)/i.test(ref)) continue; // another site, data: or a fragment: not ours
      visit(path.resolve(path.dirname(file), ref.split(/[?#]/)[0]));
    }
  };
  visit(path.join(DIR, 'index.html'));
  // The page is cached as the scope ('./', where the manifest starts it), not as index.html.
  return [...seen].map((f) => (f === path.join(DIR, 'index.html') ? './' : path.relative(DIR, f).split(path.sep).join('/'))).sort();
}

const precacheBlock = (files) => `const FILES = [\n${files.map((f) => `  '${f}',`).join('\n')}\n];`;

// The list as <app>/sw.js has it now, and as it should be.
function check(app) {
  const text = fs.readFileSync(path.join(dirOf(app), 'sw.js'), 'utf8'), m = text.match(MARK);
  if (!m) throw new Error(`${swName(app)}: no precache:start / precache:end markers`);
  const block = text.slice(m.index + m[1].length, m.index + m[0].length - m[2].length);
  return { text, current: block, wanted: precacheBlock(appFiles(app)) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = process.argv[2];
  if (!APPS.includes(app)) throw new Error(`usage: node tools/app-sw.js ${APPS.join('|')}`);
  const { text, current, wanted } = check(app);
  if (current === wanted) console.log(`${swName(app)}: the file list is up to date`);
  else {
    fs.writeFileSync(path.join(dirOf(app), 'sw.js'), text.replace(MARK, (_, a, b) => a + wanted + b));
    console.log(`${swName(app)}: ${appFiles(app).length} files written`);
  }
}

export { APPS, appFiles, precacheBlock, check };
