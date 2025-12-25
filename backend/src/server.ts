/**
 * Hono server configuration for Memory Loop
 *
 * Provides:
 * - Health check endpoint at /api/health
 * - Vaults list endpoint at /api/vaults
 * - Vault asset serving at /vault/:vaultId/assets/*
 * - WebSocket upgrade handler at /ws
 * - Static file serving from frontend build
 * - CORS headers for local development
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
import { upgradeWebSocket, websocket } from "hono/bun";
import { join } from "node:path";
import { lstat, readFile } from "node:fs/promises";
import { discoverVaults, VaultsDirError } from "./vault-manager";
import { createWebSocketHandler } from "./websocket-handler";
import { isPathWithinVault } from "./file-browser";
import { getSessionForVault } from "./session-manager";
import { serverLog as log } from "./logger";

/**
 * Allowed image extensions for vault asset serving.
 */
const ALLOWED_IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".webp",
]);

/**
 * Content-Type mapping for image extensions.
 */
const IMAGE_CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

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

  // Session lookup endpoint - returns sessionId if a session exists for this vault
  app.get("/api/sessions/:vaultId", async (c) => {
    const vaultId = c.req.param("vaultId");
    const sessionId = await getSessionForVault(vaultId);
    return c.json({ sessionId });
  });

  // Vault asset serving endpoint
  // Serves images from vault with security validation
  app.get("/vault/:vaultId/assets/*", async (c) => {
    const vaultId = c.req.param("vaultId");
    // Extract the path after /vault/:vaultId/assets/
    const url = new URL(c.req.url);
    const prefix = `/vault/${vaultId}/assets/`;
    const assetPath = url.pathname.startsWith(prefix)
      ? url.pathname.slice(prefix.length)
      : "";

    // Find the vault
    let vaults;
    try {
      vaults = await discoverVaults();
    } catch (error) {
      log.error("Failed to discover vaults for asset serving:", error);
      return c.json({ error: "Internal server error" }, 500);
    }

    const vault = vaults.find((v) => v.id === vaultId);
    if (!vault) {
      return c.json({ error: "Vault not found" }, 404);
    }

    // Validate file extension
    const ext = assetPath.substring(assetPath.lastIndexOf(".")).toLowerCase();
    if (!ALLOWED_IMAGE_EXTENSIONS.has(ext)) {
      return c.json({ error: "Invalid file type" }, 400);
    }

    // Build full path and validate it's within vault
    const fullPath = join(vault.path, assetPath);
    if (!(await isPathWithinVault(vault.path, fullPath))) {
      log.warn(`Path traversal attempt: ${assetPath}`);
      return c.json({ error: "Access denied" }, 403);
    }

    // Check file exists and is not a symlink
    try {
      const stats = await lstat(fullPath);

      if (stats.isSymbolicLink()) {
        log.warn(`Symlink access attempt: ${assetPath}`);
        return c.json({ error: "Access denied" }, 403);
      }

      if (!stats.isFile()) {
        return c.json({ error: "Not a file" }, 400);
      }
    } catch {
      return c.json({ error: "File not found" }, 404);
    }

    // Read and serve the file
    try {
      const content = await readFile(fullPath);
      const contentType = IMAGE_CONTENT_TYPES[ext] || "application/octet-stream";

      return new Response(content, {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=86400", // Cache for 1 day
        },
      });
    } catch (error) {
      log.error(`Failed to read asset: ${assetPath}`, error);
      return c.json({ error: "Failed to read file" }, 500);
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
