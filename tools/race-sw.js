// The race's offline file list: every file race/index.html loads (its stylesheets and their fonts,
// its module and everything that imports, the manifest and its icons), written into race/sw.js
// between its `precache` markers, so the installed race starts without a network.
// `npm run race:sw` after adding or removing a file the race loads; tests/run.js fails while the
// list in race/sw.js is out of date.
//
//   raceFiles() -> ['./', '../src/race/main.js', ...]   paths relative to race/, sorted
//   precacheBlock(files) -> the text between the markers
// Runs in Node.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RACE = path.join(ROOT, 'race');
const SW = path.join(RACE, 'sw.js');
const MARK = /(\/\/ precache:start\n)[\s\S]*?(\n\/\/ precache:end)/;

// What a file refers to, as paths relative to it: by its kind.
const refs = {
  '.html': (s) => [...s.matchAll(/<(?:link|script)\b[^>]*?\b(?:href|src)="([^"]+)"/g)].map((m) => m[1]),
  '.css': (s) => [...s.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)].map((m) => m[1]),
  '.js': (s) => [...s.matchAll(/^\s*(?:import|export)\b[^'";]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)|^\s*import\s*['"]([^'"]+)['"]/gm)].map((m) => m[1] || m[2] || m[3]),
  '.webmanifest': (s) => (JSON.parse(s).icons || []).map((i) => i.src),
};

function raceFiles() {
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    if (!fs.existsSync(file)) throw new Error(`race/sw.js: ${path.relative(ROOT, file)} is loaded but missing`);
    seen.add(file);
    const read = refs[path.extname(file)];
    if (!read) return;
    for (const ref of read(fs.readFileSync(file, 'utf8'))) {
      if (/^(?:[a-z]+:|\/\/|#)/i.test(ref)) continue; // another site, data: or a fragment: not ours
      visit(path.resolve(path.dirname(file), ref.split(/[?#]/)[0]));
    }
  };
  visit(path.join(RACE, 'index.html'));
  // The page is cached as the scope ('./', where the manifest starts it), not as index.html.
  return [...seen].map((f) => (f === path.join(RACE, 'index.html') ? './' : path.relative(RACE, f).split(path.sep).join('/'))).sort();
}

const precacheBlock = (files) => `const FILES = [\n${files.map((f) => `  '${f}',`).join('\n')}\n];`;

// The list as race/sw.js has it now, and as it should be.
function check() {
  const text = fs.readFileSync(SW, 'utf8'), m = text.match(MARK);
  if (!m) throw new Error('race/sw.js: no precache:start / precache:end markers');
  const block = text.slice(m.index + m[1].length, m.index + m[0].length - m[2].length);
  return { text, current: block, wanted: precacheBlock(raceFiles()) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { text, current, wanted } = check();
  if (current === wanted) console.log('race/sw.js: the file list is up to date');
  else {
    fs.writeFileSync(SW, text.replace(MARK, (_, a, b) => a + wanted + b));
    console.log(`race/sw.js: ${raceFiles().length} files written`);
  }
}

export { raceFiles, precacheBlock, check };
