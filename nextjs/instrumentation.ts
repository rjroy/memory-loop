/**
 * Next.js Instrumentation
 *
 * Called once on server startup. Initializes background schedulers
 * that were previously started in backend/src/index.ts.
 *
 * Import paths use webpackIgnore comments so the bundler skips
 * tracing into them. These modules use Node.js builtins
 * (child_process via cron, node:crypto) that turbopack can't
 * resolve during dev compilation.
 */

export async function register() {
  // Only run schedulers on the server, not during build or edge runtime
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  if (process.env.NODE_ENV === "development") {
    console.log("[instrumentation] Schedulers disabled in development mode");
    return;
  }

  // Extraction scheduler: daily at configured time (default: 3am)
  try {
    const { startScheduler, getCronSchedule } = await import(
      /* webpackIgnore: true */ "@/lib/extraction/extraction-manager"
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
        /* webpackIgnore: true */ "@/lib/spaced-repetition/card-discovery-scheduler"
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
