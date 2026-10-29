import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  envDir: false,
  envPrefix: 'MEMORY_LOOP_PUBLIC_',
  test: {
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.tsx'],
    setupFiles: ['tests/unit/setup.ts'],
  },
});
