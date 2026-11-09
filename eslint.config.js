// Lint rules: `npm run lint`. ESLint's recommended set (undefined names, unused variables, ...)
// plus no shadowing of names from an outer scope, which hid real bugs while game.js was one file.
import js from '@eslint/js';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    files: ['src/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: globals.browser },
    rules: {
      'no-shadow': ['error', { builtinGlobals: false }],
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
    },
  },
  {
    // The race sits beside src/game in the layers (notes/race.md): it shares the game's art, flying
    // and rules, never the game's own state or panels.
    files: ['src/race/**/*.js'],
    rules: { 'no-restricted-imports': ['error', { patterns: [{ group: ['**/game/*', '**/ui/*'], message: 'src/race imports src/core, art, flight and rules only (notes/race.md).' }] }] },
  },
  {
    // The idle game (idle/, src/idle/) is built on the shared layers too: core, art, world and rules,
    // and the game's UI kit (ui/kit.js and what it's built on), never the game's own state or panels.
    files: ['src/idle/**/*.js'],
    rules: { 'no-restricted-imports': ['error', { patterns: [{ group: ['**/game/*', '**/ui/*', '!**/ui/kit.js', '!**/ui/ui.js', '!**/ui/glyphs.js'], message: 'src/idle imports src/core, art, world, rules and the UI kit only (notes/idle.md).' }] }] },
  },
  {
    // The 4X game (4x/, src/4x/, notes/4x.md) is built on the shared layers too: core, art, world
    // and rules, and the game's UI kit, never the main game's own state, flight or panels.
    files: ['src/4x/**/*.js'],
    rules: { 'no-restricted-imports': ['error', { patterns: [{ group: ['**/game/*', '**/flight/*', '**/ui/*', '!**/ui/kit.js', '!**/ui/ui.js', '!**/ui/glyphs.js'], message: 'src/4x imports src/core, art, world, rules and the UI kit only (notes/4x.md).' }] }] },
  },
  {
    // Redshift, the sim (sim/, src/sim/, notes/sim.md), is built on the shared layers too: core, art,
    // world and rules, and the game's UI kit, never the main game's own state, flight or panels.
    files: ['src/sim/**/*.js'],
    rules: { 'no-restricted-imports': ['error', { patterns: [{ group: ['**/game/*', '**/flight/*', '**/ui/*', '!**/ui/kit.js', '!**/ui/ui.js', '!**/ui/glyphs.js'], message: 'src/sim imports src/core, art, world, rules and the UI kit only (notes/sim.md).' }] }] },
  },
  {
    // The race's and the idle game's service workers: a worker's globals, not a page's.
    files: ['race/sw.js', 'idle/sw.js', 'sim/sw.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'script', globals: globals.serviceworker },
  },
  {
    files: ['tests/**/*.js', 'tools/**/*.js', 'eslint.config.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.node, ...globals.browser } },
    rules: { 'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }] },
  },
];
