/**
 * Scheduler Bootstrap
 *
 * Isolates scheduler startup from instrumentation.ts so that
 * turbopack (dev) never needs to resolve dependencies like cron's
 * child_process or node:crypto. instrumentation.ts returns early
 * in development mode before importing this module.
 *
 * This module is only loaded in production.
 */

import {
  startScheduler as startExtractionScheduler,
  getCronSchedule,
} from "./extraction/extraction-manager";
import {
  startScheduler as startCardDiscoveryScheduler,
  getDiscoveryHourFromEnv,
} from "./spaced-repetition/card-discovery-scheduler";

interface Logger {
  info: (message: string, data?: unknown) => void;
  warn: (message: string, data?: unknown) => void;
  error: (message: string, data?: unknown) => void;
}

export async function bootstrapSchedulers(log: Logger): Promise<void> {
  // Extraction scheduler: daily at configured time (default: 3am)
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

  // Card discovery scheduler: daily at configured time (default: 4am)
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
}
