import { defineConfig } from '@playwright/test';

// Dedicated test preview: strictPort and no reuse protect unrelated services.
const previewPort = 47173;
const previewOrigin = `http://127.0.0.1:${previewPort}`;

export default defineConfig({
  testDir: 'tests/e2e',
  testIgnore: 'recall.spec.ts',
  use: {
    baseURL: previewOrigin,
    browserName: 'chromium',
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH },
  },
  webServer: {
    command: `bun --no-env-file run build && bun --no-env-file x vite preview --host 127.0.0.1 --port ${previewPort} --strictPort`,
    url: previewOrigin,
    reuseExistingServer: false,
  },
});
