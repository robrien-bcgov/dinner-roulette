'use strict';

const js = require('@eslint/js');
const globals = require('globals');
const playwright = require('eslint-plugin-playwright');

module.exports = [
  { ignores: ['test-results/**', 'playwright-report/**'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: globals.node,
    },
  },
  {
    ...playwright.configs['flat/recommended'],
    files: ['**/*.test.js'],
  },
];