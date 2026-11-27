import { defineConfig, devices } from '@playwright/test';

// Its own port, so a `make dev` server (not in e2e mode) is never reused.
const port = 5174;
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
    // `e2e` mode swaps in the in-memory auth fake (src/lib/auth/index.ts).
    command: `pnpm exec vite dev --mode e2e --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !ci
  }
});
