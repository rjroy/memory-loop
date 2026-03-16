/**
 * Daemon HTTP server
 *
 * Listens on a Unix socket (default) or localhost TCP port (fallback).
 * Uses Hono for routing with native Bun adapter.
 */

import { unlinkSync, existsSync } from "node:fs";
import { Hono } from "hono";
import { createLogger } from "@memory-loop/shared";
import { registerRoutes } from "./router";

const log = createLogger("daemon-server");

export interface ServerConfig {
  socketPath?: string;
  port?: number;
  startTime: number;
}

/**
 * Create the Hono app with all routes registered.
 */
export function createApp(startTime: number): Hono {
  const app = new Hono();
  registerRoutes(app, startTime);
  return app;
}

/**
 * Start the daemon server.
 *
 * Prefers Unix socket (DAEMON_SOCKET env or default path).
 * Falls back to localhost TCP if DAEMON_PORT is set.
 */
export function startServer(config: ServerConfig): { stop: () => void } {
  const { socketPath, port, startTime } = config;
  const app = createApp(startTime);

  if (socketPath) {
    // Clean up stale socket from a previous crash
    if (existsSync(socketPath)) {
      log.warn(`Removing stale socket file: ${socketPath}`);
      unlinkSync(socketPath);
    }

    const server = Bun.serve({
      unix: socketPath,
      fetch: app.fetch,
    });

    log.info(`Listening on Unix socket: ${socketPath}`);

    return {
      stop: () => {
        server.stop();
        try {
          unlinkSync(socketPath);
        } catch {
          // Best effort cleanup
        }
      },
    };
  }

  if (port) {
    const server = Bun.serve({
      port,
      hostname: "127.0.0.1",
      fetch: app.fetch,
    });

    log.info(`Listening on http://127.0.0.1:${port}`);

    return {
      stop: () => {
        server.stop();
      },
    };
  }

  throw new Error("Either socketPath or port must be specified");
}
