// Playwright configuration for static preview
// BASE_URL is injected by workflow or defaults to local dev server
const baseURL = process.env.BASE_URL || 'http://localhost:8787/tax-unified-platform';

/** @type {import('@playwright/test').PlaywrightTestConfig} */
const config = {
  timeout: 30000,
  retries: 0,
  use: {
    baseURL,
    headless: true,
  },
  webServer: {
    command: 'python -m http.server 8787',
    port: 8787,
    reuseExistingServer: !process.env.CI,
    env: {},
    cwd: __dirname,
  },
};

module.exports = config;
