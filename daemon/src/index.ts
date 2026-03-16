/**
 * Memory Loop daemon entry point.
 *
 * Starts the HTTP server on a Unix socket (default) or localhost TCP port.
 * Initializes SDK, vault cache, and background schedulers on boot.
 * Handles SIGTERM/SIGINT for clean shutdown.
 */

import { createLogger } from "@memory-loop/shared";
import { startServer } from "./server";
import { initVaultCache } from "./vault";
import { checkCwebpAvailability } from "./files/utils/image-converter";
import { initializeSdkProvider } from "./sdk-provider";
import {
  startScheduler as startExtractionScheduler,
  stopScheduler as stopExtractionScheduler,
  getCronSchedule,
} from "./extraction/extraction-manager";
import {
  startScheduler as startCardDiscoveryScheduler,
  stopScheduler as stopCardDiscoveryScheduler,
  getDiscoveryHourFromEnv,
} from "./spaced-repetition/card-discovery-scheduler";

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

// Initialize SDK provider so schedulers can call getSdkQuery() on catch-up
initializeSdkProvider();

// Initialize vault cache before accepting requests to prevent
// early requests hitting an empty cache.
await initVaultCache();

// Check cwebp binary availability (REQ-IMAGE-WEBP-15)
// Server continues regardless of result (REQ-IMAGE-WEBP-16)
await checkCwebpAvailability();

// Start background schedulers. Failures are logged but don't prevent startup.

try {
  const started = await startExtractionScheduler();
  if (started) {
    log.info(`Extraction scheduler started: ${getCronSchedule()}`);
  } else {
    log.warn("Extraction scheduler failed to start");
  }
} catch (error: unknown) {
  log.error("Failed to start extraction scheduler", error);
}

try {
  const hour = getDiscoveryHourFromEnv();
  await startCardDiscoveryScheduler({
    discoveryHour: hour,
    catchUpOnStartup: true,
  });
  log.info(`Card discovery scheduler started (daily at ${hour}:00)`);
} catch (error: unknown) {
  log.error("Failed to start card discovery scheduler", error);
}

const server = startServer({ socketPath, port, startTime });

log.info("Memory Loop daemon started");

function shutdown() {
  log.info("Shutting down...");
  stopExtractionScheduler();
  stopCardDiscoveryScheduler();
  server.stop();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
