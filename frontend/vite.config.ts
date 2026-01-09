import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execSync } from "child_process";

function getGitCommit(): string {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

/**
 * Vite configuration for Memory Loop frontend
 *
 * - React plugin for JSX transform and Fast Refresh
 * - Proxy /api and /ws to backend server for development
 * - Injects git commit SHA as __APP_VERSION__ for version watermark
 */
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(getGitCommit()),
  },
  server: {
    port: 5173,
    proxy: {
      // Proxy API requests to backend
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
      // Proxy WebSocket connections for real-time updates
      "/ws": {
        target: "ws://localhost:3000",
        ws: true,
      },
    },
  },
  build: {
    // Output to dist directory
    outDir: "dist",
    // Generate sourcemaps for debugging
    sourcemap: true,
  },
});
