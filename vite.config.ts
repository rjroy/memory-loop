import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

function daemonTarget(): string {
  const configured = process.env.MEMORY_LOOP_DAEMON_URL ?? 'http://127.0.0.1:3000';
  let target: URL;
  try {
    target = new URL(configured);
  } catch {
    throw new Error('Invalid loopback daemon URL');
  }
  if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1' || target.username || target.password ||
      target.pathname !== '/' || target.search || target.hash) {
    throw new Error('Invalid loopback daemon URL');
  }
  return target.origin;
}

export default defineConfig({
  plugins: [react()],
  envDir: false,
  envPrefix: 'MEMORY_LOOP_PUBLIC_',
  server: {
    proxy: {
      '^/api(?:/|\\?|$)': { target: daemonTarget(), changeOrigin: true },
    },
  },
  // Preview is a static-only service; do not inherit the development API proxy.
  preview: { proxy: {} },
  test: {
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.tsx'],
    setupFiles: ['tests/unit/setup.ts'],
  },
});
