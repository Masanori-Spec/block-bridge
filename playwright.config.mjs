import { defineConfig } from '@playwright/test';

// CI uses a regular hosted Ubuntu 22.04 user. Do not disable Chromium's sandbox
// to make a restricted container pass; a launch blocker must remain a blocker.
export default defineConfig({
  testDir: './tests/browser',
  testMatch: '**/*.spec.mjs',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 6_000 },
  reporter: [['list'], ['./tests/browser/safe-reporter.mjs']],
  outputDir: 'artifacts/browser/test-output',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    browserName: 'chromium',
    acceptDownloads: true,
    locale: 'en-US',
    timezoneId: 'UTC',
    colorScheme: 'light',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
    trace: 'off',
    video: 'off',
    screenshot: 'off',
    launchOptions: { chromiumSandbox: true },
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile-390', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
