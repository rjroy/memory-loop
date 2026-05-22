import { createLogger } from "@memory-loop/shared";
import { startServer } from "./server";
import { initVaultCache } from "./vault";
import { loadGlobalConfig } from "./global-config";
import { checkCwebpAvailability } from "./files/utils/image-converter";
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
  return xdgRuntime ? `${xdgRuntime}/memory-loop.sock` : "/tmp/memory-loop.sock";
}

const socketPath =
  process.env.DAEMON_SOCKET ?? (process.env.DAEMON_PORT ? undefined : getDefaultSocketPath());
const port = process.env.DAEMON_PORT ? parseInt(process.env.DAEMON_PORT, 10) : undefined;

// Initialize caches before accepting requests so early requests don't hit empty state.
await initVaultCache();
await loadGlobalConfig();

// REQ-IMAGE-WEBP-15/16: probe binary but continue regardless of result.
await checkCwebpAvailability();

// Scheduler failures are logged but don't prevent startup.
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
  await startCardDiscoveryScheduler({ discoveryHour: hour, catchUpOnStartup: true });
  log.info(`Card discovery scheduler started (daily at ${hour}:00)`);
} catch (error: unknown) {
  log.error("Failed to start card discovery scheduler", error);
}

const server = startServer({ socketPath, port, startTime });

log.info("Memory Loop daemon started");

function shutdown(): void {
  log.info("Shutting down...");
  stopExtractionScheduler();
  stopCardDiscoveryScheduler();
  server.stop();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
