// Playwright's `test`, with the mock API installed on every page (no test
// reaches a real backend). Tests seed it through the `api` fixture.
import { test as base } from '@playwright/test';
import { MockApi } from './mock-api.js';

export { expect } from '@playwright/test';

export const test = base.extend<{ api: MockApi }>({
  api: [
    async ({ page }, use) => {
      const api = new MockApi();
      await api.install(page);
      await use(api);
    },
    { auto: true }
  ]
});
