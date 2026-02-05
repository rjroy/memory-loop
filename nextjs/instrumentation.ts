/**
 * Next.js Instrumentation
 *
 * Called once on server startup. Initializes background schedulers
 * that were previously started in backend/src/index.ts.
 *
 * Uses dynamic import() with webpackIgnore comments because
 * @memory-loop/backend is in transpilePackages, which causes webpack
 * to follow import chains and fail on Node.js-only modules like
 * child_process (used by cron).
 */

export async function register() {
  // Only run schedulers on the server, not during build or edge runtime
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  if (process.env.NODE_ENV === "development") {
    console.log("[instrumentation] Schedulers disabled in development mode");
    return;
  }

  // Dynamic import bypasses webpack's static analysis of transpiled packages.
  // Webpack traces static imports through transpilePackages and fails on
  // cron's child_process dependency.

  // Extraction scheduler: daily at configured time (default: 3am)
  try {
    const { startScheduler, getCronSchedule } = await import(
      /* webpackIgnore: true */
      "@memory-loop/backend/extraction/extraction-manager"
    );
    const started = await startScheduler();
    if (started) {
      console.log(
        `[instrumentation] Extraction scheduler started: ${getCronSchedule()}`
      );
    } else {
      console.warn("[instrumentation] Extraction scheduler failed to start");
    }
  } catch (error: unknown) {
    console.error(
      "[instrumentation] Failed to start extraction scheduler:",
      error
    );
  }

  // Card discovery scheduler: daily at configured time (default: 4am)
  try {
    const { startScheduler: startCardDiscoveryScheduler, getDiscoveryHourFromEnv } =
      await import(
        /* webpackIgnore: true */
        "@memory-loop/backend/spaced-repetition/card-discovery-scheduler"
      );
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
