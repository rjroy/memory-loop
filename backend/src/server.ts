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
import { uploadFile } from "./file-upload";
import { serverLog as log } from "./logger";
import { vaultRoutes } from "./routes";
import { globalMemoryRoutes } from "./routes/memory";
import { restErrorHandler } from "./middleware/error-handler";

/**
 * Allowed extensions for vault asset serving (images, videos, PDFs).
 */
const ALLOWED_ASSET_EXTENSIONS = new Set([
  // Images
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".webp",
  ".avif",
  ".bmp",
  ".ico",
  // Videos
  ".mp4",
  ".mov",
  ".webm",
  ".ogg",
  ".m4v",
  // Documents
  ".pdf",
]);

/**
 * Content-Type mapping for asset extensions.
 */
const ASSET_CONTENT_TYPES: Record<string, string> = {
  // Images
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  // Videos
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".ogg": "video/ogg",
  ".m4v": "video/x-m4v",
  // Documents
  ".pdf": "application/pdf",
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
 * TLS configuration for HTTPS support.
 * Returns undefined if TLS is not configured, otherwise returns the tls options object.
 *
 * Required environment variables for TLS:
 * - TLS_CERT: Path to the certificate file (PEM format)
 * - TLS_KEY: Path to the private key file (PEM format)
 *
 * Optional:
 * - TLS_PASSPHRASE: Passphrase for encrypted private keys
 * - TLS_CA: Path to CA certificate chain file (for client cert verification)
 */
export const getTlsConfig = ():
  | {
      cert: ReturnType<typeof Bun.file>;
      key: ReturnType<typeof Bun.file>;
      passphrase?: string;
      ca?: ReturnType<typeof Bun.file>;
    }
  | undefined => {
  const certPath = process.env.TLS_CERT;
  const keyPath = process.env.TLS_KEY;

  // Both cert and key are required for TLS
  if (!certPath || !keyPath) {
    return undefined;
  }

  const config: {
    cert: ReturnType<typeof Bun.file>;
    key: ReturnType<typeof Bun.file>;
    passphrase?: string;
    ca?: ReturnType<typeof Bun.file>;
  } = {
    cert: Bun.file(certPath),
    key: Bun.file(keyPath),
  };

  // Optional passphrase for encrypted private keys
  const passphrase = process.env.TLS_PASSPHRASE;
  if (passphrase) {
    config.passphrase = passphrase;
  }

  // Optional CA certificate chain
  const caPath = process.env.TLS_CA;
  if (caPath) {
    config.ca = Bun.file(caPath);
  }

  return config;
};

/**
 * Check if TLS is enabled based on environment configuration
 */
export const isTlsEnabled = (): boolean => {
  return Boolean(process.env.TLS_CERT && process.env.TLS_KEY);
};

/**
 * Get the HTTP redirect port when TLS is enabled.
 * This port serves HTTP requests and redirects them to HTTPS.
 *
 * Environment variable: HTTP_PORT (default: 80)
 */
export const getHttpRedirectPort = (): number => {
  const envPort = process.env.HTTP_PORT;
  if (envPort) {
    const parsed = parseInt(envPort, 10);
    if (!isNaN(parsed) && parsed > 0 && parsed <= 65535) {
      return parsed;
    }
    log.warn(`Invalid HTTP_PORT "${envPort}", using default 80`);
  }
  return 80;
};

/**
 * Create an HTTP server that redirects all requests to HTTPS.
 * Returns the Bun server configuration for the redirect server.
 */
export const createHttpRedirectServer = (httpsPort: number) => {
  return {
    port: getHttpRedirectPort(),
    hostname: getHost(),
    fetch(req: Request) {
      const url = new URL(req.url);
      // Redirect to HTTPS, preserving path and query
      const httpsUrl = `https://${url.hostname}:${httpsPort}${url.pathname}${url.search}`;
      return Response.redirect(httpsUrl, 308);
    },
  };
};

/**
 * Create and configure the Hono application
 */
export const createApp = () => {
  const app = new Hono();

  // Global error handler for REST API routes
  // Maps domain exceptions to HTTP status codes with JSON error bodies
  app.onError(restErrorHandler);

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

  // Global memory routes - memory.md is user-global, not vault-scoped
  // Routes: GET/PUT /api/config/memory
  app.route("/api/config/memory", globalMemoryRoutes);

  // Vault asset serving endpoint
  // Serves images from vault with security validation
  app.get("/vault/:vaultId/assets/*", async (c) => {
    const vaultId = c.req.param("vaultId");
    // Extract the path after /vault/:vaultId/assets/ and decode URL encoding
    const url = new URL(c.req.url);
    const prefix = `/vault/${vaultId}/assets/`;
    const encodedPath = url.pathname.startsWith(prefix)
      ? url.pathname.slice(prefix.length)
      : "";
    const assetPath = decodeURIComponent(encodedPath);

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
    if (!ALLOWED_ASSET_EXTENSIONS.has(ext)) {
      return c.json({ error: "Invalid file type" }, 400);
    }

    // Build full path and validate it's within vault contentRoot
    const fullPath = join(vault.contentRoot, assetPath);
    if (!(await isPathWithinVault(vault.contentRoot, fullPath))) {
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
      const contentType = ASSET_CONTENT_TYPES[ext] || "application/octet-stream";

      return new Response(new Uint8Array(content), {
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

  // Image upload endpoint
  // Handles multipart/form-data image uploads to vault attachments directory
  app.post("/vault/:vaultId/upload", async (c) => {
    const vaultId = c.req.param("vaultId");
    log.info(`Image upload request for vault: ${vaultId}`);

    // Find the vault
    let vaults;
    try {
      vaults = await discoverVaults();
    } catch (error) {
      log.error("Failed to discover vaults for upload:", error);
      return c.json({ error: "Internal server error" }, 500);
    }

    const vault = vaults.find((v) => v.id === vaultId);
    if (!vault) {
      return c.json({ error: "Vault not found" }, 404);
    }

    // Parse multipart form data
    let formData;
    try {
      formData = await c.req.formData();
    } catch (error) {
      log.error("Failed to parse form data:", error);
      return c.json({ error: "Failed to parse form data" }, 400);
    }

    // Accept both "file" (preferred) and "image" (backward compat) field names
    const file = formData.get("file") ?? formData.get("image");

    if (!file || !(file instanceof File)) {
      return c.json({ error: "No file provided" }, 400);
    }

    // Convert to buffer
    let buffer: Buffer;
    try {
      buffer = Buffer.from(await file.arrayBuffer());
    } catch (error) {
      log.error("Failed to read file data:", error);
      return c.json({ error: "Failed to read file data" }, 400);
    }

    // Upload file
    const result = await uploadFile(
      vault.path,
      vault.contentRoot,
      vault.attachmentPath,
      buffer,
      file.name
    );

    if (!result.success) {
      return c.json({ error: result.error }, 400);
    }

    return c.json({ success: true, path: result.path });
  });

  // Vault-scoped REST API routes
  // All routes at /api/vaults/:vaultId/* go through vault resolution middleware
  // CORS is already applied to /api/* above, so these routes inherit it
  app.route("/api/vaults/:vaultId", vaultRoutes);

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

// Build server configuration for Bun.serve
const baseConfig = {
  port: getPort(),
  hostname: getHost(),
  fetch: app.fetch,
  websocket,
};

// Add TLS configuration if enabled
const tlsConfig = getTlsConfig();

// Export server configuration for Bun.serve
export const serverConfig = tlsConfig
  ? { ...baseConfig, tls: tlsConfig }
  : baseConfig;
