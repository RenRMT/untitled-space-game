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
    files: ['tests/**/*.js', 'tools/**/*.js', 'eslint.config.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.node, ...globals.browser } },
    rules: { 'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }] },
  },
];
