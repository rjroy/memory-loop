import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Vite configuration for Memory Loop frontend
 *
 * - React plugin for JSX transform and Fast Refresh
 * - Proxy /api and /ws to backend server for development
 */
export default defineConfig({
  plugins: [react()],
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
