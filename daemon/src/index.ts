/**
 * Memory Loop daemon entry point.
 *
 * Starts the HTTP server on a Unix socket (default) or localhost TCP port.
 * Handles SIGTERM/SIGINT for clean shutdown.
 */

import { createLogger } from "@memory-loop/shared";
import { startServer } from "./server";
import { initVaultCache } from "./vault";

const log = createLogger("daemon");
const startTime = Date.now();

function getDefaultSocketPath(): string {
  const xdgRuntime = process.env.XDG_RUNTIME_DIR;
  if (xdgRuntime) {
    return `${xdgRuntime}/memory-loop.sock`;
  }
  return "/tmp/memory-loop.sock";
}

const socketPath = process.env.DAEMON_SOCKET ?? (process.env.DAEMON_PORT ? undefined : getDefaultSocketPath());
const port = process.env.DAEMON_PORT ? parseInt(process.env.DAEMON_PORT, 10) : undefined;

// Initialize vault cache before accepting requests to prevent
// early requests hitting an empty cache.
await initVaultCache();

const server = startServer({ socketPath, port, startTime });

log.info("Memory Loop daemon started");

function shutdown() {
  log.info("Shutting down...");
  server.stop();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
