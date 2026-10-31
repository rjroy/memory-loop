import { defineConfig } from 'vitest/config';

export default defineConfig({
  envDir: false,
  test: { environment: 'node', include: ['backend/opencode-capabilities.test.ts', 'backend/think-full-stack.test.ts'] },
});
