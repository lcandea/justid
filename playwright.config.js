// @ts-check
import { defineConfig, devices } from '@playwright/test';

const PORT = 8766;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: true,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: 'es-ES',
    acceptDownloads: true,
  },
  // Chromium projects: locally the installed Chrome (no browser download); CI installs Playwright's Chromium.
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], channel: process.env.CI ? undefined : 'chrome' } },
    { name: 'mobile', use: { ...devices['Pixel 7'], channel: process.env.CI ? undefined : 'chrome' } },
    // Safari's engine (every iPhone browser uses it): Playwright's WebKit, installed with `npx playwright install webkit`.
    { name: 'iphone', use: { ...devices['iPhone 13'] } },
  ],
  webServer: {
    command: `python3 tools/serve.py ${PORT}`,
    url: `http://localhost:${PORT}/app/`,
    reuseExistingServer: !process.env.CI,
  },
});
