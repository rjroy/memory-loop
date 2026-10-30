import { defineConfig } from '@playwright/test';

// The test fixture owns its daemon and disposable vault; it never reuses preview.
export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: 'recall.spec.ts',
  use: {
    browserName: 'chromium',
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH },
  },
});
