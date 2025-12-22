/**
 * Hono server configuration for Memory Loop
 *
 * Provides:
 * - Health check endpoint at /api/health
 * - WebSocket upgrade handler at /ws
 * - Static file serving from frontend build
 * - CORS headers for local development
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
import { upgradeWebSocket, websocket } from "hono/bun";

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
    console.warn(`Invalid PORT "${envPort}", using default 3000`);
  }
  return 3000;
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

  // WebSocket upgrade handler at /ws
  // Full message handling implemented in TASK-008
  app.get(
    "/ws",
    upgradeWebSocket(() => {
      return {
        onOpen(_event, ws) {
          console.log("WebSocket connection opened");
          ws.send(JSON.stringify({ type: "connected" }));
        },
        onMessage(event, ws) {
          // event.data can be string, ArrayBuffer, or Blob
          const data = event.data;
          const message =
            typeof data === "string"
              ? data
              : data instanceof ArrayBuffer
                ? new TextDecoder().decode(data)
                : "[binary]";
          console.log("WebSocket message received:", message);
          // Message handling to be implemented in TASK-008
          ws.send(
            JSON.stringify({
              type: "ack",
              message: "Message received",
            })
          );
        },
        onClose() {
          console.log("WebSocket connection closed");
        },
        onError(event) {
          console.error("WebSocket error:", event);
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
  fetch: app.fetch,
  websocket,
};
