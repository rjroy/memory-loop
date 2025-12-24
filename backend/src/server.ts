/**
 * Hono server configuration for Memory Loop
 *
 * Provides:
 * - Health check endpoint at /api/health
 * - Vaults list endpoint at /api/vaults
 * - WebSocket upgrade handler at /ws
 * - Static file serving from frontend build
 * - CORS headers for local development
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
import { upgradeWebSocket, websocket } from "hono/bun";
import { discoverVaults, VaultsDirError } from "./vault-manager";
import { createWebSocketHandler } from "./websocket-handler";
import { serverLog as log } from "./logger";

/**
 * Get the port from environment variable or use default
 */
export const getPort = (): number => {
  const envPort = process.env.PORT;
  if (envPort) {
    const parsed = parseInt(envPort, 10);
    if (!isNaN(parsed) && parsed > 0 && parsed <= 65535) {
      return parsed;
    }
    log.warn(`Invalid PORT "${envPort}", using default 3000`);
  }
  return 3000;
};

/**
 * Get the host from environment variable or use default
 * Defaults to "0.0.0.0" to allow remote connections
 */
export const getHost = (): string => {
  const envHost = process.env.HOST;
  if (envHost) {
    return envHost;
  }
  return "0.0.0.0";
};

/**
 * Create and configure the Hono application
 */
export const createApp = () => {
  const app = new Hono();

  // CORS middleware for development
  // Note: CORS is applied before non-WebSocket routes only
  // WebSocket routes handle upgrades before CORS can modify headers
  app.use(
    "/api/*",
    cors({
      origin: ["http://localhost:5173", "http://localhost:3000"],
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
      credentials: true,
    })
  );

  // Health check endpoint
  app.get("/api/health", (c) => {
    return c.text("Memory Loop Backend");
  });

  // Vaults list endpoint
  app.get("/api/vaults", async (c) => {
    try {
      const vaults = await discoverVaults();
      return c.json({ vaults });
    } catch (error) {
      if (error instanceof VaultsDirError) {
        return c.json({ error: error.message }, 500);
      }
      // Re-throw unexpected errors
      throw error;
    }
  });

  // WebSocket upgrade handler at /ws
  // Each connection gets its own handler instance for state isolation
  app.get(
    "/ws",
    upgradeWebSocket(() => {
      const handler = createWebSocketHandler();

      return {
        onOpen(_event, ws) {
          log.info("WebSocket connection opened");
          // Send vault list on connection
          handler.onOpen(ws).catch((error) => {
            log.error("Error in WebSocket onOpen:", error);
          });
        },
        onMessage(event, ws) {
          // event.data can be string, ArrayBuffer, or Blob
          const data = event.data;
          if (data instanceof Blob) {
            // Convert Blob to text, then handle
            void data.text().then((text) => {
              void handler.onMessage(ws, text).catch((error) => {
                log.error("Error in WebSocket onMessage:", error);
              });
            });
          } else if (typeof data === "string") {
            // String data
            void handler.onMessage(ws, data).catch((error) => {
              log.error("Error in WebSocket onMessage:", error);
            });
          } else if (data instanceof ArrayBuffer) {
            // ArrayBuffer data
            void handler.onMessage(ws, data).catch((error) => {
              log.error("Error in WebSocket onMessage:", error);
            });
          } else {
            // SharedArrayBuffer or other - convert to string
            const text = new TextDecoder().decode(new Uint8Array(data as ArrayBufferLike));
            void handler.onMessage(ws, text).catch((error) => {
              log.error("Error in WebSocket onMessage:", error);
            });
          }
        },
        onClose() {
          log.info("WebSocket connection closed");
          handler.onClose().catch((error) => {
            log.error("Error in WebSocket onClose:", error);
          });
        },
        onError(event) {
          log.error("WebSocket error:", event);
        },
      };
    })
  );

  // Static file serving from frontend build directory
  // Serves files from ../frontend/dist relative to backend
  app.use(
    "/*",
    serveStatic({
      root: "../frontend/dist",
      rewriteRequestPath: (path) => path,
    })
  );

  // Fallback to index.html for SPA routing
  app.get("*", serveStatic({ path: "../frontend/dist/index.html" }));

  return app;
};

// Create the app instance
export const app = createApp();

// Export server configuration for Bun.serve
export const serverConfig = {
  port: getPort(),
  hostname: getHost(),
  fetch: app.fetch,
  websocket,
};
