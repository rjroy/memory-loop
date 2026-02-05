/**
 * Next.js Instrumentation
 *
 * Called once on server startup. Initializes background schedulers
 * that were previously started in backend/src/index.ts.
 */

export async function register() {
  // Only run schedulers on the server, not during build
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Lazy import to avoid loading backend code during build
  const { startScheduler, getCronSchedule } = await import(
    "@memory-loop/backend/extraction/extraction-manager"
  );
  const {
    startScheduler: startCardDiscoveryScheduler,
    getDiscoveryHourFromEnv,
  } = await import(
    "@memory-loop/backend/spaced-repetition/card-discovery-scheduler"
  );

  if (process.env.NODE_ENV === "development") {
    console.log("[instrumentation] Schedulers disabled in development mode");
    return;
  }

  // Extraction scheduler: daily at configured time (default: 3am)
  try {
    const started = await startScheduler();
    if (started) {
      console.log(
        `[instrumentation] Extraction scheduler started: ${getCronSchedule()}`
      );
    } else {
      console.warn("[instrumentation] Extraction scheduler failed to start");
    }
  } catch (error: unknown) {
    console.error("[instrumentation] Failed to start extraction scheduler:", error);
  }

  // Card discovery scheduler: daily at configured time (default: 4am)
  try {
    await startCardDiscoveryScheduler({
      discoveryHour: getDiscoveryHourFromEnv(),
      catchUpOnStartup: true,
    });
    console.log(
      `[instrumentation] Card discovery scheduler started (daily at ${getDiscoveryHourFromEnv()}:00)`
    );
  } catch (error: unknown) {
    console.error(
      "[instrumentation] Failed to start card discovery scheduler:",
      error
    );
  }
}
