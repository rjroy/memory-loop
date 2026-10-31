import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  envDir: false,
  test: {
    environment: 'node',
    include: ['backend/**/*.test.ts', 'src/web/**/*.test.ts'],
    exclude: [...configDefaults.exclude, 'backend/opencode-capabilities.test.ts'],
  },
});
