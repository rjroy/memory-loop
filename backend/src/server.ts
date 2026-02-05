/**
 * Hono server configuration for Memory Loop
 *
 * Provides:
 * - WebSocket upgrade handler at /ws
 * - Server configuration utilities (port, host, TLS)
 *
 * REST API routes have moved to Next.js (nextjs/app/api/).
 */

import { Hono } from "hono";
import { upgradeWebSocket, websocket } from "hono/bun";
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
 * Create and configure the Hono application.
 * Now only handles WebSocket upgrades; REST routes are in Next.js.
 */
export const createApp = () => {
  const app = new Hono();

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
