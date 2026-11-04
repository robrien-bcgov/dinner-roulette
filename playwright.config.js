'use strict';

const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testMatch: '**/*.test.js',
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    channel: 'msedge',
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});