import { defineConfig, devices } from '@playwright/test';

const port = 5173;
const ci = !!process.env.CI;

export default defineConfig({
  // Vitest owns `src/**/*.test.ts`; Playwright only looks here.
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: ci,
  retries: ci ? 2 : 0,
  // `list` for the console; the HTML report is written but never opened, so
  // CI can upload it and local runs don't block on a browser.
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'on-first-retry'
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', use: { ...devices['Pixel 7'] } }
  ],
  webServer: {
    command: `pnpm exec vite dev --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !ci
  }
});
